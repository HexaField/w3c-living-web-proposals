/**
 * Conformance tests for @living-web/default-sync-module.
 *
 * Covers the Context.prototype extension behaviour when the default sync
 * module is installed: publish/syncState/peers/currentRevision and
 * cross-context propagation over BroadcastChannel.
 *
 * Sync requires a context to be groupified ([[GROUP-IDENTITY]]) — without a
 * did:graph the publish() call would throw, because the IRI alone is a
 * snapshot address (changes per mutation) and so can't serve as a stable
 * subscription handle. The tests stub groupification by calling
 * `ctx.setDid(...)` directly (the production path goes through
 * @living-web/group-identity's groupifyContext).
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
  DiffEvent,
  PeerEvent,
  SignalEvent,
  SyncStateChangeEvent,
  installContextSyncExtension,
} from '@living-web/context-sync';
import { installSyncModule } from '@living-web/sync-module';
import { defaultSyncModule } from '../index.js';

beforeAll(() => {
  installContextSyncExtension();
  installSyncModule(defaultSyncModule);
});

async function newManager(): Promise<GraphStoreManager> {
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  const storage = new GraphStorage(`dsm-sync-${crypto.randomUUID()}`);
  return new GraphStoreManager(storage, async () => eph);
}

/** Test-only stub: attach a fake did:graph to a context to satisfy sync. */
function fakeGroupify(ctx: Context): string {
  const did = `did:graph:test-${crypto.randomUUID().replace(/-/g, '')}`;
  ctx.setDid(did);
  return did;
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

describe('§6.1 Context.publish()', () => {
  let manager: GraphStoreManager;
  beforeEach(async () => {
    manager = await newManager();
  });

  it('returns a PublishedContext with addressing', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    fakeGroupify(ctx);
    const pub = await ctx.publish();
    expect(pub.graphDid).toBe(ctx.did);
    expect(pub.spaceUri).toMatch(/^space:\/\//);
    expect(typeof pub.moduleHash).toBe('string');
  });

  it('requires the context to be groupified', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    await expect(ctx.publish()).rejects.toThrow(/groupified|did:graph/);
  });

  it('transitions to synced and exposes syncState()', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    fakeGroupify(ctx);
    await ctx.publish();
    expect(await ctx.syncState()).toBe('synced');
  });

  it('is idempotent — calling twice returns the same addressing', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    fakeGroupify(ctx);
    const p1 = await ctx.publish();
    const p2 = await ctx.publish();
    expect(p2.spaceUri).toBe(p1.spaceUri);
  });

  it('honours customSpace when topology is "custom"', async () => {
    const store = await manager.create('ws');
    const c1 = await store.createContext({ displayName: 'a' });
    fakeGroupify(c1);
    const c2 = await store.createContext({ displayName: 'b' });
    fakeGroupify(c2);
    const p1 = await c1.publish({ spaceTopology: 'custom', customSpace: 'team-A' });
    const p2 = await c2.publish({ spaceTopology: 'custom', customSpace: 'team-A' });
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
    fakeGroupify(ctx);
    await ctx.publish();
    expect(await ctx.peers()).toEqual([]);
    expect(await ctx.onlinePeers()).toEqual([]);
  });

  it('currentRevision() resolves to a SHA-256 hex string', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    fakeGroupify(ctx);
    await ctx.publish();
    const rev = await ctx.currentRevision();
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unpublish() drops syncState back to idle', async () => {
    const store = await manager.create('ws');
    const ctx = await store.createContext({ displayName: 'Notes' });
    fakeGroupify(ctx);
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
    fakeGroupify(a);
    const b = await store.createContext({ displayName: 'B' });
    fakeGroupify(b);
    await a.publish({ spaceTopology: 'custom', customSpace: 'crowd' });
    const joined = waitForEvent<PeerEvent>(a, 'peerjoined');
    await b.publish({ spaceTopology: 'custom', customSpace: 'crowd' });
    const evt = await joined;
    expect(evt.peer.did).toBeTruthy();
  });

  it('a broadcast signal is delivered to peers in the same space', async () => {
    const store = await manager.create('ws');
    const a = await store.createContext({ displayName: 'A' });
    fakeGroupify(a);
    const b = await store.createContext({ displayName: 'B' });
    fakeGroupify(b);
    await a.publish({ spaceTopology: 'custom', customSpace: 'signal-space' });
    await b.publish({ spaceTopology: 'custom', customSpace: 'signal-space' });
    const received = waitForEvent<SignalEvent>(a, 'signal');
    await b.broadcast(new TextEncoder().encode('hello'));
    const evt = await received;
    expect(new TextDecoder().decode(evt.payload)).toBe('hello');
  });

  it('a diff written on one peer of a context propagates to the other peer of the same context', async () => {
    const store = await manager.create('ws');
    const a = await store.createContext({ displayName: 'Shared' });
    const sharedDid = fakeGroupify(a);

    const idB = new EphemeralIdentity();
    await idB.ensureReady();
    const storageB = new GraphStorage(`peer-b-${crypto.randomUUID()}`);
    // Peer B has its own internal id but the same sovereign did:graph.
    const b = new Context(`peerB-${crypto.randomUUID()}`, 'Shared (peer B)', idB, storageB);
    b.setDid(sharedDid);

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
    fakeGroupify(ctx);
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

export type _Unused = SignedTriple | IdentityProvider | SyncStateChangeEvent;
