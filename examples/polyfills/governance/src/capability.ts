/**
 * ZCAP verification module (§6)
 */

import { GOV } from './predicates.js';
import type { GraphConstraint, ValidationResult, TripleInput, ValidationContext, ZCAPDocument } from './types.js';

const MAX_CHAIN_DEPTH = 10;

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

export async function verifyCapability(
  triple: TripleInput,
  constraints: GraphConstraint[],
  ancestry: string[],
  ctx: ValidationContext,
): Promise<ValidationResult> {
  // Step 1: no predicate → accept
  if (!triple.predicate) return { allowed: true };

  // Step 2: collect capability constraints with enforcement=required
  const capConstraints = constraints.filter(
    c => c.kind === 'capability' && c.properties[GOV.CAPABILITY_ENFORCEMENT] === 'required'
  );
  if (capConstraints.length === 0) return { allowed: true };

  // Step 3: check if predicate is covered by any capability constraint
  let predicateCovered = false;
  for (const cc of capConstraints) {
    const preds = parseCommaSeparated(cc.properties[GOV.CAPABILITY_PREDICATES]);
    if (preds.length === 0 || preds.includes(triple.predicate)) {
      predicateCovered = true;
      break;
    }
  }
  if (!predicateCovered) return { allowed: true };

  // Step 4: root authority bypass
  if (triple.author === ctx.rootAuthority) return { allowed: true };

  // Step 5: find author's ZCAPs
  const zcapLinks = await ctx.queryTriples({
    source: triple.author,
    predicate: GOV.HAS_ZCAP,
  });

  // Step 6: evaluate each ZCAP
  for (const link of zcapLinks) {
    const zcap = await resolveZCAP(link.data.target, ctx);
    if (!zcap) continue;

    // 6.1: predicate match
    if (!zcap.capability.predicates.includes(triple.predicate!)) continue;

    // 6.2: scope match
    if (zcap.capability.scope.within !== null) {
      if (!ancestry.includes(zcap.capability.scope.within)) continue;
    }

    // 6.3: expiry
    const now = ctx.now ? ctx.now() : Date.now();
    if (zcap.expires) {
      const expiryTime = new Date(zcap.expires).getTime();
      if (now > expiryTime) continue;
    }

    // 6.4: revocation
    if (await isRevoked(zcap.id, ctx)) continue;

    // 6.5: chain verification
    if (await verifyChain(zcap, ctx, ancestry)) {
      return { allowed: true };
    }
  }

  // Step 7: no valid capability
  return {
    allowed: false,
    module: 'capability',
    reason: `No valid capability for predicate ${triple.predicate} in scope`,
    rejectedBy: capConstraints[0].id,
  };
}

async function resolveZCAP(address: string, ctx: ValidationContext): Promise<ZCAPDocument | null> {
  if (ctx.resolveExpression) {
    try {
      const doc = await ctx.resolveExpression(address);
      if (doc && typeof doc === 'object' && 'id' in (doc as any)) {
        return doc as ZCAPDocument;
      }
    } catch { /* fall through */ }
  }

  // Try reading from graph triples (ZCAP stored as JSON target)
  const triples = await ctx.queryTriples({ source: address });
  if (triples.length > 0) {
    // Look for a triple whose target is a JSON ZCAP
    for (const t of triples) {
      try {
        const parsed = JSON.parse(t.data.target);
        if (parsed.id) return parsed as ZCAPDocument;
      } catch { /* not JSON */ }
    }
  }

  return null;
}

async function isRevoked(zcapId: string, ctx: ValidationContext): Promise<boolean> {
  const revocations = await ctx.queryTriples({
    predicate: GOV.REVOKES_CAPABILITY,
    target: zcapId,
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

  // Verify proof exists
  if (!zcap.proof?.proofValue) return false;

  if (zcap.parentCapability === null) {
    // Root ZCAP — signer must be root authority
    const signerDid = extractDIDFromVerificationMethod(zcap.proof.verificationMethod);
    return signerDid === ctx.rootAuthority;
  }

  // Resolve parent
  const parent = await resolveZCAPById(zcap.parentCapability, ctx);
  if (!parent) return false;

  // Attenuation: predicates must be subset
  for (const pred of zcap.capability.predicates) {
    if (!parent.capability.predicates.includes(pred)) return false;
  }

  // Attenuation: scope must be equal or descendant
  if (zcap.capability.scope.within !== null && parent.capability.scope.within !== null) {
    // Child scope must be within parent scope — check if child scope is in ancestry from parent scope
    // For simplicity: child's within must equal or be a descendant of parent's within
    if (zcap.capability.scope.within !== parent.capability.scope.within) {
      // Check if child scope is a descendant of parent scope
      const childAncestry = await resolveAncestryForScope(zcap.capability.scope.within, ctx);
      if (!childAncestry.includes(parent.capability.scope.within)) return false;
    }
  }

  // Delegator check: proof signer must be parent's invoker
  const signerDid = extractDIDFromVerificationMethod(zcap.proof.verificationMethod);
  if (signerDid !== parent.invoker) return false;

  // Revocation check on parent
  if (await isRevoked(parent.id, ctx)) return false;

  // Recurse up the chain
  return verifyChain(parent, ctx, ancestry, depth + 1);
}

async function resolveZCAPById(zcapId: string, ctx: ValidationContext): Promise<ZCAPDocument | null> {
  // Search for ZCAPs by querying has_zcap triples and resolving each
  const allZcapLinks = await ctx.queryTriples({ predicate: GOV.HAS_ZCAP });
  for (const link of allZcapLinks) {
    const zcap = await resolveZCAP(link.data.target, ctx);
    if (zcap && zcap.id === zcapId) return zcap;
  }
  return null;
}

async function resolveAncestryForScope(entityAddress: string, ctx: ValidationContext): Promise<string[]> {
  const { resolveAncestry } = await import('./scope.js');
  return resolveAncestry(entityAddress, ctx);
}

function extractDIDFromVerificationMethod(vm: string): string {
  // "did:key:z6Mk...#key-1" → "did:key:z6Mk..."
  const hashIdx = vm.indexOf('#');
  return hashIdx >= 0 ? vm.substring(0, hashIdx) : vm;
}
