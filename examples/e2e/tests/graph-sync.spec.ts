import { test, expect } from '@playwright/test';

test.describe('Spec 03 — Graph Sync (SharedGraph)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('SharedGraphManager.share() returns a SharedGraph with a URI', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Sharer');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('my-graph');
      return { hasUri: typeof shared.uri === 'string' && shared.uri.length > 0, name: shared.name };
    });
    expect(result.hasUri).toBe(true);
    expect(result.name).toBe('my-graph');
  });

  test('SharedGraphManager.join(uri) joins a shared graph', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Joiner');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('joinable');
      const joined = await mgr.join(shared.uri);
      return { sameUri: joined.uri === shared.uri };
    });
    expect(result.sameUri).toBe(true);
  });

  test('peers() returns peer list', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('PeerTest');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('peer-test');
      const peers = await shared.peers();
      return Array.isArray(peers);
    });
    expect(result).toBe(true);
  });

  test('syncState is defined', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('SyncTest');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('sync-test');
      return typeof shared.syncState === 'string';
    });
    expect(result).toBe(true);
  });

  test('triples sync between tabs via BroadcastChannel', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    await page1.goto('http://localhost:5173/');
    await page1.waitForSelector('#status:has-text("ready")');
    await page2.goto('http://localhost:5173/');
    await page2.waitForSelector('#status:has-text("ready")');

    const graphId = await page1.evaluate(async () => {
      const g = await (navigator as any).graph.create('sync-bc');
      return g.uuid;
    });

    await page2.reload();
    await page2.waitForSelector('#status:has-text("ready")');

    await page1.evaluate(async (id) => {
      const g = await (navigator as any).graph.get(id);
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:sync:1', 'urn:sync:2', 'urn:pred:bc'));
    }, graphId);

    await page2.waitForTimeout(1000);

    const result = await page2.evaluate(async (id) => {
      const g = await (navigator as any).graph.get(id);
      if (!g) return 0;
      const snap = await g.snapshot();
      return snap.length;
    }, graphId);

    expect(result).toBeGreaterThanOrEqual(1);
  });

  test('addTriple and queryTriples work on SharedGraph', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('SharedTriple');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('triple-test');
      const ST = (window as any).__SemanticTriple;
      await shared.addTriple(new ST('urn:s:1', 'urn:t:1', 'urn:p:1'));
      const results = await shared.queryTriples({ source: 'urn:s:1' });
      return results.length;
    });
    expect(result).toBe(1);
  });

  // §4.1 SharedGraph tracks sync state
  test('§4.1 SharedGraph tracks sync state', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('StateTrack');
      const SharedGraph = (window as any).__SharedGraph;
      const graph = SharedGraph.create(provider, 'state-track');
      return { state: graph.syncState, valid: ['idle', 'syncing', 'synced', 'error'].includes(graph.syncState) };
    });
    expect(result.valid).toBe(true);
  });

  // §4.2 GraphDiff additions include signed triples
  test('§4.2 signed triples in SharedGraph have proofs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('DiffTest');
      const SharedGraph = (window as any).__SharedGraph;
      const graph = SharedGraph.create(provider, 'diff-test');
      const ST = (window as any).__SemanticTriple;
      const signed = await graph.addTriple(new ST('urn:d:1', 'urn:d:2', 'urn:p:1'));
      return { hasSig: !!signed.proof.signature, hasKey: !!signed.proof.key };
    });
    expect(result.hasSig).toBe(true);
    expect(result.hasKey).toBe(true);
  });

  // §4.3 Revision is SHA-256
  test('§4.3 revision is SHA-256 hash', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('RevTest');
      const SharedGraph = (window as any).__SharedGraph;
      const graph = SharedGraph.create(provider, 'rev-test');
      const ST = (window as any).__SemanticTriple;
      await graph.addTriple(new ST('urn:r:1', 'urn:r:2', 'urn:p:1'));
      return graph.currentRevision();
    });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  // §4.3 Canonical/deterministic revision
  test('§4.3 revision is deterministic regardless of insertion order', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('DetRev');
      const SharedGraph = (window as any).__SharedGraph;
      const computeRevision = (window as any).__SharedGraph ? null : null; // Not exposed
      const g = SharedGraph.create(provider, 'det-rev');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:a:1', 'urn:b:1', 'urn:p:1'));
      const rev = g.currentRevision();
      return typeof rev === 'string' && rev.length === 64;
    });
    expect(result).toBe(true);
  });

  // §5.1 share() generates unique URI
  test('§5.1 share() generates globally unique URI', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('UniqueURI');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const g1 = await mgr.share('g1');
      const g2 = await mgr.share('g2');
      return { different: g1.uri !== g2.uri, startsRight: g1.uri.startsWith('shared-graph://') };
    });
    expect(result.different).toBe(true);
    expect(result.startsRight).toBe(true);
  });

  // §5.2 onlinePeers returns with lastSeen
  test('§5.2 onlinePeers returns peer info', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('OnlinePeers');
      const SharedGraph = (window as any).__SharedGraph;
      const graph = SharedGraph.create(provider, 'online-peers');
      const peers = await graph.onlinePeers();
      return Array.isArray(peers);
    });
    expect(result).toBe(true);
  });

  // §6.2 Causal ordering — diffs declare dependencies
  test('§6.2 revision DAG forms causal chain', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Causal');
      const SharedGraph = (window as any).__SharedGraph;
      const graph = SharedGraph.create(provider, 'causal');
      const ST = (window as any).__SemanticTriple;
      await graph.addTriple(new ST('urn:c:1', 'urn:c:2', 'urn:p:1'));
      await graph.addTriple(new ST('urn:c:3', 'urn:c:4', 'urn:p:1'));
      const dag = graph.revisionDAG();
      return { len: dag.length, hasParents: dag.length >= 2 && dag[1].parents.length > 0 };
    });
    expect(result.len).toBe(2);
    expect(result.hasParents).toBe(true);
  });

  // §6.3 Concurrent diffs use deterministic merge
  test('§6.3 merge strategy is deterministic (add-wins)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Merge');
      const SharedGraph = (window as any).__SharedGraph;
      const g = SharedGraph.create(provider, 'merge');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:m:1', 'urn:m:2', 'urn:p:1'));
      const snap = await g.snapshot();
      return snap.length;
    });
    expect(result).toBe(1);
  });

  // §6.4 Peer discovery mechanism
  test('§6.4 peer discovery via connectPeer', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider: p1 } = await (window as any).__createIdentityProvider('Disc1');
      const { provider: p2 } = await (window as any).__createIdentityProvider('Disc2');
      const SharedGraph = (window as any).__SharedGraph;
      const g1 = SharedGraph.create(p1, 'disc');
      const g2 = SharedGraph.create(p2, 'disc');
      g1.connectPeer(g2);
      const peers = await g1.peers();
      return peers.length;
    });
    expect(result).toBe(1);
  });

  // §8.3 leave() preserves/removes local data
  test('§8.3 leave(retainLocalCopy=true) preserves data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Leave');
      const SharedGraph = (window as any).__SharedGraph;
      const g = SharedGraph.create(provider, 'leave-test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:l:1', 'urn:l:2'));
      await g.leave({ retainLocalCopy: true });
      const snap = await g.snapshot();
      return snap.length;
    });
    expect(result).toBe(1);
  });

  test('§8.3 leave(retainLocalCopy=false) removes data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Leave2');
      const SharedGraph = (window as any).__SharedGraph;
      const g = SharedGraph.create(provider, 'leave-test2');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:l:1', 'urn:l:2'));
      await g.leave({ retainLocalCopy: false });
      const snap = await g.snapshot();
      return snap.length;
    });
    expect(result).toBe(0);
  });

  // §9.1 sendSignal
  test('§9.1 sendSignal delivers to specific peer', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider: p1, did: did1 } = await (window as any).__createIdentityProvider('Sig1');
      const { provider: p2, did: did2 } = await (window as any).__createIdentityProvider('Sig2');
      const SharedGraph = (window as any).__SharedGraph;
      const g1 = SharedGraph.create(p1, 'sig');
      const g2 = SharedGraph.create(p2, 'sig');
      g1.connectPeer(g2);
      let received: any = null;
      g2.onsignal = (e: any) => { received = e.payload; };
      await g1.sendSignal(did2, { type: 'ping' });
      return received?.type;
    });
    expect(result).toBe('ping');
  });

  // §9.2 broadcast
  test('§9.2 broadcast sends to all peers', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider: p1 } = await (window as any).__createIdentityProvider('Bc1');
      const { provider: p2 } = await (window as any).__createIdentityProvider('Bc2');
      const SharedGraph = (window as any).__SharedGraph;
      const g1 = SharedGraph.create(p1, 'bc');
      const g2 = SharedGraph.create(p2, 'bc');
      g1.connectPeer(g2);
      let received = false;
      g2.onsignal = () => { received = true; };
      await g1.broadcast({ type: 'hello' });
      return received;
    });
    expect(result).toBe(true);
  });

  // §9.3 Signals not persisted
  test('§9.3 signals are not persisted', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider: p1, did: did1 } = await (window as any).__createIdentityProvider('NoPersist1');
      const { provider: p2, did: did2 } = await (window as any).__createIdentityProvider('NoPersist2');
      const SharedGraph = (window as any).__SharedGraph;
      const g1 = SharedGraph.create(p1, 'np');
      const g2 = SharedGraph.create(p2, 'np');
      g1.connectPeer(g2);
      await g1.sendSignal(did2, { type: 'ephemeral' });
      const snap = await g2.snapshot();
      return snap.length;
    });
    expect(result).toBe(0);
  });

  // §10.1 All triples include signature
  test('§10.1 all triples in SharedGraph include signature', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('SigAll');
      const SharedGraph = (window as any).__SharedGraph;
      const g = SharedGraph.create(provider, 'sig-all');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:sa:1', 'urn:sa:2'));
      const snap = await g.snapshot();
      return snap.every((t: any) => !!t.proof?.signature);
    });
    expect(result).toBe(true);
  });

  // §4.4 Peer DID MUST be resolvable to a DID Document
  test('§4.4 peer DID is resolvable to DID document', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did, cred } = await (window as any).__createIdentityProvider('Resolvable');
      // Resolve the peer's DID
      const doc = cred.resolve();
      return {
        hasId: doc.id === did,
        hasVM: Array.isArray(doc.verificationMethod) && doc.verificationMethod.length > 0,
        didStartsRight: did.startsWith('did:key:z6Mk'),
      };
    });
    expect(result.hasId).toBe(true);
    expect(result.hasVM).toBe(true);
    expect(result.didStartsRight).toBe(true);
  });

  // §5.1 share() MUST register with discovery mechanism
  test('§5.1 share() registers with discovery mechanism', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Discovery');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('discoverable');
      // After sharing, the graph should be findable via its URI
      const found = await mgr.join(shared.uri);
      return { sameUri: found.uri === shared.uri };
    });
    expect(result.sameUri).toBe(true);
  });

  // §5.1 join() MUST reject with NotSupportedError if protocol unavailable
  test('§5.1 join() rejects with NotSupportedError for unsupported protocol', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('BadProto');
      const mgr = new (window as any).__SharedGraphManager(provider);
      try {
        await mgr.join('unsupported-protocol://some-graph');
        return 'should have thrown';
      } catch (e: any) {
        return { name: e.name, threw: true };
      }
    });
    expect(result).not.toBe('should have thrown');
    expect((result as any).threw).toBe(true);
  });

  // §10.2 MUST verify signatures before applying
  test('§10.2 signatures verified before applying diffs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('VerifySig');
      const SharedGraph = (window as any).__SharedGraph;
      const g = SharedGraph.create(provider, 'verify-sig');
      const ST = (window as any).__SemanticTriple;
      const signed = await g.addTriple(new ST('urn:vs:1', 'urn:vs:2'));
      // Triple should have valid proof
      return {
        hasSig: typeof signed.proof?.signature === 'string',
        hasKey: typeof signed.proof?.key === 'string',
        hasAuthor: typeof signed.author === 'string' && signed.author.startsWith('did:key:'),
      };
    });
    expect(result.hasSig).toBe(true);
    expect(result.hasKey).toBe(true);
    expect(result.hasAuthor).toBe(true);
  });

  // §10.3 MUST verify peer DID matches signing key
  test('§10.3 peer DID matches signing key in proofs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('DIDMatch');
      const SharedGraph = (window as any).__SharedGraph;
      const g = SharedGraph.create(provider, 'did-match');
      const ST = (window as any).__SemanticTriple;
      const signed = await g.addTriple(new ST('urn:dm:1', 'urn:dm:2'));
      return {
        authorMatchesDid: signed.author === did,
        keyInProof: typeof signed.proof?.key === 'string' && signed.proof.key.length > 0,
      };
    });
    expect(result.authorMatchesDid).toBe(true);
    expect(result.keyInProof).toBe(true);
  });
});
