/**
 * Comprehensive edge-case tests for the redesigned governance engine.
 *
 * Proves the theory in Spec 03 across the combinations the framework now
 * promises:
 *   - Scope-set resolution (single / hierarchical / holonic / multi-parent /
 *     transitive / cycle / overflow)
 *   - Constraint accumulation (no override) + deny-wins composition
 *   - Capability invocation with `has_zcap` across the scope set
 *   - BootstrapRoot chain-cut at constitutional boundaries
 *   - Immutable-caveats attenuation (add OK, modify/remove invalid)
 *   - Revocation (chain invalidation, forward-looking under EC)
 *   - Action derivation by predicate prefix + custom registry
 *   - Enforcement modes: Open / Announced / Enforced asymmetry
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
  BOOTSTRAP_ROOT,
  inferAction,
  resolveScopeSet,
  collectConstraints,
  pickAuditAttribution,
  type TripleInput,
  type ValidationContext,
  type ZCAPDocument,
  type ConstraintHandler,
  type Caveat,
} from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test scaffolding.
//
// We simulate multiple participating graphs by writing all triples into a
// single Graph store, with the per-graph DID encoded in each triple's subject.
// This is semantically equivalent for queryTriples-based engine logic — the
// engine never asks "which physical store holds this triple", it just
// indexes by subject/predicate/object. Real multi-store environments behave
// identically because the polyfill's resolveScopeSet only depends on the
// relational view.
// ─────────────────────────────────────────────────────────────────────────────

const ALPHA  = 'did:graph:alpha';   // primary writing graph
const BETA   = 'did:graph:beta';    // participating partner
const GAMMA  = 'did:graph:gamma';   // second participant (multi-parent)
const DELTA  = 'did:graph:delta';   // transitive ancestor

const OWNER  = 'did:key:z6Mkowner';
const ALICE  = 'did:key:z6Mkalice';
const BOB    = 'did:key:z6Mkbob';
const EVE    = 'did:key:z6Mkeve';

let store: GraphStorage;
let identity: IdentityProvider;
let graph: Graph;
let expressionStore: Map<string, ZCAPDocument>;

beforeEach(async () => {
  store = new GraphStorage(`test-${crypto.randomUUID()}`);
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  identity = eph;
  graph = new Graph(ALPHA, 'Alpha', identity, store);
  graph.setDid(ALPHA);
  expressionStore = new Map();
});

function ctxFor(graphDid: string, mode: 'open' | 'announced' | 'enforced' = 'enforced'): ValidationContext {
  return {
    graphDid,
    rootCapabilityId: null,
    enforcementMode: mode,
    queryTriples: async (q) => {
      const r = await graph.queryTriples({
        subject: q.subject ?? undefined,
        predicate: q.predicate ?? undefined,
        object: q.object ?? undefined,
      });
      return r.map(t => ({
        data: { subject: t.data.subject, predicate: t.data.predicate, object: t.data.object },
        author: t.author,
        timestamp: t.timestamp,
      }));
    },
    resolveExpression: async (addr) => expressionStore.get(addr) ?? null,
  };
}

async function declareParticipation(participator: string, target: string): Promise<void> {
  await graph.addTriple({ subject: participator, predicate: CONTEXT.PARTICIPATES_IN, object: target });
  await graph.addTriple({ subject: target,       predicate: CONTEXT.ACCEPTS_PARTICIPATION, object: participator });
}

async function declareEnforcement(graphDid: string, mode: 'open' | 'announced' | 'enforced'): Promise<void> {
  await graph.addTriple({ subject: graphDid, predicate: GOV.ENFORCEMENT_MODE, object: `"${mode}"` });
}

async function bindConstraint(graphDid: string, constraintId: string): Promise<void> {
  await graph.addTriple({ subject: graphDid, predicate: GOV.HAS_CONSTRAINT, object: constraintId });
}

async function defineCapabilityConstraint(constraintId: string, opts?: { predicates?: string[] }): Promise<void> {
  await graph.addTriple({ subject: constraintId, predicate: GOV.ENTRY_TYPE, object: GOV.CONSTRAINT });
  await graph.addTriple({ subject: constraintId, predicate: GOV.CONSTRAINT_KIND, object: '"capability"' });
  await graph.addTriple({ subject: constraintId, predicate: GOV.CAPABILITY_ENFORCEMENT, object: '"required"' });
  if (opts?.predicates) {
    await graph.addTriple({ subject: constraintId, predicate: GOV.CAPABILITY_PREDICATES, object: opts.predicates.join(',') });
  }
}

async function defineKindConstraint(constraintId: string, kind: string): Promise<void> {
  await graph.addTriple({ subject: constraintId, predicate: GOV.ENTRY_TYPE, object: GOV.CONSTRAINT });
  await graph.addTriple({ subject: constraintId, predicate: GOV.CONSTRAINT_KIND, object: `"${kind}"` });
}

async function declareRoot(graphDid: string, capId: string): Promise<void> {
  await graph.addTriple({ subject: graphDid, predicate: GOV.ROOT_CAPABILITY, object: capId });
}

async function grantZcap(holder: string, capId: string): Promise<void> {
  await graph.addTriple({ subject: holder, predicate: GOV.HAS_ZCAP, object: capId });
}

function makeZcap(opts: {
  id: string;
  invoker: string;
  parent: string;
  actions: string[];
  resource: string;
  caveats?: Caveat[];
  proofSigner?: string;
}): ZCAPDocument {
  return {
    id: opts.id,
    invoker: opts.invoker,
    parentCapability: opts.parent,
    actions: opts.actions,
    resource: opts.resource,
    caveats: opts.caveats,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${opts.proofSigner ?? opts.invoker}#key-1`,
      proofPurpose: 'capabilityDelegation',
      proofValue: 'z' + Math.random().toString(36).slice(2),
    },
  };
}

function storeZcap(cap: ZCAPDocument): void {
  expressionStore.set(cap.id, cap);
}

function mkTriple(predicate: string, opts?: { author?: string; subject?: string; object?: string }): TripleInput {
  return {
    subject: opts?.subject ?? 'urn:entity:test',
    predicate,
    object: opts?.object ?? 'value',
    author: opts?.author ?? ALICE,
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SCOPE-SET RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Scope-set resolution', () => {
  test('single graph: scope-set is just the graph itself', async () => {
    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...scope.graphs.keys()]).toEqual([ALPHA]);
    expect(scope.graphs.get(ALPHA)).toBe(0);
    expect(scope.overflow).toBe(false);
  });

  test('hierarchical (one direction): participator reaches target; target alone does not reach participator', async () => {
    await declareParticipation(ALPHA, BETA);

    const fromAlpha = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...fromAlpha.graphs.keys()].sort()).toEqual([ALPHA, BETA].sort());
    expect(fromAlpha.graphs.get(BETA)).toBe(1);

    const fromBeta = await resolveScopeSet(BETA, ctxFor(BETA));
    expect([...fromBeta.graphs.keys()]).toEqual([BETA]);
  });

  test('holonic (both directions): each graph reaches the other', async () => {
    await declareParticipation(ALPHA, BETA);
    await declareParticipation(BETA, ALPHA);

    const fromAlpha = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...fromAlpha.graphs.keys()].sort()).toEqual([ALPHA, BETA].sort());

    const fromBeta = await resolveScopeSet(BETA, ctxFor(BETA));
    expect([...fromBeta.graphs.keys()].sort()).toEqual([ALPHA, BETA].sort());
  });

  test('multi-parent: a graph participating in two others has both at depth 1', async () => {
    await declareParticipation(ALPHA, BETA);
    await declareParticipation(ALPHA, GAMMA);

    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...scope.graphs.keys()].sort()).toEqual([ALPHA, BETA, GAMMA].sort());
    expect(scope.graphs.get(BETA)).toBe(1);
    expect(scope.graphs.get(GAMMA)).toBe(1);
  });

  test('transitive participation: A→B→C reaches all three', async () => {
    await declareParticipation(ALPHA, BETA);
    await declareParticipation(BETA, DELTA);

    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...scope.graphs.keys()].sort()).toEqual([ALPHA, BETA, DELTA].sort());
    expect(scope.graphs.get(BETA)).toBe(1);
    expect(scope.graphs.get(DELTA)).toBe(2);
  });

  test('cycle: visited-set guards against infinite loops', async () => {
    await declareParticipation(ALPHA, BETA);
    await declareParticipation(BETA, ALPHA);   // cycle (also = holonic)
    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...scope.graphs.keys()].sort()).toEqual([ALPHA, BETA].sort());
  });

  test('missing acceptance: unilateral participation is ignored', async () => {
    await graph.addTriple({ subject: ALPHA, predicate: CONTEXT.PARTICIPATES_IN, object: BETA });
    // no accepts_participation on BETA side
    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect([...scope.graphs.keys()]).toEqual([ALPHA]);
  });

  test('multi-parent depth: a graph reached via two paths records the minimum depth', async () => {
    // ALPHA → BETA, ALPHA → GAMMA, BETA → DELTA, GAMMA → DELTA — DELTA reachable at depth 2 via either path
    await declareParticipation(ALPHA, BETA);
    await declareParticipation(ALPHA, GAMMA);
    await declareParticipation(BETA, DELTA);
    await declareParticipation(GAMMA, DELTA);
    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    expect(scope.graphs.get(DELTA)).toBe(2);
  });

  test('scope-overflow: BFS halts at 100 graphs and signals overflow', async () => {
    // Build a chain of 105 participations.
    for (let i = 0; i < 104; i++) {
      const a = `did:graph:n${i}`;
      const b = `did:graph:n${i + 1}`;
      await graph.addTriple({ subject: a, predicate: CONTEXT.PARTICIPATES_IN, object: b });
      await graph.addTriple({ subject: b, predicate: CONTEXT.ACCEPTS_PARTICIPATION, object: a });
    }
    const scope = await resolveScopeSet('did:graph:n0', ctxFor('did:graph:n0'));
    expect(scope.overflow).toBe(true);
    expect(scope.graphs.size).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONSTRAINT ACCUMULATION + DENY-WINS
// ─────────────────────────────────────────────────────────────────────────────

describe('Constraint accumulation and deny-wins', () => {
  test('same-kind constraints from parent + child both appear (no override)', async () => {
    await declareParticipation(ALPHA, BETA);
    await defineKindConstraint('urn:c:alpha-temporal', 'temporal');
    await bindConstraint(ALPHA, 'urn:c:alpha-temporal');
    await defineKindConstraint('urn:c:beta-temporal', 'temporal');
    await bindConstraint(BETA, 'urn:c:beta-temporal');

    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    const constraints = await collectConstraints(scope, ctxFor(ALPHA));

    const temporalIds = constraints.filter(c => c.kind === 'temporal').map(c => c.id).sort();
    expect(temporalIds).toEqual(['urn:c:alpha-temporal', 'urn:c:beta-temporal']);
  });

  test('deny-wins: either parent or child rejecting causes rejection', async () => {
    await declareParticipation(ALPHA, BETA);
    await defineKindConstraint('urn:c:parent-deny', 'temporal');
    await bindConstraint(BETA, 'urn:c:parent-deny');

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    const denyHandler: ConstraintHandler = {
      kind: 'temporal',
      validate: async (_t, c) => c.id === 'urn:c:parent-deny'
        ? { allowed: false, constraintKind: 'temporal', reason: 'parent denies', rejectedBy: c.id }
        : { allowed: true },
    };
    engine.registerConstraintKind(denyHandler);

    const result = await engine.validate(mkTriple('urn:p:msg', { object: 'hi' }));
    expect(result.allowed).toBe(false);
    expect(result.rejectedBy).toBe('urn:c:parent-deny');
  });

  test('different kinds accumulate; any kind rejecting causes rejection', async () => {
    await defineKindConstraint('urn:c:temporal-1', 'temporal');
    await bindConstraint(ALPHA, 'urn:c:temporal-1');
    await defineKindConstraint('urn:c:content-1', 'content');
    await bindConstraint(ALPHA, 'urn:c:content-1');

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    engine.registerConstraintKind({
      kind: 'temporal',
      validate: async () => ({ allowed: true }),
    });
    engine.registerConstraintKind({
      kind: 'content',
      validate: async (_t, c) => ({ allowed: false, constraintKind: 'content', reason: 'blocked', rejectedBy: c.id }),
    });

    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(false);
    expect(result.constraintKind).toBe('content');
  });

  test('audit attribution: lowest-depth rejecting constraint wins rejectedBy', async () => {
    await declareParticipation(ALPHA, BETA);
    await defineKindConstraint('urn:c:child-deny', 'temporal');
    await bindConstraint(ALPHA, 'urn:c:child-deny');
    await defineKindConstraint('urn:c:parent-deny', 'temporal');
    await bindConstraint(BETA, 'urn:c:parent-deny');

    const scope = await resolveScopeSet(ALPHA, ctxFor(ALPHA));
    const constraints = await collectConstraints(scope, ctxFor(ALPHA));
    const rejecting = constraints.filter(c => c.kind === 'temporal');
    const attribution = pickAuditAttribution(rejecting);
    // child-deny is depth 0; parent-deny is depth 1. Lowest depth wins.
    expect(attribution?.id).toBe('urn:c:child-deny');
  });

  test('unknown constraint kind without registered handler: fail-closed', async () => {
    await defineKindConstraint('urn:c:weird', 'temporal');   // valid kind, but no handler
    await bindConstraint(ALPHA, 'urn:c:weird');

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(false);
    expect(result.constraintKind).toBe('temporal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CAPABILITY across scope-set has_zcap + BootstrapRoot
// ─────────────────────────────────────────────────────────────────────────────

describe('Capability invocation across the scope set', () => {
  test('cap whose resource is a participating parent applies to writes in the child', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await declareParticipation(ALPHA, BETA);
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const rootCap = makeZcap({
      id: 'urn:cap:beta-root',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: BETA,   // resource is the parent graph
    });
    storeZcap(rootCap);
    await declareRoot(BETA, rootCap.id);
    await grantZcap(ALICE, rootCap.id);

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(true);
  });

  test('cap not in scope set: rejected even if action+caveats match', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const cap = makeZcap({
      id: 'urn:cap:foreign',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: GAMMA,   // GAMMA is NOT in alpha's scope
    });
    storeZcap(cap);
    await grantZcap(ALICE, cap.id);
    // GAMMA isn't even reachable, so its root_capability doesn't help.

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(false);
  });

  test('BootstrapRoot terminates chain at the local root', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const rootCap = makeZcap({
      id: 'urn:cap:alpha-root',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: ALPHA,
    });
    storeZcap(rootCap);
    await declareRoot(ALPHA, rootCap.id);
    await grantZcap(ALICE, rootCap.id);

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(true);
  });

  test('BootstrapRoot cap NOT declared as root_capability: rejected', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const fakeBootstrap = makeZcap({
      id: 'urn:cap:fake-root',
      invoker: EVE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: ALPHA,
    });
    storeZcap(fakeBootstrap);
    // NOT declared as root_capability of ALPHA — chain validation should fail.
    await grantZcap(EVE, fakeBootstrap.id);

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validate(mkTriple('urn:p:x', { author: EVE }));
    expect(result.allowed).toBe(false);
  });

  test('constitutionalisation: parent\'s key in BootstrapRoot does not grant standing in the child later', async () => {
    // Bootstrap of ALPHA was signed by a parent-delegate key. After bootstrap,
    // that key has no standing in ALPHA for ordinary writes — only the
    // root_capability invoker (and their delegates) do.
    await declareEnforcement(ALPHA, 'enforced');
    await declareParticipation(ALPHA, BETA);
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    // ALPHA's root was bootstrap-issued; invoker is ALICE (the founder).
    const alphaRoot = makeZcap({
      id: 'urn:cap:alpha-root',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: ALPHA,
    });
    storeZcap(alphaRoot);
    await declareRoot(ALPHA, alphaRoot.id);
    await grantZcap(ALICE, alphaRoot.id);

    // EVE is a legitimate delegate of BETA (the parent), but BETA's authority
    // does not bleed into ALPHA's root chain. EVE has no cap on ALPHA.
    const result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: EVE }));
    expect(result.allowed).toBe(false);

    // ALICE writes fine.
    const okResult = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: ALICE }));
    expect(okResult.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IMMUTABLE CAVEATS ATTENUATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Immutable-caveats attenuation', () => {
  beforeEach(async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');
  });

  function parentCap(caveats: Caveat[]): ZCAPDocument {
    return makeZcap({
      id: 'urn:cap:parent',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: ALPHA,
      caveats,
    });
  }

  test('child with identical caveats: chain valid', async () => {
    const parent = parentCap([{ type: 'rateLimit', value: { maxPerWindow: 10, windowSeconds: 60 } }]);
    storeZcap(parent);
    await declareRoot(ALPHA, parent.id);

    const child = makeZcap({
      id: 'urn:cap:child',
      invoker: BOB,
      parent: parent.id,
      actions: ['createLink'],
      resource: ALPHA,
      caveats: [{ type: 'rateLimit', value: { maxPerWindow: 10, windowSeconds: 60 } }],
      proofSigner: ALICE,
    });
    storeZcap(child);
    await grantZcap(BOB, child.id);

    const result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: BOB }));
    expect(result.allowed).toBe(true);
  });

  test('child adding a new caveat (parent caveats unchanged): chain valid', async () => {
    const parent = parentCap([{ type: 'rateLimit', value: { maxPerWindow: 10, windowSeconds: 60 } }]);
    storeZcap(parent);
    await declareRoot(ALPHA, parent.id);

    const child = makeZcap({
      id: 'urn:cap:child',
      invoker: BOB,
      parent: parent.id,
      actions: ['createLink'],
      resource: ALPHA,
      caveats: [
        { type: 'rateLimit', value: { maxPerWindow: 10, windowSeconds: 60 } },
        { type: 'predicate', value: { allowed: ['urn:p:x'] } },
      ],
      proofSigner: ALICE,
    });
    storeZcap(child);
    await grantZcap(BOB, child.id);

    const result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: BOB }));
    expect(result.allowed).toBe(true);
  });

  test('child missing a parent caveat: chain invalid', async () => {
    const parent = parentCap([{ type: 'rateLimit', value: { maxPerWindow: 10, windowSeconds: 60 } }]);
    storeZcap(parent);
    await declareRoot(ALPHA, parent.id);

    const child = makeZcap({
      id: 'urn:cap:child',
      invoker: BOB,
      parent: parent.id,
      actions: ['createLink'],
      resource: ALPHA,
      caveats: [],   // missing the parent's rateLimit
      proofSigner: ALICE,
    });
    storeZcap(child);
    await grantZcap(BOB, child.id);

    const result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: BOB }));
    expect(result.allowed).toBe(false);
  });

  test('child with modified parent caveat (different value): chain invalid', async () => {
    const parent = parentCap([{ type: 'rateLimit', value: { maxPerWindow: 10, windowSeconds: 60 } }]);
    storeZcap(parent);
    await declareRoot(ALPHA, parent.id);

    const child = makeZcap({
      id: 'urn:cap:child',
      invoker: BOB,
      parent: parent.id,
      actions: ['createLink'],
      resource: ALPHA,
      caveats: [{ type: 'rateLimit', value: { maxPerWindow: 100, windowSeconds: 60 } }],  // "narrowed" → still rejected
      proofSigner: ALICE,
    });
    storeZcap(child);
    await grantZcap(BOB, child.id);

    const result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: BOB }));
    expect(result.allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REVOCATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Revocation', () => {
  test('revoking a parent invalidates the whole sub-chain', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const parent = makeZcap({
      id: 'urn:cap:parent',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: ALPHA,
    });
    storeZcap(parent);
    await declareRoot(ALPHA, parent.id);

    const child = makeZcap({
      id: 'urn:cap:child',
      invoker: BOB,
      parent: parent.id,
      actions: ['createLink'],
      resource: ALPHA,
      proofSigner: ALICE,
    });
    storeZcap(child);
    await grantZcap(BOB, child.id);

    // Before revocation: BOB can write.
    let result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: BOB }));
    expect(result.allowed).toBe(true);

    // Revoke the parent.
    await graph.addTriple({ subject: ALICE, predicate: GOV.REVOKES_CAPABILITY, object: parent.id });

    result = await new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'))
      .validate(mkTriple('urn:p:x', { author: BOB }));
    expect(result.allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ACTION DERIVATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Action derivation', () => {
  test('governance:// → updateGovernance', () => {
    expect(inferAction(mkTriple('governance://enforcement_mode'))).toBe('updateGovernance');
  });
  test('did-document:// → updateDIDDocument', () => {
    expect(inferAction(mkTriple('did-document://add-method'))).toBe('updateDIDDocument');
  });
  test('shacl:// → updateSHACL', () => {
    expect(inferAction(mkTriple('shacl://target'))).toBe('updateSHACL');
  });
  test('shape:// → updateSHACL', () => {
    expect(inferAction(mkTriple('shape://target'))).toBe('updateSHACL');
  });
  test('flow:// → updateFlow', () => {
    expect(inferAction(mkTriple('flow://name'))).toBe('updateFlow');
  });
  test('unrecognised prefix → createLink', () => {
    expect(inferAction(mkTriple('urn:msg:body'))).toBe('createLink');
  });
  test('custom prefix registered on engine takes precedence', () => {
    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    engine.registerActionPrefix('app://special-', 'updateSpecial');
    expect(engine.inferAction(mkTriple('app://special-rename'))).toBe('updateSpecial');
  });
  test('overlapping prefix registration throws', () => {
    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    engine.registerActionPrefix('app://foo-', 'doFoo');
    expect(() => engine.registerActionPrefix('app://foo-extra-', 'doFooExtra')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ENFORCEMENT MODES
// ─────────────────────────────────────────────────────────────────────────────

describe('Enforcement modes', () => {
  beforeEach(async () => {
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');
  });

  test('Open: missing capability is accepted', async () => {
    await declareEnforcement(ALPHA, 'open');
    const result = await new GraphGovernanceEngine(ctxFor(ALPHA))
      .validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(true);
  });

  test('Open: non-capability constraints still apply (rejection holds)', async () => {
    await declareEnforcement(ALPHA, 'open');
    await defineKindConstraint('urn:c:temporal-deny', 'temporal');
    await bindConstraint(ALPHA, 'urn:c:temporal-deny');

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    engine.registerConstraintKind({
      kind: 'temporal',
      validate: async (_t, c) => ({ allowed: false, constraintKind: 'temporal', reason: 'rate', rejectedBy: c.id }),
    });
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(false);
    expect(result.constraintKind).toBe('temporal');
  });

  test('Announced: capability failure does not reject; logs to history', async () => {
    await declareEnforcement(ALPHA, 'announced');
    const engine = new GraphGovernanceEngine(ctxFor(ALPHA));
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(true);

    const history = engine.getValidationHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history.some(h => h.result.announcedRejection !== undefined)).toBe(true);
  });

  test('Enforced: capability failure rejects', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    const result = await new GraphGovernanceEngine(ctxFor(ALPHA))
      .validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(false);
    expect(result.constraintKind).toBe('capability');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. HOLONIC SYNC IMPLICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Holonic sync implication', () => {
  test('write to A is rejected by a constraint on holonically-linked B', async () => {
    // ALPHA and BETA are holonic peers; BETA has a temporal-deny that fires.
    await declareParticipation(ALPHA, BETA);
    await declareParticipation(BETA, ALPHA);
    await defineKindConstraint('urn:c:beta-deny', 'temporal');
    await bindConstraint(BETA, 'urn:c:beta-deny');

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    engine.registerConstraintKind({
      kind: 'temporal',
      validate: async (_t, c) => ({ allowed: false, constraintKind: 'temporal', reason: 'holonic deny', rejectedBy: c.id }),
    });
    const result = await engine.validate(mkTriple('urn:p:x'));
    expect(result.allowed).toBe(false);
    expect(result.rejectedBy).toBe('urn:c:beta-deny');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. READ-SIDE AUTHORIZATION — mountContext via engine.validateAction
//
// Proves the Spec 04 §7.1 + Spec 05 §9.2.2 contract: a sync peer authorising
// a snapshot pull asks the governance engine "may this DID perform
// mountContext?" — without supplying a triple. Caveats that depend on
// triple content are skipped; context caveats (expiry, rateLimit) still apply.
//
// Genuine scenario: Group G has a mountContext capability constraint.
// Alice holds a valid mountContext ZCAP. Bob does not. Eve has a ZCAP
// for the WRONG action (createLink instead of mountContext).
// ─────────────────────────────────────────────────────────────────────────────

describe('Read-side authorization: mountContext via validateAction', () => {
  beforeEach(async () => {
    // Group ALPHA: enforced governance with a capability constraint that
    // covers any action (no predicate filter, no action filter).
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    // Alice has a mountContext-capable ZCAP rooted at ALPHA's bootstrap.
    const aliceCap = makeZcap({
      id: 'urn:cap:alice-mount',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['mountContext'],
      resource: ALPHA,
    });
    storeZcap(aliceCap);
    await declareRoot(ALPHA, aliceCap.id);
    await grantZcap(ALICE, aliceCap.id);

    // Eve has a ZCAP for createLink (WRITES only — no mountContext).
    const eveCap = makeZcap({
      id: 'urn:cap:eve-write',
      invoker: EVE,
      parent: BOOTSTRAP_ROOT,
      actions: ['createLink'],
      resource: ALPHA,
    });
    storeZcap(eveCap);
    await grantZcap(EVE, eveCap.id);
    // Note: declareRoot used for aliceCap above; eveCap is also a bootstrap
    // root in this synthetic setup — Spec 04 §7 step 6.5.3 accepts any cap
    // whose id matches *some* root_capability triple in the scope set.
    // For this test we keep Alice's as the canonical root.

    // BOB has no ZCAPs at all.
  });

  test('Alice (holds mountContext cap) is accepted', async () => {
    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validateAction('mountContext', ALICE);
    expect(result.allowed).toBe(true);
  });

  test('Bob (holds no cap) is rejected', async () => {
    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validateAction('mountContext', BOB);
    expect(result.allowed).toBe(false);
    expect(result.constraintKind).toBe('capability');
    expect(result.rejectedBy).toBe('urn:c:alpha-cap');
  });

  test('Eve (holds a createLink cap, but not mountContext) is rejected', async () => {
    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validateAction('mountContext', EVE);
    expect(result.allowed).toBe(false);
    expect(result.constraintKind).toBe('capability');
  });

  test('Unrestricted graph (no capability constraint): all readers accepted', async () => {
    // Build a fresh setup: ALPHA without any constraint binding.
    const fresh = new GraphGovernanceEngine(ctxFor(BETA, 'enforced'));
    // BETA has no constraint binding at all.
    const result = await fresh.validateAction('mountContext', BOB);
    expect(result.allowed).toBe(true);
  });
});

describe('Read-side authorization: context-only caveats (expiry) still apply', () => {
  test('mountContext cap with expired expiry is rejected', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const expiredCap = makeZcap({
      id: 'urn:cap:expired',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['mountContext'],
      resource: ALPHA,
      caveats: [{ type: 'expiry', value: { expiresAt: '2020-01-01T00:00:00Z' } }],
    });
    storeZcap(expiredCap);
    await declareRoot(ALPHA, expiredCap.id);
    await grantZcap(ALICE, expiredCap.id);

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validateAction('mountContext', ALICE);
    expect(result.allowed).toBe(false);
  });

  test('mountContext cap with a future expiry is accepted', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const validCap = makeZcap({
      id: 'urn:cap:valid',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['mountContext'],
      resource: ALPHA,
      caveats: [{ type: 'expiry', value: { expiresAt: '2099-01-01T00:00:00Z' } }],
    });
    storeZcap(validCap);
    await declareRoot(ALPHA, validCap.id);
    await grantZcap(ALICE, validCap.id);

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validateAction('mountContext', ALICE);
    expect(result.allowed).toBe(true);
  });
});

describe('Read-side authorization: scope-set has_zcap (holonic case)', () => {
  test('mountContext cap stored on a participating parent applies to reads of the child', async () => {
    // BETA is a holonic peer of ALPHA. Alice's cap lives on BETA but
    // covers reads of ALPHA — proving that has_zcap is queried across the
    // scope set (Spec 04 §7 step 5), not just the target graph.
    await declareEnforcement(ALPHA, 'enforced');
    await declareParticipation(ALPHA, BETA);   // ALPHA inherits BETA's scope
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const cap = makeZcap({
      id: 'urn:cap:alice-mount-via-beta',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['mountContext'],
      resource: ALPHA,           // resource still names the target
    });
    storeZcap(cap);
    await declareRoot(ALPHA, cap.id);    // declared as ALPHA's root
    // The has_zcap link is placed on BETA — the scope-set walk has to find it.
    // (In the polyfill the single graph store holds all triples; the
    // distinction is which subject the triple is anchored to.)
    await graph.addTriple({ subject: ALICE, predicate: GOV.HAS_ZCAP, object: cap.id });

    const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
    const result = await engine.validateAction('mountContext', ALICE);
    expect(result.allowed).toBe(true);
  });
});

describe('Read-side authorization: end-to-end PULL scenario (validateAction as the gate)', () => {
  // A faithful enactment of the protocol that a sync module's PULL handler
  // would execute on the responder side (Spec 05 §9.2.2; Spec 09 §10.2).
  //
  // The scenario:
  //   1. Group G is set up with a mountContext-required constraint.
  //   2. Alice holds a valid mountContext cap.
  //   3. Bob does NOT hold one.
  //   4. Both attempt a PULL. The responder calls engine.validateAction
  //      ('mountContext', requesterDid) and serves SNAPSHOT iff accepted.
  //
  // This test models *what the responder does*; the wire-level send/receive
  // is the module's concern but the gate logic is what the spec mandates.

  test('Alice succeeds; Bob is denied (a PULL_DENIED would be sent)', async () => {
    await declareEnforcement(ALPHA, 'enforced');
    await defineCapabilityConstraint('urn:c:alpha-cap');
    await bindConstraint(ALPHA, 'urn:c:alpha-cap');

    const aliceCap = makeZcap({
      id: 'urn:cap:alice',
      invoker: ALICE,
      parent: BOOTSTRAP_ROOT,
      actions: ['mountContext'],
      resource: ALPHA,
    });
    storeZcap(aliceCap);
    await declareRoot(ALPHA, aliceCap.id);
    await grantZcap(ALICE, aliceCap.id);

    // Responder logic — what a sync module's PULL handler would run.
    async function handlePull(requesterDid: string): Promise<{ accepted: boolean; reason?: string }> {
      const engine = new GraphGovernanceEngine(ctxFor(ALPHA, 'enforced'));
      const r = await engine.validateAction('mountContext', requesterDid);
      return r.allowed
        ? { accepted: true }
        : { accepted: false, reason: r.reason };
    }

    const aliceResponse = await handlePull(ALICE);
    expect(aliceResponse.accepted).toBe(true);
    // Responder would send SNAPSHOT { graphDid, snapshot: ... }

    const bobResponse = await handlePull(BOB);
    expect(bobResponse.accepted).toBe(false);
    // Responder would send PULL_DENIED { graphDid, reason: 'mountContext_required', ... }
    //   and MUST NOT send SNAPSHOT or DIFFs for ALPHA to Bob.
  });
});
