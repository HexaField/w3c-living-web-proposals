/**
 * Conformance tests for @living-web/personal-graph.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Triple,
  Graph,
  GraphStorage,
  GraphManager,
  EphemeralIdentity,
  signTripleWithReifier,
  verifyReifier,
  reifierToSigned,
  canonicalNQuad,
  computeContentHash,
  getAsSnapshot,
  parseSnapshot,
  type SignedTriple,
  type IdentityProvider,
} from '../index.js';

let store: GraphStorage;

beforeEach(() => {
  store = new GraphStorage(`test-${crypto.randomUUID()}`);
});

describe('Triple', () => {
  it('requires a valid subject URI', () => {
    expect(() => new Triple('not a uri', 'pred://x', 'value')).toThrow(TypeError);
  });

  it('requires a valid predicate URI', () => {
    expect(() => new Triple('urn:a', 'not a uri', 'value')).toThrow(TypeError);
  });

  it('requires a non-empty object', () => {
    expect(() => new Triple('urn:a', 'pred://x', '')).toThrow(TypeError);
  });

  it('stores all three components when valid', () => {
    const t = new Triple('urn:a', 'pred://x', 'value');
    expect(t.subject).toBe('urn:a');
    expect(t.predicate).toBe('pred://x');
    expect(t.object).toBe('value');
  });
});

describe('Reifier signing', () => {
  it('produces a verifiable reifier for a triple', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const triple = new Triple('urn:event:1', 'schema://name', 'Coffee');
    const reifier = await signTripleWithReifier(triple, id, 'did:graph:test');
    expect(reifier.author).toBe(id.getDID());
    expect(reifier.method).toBe(id.getKeyURI());
    const ok = await verifyReifier(reifier, id.getPublicKey(), 'did:graph:test');
    expect(ok).toBe(true);
  });

  it('rejects a tampered triple', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const triple = new Triple('urn:event:1', 'schema://name', 'Coffee');
    const reifier = await signTripleWithReifier(triple, id, 'did:graph:test');
    const tampered = {
      ...reifier,
      triple: new Triple('urn:event:1', 'schema://name', 'Tea'),
    };
    const ok = await verifyReifier(tampered, id.getPublicKey(), 'did:graph:test');
    expect(ok).toBe(false);
  });

  it('canonical N-Quad is deterministic across runs', () => {
    const t = new Triple('urn:a', 'pred://x', 'value');
    expect(canonicalNQuad(t, 'did:graph:test')).toBe(canonicalNQuad(t, 'did:graph:test'));
  });
});

describe('Graph', () => {
  let identity: IdentityProvider;
  let graph: Graph;

  beforeEach(async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    identity = eph;
    graph = new Graph('urn:graph:test', 'Test', identity, store);
  });

  it('adds a triple and emits tripleadded', async () => {
    const events: SignedTriple[] = [];
    graph.ontripleadded = (e) => {
      const ev = e as Event & { triple: SignedTriple };
      events.push(ev.triple);
    };
    const t = new Triple('urn:a', 'pred://x', 'value');
    const signed = await graph.addTriple(t);
    expect(signed.author).toBe(identity.getDID());
    expect(events).toHaveLength(1);
  });

  it('queries by subject, predicate, object', async () => {
    await graph.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    await graph.addTriple(new Triple('urn:a', 'pred://y', 'v2'));
    await graph.addTriple(new Triple('urn:b', 'pred://x', 'v3'));

    const bySource = await graph.queryTriples({ subject: 'urn:a' });
    expect(bySource).toHaveLength(2);

    const byPredicate = await graph.queryTriples({ predicate: 'pred://x' });
    expect(byPredicate).toHaveLength(2);

    const byTarget = await graph.queryTriples({ object: 'v3' });
    expect(byTarget).toHaveLength(1);
  });

  it('removes a triple and emits tripleremoved', async () => {
    const events: SignedTriple[] = [];
    graph.ontripleremoved = (e) => {
      const ev = e as Event & { triple: SignedTriple };
      events.push(ev.triple);
    };
    const signed = await graph.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    const ok = await graph.removeTriple(signed);
    expect(ok).toBe(true);
    expect(events).toHaveLength(1);
    const remaining = await graph.queryTriples({});
    expect(remaining).toHaveLength(0);
  });

  it('addTriples is atomic and signs all triples', async () => {
    const signed = await graph.addTriples([
      new Triple('urn:a', 'pred://x', 'v1'),
      new Triple('urn:b', 'pred://x', 'v2'),
    ]);
    expect(signed).toHaveLength(2);
    expect(signed.every(s => s.author === identity.getDID())).toBe(true);
  });

  it('exposes provenance for a triple', async () => {
    const signed = await graph.addTriple(new Triple('urn:a', 'pred://x', 'value'));
    const reifiers = await graph.provenance(signed.data);
    expect(reifiers).toHaveLength(1);
    expect(reifiers[0].author).toBe(identity.getDID());
  });

  it('snapshot returns triples sorted by timestamp ascending', async () => {
    await graph.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    await new Promise(resolve => setTimeout(resolve, 5));
    await graph.addTriple(new Triple('urn:b', 'pred://x', 'v2'));
    const snap = await graph.snapshot();
    expect(snap[0].timestamp <= snap[1].timestamp).toBe(true);
  });

  it('IRI changes after every mutation', async () => {
    const iri0 = graph.iri;
    await graph.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    expect(graph.iri).not.toBe(iri0);
  });

  it('dissolve rejects subsequent mutations', async () => {
    await graph.dissolve();
    await expect(graph.addTriple(new Triple('urn:a', 'pred://x', 'v1'))).rejects.toThrow();
  });
});

describe('Graph snapshots', () => {
  it('content hash is deterministic regardless of triple insertion order', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const t1 = await signTripleWithReifier(new Triple('urn:a', 'pred://x', 'v1'), id, 'did:graph:g');
    const t2 = await signTripleWithReifier(new Triple('urn:b', 'pred://y', 'v2'), id, 'did:graph:g');
    const hash1 = computeContentHash([reifierToSigned(t1), reifierToSigned(t2)]);
    const hash2 = computeContentHash([reifierToSigned(t2), reifierToSigned(t1)]);
    expect(hash1).toBe(hash2);
  });

  it('round-trips through snapshot serialise → parse', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const t = await signTripleWithReifier(new Triple('urn:a', 'pred://x', 'value'), id, 'graph://test');
    const snap = await getAsSnapshot('graph://test', null, [reifierToSigned(t)], id, null, { signBy: 'agent' });
    const parsed = parseSnapshot(snap);
    expect(parsed.triples).toHaveLength(1);
    expect(parsed.triples[0].data.subject).toBe('urn:a');
    expect(parsed.triples[0].data.predicate).toBe('pred://x');
    expect(parsed.triples[0].data.object).toBe('value');
    expect(parsed.triples[0].author).toBe(id.getDID());
  });

  it('snapshot proofs include the requested role', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const snap = await getAsSnapshot('graph://test', null, [], id, null, { signBy: 'agent' });
    expect(snap.proofs).toHaveLength(1);
    expect(snap.proofs[0].role).toBe('agent');
  });
});

describe('GraphManager', () => {
  it('create() returns a Graph with trustLevel="local" and null did', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphManager(store, async () => eph);
    const g = await manager.create({ displayName: 'My Calendar' });
    expect(g.iri.startsWith('graph://')).toBe(true);
    expect(g.did).toBeNull();
    expect(g.trustLevel).toBe('local');
  });

  it('mutations on a created graph advance the IRI', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphManager(store, async () => eph);
    const g = await manager.create({ displayName: 'Calendar' });
    const iri0 = g.iri;
    await g.addTriple(new Triple('urn:event:1', 'pred://x', 'value'));
    expect(g.iri).not.toBe(iri0);
  });

  it('fromSnapshot materialises a graph whose IRI matches the snapshot', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphManager(store, async () => eph);

    const source = await manager.create({ displayName: 'Source' });
    await source.addTriple(new Triple('urn:a', 'pred://x', 'hello'));
    const snap = await source.getAsSnapshot({ signBy: 'agent' });

    const materialised = await manager.fromSnapshot(snap);
    expect(materialised.iri).toBe(snap.graphIri);
    expect(materialised.trustLevel).toBe('external');
  });

  it('rejects lossy snapshot formats in fromSnapshot', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphManager(store, async () => eph);

    const source = await manager.create({ displayName: 'Source' });
    await source.addTriple(new Triple('urn:a', 'pred://x', 'hello'));
    const lossy = await source.getAsSnapshot({ format: 'turtle', signBy: 'agent' });

    await expect(manager.fromSnapshot(lossy)).rejects.toThrow(/NotSupportedError|lossy/);
  });
});

describe('Holonic SPARQL', () => {
  it('queries across a default graph and named graphs', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphManager(store, async () => eph);

    const community = await manager.create({ displayName: 'Acme' });
    const channel   = await manager.create({ displayName: '#general' });

    // Write messages FIRST so channel.iri is stable before community
    // references it. Graph IRIs are content-addressed and change on every
    // write; cross-graph references must capture the post-mutation IRI.
    await channel.addTriple(new Triple(
      'urn:msg:1',
      'urn:p:body',
      'hello',
    ));
    await community.addTriple(new Triple(
      'urn:community:acme',
      'urn:p:hasChannel',
      channel.iri,
    ));

    const r = await community.querySparql(`
      SELECT ?body WHERE {
        <urn:community:acme> <urn:p:hasChannel> ?ch .
        GRAPH ?ch {
          ?msg <urn:p:body> ?body .
        }
      }
    `, { namedGraphs: [channel] });

    expect(r.bindings.map(b => b.body)).toContain('hello');
  });
});
