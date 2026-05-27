/**
 * Credential constraint handler — requires authors to hold a Verifiable Credential.
 */

import type {
  ConstraintHandler,
  GraphConstraint,
  GovernanceValidationResult,
  TripleInput,
  ValidationContext,
} from '@living-web/capability-framework';
import type { VerifiableCredential } from './types.js';
import { VOCAB } from './predicates.js';

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

async function resolveCredential(
  address: string,
  ctx: ValidationContext,
): Promise<VerifiableCredential | null> {
  if (!ctx.resolveExpression) return null;
  try {
    const doc = await ctx.resolveExpression(address);
    if (doc && typeof doc === 'object' && 'type' in (doc as Record<string, unknown>)) {
      return doc as VerifiableCredential;
    }
  } catch { /* fall through */ }
  return null;
}

export const credentialConstraintHandler: ConstraintHandler = {
  kind: 'credential',

  async validate(
    triple: TripleInput,
    constraint: GraphConstraint,
    ctx: ValidationContext,
  ): Promise<GovernanceValidationResult> {
    const requiredType = constraint.properties[VOCAB.REQUIRES_CREDENTIAL_TYPE];
    if (!requiredType) return { allowed: true };

    const issuerPattern = constraint.properties[VOCAB.CREDENTIAL_ISSUER_PATTERN];
    const minAgeHours = parseInt(constraint.properties[VOCAB.CREDENTIAL_MIN_AGE_HOURS] || '0', 10);

    const credLinks = await ctx.queryTriples({
      subject: triple.author,
      predicate: VOCAB.HAS_CREDENTIAL,
    });

    const now = ctx.now ? ctx.now() : Date.now();
    let found = false;
    for (const link of credLinks) {
      const vc = await resolveCredential(link.data.object, ctx);
      if (!vc) continue;
      if (!vc.type.includes(requiredType)) continue;
      if (issuerPattern && !globMatch(issuerPattern, vc.issuer)) continue;
      if (minAgeHours > 0) {
        const issuedAt = new Date(vc.issuanceDate).getTime();
        const ageHours = (now - issuedAt) / (1000 * 60 * 60);
        if (ageHours < minAgeHours) continue;
      }
      if (vc.credentialSubject.id !== triple.author) continue;
      if (vc.expirationDate && new Date(vc.expirationDate).getTime() < now) continue;
      if (!vc.proof?.proofValue) continue;
      found = true;
      break;
    }

    if (!found) {
      return {
        allowed: false,
        constraintKind: 'credential',
        reason: `Missing required credential of type ${requiredType}`,
        rejectedBy: constraint.id,
      };
    }
    return { allowed: true };
  },
};
