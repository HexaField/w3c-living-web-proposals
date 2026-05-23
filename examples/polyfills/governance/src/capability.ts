/**
 * ZCAP verification — actions+resource model (did:graph as resource), with full caveat support.
 */

import { GOV } from './predicates.js';
import { evaluateCaveats } from './caveats.js';
import type {
  GraphConstraint, ValidationResult, TripleInput,
  ValidationContext, ZCAPDocument, Caveat,
} from './types.js';

const MAX_CHAIN_DEPTH = 10;

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

/** Determine the action being attempted. Polyfill heuristic. */
function inferAction(_triple: TripleInput): string {
  return 'createLink';   // applications can override via context
}

export async function verifyCapability(
  triple: TripleInput,
  constraints: GraphConstraint[],
  ancestry: string[],
  ctx: ValidationContext,
): Promise<ValidationResult> {
  const action = inferAction(triple);
  const capConstraints = constraints.filter(
    c => c.kind === 'capability' && c.properties[GOV.CAPABILITY_ENFORCEMENT] === '"required"',
  );

  // If there are no capability constraints, accept (root capability check separately).
  if (capConstraints.length === 0) return { allowed: true };

  // Check if the action's predicate is covered.
  let predicateCovered = false;
  for (const cc of capConstraints) {
    const preds = parseCommaSeparated(cc.properties[GOV.CAPABILITY_PREDICATES]);
    if (preds.length === 0 || preds.includes(triple.predicate)) {
      predicateCovered = true;
      break;
    }
  }
  if (!predicateCovered) return { allowed: true };

  // Find the author's ZCAPs (their declared has_zcap links).
  const zcapLinks = await ctx.queryTriples({
    subject: triple.author,
    predicate: GOV.HAS_ZCAP,
  });

  for (const link of zcapLinks) {
    const zcap = await resolveZCAP(link.data.object, ctx);
    if (!zcap) continue;

    // Action match
    const actions = zcap.actions ?? zcap.capability?.predicates ?? [];
    if (!actions.includes(action)) continue;

    // Resource match
    const resource = zcap.resource ?? zcap.capability?.scope?.graph;
    if (resource && !ancestry.includes(resource)) continue;

    // Expiry — check caveats
    const caveats: Caveat[] = zcap.caveats ?? [];
    const expiry = caveats.find(c => c.type === 'expiry');
    if (expiry) {
      const expiresAt = (expiry.value as any).expiresAt;
      const now = ctx.now ? ctx.now() : Date.now();
      if (expiresAt && new Date(expiresAt).getTime() < now) continue;
    }

    // Revocation
    if (await isRevoked(zcap.id, ctx)) continue;

    // Evaluate caveats against the triple
    if (caveats.length > 0) {
      const caveatResult = await evaluateCaveats(caveats, triple, action, ctx);
      if (!caveatResult.allowed) continue;
    }

    // Chain verification
    if (await verifyChain(zcap, ctx, ancestry)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    module: 'capability',
    reason: `No valid capability for ${action} on ${ctx.graphDid}`,
    rejectedBy: capConstraints[0].id,
  };
}

async function resolveZCAP(address: string, ctx: ValidationContext): Promise<ZCAPDocument | null> {
  if (ctx.resolveExpression) {
    try {
      const doc = await ctx.resolveExpression(address);
      if (doc && typeof doc === 'object' && 'id' in (doc as any)) return doc as ZCAPDocument;
    } catch {}
  }
  // ZCAP stored as serialised triple object
  const triples = await ctx.queryTriples({ subject: address });
  for (const t of triples) {
    try {
      const parsed = JSON.parse(t.data.object);
      if (parsed.id) return parsed as ZCAPDocument;
    } catch {}
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
  ancestry: string[],
  depth = 0,
): Promise<boolean> {
  if (depth > MAX_CHAIN_DEPTH) return false;
  if (!zcap.proof?.proofValue) return false;

  if (zcap.parentCapability === null) {
    // Root ZCAP — must match the context's root capability.
    if (ctx.rootCapabilityId && zcap.id !== ctx.rootCapabilityId) return false;
    return true;
  }

  const parent = await resolveZCAPById(zcap.parentCapability, ctx);
  if (!parent) return false;

  // Attenuation
  const childActions = zcap.actions ?? zcap.capability?.predicates ?? [];
  const parentActions = parent.actions ?? parent.capability?.predicates ?? [];
  for (const a of childActions) {
    if (!parentActions.includes(a)) return false;
  }

  const childResource = zcap.resource ?? zcap.capability?.scope?.graph;
  const parentResource = parent.resource ?? parent.capability?.scope?.graph;
  if (childResource && parentResource && childResource !== parentResource
      && !ancestry.includes(parentResource)) {
    return false;
  }

  // Delegator binding: proof signer is the parent's invoker
  const signerDid = extractDIDFromVerificationMethod(zcap.proof.verificationMethod);
  if (signerDid !== parent.invoker) return false;

  if (await isRevoked(parent.id, ctx)) return false;

  return verifyChain(parent, ctx, ancestry, depth + 1);
}

async function resolveZCAPById(zcapId: string, ctx: ValidationContext): Promise<ZCAPDocument | null> {
  const allZcapLinks = await ctx.queryTriples({ predicate: GOV.HAS_ZCAP });
  for (const link of allZcapLinks) {
    const zcap = await resolveZCAP(link.data.object, ctx);
    if (zcap && zcap.id === zcapId) return zcap;
  }
  return null;
}

function extractDIDFromVerificationMethod(vm: string): string {
  const hashIdx = vm.indexOf('#');
  return hashIdx >= 0 ? vm.substring(0, hashIdx) : vm;
}
