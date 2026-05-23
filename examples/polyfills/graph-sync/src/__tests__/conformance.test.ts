/**
 * Conformance tests for @living-web/graph-sync.
 *
 * Covers ContextDiff construction + immutability, revision determinism,
 * sync space derivation, and the Context.prototype extension installed by
 * `installSyncExtension`.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Triple,
  Context,
  GraphStorage,
  GraphStoreManager,
  EphemeralIdentity,
  type SignedTriple,
  type IdentityProvider,
} from '@living-web/personal-graph';

import {
  ContextDiff,
  DiffEvent,
  PeerEvent,
  SignalEvent,
  SyncStateChangeEvent,
  createContextDiff,
  computeRevision,
  deriveSpaceUri,
  installSyncExtension,
} from '../index.js';

// Install the extension once for the whole suite.
beforeAll(() => {
  installSyncExtension();
});

async function newManager(): Promise<GraphStoreManager> {
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  const storage = new GraphStorage(`gs-sync-${crypto.randomUUID()}`);
  return new GraphStoreManager(storage, async () => eph);
}

function waitForEvent<T extends Event>(object: EventTarget, type: string, timeoutMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    object.addEventListener(
      type,
      (e) => {
        clearTimeout(timer);
        resolve(e as T);
      },
      { once: true },
    );
  });
}

describe('§5.1 ContextDiff', () => {
  it('is immutable after construction', () => {
    const diff = new ContextDiff({
      graphDid: 'did:graph:abc',
      revision: 'deadbeef',
      additions: [],
      removals: [],
      dependencies: [],
      author: 'did:key:author',
      timestamp: 1700000000000,
    });
    expect(Object.isFrozen(diff)).toBe(true);
    expect(Object.isFrozen(diff.additions)).toBe(true);
    expect(Object.isFrozen(diff.removals)).toBe(true);
    expect(Object.isFrozen(diff.dependencies)).toBe(true);
  });

  it('carries the originating graph DID', () => {
    const diff = createContextDiff({
      graphDid: 'did:graph:abc',
      additions: [],
      removals: [],
      author: 'did:key:author',
    });
    expect(diff.graphDid).toBe('did:graph:abc');
  });
});

describe('§5.2 Revision', () => {
  it('is a 64-char hex SHA-256 string', () => {
    const rev = computeRevision('did:graph:abc', [], [], []);
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic regardless of insertion order', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const storage = new GraphStorage(`revdet-${crypto.randomUUID()}`);
    const ctx = new Context('did:graph:revdet', null, id, storage);
    const a = await ctx.addTriple(new Triple('urn:a', 'pred://p', 'x'));
    const b = await ctx.addTriple(new Triple('urn:b', 'pred://p', 'y'));
    const r1 = computeRevision('did:graph:revdet', [a, b], [], []);
    const r2 = computeRevision('did:graph:revdet', [b, a], [], []);
    expect(r1).toBe(r2);
  });

  it('differs when graphDid differs', () => {
    expect(computeRevision('did:graph:a', [], [], [])).not.toBe(
      computeRevision('did:graph:b', [], [], []),
    );
  });
});

describe('§7.3 Space derivation', () => {
  it('produces a space:// URI', () => {
    const uri = deriveSpaceUri('unified', 'did:graph:abc');
    expect(uri).toMatch(/^space:\/\/[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = deriveSpaceUri('fully-partitioned', 'did:graph:abc');
    const b = deriveSpaceUri('fully-partitioned', 'did:graph:abc');
    expect(a).toBe(b);
  });

  it('differs across topologies for the same context', () => {
    const u = deriveSpaceUri('unified', 'did:graph:abc');
    const p = deriveSpaceUri('fully-partitioned', 'did:graph:abc');
    expect(u).not.toBe(p);
  });

  it('fully-partitioned bakes the graphDid into the space', () => {
    const a = deriveSpaceUri('fully-partitioned', 'did:graph:a');
    const b = deriveSpaceUri('fully-partitioned', 'did:graph:b');
    expect(a).not.toBe(b);
  });
});

describe('§6.1 Context.publish()', () => {
  let manager: GraphStoreManager;
  beforeEach(async () => {
    manager = await newManager();
  });

  it('returns a PublishedContext with addressing', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    const pub = await ctx.publish();
    expect(pub.graphDid).toBe(ctx.did);
    expect(pub.spaceUri).toMatch(/^space:\/\//);
    expect(typeof pub.moduleHash).toBe('string');
  });

  it('transitions to synced and exposes syncState()', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    await ctx.publish();
    expect(await ctx.syncState()).toBe('synced');
  });

  it('is idempotent — calling twice returns the same addressing', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    const p1 = await ctx.publish();
    const p2 = await ctx.publish();
    expect(p2.spaceUri).toBe(p1.spaceUri);
  });

  it('honours customSpace when topology is "custom"', async () => {
    const store = await manager.create('ws');
    const c1 = await store.createContext({ displayName: 'a' });
    const c2 = await store.createContext({ displayName: 'b' });
    const p1 = await c1.publish({ spaceTopology: 'custom', customSpace: 'team-A' });
    const p2 = await c2.publish({ spaceTopology: 'custom', customSpace: 'team-A' });
    // Same custom space → same spaceUri, even for different contexts.
    expect(p1.spaceUri).toBe(p2.spaceUri);
  });
});

describe('§6.3 Sync operations', () => {
  let manager: GraphStoreManager;
  beforeEach(async () => {
    manager = await newManager();
  });

  it('peers()/onlinePeers() return arrays before any peer joins', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    await ctx.publish();
    expect(await ctx.peers()).toEqual([]);
    expect(await ctx.onlinePeers()).toEqual([]);
  });

  it('currentRevision() resolves to a SHA-256 hex string', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    await ctx.publish();
    const rev = await ctx.currentRevision();
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unpublish() drops syncState back to idle', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    await ctx.publish();
    await ctx.unpublish();
    expect(await ctx.syncState()).toBe('idle');
  });
});

describe('Cross-context sync over BroadcastChannel', () => {
  let manager: GraphStoreManager;
  beforeEach(async () => {
    manager = await newManager();
  });

  it('two published contexts in the same space discover each other', async () => {
    const store = await manager.create('ws');
    const a = await store.createContext({ displayName: 'A' });
    const b = await store.createContext({ displayName: 'B' });
    await a.publish({ spaceTopology: 'custom', customSpace: 'crowd' });
    const joined = waitForEvent<PeerEvent>(a, 'peerjoined');
    await b.publish({ spaceTopology: 'custom', customSpace: 'crowd' });
    const evt = await joined;
    expect(evt.peer.did).toBeTruthy();
  });

  it('a broadcast signal is delivered to peers in the same space', async () => {
    const store = await manager.create('ws');
    const a = await store.createContext({ displayName: 'A' });
    const b = await store.createContext({ displayName: 'B' });
    await a.publish({ spaceTopology: 'custom', customSpace: 'signal-space' });
    await b.publish({ spaceTopology: 'custom', customSpace: 'signal-space' });
    const received = waitForEvent<SignalEvent>(a, 'signal');
    await b.broadcast(new TextEncoder().encode('hello'));
    const evt = await received;
    expect(new TextDecoder().decode(evt.payload)).toBe('hello');
  });

  it('a diff written on one peer of a context propagates to the other peer of the same context', async () => {
    // Two Context instances of the same graphDid simulate two devices/tabs
    // subscribed to the same shared context.
    const store = await manager.create('ws');
    const a = await store.createContext({ displayName: 'Shared' });
    const sharedDid = a.did;

    const idB = new EphemeralIdentity();
    await idB.ensureReady();
    const storageB = new GraphStorage(`peer-b-${crypto.randomUUID()}`);
    const b = new Context(sharedDid, 'Shared (peer B)', idB, storageB);

    await a.publish({ spaceTopology: 'custom', customSpace: 'two-peer-space' });
    await b.publish({ spaceTopology: 'custom', customSpace: 'two-peer-space' });

    const received = waitForEvent<DiffEvent>(a, 'diff');
    await b.addTriple(new Triple('urn:hello', 'pred://x', 'world'));
    const evt = await received;
    expect(evt.diff.graphDid).toBe(sharedDid);
    expect(evt.diff.additions.length).toBeGreaterThan(0);
  });
});

describe('Identity hygiene', () => {
  it('every triple produced through a published context still carries a valid signature', async () => {
    const manager = await newManager();
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    await ctx.publish();
    await ctx.addTriple(new Triple('urn:x', 'pred://p', 'v'));
    const triples = await ctx.queryTriples({});
    for (const t of triples) {
      expect(t.proof.signature).toBeTruthy();
      expect(t.proof.method).toBeTruthy();
      expect(t.author).toBeTruthy();
    }
  });
});

// Silence unused-import lint when type-only imports are not consumed elsewhere.
export type _Unused = SignedTriple | IdentityProvider | SyncStateChangeEvent;
