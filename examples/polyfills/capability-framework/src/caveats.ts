/**
 * Caveat dispatch (Spec 04 §9).
 *
 * The framework defines exactly one core caveat type: `expiry`. All other
 * caveat types are plug-ins registered via `engine.registerCaveatType(handler)`
 * — see `@living-web/constraint-vocabulary` for the standard vocabulary.
 *
 * Counter-style caveats that need cross-invocation state (rateLimit,
 * cardinality, etc.) live in the plug-in package; the framework holds no
 * counters itself.
 */

import type {
  Caveat,
  CaveatHandler,
  TripleInput,
  GovernanceValidationResult,
  ValidationContext,
} from './types.js';

/** Framework-core `expiry` handler — always registered by default. */
export const expiryCaveatHandler: CaveatHandler = {
  type: 'expiry',
  appliesToNonTripleOps: true,
  evaluate(caveat, _triple, _action, ctx) {
    const { expiresAt } = caveat.value as { expiresAt?: string };
    if (!expiresAt) return { allowed: true };
    const now = ctx.now ? ctx.now() : Date.now();
    if (new Date(expiresAt).getTime() < now) {
      return { allowed: false, constraintKind: 'caveat', reason: 'Capability expired' };
    }
    return { allowed: true };
  },
};

/**
 * Evaluate caveats against an operation. The handler registry MUST contain
 * at least `expiry`; missing handlers for any other caveat type cause
 * rejection (fail-closed, Spec 04 §13.9). Non-triple ops skip handlers
 * whose `appliesToNonTripleOps = false`.
 */
export async function evaluateCaveats(
  caveats: Caveat[],
  triple: TripleInput | null,
  action: string,
  ctx: ValidationContext,
  handlers: Map<string, CaveatHandler>,
): Promise<GovernanceValidationResult> {
  for (const c of caveats) {
    const h = handlers.get(c.type);
    if (!h) {
      return {
        allowed: false,
        constraintKind: 'caveat',
        reason: `Unknown caveat type '${c.type}' has no registered handler`,
      };
    }
    if (triple === null && !h.appliesToNonTripleOps) continue;
    const r = await h.evaluate(c, triple, action, ctx);
    if (!r.allowed) return r;
  }
  return { allowed: true };
}

/** Test helper retained for backward-compatible test API surface; no-op now. */
export function resetCaveatCounters(): void {
  // No counters in the framework core. Plug-ins manage their own state and
  // expose their own reset helpers (e.g. constraint-vocabulary).
}
