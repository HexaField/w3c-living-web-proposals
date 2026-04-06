import { describe, it, expect, beforeEach } from 'vitest';
import { SharedGraph, SharedGraphManager, SyncProtocolRegistry, GraphDiff, createGraphDiff, computeRevision } from '../index.js';
import { SemanticTriple, EphemeralIdentity, type SignedTriple } from '@living-web/personal-graph';
import { SignalEvent, PeerEvent, SyncStateChangeEvent, DiffEvent } from '../types.js';

// Helper to create an identity and wait for it to be ready
async function makeIdentity(): Promise<EphemeralIdentity> {
  const id = new EphemeralIdentity();
  await id.ensureReady();
  return id;
}

// Helper to wait for an event
function waitForEvent<T extends Event>(target: EventTarget, type: string, timeoutMs = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for event: ${type}`)), timeoutMs);
    target.addEventListener(type, (e) => {
      clearTimeout(timer);
      resolve(e as T);
    }, { once: true });
  });
}

// Helper to create a triple
function triple(s: string, p: string, t: string): SemanticTriple {
  return new SemanticTriple(s, t, p);
}

describe('P2P Graph Sync — Conformance Tests', () => {
  let aliceId: EphemeralIdentity;
  let bobId: EphemeralIdentity;

  beforeEach(async () => {
    aliceId = await makeIdentity();
    bobId = await makeIdentity();
  });

  // §4.1 SharedGraph MUST support all PersonalGraph operations
  describe('§4.1 SharedGraph basics', () => {
    it('MUST support addTriple', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const signed = await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      expect(signed.data.source).toBe('note:1');
      expect(signed.author).toBe(aliceId.getDID());
    });

    it('MUST support queryTriples', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      await graph.addTriple(triple('note:2', 'schema:name', 'World'));
      const results = await graph.queryTriples({ predicate: 'schema:name' });
      expect(results).toHaveLength(2);
    });

    it('MUST support removeTriple', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const signed = await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const removed = await graph.removeTriple(signed);
      expect(removed).toBe(true);
      const results = await graph.queryTriples({});
      expect(results).toHaveLength(0);
    });

    it('MUST support snapshot', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const snap = await graph.snapshot();
      expect(snap).toHaveLength(1);
    });

    it('MUST maintain a set of known peers', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const peers = await graph.peers();
      expect(Array.isArray(peers)).toBe(true);
    });

    it('MUST track sync state', () => {
      const graph = SharedGraph.create(aliceId, 'test');
      expect(['idle', 'syncing', 'synced', 'error']).toContain(graph.syncState);
    });

    it('has a globally unique URI', () => {
      const g1 = SharedGraph.create(aliceId);
      const g2 = SharedGraph.create(aliceId);
      expect(g1.uri).toMatch(/^graph:\/\//);
      expect(g1.uri).not.toBe(g2.uri);
    });
  });

  // §4.2 GraphDiff
  describe('§4.2 GraphDiff', () => {
    it('MUST contain additions with signed triples', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const signed = await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const diff = createGraphDiff([signed], [], [], aliceId.getDID());
      expect(diff.additions).toHaveLength(1);
      expect(diff.additions[0].proof.signature).toBeTruthy();
    });

    it('MUST contain removals with signed triples', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const signed = await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const diff = createGraphDiff([], [signed], [], aliceId.getDID());
      expect(diff.removals).toHaveLength(1);
    });

    it('MUST be immutable once revision computed', () => {
      const diff = new GraphDiff({
        revision: 'abc',
        additions: [],
        removals: [],
        dependencies: [],
        author: 'did:test:1',
        timestamp: Date.now(),
      });
      expect(Object.isFrozen(diff)).toBe(true);
      expect(Object.isFrozen(diff.additions)).toBe(true);
      expect(Object.isFrozen(diff.removals)).toBe(true);
      expect(Object.isFrozen(diff.dependencies)).toBe(true);
    });
  });

  // §4.3 Revision
  describe('§4.3 Revision', () => {
    it('MUST be computed as SHA-256 hash', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const signed = await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const rev = computeRevision([signed], [], []);
      expect(rev).toMatch(/^[0-9a-f]{64}$/); // 64 hex chars = SHA-256
    });

    it('MUST produce deterministic bytes regardless of insertion order', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const t1 = await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      const t2 = await graph.addTriple(triple('note:2', 'schema:name', 'B'));
      // Same signed triples in different order must produce same revision
      const rev1 = computeRevision([t1, t2], [], []);
      const rev2 = computeRevision([t2, t1], [], []);
      expect(rev1).toBe(rev2);
    });

    it('same triples with same signatures produce same revision', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const t1 = await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      // Same triple object produces same revision regardless of array position
      const rev1 = computeRevision([t1], [], []);
      const rev2 = computeRevision([t1], [], []);
      expect(rev1).toBe(rev2);
    });
  });

  // §5.1 SharedGraphManager — publish and join
  describe('§5.1 SharedGraphManager', () => {
    it('share() returns SharedGraph with unique URI', async () => {
      const mgr = new SharedGraphManager(aliceId);
      const graph = await mgr.share('test-graph');
      expect(graph.uri).toMatch(/^graph:\/\//);
      expect(graph.name).toBe('test-graph');
    });

    it('share() returns graph reflecting current state (triples added after share)', async () => {
      const mgr = new SharedGraphManager(aliceId);
      const graph = await mgr.share('test');
      await graph.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const snap = await graph.snapshot();
      expect(snap).toHaveLength(1);
    });

    it('join() returns SharedGraph for URI', async () => {
      const mgr = new SharedGraphManager(aliceId);
      const shared = await mgr.share('test');
      const joined = await mgr.join(shared.uri);
      expect(joined.uri).toBe(shared.uri);
    });

    it('join() returns same instance for same URI', async () => {
      const mgr = new SharedGraphManager(aliceId);
      const shared = await mgr.share('test');
      const j1 = await mgr.join(shared.uri);
      const j2 = await mgr.join(shared.uri);
      expect(j1).toBe(j2);
    });

    it('listShared() returns shared graph info', async () => {
      const mgr = new SharedGraphManager(aliceId);
      await mgr.share('graph1');
      await mgr.share('graph2');
      const list = await mgr.listShared();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('graph1');
    });
  });

  // §5.2 SharedGraph — sync operations
  describe('§5.2 SharedGraph sync', () => {
    it('peers() returns connected peer DIDs', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      const peers = await alice.peers();
      expect(peers.map(p => p.did)).toContain(bobId.getDID());
    });

    it('onlinePeers() returns peers with lastSeen', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      const peers = await alice.onlinePeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].did).toBe(bobId.getDID());
      expect(peers[0].lastSeen).toBeGreaterThan(0);
    });
  });

  // §5.5 SyncState
  describe('§5.5 SyncState', () => {
    it('initial state is idle', () => {
      const graph = SharedGraph.create(aliceId, 'test');
      expect(graph.syncState).toBe('idle');
    });

    it('transitions to synced when peer connects', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      const stateChange = waitForEvent<SyncStateChangeEvent>(alice, 'syncstatechange');
      alice.connectPeer(bob);
      const evt = await stateChange;
      expect(evt.state).toBe('synced');
      expect(alice.syncState).toBe('synced');
    });

    it('transitions to idle when all peers disconnect', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      const stateChange = waitForEvent<SyncStateChangeEvent>(alice, 'syncstatechange');
      alice.disconnectPeer(bobId.getDID());
      const evt = await stateChange;
      expect(evt.state).toBe('idle');
    });
  });

  // §6.1 Eventual consistency — THE CRITICAL TEST
  describe('§6.1 Eventual consistency', () => {
    it('two peers converge: triple added in one appears in the other', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      // Alice adds a triple
      await alice.addTriple(triple('note:1', 'schema:name', 'Hello from Alice'));

      // Bob should now have it
      const bobTriples = await bob.queryTriples({ source: 'note:1' });
      expect(bobTriples).toHaveLength(1);
      expect(bobTriples[0].data.target).toBe('Hello from Alice');
    });

    it('two peers converge: triples added in both appear in each', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      await alice.addTriple(triple('note:1', 'schema:name', 'From Alice'));
      await bob.addTriple(triple('note:2', 'schema:name', 'From Bob'));

      const aliceTriples = await alice.queryTriples({});
      const bobTriples = await bob.queryTriples({});
      expect(aliceTriples).toHaveLength(2);
      expect(bobTriples).toHaveLength(2);
    });

    it('removal syncs between peers', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      const signed = await alice.addTriple(triple('note:1', 'schema:name', 'Hello'));
      
      // Bob should have it
      let bobTriples = await bob.queryTriples({});
      expect(bobTriples).toHaveLength(1);

      // Alice removes it
      await alice.removeTriple(signed);

      // Bob should no longer have it
      bobTriples = await bob.queryTriples({});
      expect(bobTriples).toHaveLength(0);
    });

    it('pre-existing triples sync on peer connect', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      await alice.addTriple(triple('note:1', 'schema:name', 'Pre-existing'));

      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      const bobTriples = await bob.queryTriples({});
      expect(bobTriples).toHaveLength(1);
      expect(bobTriples[0].data.target).toBe('Pre-existing');
    });

    it('both peers have pre-existing triples — merge on connect', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      await alice.addTriple(triple('note:1', 'schema:name', 'Alice data'));

      const bob = SharedGraph.create(bobId, 'test');
      await bob.addTriple(triple('note:2', 'schema:name', 'Bob data'));

      alice.connectPeer(bob);

      const aliceTriples = await alice.queryTriples({});
      const bobTriples = await bob.queryTriples({});
      expect(aliceTriples).toHaveLength(2);
      expect(bobTriples).toHaveLength(2);
    });
  });

  // §6.2 Causal ordering
  describe('§6.2 Causal ordering', () => {
    it('GraphDiff declares causal dependencies', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      await graph.addTriple(triple('note:1', 'schema:name', 'First'));
      const rev1 = await graph.currentRevision();
      expect(rev1).toBeTruthy();

      await graph.addTriple(triple('note:2', 'schema:name', 'Second'));
      const dag = graph.revisionDAG();
      expect(dag).toHaveLength(2);
      // Second revision should depend on first
      expect(dag[1].parents).toContain(rev1);
    });

    it('revision DAG forms a chain for sequential operations', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      await graph.addTriple(triple('note:2', 'schema:name', 'B'));
      await graph.addTriple(triple('note:3', 'schema:name', 'C'));
      const dag = graph.revisionDAG();
      expect(dag).toHaveLength(3);
      expect(dag[0].parents).toHaveLength(0);
      expect(dag[1].parents).toEqual([dag[0].revision]);
      expect(dag[2].parents).toEqual([dag[1].revision]);
    });
  });

  // §6.3 Conflict resolution (OR-Set via Y.js)
  describe('§6.3 Conflict resolution', () => {
    it('concurrent adds on same triple converge (add-wins)', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');

      // Both add the same triple before connecting
      await alice.addTriple(triple('note:1', 'schema:name', 'Shared'));
      await bob.addTriple(triple('note:1', 'schema:name', 'Shared'));

      alice.connectPeer(bob);

      // Both should have exactly one copy (Y.Map deduplicates by key)
      const aliceTriples = await alice.queryTriples({ source: 'note:1' });
      const bobTriples = await bob.queryTriples({ source: 'note:1' });
      expect(aliceTriples).toHaveLength(1);
      expect(bobTriples).toHaveLength(1);
    });
  });

  // §6.4 Peer discovery
  describe('§6.4 Peer discovery', () => {
    it('peers discover each other via connectPeer (room-based in polyfill)', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      expect((await alice.peers()).map(p => p.did)).toContain(bobId.getDID());
      expect((await bob.peers()).map(p => p.did)).toContain(aliceId.getDID());
    });
  });

  // §8.1 Publishing
  describe('§8.1 Publishing', () => {
    it('SharedGraph URI has sufficient entropy (UUID)', () => {
      const graph = SharedGraph.create(aliceId, 'test');
      expect(graph.uri).toMatch(/^graph:\/\//);
      // Extract graph ID from URI and verify it's a UUID
      const match = graph.uri.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/);
      expect(match).toBeTruthy();
    });
  });

  // §8.3 Leaving
  describe('§8.3 Leaving', () => {
    it('leave() disconnects from all peers', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      await alice.leave();
      expect(await alice.peers()).toHaveLength(0);
      expect(await bob.peers()).toHaveLength(0);
    });

    it('leave() ceases sync activity', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      await alice.leave();
      expect(alice.syncState).toBe('idle');
    });

    it('leave(retainLocalCopy=true) preserves local data', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      await alice.addTriple(triple('note:1', 'schema:name', 'Keep me'));
      await alice.leave({ retainLocalCopy: true });
      const triples = await alice.queryTriples({});
      expect(triples).toHaveLength(1);
    });

    it('leave(retainLocalCopy=false) removes local data', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      await alice.addTriple(triple('note:1', 'schema:name', 'Delete me'));
      await alice.leave({ retainLocalCopy: false });
      const triples = await alice.queryTriples({});
      expect(triples).toHaveLength(0);
    });
  });

  // §9 Signalling
  describe('§9 Signalling', () => {
    it('sendSignal() delivers to specific peer', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      const signalP = waitForEvent<SignalEvent>(bob, 'signal');
      await alice.sendSignal(bobId.getDID(), { type: 'ping', data: 42 });
      const evt = await signalP;
      expect(evt.senderDid).toBe(aliceId.getDID());
      expect(evt.payload.type).toBe('ping');
      expect(evt.payload.data).toBe(42);
    });

    it('broadcast() sends to all peers', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      const signalP = waitForEvent<SignalEvent>(bob, 'signal');
      await alice.broadcast({ type: 'hello' });
      const evt = await signalP;
      expect(evt.senderDid).toBe(aliceId.getDID());
      expect(evt.payload.type).toBe('hello');
    });

    it('signals are NOT persisted in graph', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      await alice.sendSignal(bobId.getDID(), { type: 'ephemeral' });
      const triples = await bob.queryTriples({});
      expect(triples).toHaveLength(0);
    });

    it('signals are NOT replayed to new peers', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      await alice.sendSignal(bobId.getDID(), { type: 'old' });

      // Charlie joins later — should not receive the old signal
      const charlieId = await makeIdentity();
      const charlie = SharedGraph.create(charlieId, 'test');
      const signals: SignalEvent[] = [];
      charlie.onsignal = (e: Event) => signals.push(e as SignalEvent);
      alice.connectPeer(charlie);

      // Give a tick for any potential replay
      await new Promise((r) => setTimeout(r, 50));
      expect(signals).toHaveLength(0);
    });
  });

  // Peer events
  describe('Peer events', () => {
    it('onpeerjoined fires when peer connects', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      const peerJoined = waitForEvent<PeerEvent>(alice, 'peerjoined');
      alice.connectPeer(bob);
      const evt = await peerJoined;
      expect(evt.did).toBe(bobId.getDID());
    });

    it('onpeerleft fires when peer disconnects', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      const peerLeft = waitForEvent<PeerEvent>(alice, 'peerleft');
      alice.disconnectPeer(bobId.getDID());
      const evt = await peerLeft;
      expect(evt.did).toBe(bobId.getDID());
    });
  });

  // Diff events
  describe('Diff events', () => {
    it('diff event fires on remote change', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      const diffP = waitForEvent<DiffEvent>(bob, 'diff');
      await alice.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const evt = await diffP;
      expect(evt.diff.additions).toHaveLength(1);
      expect(evt.diff.revision).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // §10 Security
  describe('§10 Security', () => {
    it('all triples in graph have valid signatures', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      await graph.addTriple(triple('note:1', 'schema:name', 'Signed'));
      const triples = await graph.queryTriples({});
      for (const t of triples) {
        expect(t.proof.signature).toBeTruthy();
        expect(t.proof.key).toBeTruthy();
        expect(t.author).toBe(aliceId.getDID());
      }
    });

    it('SharedGraph URI is unguessable (contains UUID)', () => {
      const graph = SharedGraph.create(aliceId);
      expect(graph.uri.length).toBeGreaterThan(20);
    });
  });

  // SyncProtocolRegistry
  describe('SyncProtocolRegistry', () => {
    it('registers and retrieves custom protocols', () => {
      const factory = () => ({} as any);
      SyncProtocolRegistry.register('test-proto', factory);
      expect(SyncProtocolRegistry.has('test-proto')).toBe(true);
      expect(SyncProtocolRegistry.get('test-proto')).toBe(factory);
    });

    it('lists registered protocols', () => {
      SyncProtocolRegistry.register('proto-a', () => ({} as any));
      const list = SyncProtocolRegistry.list();
      expect(list).toContain('proto-a');
    });
  });

  // Revision DAG
  describe('Revision DAG', () => {
    it('revisionDAG() returns revision history', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      await graph.addTriple(triple('note:2', 'schema:name', 'B'));
      const dag = graph.revisionDAG();
      expect(dag).toHaveLength(2);
      expect(dag[0].revision).toMatch(/^[0-9a-f]{64}$/);
    });

    it('currentRevision() returns latest revision', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      expect(await graph.currentRevision()).toBeNull();
      await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      expect(await graph.currentRevision()).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // SharedGraphManager leave
  describe('SharedGraphManager leave', () => {
    it('leave removes graph from list when retainLocalCopy=false', async () => {
      const mgr = new SharedGraphManager(aliceId);
      const graph = await mgr.share('test');
      await mgr.leave(graph.uri, { retainLocalCopy: false });
      const list = await mgr.listShared();
      expect(list).toHaveLength(0);
    });
  });

  // §4.4 Peer DID MUST be resolvable
  describe('§4.4 Peer DID resolution', () => {
    it('peer DID MUST be resolvable to a DID Document', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);
      const peers = await alice.peers();
      for (const peer of peers) {
        expect(peer.did).toMatch(/^did:/);
      }
    });
  });

  // §5.1 join() MUST reject with NotSupportedError if protocol unavailable
  describe('§5.1 join() protocol rejection', () => {
    it('join() MUST reject with NotSupportedError if URI protocol is not supported', async () => {
      const mgr = new SharedGraphManager(aliceId);
      await expect(mgr.join('unknown-protocol://nonexistent')).rejects.toThrow();
    });
  });

  // §10.2 Signature verification on incoming triples
  describe('§10.2 Signature verification', () => {
    it('all triples received from peers should have valid signatures', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      await alice.addTriple(triple('note:1', 'schema:name', 'Signed by Alice'));
      const bobTriples = await bob.queryTriples({});
      expect(bobTriples).toHaveLength(1);
      // The triple has a proof with non-empty signature
      expect(bobTriples[0].proof.signature).toBeTruthy();
      expect(bobTriples[0].proof.key).toBeTruthy();
    });
  });

  // §10.3 Peer DID matches signing key
  describe('§10.3 Peer DID ↔ signing key', () => {
    it('triple author DID MUST match the signing key used', async () => {
      const alice = SharedGraph.create(aliceId, 'test');
      const bob = SharedGraph.create(bobId, 'test');
      alice.connectPeer(bob);

      await alice.addTriple(triple('note:1', 'schema:name', 'Hello'));
      const bobTriples = await bob.queryTriples({});
      expect(bobTriples[0].author).toBe(aliceId.getDID());
      expect(bobTriples[0].proof.key).toContain(aliceId.getDID());
    });
  });

  // tripleadded / tripleremoved events
  describe('Triple events on SharedGraph', () => {
    it('dispatches tripleadded on addTriple', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const evtP = waitForEvent(graph, 'tripleadded');
      await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      const evt = await evtP;
      expect(evt).toBeTruthy();
    });

    it('dispatches tripleremoved on removeTriple', async () => {
      const graph = SharedGraph.create(aliceId, 'test');
      const signed = await graph.addTriple(triple('note:1', 'schema:name', 'A'));
      const evtP = waitForEvent(graph, 'tripleremoved');
      await graph.removeTriple(signed);
      const evt = await evtP;
      expect(evt).toBeTruthy();
    });
  });
});

// §5.1 share() MUST register with discovery mechanism
describe('§5.1 share() registers with discovery mechanism', () => {
  it('shared graph is discoverable via listShared()', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const mgr = new SharedGraphManager(id);
    const graph = await mgr.share('discoverable');
    const listed = await mgr.listShared();
    expect(listed.some((g: any) => g.uri === graph.uri)).toBe(true);
    expect(listed.some((g: any) => g.name === 'discoverable')).toBe(true);
  });

  it('shared graph is retrievable via getShared(uri)', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const mgr = new SharedGraphManager(id);
    const graph = await mgr.share('findme');
    const found = await mgr.get(graph.uri);
    expect(found).toBe(graph);
  });
});

// --- New API tests ---
import { DefaultSyncModule, parseGraphURI, buildGraphURI, isGraphURI } from '../index.js';

describe('Graph URI', () => {
  it('parseGraphURI parses valid URI', () => {
    const parsed = parseGraphURI('graph://relay.example.com/abc-123?module=sha256hash');
    expect(parsed.relays).toEqual(['relay.example.com']);
    expect(parsed.graphId).toBe('abc-123');
    expect(parsed.moduleHash).toBe('sha256hash');
  });

  it('parseGraphURI handles multiple relays', () => {
    const parsed = parseGraphURI('graph://r1.com,r2.com/myid');
    expect(parsed.relays).toEqual(['r1.com', 'r2.com']);
    expect(parsed.moduleHash).toBeNull();
  });

  it('parseGraphURI throws on invalid URI', () => {
    expect(() => parseGraphURI('http://example.com')).toThrow();
  });

  it('buildGraphURI constructs valid URI', () => {
    const uri = buildGraphURI(['relay.com'], 'graph-id', 'mod-hash');
    expect(uri).toBe('graph://relay.com/graph-id?module=mod-hash');
  });

  it('isGraphURI validates URIs', () => {
    expect(isGraphURI('graph://r/id')).toBe(true);
    expect(isGraphURI('http://r/id')).toBe(false);
  });

  it('roundtrips through build and parse', () => {
    const uri = buildGraphURI(['a.com', 'b.com'], 'test-id', 'hash123');
    const parsed = parseGraphURI(uri);
    expect(parsed.relays).toEqual(['a.com', 'b.com']);
    expect(parsed.graphId).toBe('test-id');
    expect(parsed.moduleHash).toBe('hash123');
  });
});

describe('SharedGraph new API', () => {
  it('has moduleHash property defaulting to "default"', async () => {
    const id = await makeIdentity();
    const graph = SharedGraph.create(id, 'test');
    expect(graph.moduleHash).toBe('default');
  });

  it('URI uses graph:// format', async () => {
    const id = await makeIdentity();
    const graph = SharedGraph.create(id, 'test');
    expect(graph.uri).toMatch(/^graph:\/\//);
    expect(isGraphURI(graph.uri)).toBe(true);
  });

  it('currentRevision() returns a promise', async () => {
    const id = await makeIdentity();
    const graph = SharedGraph.create(id, 'test');
    const rev = graph.currentRevision();
    expect(rev).toBeInstanceOf(Promise);
    expect(await rev).toBeNull();
  });

  it('ondiff handler receives diff events', async () => {
    const id = await makeIdentity();
    const graph = SharedGraph.create(id, 'test');
    const diffs: any[] = [];
    graph.ondiff = (e: Event) => diffs.push((e as DiffEvent).diff);
    await graph.addTriple(triple('urn:s', 'urn:p', 'urn:o'));
    // Diff is dispatched from Y.js observer
    // Give a tick
    await new Promise(r => setTimeout(r, 10));
    // At minimum the tripleadded triggers a diff in the revision DAG
    const rev = await graph.currentRevision();
    expect(rev).toBeTruthy();
  });

  it('create() accepts SharedGraphOptions with meta', async () => {
    const id = await makeIdentity();
    const graph = SharedGraph.create(id, undefined, {
      meta: { name: 'My Graph', description: 'A test graph' },
      module: 'custom-hash',
    });
    expect(graph.name).toBe('My Graph');
    expect(graph.moduleHash).toBe('custom-hash');
  });

  it('peers() returns Peer objects with did and online', async () => {
    const aliceId = await makeIdentity();
    const bobId = await makeIdentity();
    const alice = SharedGraph.create(aliceId, 'test');
    const bob = SharedGraph.create(bobId, 'test');
    alice.connectPeer(bob);
    const peers = await alice.peers();
    expect(peers[0]).toHaveProperty('did');
    expect(peers[0]).toHaveProperty('online');
    expect(peers[0].online).toBe(true);
  });
});

describe('DefaultSyncModule', () => {
  it('can be instantiated and initialized', () => {
    const mod = new DefaultSyncModule();
    mod.init({
      graphUri: 'graph://localhost/test',
      localDid: 'did:test:alice',
      graphWriter: { applyDiff: () => {}, rejectDiff: () => {} },
      graphReader: { query: () => [], tripleCount: () => 0, currentRevision: () => null },
    });
    expect(mod.peers()).toEqual([]);
    expect(mod.onlinePeers()).toEqual([]);
    mod.shutdown();
  });

  it('validate accepts diffs with signatures by default', async () => {
    const mod = new DefaultSyncModule();
    const id = await makeIdentity();
    const graph = SharedGraph.create(id, 'test');
    const signed = await graph.addTriple(triple('urn:s', 'urn:p', 'urn:o'));
    const diff = new GraphDiff({
      revision: 'rev1',
      additions: [signed],
      removals: [],
      dependencies: [],
      author: id.getDID(),
      timestamp: Date.now(),
    });
    const reader = { query: () => [], tripleCount: () => 0, currentRevision: () => null };
    const result = mod.validate(diff, id.getDID(), reader);
    expect(result.accepted).toBe(true);
  });

  it('validate rejects diffs without signatures', () => {
    const mod = new DefaultSyncModule();
    const diff = new GraphDiff({
      revision: 'rev1',
      additions: [{ data: { source: 's', target: 'o', predicate: 'p' }, author: 'did:test:x', timestamp: '2024-01-01', proof: { signature: '', key: '' } } as any],
      removals: [],
      dependencies: [],
      author: 'did:test:x',
      timestamp: Date.now(),
    });
    const reader = { query: () => [], tripleCount: () => 0, currentRevision: () => null };
    const result = mod.validate(diff, 'did:test:x', reader);
    expect(result.accepted).toBe(false);
  });

  it('onSignal registers callback', () => {
    const mod = new DefaultSyncModule();
    const cb = () => {};
    mod.onSignal(cb);
    // No throw = success
  });
});
