/**
 * Credential verification module (§4.4)
 */

import { GOV } from './predicates.js';
import type { GraphConstraint, ValidationResult, TripleInput, ValidationContext, VerifiableCredential } from './types.js';

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

export async function verifyCredential(
  triple: TripleInput,
  constraints: GraphConstraint[],
  ctx: ValidationContext,
): Promise<ValidationResult> {
  const credConstraints = constraints.filter(c => c.kind === 'credential');
  if (credConstraints.length === 0) return { allowed: true };

  // Root authority bypass
  if (triple.author === ctx.rootAuthority) return { allowed: true };

  for (const cc of credConstraints) {
    const requiredType = cc.properties[GOV.REQUIRES_CREDENTIAL_TYPE];
    if (!requiredType) continue; // malformed — skip

    const issuerPattern = cc.properties[GOV.CREDENTIAL_ISSUER_PATTERN];
    const minAgeHours = parseInt(cc.properties[GOV.CREDENTIAL_MIN_AGE_HOURS] || '0', 10);

    // Find author's credentials
    const credLinks = await ctx.queryTriples({
      source: triple.author,
      predicate: GOV.HAS_CREDENTIAL,
    });

    let found = false;
    for (const link of credLinks) {
      const vc = await resolveCredential(link.data.target, ctx);
      if (!vc) continue;

      // Check type
      if (!vc.type.includes(requiredType)) continue;

      // Check issuer pattern
      if (issuerPattern && !globMatch(issuerPattern, vc.issuer)) continue;

      // Check min age
      const now = ctx.now ? ctx.now() : Date.now();
      if (minAgeHours > 0) {
        const issuedAt = new Date(vc.issuanceDate).getTime();
        const ageHours = (now - issuedAt) / (1000 * 60 * 60);
        if (ageHours < minAgeHours) continue;
      }

      // Check subject matches author
      if (vc.credentialSubject.id !== triple.author) continue;

      // Check expiration
      if (vc.expirationDate) {
        const expiresAt = new Date(vc.expirationDate).getTime();
        const now2 = ctx.now ? ctx.now() : Date.now();
        if (now2 > expiresAt) continue;
      }

      // Check proof exists (simplified — real impl would verify signature)
      if (!vc.proof?.proofValue) continue;

      found = true;
      break;
    }

    if (!found) {
      return {
        allowed: false,
        module: 'credential',
        reason: `Missing required credential of type ${requiredType}`,
        rejectedBy: cc.id,
      };
    }
  }

  return { allowed: true };
}

async function resolveCredential(address: string, ctx: ValidationContext): Promise<VerifiableCredential | null> {
  if (ctx.resolveExpression) {
    try {
      const doc = await ctx.resolveExpression(address);
      if (doc && typeof doc === 'object' && 'type' in (doc as any)) {
        return doc as VerifiableCredential;
      }
    } catch { /* fall through */ }
  }
  return null;
}
