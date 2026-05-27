/**
 * Conformance tests for @living-web/capability-framework.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Graph,
  GraphStorage,
  EphemeralIdentity,
  type IdentityProvider,
} from '@living-web/personal-graph';
import {
  GraphGovernanceEngine,
  GOV,
  CONTEXT,
  createCapability,
  delegateCapability,
  revokeCapability,
  evaluateCaveats,
  expiryCaveatHandler,
  createGovernanceLayer,
  type Caveat,
  type CaveatHandler,
  type TripleInput,
  type ValidationContext,
} from '../index.js';

const coreHandlers = new Map<string, CaveatHandler>([['expiry', expiryCaveatHandler]]);

const GRAPH_DID = 'did:graph:test-governance';
const OWNER_DID = 'did:key:z6Mkowner';
const ALICE_DID = 'did:key:z6Mkalice';
const BOB_DID = 'did:key:z6Mkbob';

let store: GraphStorage;
let identity: IdentityProvider;
let graph: Graph;

beforeEach(async () => {
  store = new GraphStorage(`test-${crypto.randomUUID()}`);
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  identity = eph;
  // Construct with the did:graph as the internal id (it doubles as the
  // groupified identity, since these tests pre-suppose the graph is
  // "the graph identified by GRAPH_DID"). setDid pins the did.
  graph = new Graph(GRAPH_DID, 'Test', identity, store);
  graph.setDid(GRAPH_DID);
});

function makeContext(): ValidationContext {
  return {
    graphDid: GRAPH_DID,
    rootCapabilityId: null,
    enforcementMode: 'open',
    queryTriples: async (q) => {
      const results = await graph.queryTriples({
        subject: q.subject ?? undefined,
        predicate: q.predicate ?? undefined,
        object: q.object ?? undefined,
      });
      return results.map(r => ({
        data: { subject: r.data.subject, predicate: r.data.predicate, object: r.data.object },
        author: r.author,
        timestamp: r.timestamp,
      }));
    },
  };
}

function makeTriple(predicate: string, object: string, author = ALICE_DID): TripleInput {
  return {
    subject: 'urn:entity:1',
    predicate,
    object,
    author,
    timestamp: new Date().toISOString(),
  };
}

describe('createCapability', () => {
  test('builds a ZCAP with actions + resource', () => {
    const zcap = createCapability(ALICE_DID, ['createLink'], GRAPH_DID, OWNER_DID);
    expect(zcap.invoker).toBe(ALICE_DID);
    expect(zcap.resource).toBe(GRAPH_DID);
    expect(zcap.actions).toEqual(['createLink']);
    expect(zcap.parentCapability).toBeNull();
  });

  test('accepts caveats', () => {
    const zcap = createCapability(ALICE_DID, ['createLink'], GRAPH_DID, OWNER_DID, {
      caveats: [
        { type: 'expiry', value: { expiresAt: '2027-01-01T00:00:00Z' } },
        { type: 'predicate', value: { allowed: ['msg://body'] } },
      ],
    });
    expect(zcap.caveats).toHaveLength(2);
  });
});

describe('delegateCapability', () => {
  test('attenuates actions to a subset', () => {
    const parent = createCapability(ALICE_DID, ['createLink', 'removeLink'], GRAPH_DID, OWNER_DID);
    const child = delegateCapability(parent, BOB_DID, ALICE_DID, {
      subsetActions: ['createLink'],
    });
    expect(child.actions).toEqual(['createLink']);
    expect(child.parentCapability).toBe(parent.id);
  });

  test('rejects actions not present on parent', () => {
    const parent = createCapability(ALICE_DID, ['createLink'], GRAPH_DID, OWNER_DID);
    expect(() =>
      delegateCapability(parent, BOB_DID, ALICE_DID, {
        subsetActions: ['removeLink'],
      }),
    ).toThrow(/not in parent capability/);
  });

  test('preserves parent caveats and appends new ones', () => {
    const parent = createCapability(ALICE_DID, ['createLink'], GRAPH_DID, OWNER_DID, {
      caveats: [{ type: 'expiry', value: { expiresAt: '2030-01-01T00:00:00Z' } }],
    });
    const child = delegateCapability(parent, BOB_DID, ALICE_DID, {
      additionalCaveats: [{ type: 'rateLimit', value: { maxPerWindow: 5, windowSeconds: 60 } }],
    });
    expect(child.caveats).toHaveLength(2);
    expect(child.caveats?.[0].type).toBe('expiry');
    expect(child.caveats?.[1].type).toBe('rateLimit');
  });
});

describe('revokeCapability', () => {
  test('produces a revocation triple', () => {
    const r = revokeCapability(OWNER_DID, 'urn:uuid:cap-1');
    expect(r.subject).toBe(OWNER_DID);
    expect(r.predicate).toBe(GOV.REVOKES_CAPABILITY);
    expect(r.object).toBe('urn:uuid:cap-1');
  });
});

describe('Caveat evaluation (framework-core)', () => {
  test('expiry — accepts before expiry, rejects after', async () => {
    const ctx = makeContext();
    const triple = makeTriple('msg://body', 'hi');
    const future: Caveat = { type: 'expiry', value: { expiresAt: '2099-01-01T00:00:00Z' } };
    const past: Caveat = { type: 'expiry', value: { expiresAt: '2020-01-01T00:00:00Z' } };
    expect((await evaluateCaveats([future], triple, 'createLink', ctx, coreHandlers)).allowed).toBe(true);
    expect((await evaluateCaveats([past], triple, 'createLink', ctx, coreHandlers)).allowed).toBe(false);
  });

  test('unknown caveat type rejects fail-closed', async () => {
    const ctx = makeContext();
    const triple = makeTriple('msg://body', 'hi');
    const unknown: Caveat = { type: 'rateLimit', value: { maxPerWindow: 1, windowSeconds: 60 } };
    // No handler registered for `rateLimit` in core — must reject.
    const r = await evaluateCaveats([unknown], triple, 'createLink', ctx, coreHandlers);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Unknown caveat type 'rateLimit'/);
  });
});

// Plug-in caveat handlers (predicate, rateLimit, subject, object, …) are
// covered by `@living-web/constraint-vocabulary` tests, not here.

describe('Enforcement mode', () => {
  test('open mode accepts unauthorised writes', async () => {
    const engine = new GraphGovernanceEngine(makeContext());
    const ctx = engine.graph;
    ctx.enforcementMode = 'open';
    const result = await engine.validate(makeTriple('msg://body', 'hi'));
    expect(result.allowed).toBe(true);
  });

  test('announced mode reads from graph triples', async () => {
    await graph.addTriple({
      subject: GRAPH_DID,
      predicate: GOV.ENFORCEMENT_MODE,
      object: '"announced"',
    });
    const engine = new GraphGovernanceEngine(makeContext());
    const mode = await engine.getEnforcementMode();
    expect(mode).toBe('announced');
  });
});

describe('Scope resolution', () => {
  test('walks context://participates_in upward', async () => {
    // Set up: child graph participates in parent. Use makeContext queries
    // against `graph` which holds the participation triple.
    await graph.addTriple({
      subject: GRAPH_DID,
      predicate: CONTEXT.PARTICIPATES_IN,
      object: 'did:graph:parent',
    });
    await graph.addTriple({
      subject: 'did:graph:parent',
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
      object: GRAPH_DID,
    });

    const { resolveScopeSet } = await import('../index.js');
    const scope = await resolveScopeSet(GRAPH_DID, makeContext());
    expect([...scope.graphs.keys()].sort()).toEqual([GRAPH_DID, 'did:graph:parent'].sort());
    expect(scope.graphs.get(GRAPH_DID)).toBe(0);
    expect(scope.graphs.get('did:graph:parent')).toBe(1);
  });

  test('ignores participation without mutual acceptance', async () => {
    await graph.addTriple({
      subject: GRAPH_DID,
      predicate: CONTEXT.PARTICIPATES_IN,
      object: 'did:graph:parent',
    });
    // No accepts_participation triple — the parent is not honoured.
    const { resolveScopeSet } = await import('../index.js');
    const scope = await resolveScopeSet(GRAPH_DID, makeContext());
    expect([...scope.graphs.keys()]).toEqual([GRAPH_DID]);
  });
});

describe('createGovernanceLayer', () => {
  test('queries the graph for the root capability', async () => {
    await graph.addTriple({
      subject: GRAPH_DID,
      predicate: GOV.ROOT_CAPABILITY,
      object: 'urn:uuid:root',
    });
    const layer = createGovernanceLayer(graph);
    // Allow microtask in integration to read the triple.
    await new Promise(resolve => setTimeout(resolve, 0));
    const constraints = await layer.constraintsFor();
    expect(Array.isArray(constraints)).toBe(true);
  });

  test('setEnforcementMode persists the mode triple', async () => {
    const layer = createGovernanceLayer(graph);
    await layer.setEnforcementMode('enforced');
    const triples = await graph.queryTriples({
      subject: GRAPH_DID,
      predicate: GOV.ENFORCEMENT_MODE,
    });
    expect(triples.find(t => t.data.object === '"enforced"')).toBeDefined();
  });
});
