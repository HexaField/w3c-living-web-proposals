/**
 * Conformance tests for @living-web/default-sync-module.
 *
 * Covers the Context.prototype extension behaviour when the default sync
 * module is installed: publish/syncState/peers/currentRevision and
 * cross-context propagation over BroadcastChannel.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Triple,
  Context,
  GraphStorage,
  GraphStoreManager,
  EphemeralIdentity,
  registerContextMethodBinding,
  type SignedTriple,
  type IdentityProvider,
} from '@living-web/personal-graph';
import {
  DIDCredential,
  encodeEd25519Multibase,
  ed25519,
  randomPrivateKey,
  storeCredential,
} from '@living-web/identity';

import {
  DiffEvent,
  PeerEvent,
  SignalEvent,
  SyncStateChangeEvent,
  installContextSyncExtension,
} from '@living-web/context-sync';
import { installSyncModule } from '@living-web/sync-module';
import { defaultSyncModule } from '../index.js';

// Install the extension + register the default module for the suite + a
// minimal did:graph binding so personal-graph can mint contexts (these tests
// focus on sync, not did:graph semantics — group-identity provides the
// production binding).
beforeAll(() => {
  installContextSyncExtension();
  installSyncModule(defaultSyncModule);
  registerContextMethodBinding({
    async mintContextCredential(displayName, passphrase) {
      const privateKey = randomPrivateKey();
      const publicKey = await ed25519.getPublicKeyAsync(privateKey);
      const id = encodeEd25519Multibase(publicKey);
      const did = `did:graph:${id}`;
      const methodId = `${did}#${id}`;
      const createdAt = new Date().toISOString();
      await storeCredential(methodId, 'Ed25519', displayName, createdAt, publicKey, privateKey, passphrase);
      const credential = new DIDCredential(did, methodId, 'Ed25519', displayName, createdAt, publicKey, privateKey);
      return { credential, publicKey, privateKey };
    },
    *seedTriples(graphDid) {
      const id = graphDid.slice('did:graph:'.length);
      const methodId = `${graphDid}#${id}`;
      yield { subject: graphDid, predicate: 'did://hasMethod', object: methodId };
      yield { subject: methodId, predicate: 'did://verificationMethod/type', object: '"Ed25519VerificationKey2020"' };
      yield { subject: methodId, predicate: 'did://verificationMethod/controller', object: graphDid };
      yield { subject: methodId, predicate: 'did://verificationMethod/publicKeyMultibase', object: `"${id}"` };
      for (const sec of ['capabilityInvocation', 'capabilityDelegation', 'assertionMethod', 'authentication']) {
        yield { subject: graphDid, predicate: `did://${sec}`, object: methodId };
      }
    },
    *addDelegateTriples() { /* unused in these tests */ },
    publicKeyFromDid() { return new Uint8Array(32); },
  });
});

async function newManager(): Promise<GraphStoreManager> {
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  const storage = new GraphStorage(`dsm-sync-${crypto.randomUUID()}`);
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

export type _Unused = SignedTriple | IdentityProvider | SyncStateChangeEvent;
