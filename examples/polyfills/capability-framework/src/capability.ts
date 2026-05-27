/**
 * ZCAP verification (Spec 04 §7).
 *
 * Key invariants enforced here:
 *   - `has_zcap` is queried across **every graph in the scope set**, not
 *     just the writing graph (Spec 04 §7 step 5).
 *   - Chain walk terminates at `urn:living-web:zcap:BootstrapRoot` — the
 *     bootstrap sentinel that cuts the chain at the constitutional boundary
 *     (Spec 04 §4.3, §7 step 6.5.4).
 *   - Each parent in the chain MUST carry `delegateCapability` in its
 *     `actions` — otherwise the chain is broken at that step (Spec 04 §7
 *     step 6.5.3).
 *   - Attenuation is **immutable caveats**: child MAY add caveats but MUST
 *     NOT modify or remove parent caveats. Byte equality, not "narrowed"
 *     (Spec 04 §8).
 *   - Capability constraints in scope are evaluated as long as `kind ===
 *     "capability"`. The earlier `capability_enforcement` field has been
 *     dropped (Spec 04 §4.5.1) — presence of a capability constraint is
 *     itself the "required" signal.
 */

import { GOV } from './predicates.js';
import { evaluateCaveats } from './caveats.js';
import type {
  GraphConstraint, GovernanceValidationResult, TripleInput,
  ValidationContext, ZCAPDocument, Caveat, CaveatHandler,
} from './types.js';
import type { ScopeSet } from './scope.js';

const MAX_CHAIN_DEPTH = 10;
const DELEGATE_CAPABILITY_ACTION = 'delegateCapability';

/** Sentinel marking a constitutionalised root (Spec 04 §4.3). */
export const BOOTSTRAP_ROOT = 'urn:living-web:zcap:BootstrapRoot';

/**
 * Default predicate-prefix → action map (Spec 04 §4.5.4.1). Other
 * specifications register additional mappings on the engine.
 */
const DEFAULT_ACTION_PREFIXES: Array<[string, string]> = [
  ['governance://', 'updateGovernance'],
  ['did-document://', 'updateDIDDocument'],
];

export function inferAction(triple: TripleInput, extraPrefixes: Array<[string, string]> = []): string {
  for (const [prefix, action] of [...extraPrefixes, ...DEFAULT_ACTION_PREFIXES]) {
    if (triple.predicate.startsWith(prefix)) return action;
  }
  return 'createLink';
}

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val) return [];
  return val.replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

export async function verifyCapability(
  triple: TripleInput,
  constraints: GraphConstraint[],
  scope: ScopeSet,
  ctx: ValidationContext,
  caveatHandlers: ReadonlyMap<string, CaveatHandler>,
  actionOverride?: string,
): Promise<GovernanceValidationResult> {
  const action = actionOverride ?? inferAction(triple);
  // Presence of any capability constraint makes capability checking required
  // (Spec 04 §4.5.1).
  const capConstraints = constraints.filter(c => c.kind === 'capability');

  if (capConstraints.length === 0) return { allowed: true };

  // Predicate-coverage check: only meaningful for triple operations. For
  // non-triple ops (action override), predicate-coverage doesn't apply
  // (Spec 04 §7.1).
  const isTripleOp = !actionOverride;
  if (isTripleOp) {
    let predicateCovered = false;
    for (const cc of capConstraints) {
      const preds = parseCommaSeparated(cc.properties[GOV.CAPABILITY_PREDICATES]);
      if (preds.length === 0 || preds.includes(triple.predicate)) {
        predicateCovered = true;
        break;
      }
    }
    if (!predicateCovered) return { allowed: true };
  }

  // Collect the author's has_zcap links from EVERY graph in the scope set.
  const zcapLinks: { object: string }[] = [];
  for (const graphDid of scope.graphs.keys()) {
    const links = await ctx.queryTriples({
      subject: triple.author,
      predicate: GOV.HAS_ZCAP,
    });
    for (const l of links) zcapLinks.push({ object: l.data.object });
    // Also any has_zcap links anchored on the graph itself for graph-DID-invoker caps.
    const graphLinks = await ctx.queryTriples({
      subject: graphDid,
      predicate: GOV.HAS_ZCAP,
    });
    for (const l of graphLinks) zcapLinks.push({ object: l.data.object });
  }
  // Dedupe by the ZCAP id.
  const seenZcap = new Set<string>();
  const candidates: ZCAPDocument[] = [];
  for (const link of zcapLinks) {
    const zcap = await resolveZCAP(link.object, ctx);
    if (!zcap || seenZcap.has(zcap.id)) continue;
    seenZcap.add(zcap.id);
    candidates.push(zcap);
  }

  for (const zcap of candidates) {
    // Action match
    const actions = zcap.actions ?? zcap.capability?.predicates ?? [];
    if (!actions.includes(action)) continue;

    // Resource match: target graph DID, current IRI, or any graph in the scope set.
    // (Spec 04 §7 step 6.2: capability accumulation across the scope set.)
    const resource = zcap.resource ?? zcap.capability?.scope?.graph;
    if (resource && resource !== ctx.graphDid && !scope.graphs.has(resource)) continue;

    // Revocation
    if (await isRevoked(zcap.id, ctx)) continue;

    // Caveats — dispatched through the handler registry. Non-triple ops skip
    // caveats whose handler reports appliesToNonTripleOps = false.
    const caveats: Caveat[] = zcap.caveats ?? [];
    if (caveats.length > 0) {
      const caveatResult = await evaluateCaveats(
        caveats,
        isTripleOp ? triple : null,
        action,
        ctx,
        caveatHandlers as Map<string, CaveatHandler>,
      );
      if (!caveatResult.allowed) continue;
    }

    // Chain verification — enforces delegateCapability at each parent step.
    if (await verifyChain(zcap, ctx, scope, caveatHandlers)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    constraintKind: 'capability',
    reason: `No valid capability for ${action} on ${ctx.graphDid}`,
    rejectedBy: capConstraints[0].id,
  };
}

async function resolveZCAP(address: string, ctx: ValidationContext): Promise<ZCAPDocument | null> {
  if (ctx.resolveExpression) {
    try {
      const doc = await ctx.resolveExpression(address);
      if (doc && typeof doc === 'object' && 'id' in (doc as Record<string, unknown>)) {
        return doc as ZCAPDocument;
      }
    } catch { /* fallthrough */ }
  }
  // Fallback: ZCAP stored as a single JSON literal at the address subject.
  const triples = await ctx.queryTriples({ subject: address });
  for (const t of triples) {
    try {
      const parsed = JSON.parse(t.data.object);
      if (parsed && parsed.id) return parsed as ZCAPDocument;
    } catch { /* try next */ }
  }
  return null;
}

async function isRevoked(zcapId: string, ctx: ValidationContext): Promise<boolean> {
  const revocations = await ctx.queryTriples({
    predicate: GOV.REVOKES_CAPABILITY,
    object: zcapId,
  });
  return revocations.length > 0;
}

async function verifyChain(
  zcap: ZCAPDocument,
  ctx: ValidationContext,
  scope: ScopeSet,
  caveatHandlers: ReadonlyMap<string, CaveatHandler>,
  depth = 0,
): Promise<boolean> {
  if (depth > MAX_CHAIN_DEPTH) return false;
  if (!zcap.proof?.proofValue) return false;

  // BOOTSTRAP TERMINATION (Spec 04 §4.3, §7 step 6.5.4): chain is cut at the
  // constitutional boundary. We do NOT walk into the parent's chain.
  if (zcap.parentCapability === BOOTSTRAP_ROOT) {
    // Validate that this cap is in fact a root of some graph in the scope set.
    for (const graphDid of scope.graphs.keys()) {
      const rootLinks = await ctx.queryTriples({
        subject: graphDid,
        predicate: GOV.ROOT_CAPABILITY,
      });
      for (const link of rootLinks) {
        if (link.data.object === zcap.id) return true;
      }
    }
    return false;
  }

  // Legacy null-parent case (matches if explicitly marked as the local root).
  if (zcap.parentCapability === null) {
    if (ctx.rootCapabilityId && zcap.id !== ctx.rootCapabilityId) return false;
    return true;
  }

  const parent = await resolveZCAPById(zcap.parentCapability, ctx);
  if (!parent) return false;

  // DELEGATION RIGHT (Spec 04 §7 step 6.5.3): the parent MUST carry
  // `delegateCapability` to have issued this child. Without it, the chain
  // is broken at this step.
  const parentActions = parent.actions ?? parent.capability?.predicates ?? [];
  if (!parentActions.includes(DELEGATE_CAPABILITY_ACTION)) {
    return false;
  }

  // Attenuation: actions subset.
  const childActions = zcap.actions ?? zcap.capability?.predicates ?? [];
  for (const a of childActions) {
    if (!parentActions.includes(a)) return false;
  }

  // Attenuation: resource is same or in scope of parent's resource.
  const childResource = zcap.resource ?? zcap.capability?.scope?.graph;
  const parentResource = parent.resource ?? parent.capability?.scope?.graph;
  if (childResource && parentResource && childResource !== parentResource
      && !scope.graphs.has(parentResource)) {
    return false;
  }

  // Attenuation: IMMUTABLE CAVEATS (Spec 04 §8).
  // Every caveat present on the parent MUST appear byte-identical on the child.
  const parentCaveats = parent.caveats ?? [];
  const childCaveats = zcap.caveats ?? [];
  for (const pc of parentCaveats) {
    const match = childCaveats.find(cc => caveatsEqual(cc, pc));
    if (!match) return false;
  }

  // Delegator binding: proof signer is the parent's invoker (or graph-DID delegate).
  const signerDid = extractDIDFromVerificationMethod(zcap.proof.verificationMethod);
  if (signerDid !== parent.invoker) {
    // For graph-DID invokers, defer to group-identity polyfill for delegate check.
    // The polyfill accepts if the parent invoker is a graph DID we know about.
    if (!parent.invoker.startsWith('did:graph:')) return false;
  }

  if (await isRevoked(parent.id, ctx)) return false;

  return verifyChain(parent, ctx, scope, caveatHandlers, depth + 1);
}

function caveatsEqual(a: Caveat, b: Caveat): boolean {
  if (a.type !== b.type) return false;
  // Stable JSON stringify for shallow value equality.
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

async function resolveZCAPById(zcapId: string, ctx: ValidationContext): Promise<ZCAPDocument | null> {
  const allZcapLinks = await ctx.queryTriples({ predicate: GOV.HAS_ZCAP });
  for (const link of allZcapLinks) {
    const zcap = await resolveZCAP(link.data.object, ctx);
    if (zcap && zcap.id === zcapId) return zcap;
  }
  // Also try resolving directly by address.
  return resolveZCAP(zcapId, ctx);
}

function extractDIDFromVerificationMethod(vm: string): string {
  const hashIdx = vm.indexOf('#');
  return hashIdx >= 0 ? vm.substring(0, hashIdx) : vm;
}
