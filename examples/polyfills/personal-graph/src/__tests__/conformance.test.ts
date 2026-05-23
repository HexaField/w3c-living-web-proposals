/**
 * Conformance tests for @living-web/personal-graph.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Triple,
  Context,
  GraphStorage,
  GraphStoreManager,
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
  it('requires a valid source URI', () => {
    expect(() => new Triple('not a uri', 'pred://x', 'value')).toThrow(TypeError);
  });

  it('requires a valid predicate URI', () => {
    expect(() => new Triple('urn:a', 'not a uri', 'value')).toThrow(TypeError);
  });

  it('requires a non-empty target', () => {
    expect(() => new Triple('urn:a', 'pred://x', '')).toThrow(TypeError);
  });

  it('stores all three components when valid', () => {
    const t = new Triple('urn:a', 'pred://x', 'value');
    expect(t.source).toBe('urn:a');
    expect(t.predicate).toBe('pred://x');
    expect(t.target).toBe('value');
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

describe('Context', () => {
  let identity: IdentityProvider;
  let context: Context;

  beforeEach(async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    identity = eph;
    context = new Context('did:graph:test-ctx', 'Test', identity, store);
  });

  it('adds a triple and emits tripleadded', async () => {
    const events: SignedTriple[] = [];
    context.ontripleadded = (e) => {
      const ev = e as Event & { triple: SignedTriple };
      events.push(ev.triple);
    };
    const t = new Triple('urn:a', 'pred://x', 'value');
    const signed = await context.addTriple(t);
    expect(signed.author).toBe(identity.getDID());
    expect(events).toHaveLength(1);
  });

  it('queries by source, predicate, target', async () => {
    await context.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    await context.addTriple(new Triple('urn:a', 'pred://y', 'v2'));
    await context.addTriple(new Triple('urn:b', 'pred://x', 'v3'));

    const bySource = await context.queryTriples({ source: 'urn:a' });
    expect(bySource).toHaveLength(2);

    const byPredicate = await context.queryTriples({ predicate: 'pred://x' });
    expect(byPredicate).toHaveLength(2);

    const byTarget = await context.queryTriples({ target: 'v3' });
    expect(byTarget).toHaveLength(1);
  });

  it('removes a triple and emits tripleremoved', async () => {
    const events: SignedTriple[] = [];
    context.ontripleremoved = (e) => {
      const ev = e as Event & { triple: SignedTriple };
      events.push(ev.triple);
    };
    const signed = await context.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    const ok = await context.removeTriple(signed);
    expect(ok).toBe(true);
    expect(events).toHaveLength(1);
    const remaining = await context.queryTriples({});
    expect(remaining).toHaveLength(0);
  });

  it('addTriples is atomic and signs all triples', async () => {
    const signed = await context.addTriples([
      new Triple('urn:a', 'pred://x', 'v1'),
      new Triple('urn:b', 'pred://x', 'v2'),
    ]);
    expect(signed).toHaveLength(2);
    expect(signed.every(s => s.author === identity.getDID())).toBe(true);
  });

  it('exposes provenance for a triple', async () => {
    const signed = await context.addTriple(new Triple('urn:a', 'pred://x', 'value'));
    const reifiers = await context.provenance(signed.data);
    expect(reifiers).toHaveLength(1);
    expect(reifiers[0].author).toBe(identity.getDID());
  });

  it('snapshot returns triples sorted by timestamp ascending', async () => {
    await context.addTriple(new Triple('urn:a', 'pred://x', 'v1'));
    await new Promise(resolve => setTimeout(resolve, 5));
    await context.addTriple(new Triple('urn:b', 'pred://x', 'v2'));
    const snap = await context.snapshot();
    expect(snap[0].timestamp <= snap[1].timestamp).toBe(true);
  });
});

describe('Graph snapshots', () => {
  it('content hash is deterministic regardless of triple insertion order', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const t1 = await signTripleWithReifier(new Triple('urn:a', 'pred://x', 'v1'), id, 'did:graph:g');
    const t2 = await signTripleWithReifier(new Triple('urn:b', 'pred://y', 'v2'), id, 'did:graph:g');
    const hash1 = computeContentHash([reifierToSigned(t1), reifierToSigned(t2)], 'did:graph:g');
    const hash2 = computeContentHash([reifierToSigned(t2), reifierToSigned(t1)], 'did:graph:g');
    expect(hash1).toBe(hash2);
  });

  it('round-trips through snapshot serialise → parse', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const t = await signTripleWithReifier(new Triple('urn:a', 'pred://x', 'value'), id, 'did:graph:g');
    const snap = await getAsSnapshot('did:graph:g', [reifierToSigned(t)], id, null, { signBy: 'agent' });
    const parsed = parseSnapshot(snap);
    expect(parsed.triples).toHaveLength(1);
    expect(parsed.triples[0].source).toBe('urn:a');
    expect(parsed.triples[0].predicate).toBe('pred://x');
    expect(parsed.triples[0].target).toBe('value');
  });

  it('snapshot proofs include the requested role', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const snap = await getAsSnapshot('did:graph:g', [], id, null, { signBy: 'agent' });
    expect(snap.proofs).toHaveLength(1);
    expect(snap.proofs[0].role).toBe('agent');
  });
});

describe('GraphStoreManager', () => {
  it('creates a GraphStore with a private graph mounted in governance mode', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphStoreManager(store, async () => eph);
    const gs = await manager.create('Test Workspace');
    expect(gs.privateGraphDid.startsWith('did:graph:')).toBe(true);
    const priv = gs.privateGraph();
    expect(priv).toBeDefined();
    expect(priv?.mountMode).toBe('governance');
  });

  it('createContext mints a fresh did:graph and writes seed DID-document triples', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphStoreManager(store, async () => eph);
    const gs = await manager.create('Workspace');
    const ctx = await gs.createContext({ displayName: 'Calendar' });
    expect(ctx.did.startsWith('did:graph:')).toBe(true);
    const docTriples = await ctx.queryTriples({ source: ctx.did });
    expect(docTriples.length).toBeGreaterThan(0);
  });

  it('participatesIn writes the context://participates_in triple', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphStoreManager(store, async () => eph);
    const gs = await manager.create('Workspace');
    const parent = await gs.createContext({ displayName: 'Parent' });
    const child = await gs.createContext({ displayName: 'Child', participatesIn: parent.did });
    const participation = await child.queryTriples({
      source: child.did,
      predicate: 'context://participates_in',
    });
    expect(participation).toHaveLength(1);
    expect(participation[0].data.target).toBe(parent.did);
  });

  it('resolveContext finds a mounted context by DID', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphStoreManager(store, async () => eph);
    const gs = await manager.create('Workspace');
    const ctx = await gs.createContext();
    const found = await manager.resolveContext(ctx.did);
    expect(found?.did).toBe(ctx.did);
  });
});

describe('GraphStore cross-context query', () => {
  it('querySparql unions triples across mounted contexts', async () => {
    const eph = new EphemeralIdentity();
    await eph.ensureReady();
    const manager = new GraphStoreManager(store, async () => eph);
    const gs = await manager.create('Workspace');
    const c1 = await gs.createContext({ displayName: 'A' });
    const c2 = await gs.createContext({ displayName: 'B' });
    await c1.addTriple(new Triple('urn:m1', 'pred://body', 'hello'));
    await c2.addTriple(new Triple('urn:m2', 'pred://body', 'world'));
    const r = await gs.querySparql('SELECT ?s WHERE { ?s <pred://body> ?o }');
    const sources = r.bindings.map(b => b.s).sort();
    expect(sources).toContain('urn:m1');
    expect(sources).toContain('urn:m2');
  });
});
