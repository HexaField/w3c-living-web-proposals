/**
 * Standard caveat-type handlers (Spec 08 §7).
 *
 * Register on an engine via `engine.registerCaveatType(handler)`, or pass
 * them as `caveatTypes` to `createGovernanceLayer`. The framework-core
 * `expiry` handler is registered automatically by the engine; everything
 * here is opt-in.
 *
 * Counter-style handlers (`rateLimit`, `cardinality`) hold their own
 * in-memory state. Per Spec 04 §13.11 / Spec 08 §7.5–§7.6, this state is
 * local-only — convergent over-use is possible under concurrent writes
 * and MUST be coordinated at the sync layer for strict bounds.
 */

import type {
  CaveatHandler,
  GovernanceValidationResult,
  TripleInput,
  ValidationContext,
} from '@living-web/capability-framework';

// Per-(zcap caveat key) sliding-window timestamps.
const rateCounters = new Map<string, number[]>();
// Per-(zcap caveat key) lifetime counter.
const cardinalityCounters = new Map<string, number>();

function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return re.test(value);
}

/** `predicate` caveat (Spec 08 §7.2). Deny-wins within the caveat. */
export const predicateCaveatHandler: CaveatHandler = {
  type: 'predicate',
  appliesToNonTripleOps: false,
  evaluate(caveat, triple): GovernanceValidationResult {
    if (!triple) return { allowed: true };
    const { allowed, denied } = caveat.value as { allowed?: string[]; denied?: string[] };
    if (denied?.includes(triple.predicate)) {
      return { allowed: false, constraintKind: 'caveat', reason: `Predicate ${triple.predicate} denied` };
    }
    if (allowed && allowed.length > 0 && !allowed.includes(triple.predicate)) {
      return { allowed: false, constraintKind: 'caveat', reason: `Predicate ${triple.predicate} not allowed` };
    }
    return { allowed: true };
  },
};

/** `property` caveat (Spec 08 §7.3). Same shape as `predicate`. */
export const propertyCaveatHandler: CaveatHandler = {
  type: 'property',
  appliesToNonTripleOps: false,
  evaluate(caveat, triple): GovernanceValidationResult {
    if (!triple) return { allowed: true };
    const { allowed, denied } = caveat.value as { allowed?: string[]; denied?: string[] };
    if (denied?.includes(triple.predicate)) {
      return { allowed: false, constraintKind: 'caveat', reason: `Property ${triple.predicate} denied` };
    }
    if (allowed && allowed.length > 0 && !allowed.includes(triple.predicate)) {
      return { allowed: false, constraintKind: 'caveat', reason: `Property ${triple.predicate} not allowed` };
    }
    return { allowed: true };
  },
};

/** `subject` caveat (Spec 08 §7.4). Glob match against triple.subject. */
export const subjectCaveatHandler: CaveatHandler = {
  type: 'subject',
  appliesToNonTripleOps: false,
  evaluate(caveat, triple): GovernanceValidationResult {
    if (!triple) return { allowed: true };
    const { pattern } = caveat.value as { pattern: string };
    if (!globMatch(pattern, triple.subject)) {
      return { allowed: false, constraintKind: 'caveat', reason: `Subject does not match ${pattern}` };
    }
    return { allowed: true };
  },
};

/** `object` caveat (Spec 08 §7.4). Glob match against triple.object. */
export const objectCaveatHandler: CaveatHandler = {
  type: 'object',
  appliesToNonTripleOps: false,
  evaluate(caveat, triple): GovernanceValidationResult {
    if (!triple) return { allowed: true };
    const { pattern } = caveat.value as { pattern: string };
    if (!globMatch(pattern, triple.object)) {
      return { allowed: false, constraintKind: 'caveat', reason: `Object does not match ${pattern}` };
    }
    return { allowed: true };
  },
};

/** `rateLimit` caveat (Spec 08 §7.5). Sliding window, local-state only. */
export const rateLimitCaveatHandler: CaveatHandler = {
  type: 'rateLimit',
  appliesToNonTripleOps: true,
  evaluate(caveat, triple, action, ctx): GovernanceValidationResult {
    const { maxPerWindow, windowSeconds } = caveat.value as {
      maxPerWindow: number; windowSeconds: number;
    };
    const author = triple?.author ?? '__non_triple__';
    const key = `${author}@${triple?.predicate ?? action}`;
    const now = ctx.now ? ctx.now() : Date.now();
    const cutoff = now - windowSeconds * 1000;
    const arr = (rateCounters.get(key) ?? []).filter(ts => ts >= cutoff);
    if (arr.length >= maxPerWindow) {
      return {
        allowed: false,
        constraintKind: 'caveat',
        reason: `Rate limit: ${maxPerWindow} per ${windowSeconds}s exceeded`,
      };
    }
    arr.push(now);
    rateCounters.set(key, arr);
    return { allowed: true };
  },
};

/** `cardinality` caveat (Spec 08 §7.6). Lifetime cap, local-state only. */
export const cardinalityCaveatHandler: CaveatHandler = {
  type: 'cardinality',
  appliesToNonTripleOps: true,
  evaluate(caveat, triple, action): GovernanceValidationResult {
    const { max } = caveat.value as { max: number };
    const author = triple?.author ?? '__non_triple__';
    const key = `${author}@cardinality@${action}`;
    const current = cardinalityCounters.get(key) ?? 0;
    if (current >= max) {
      return { allowed: false, constraintKind: 'caveat', reason: `Cardinality cap ${max} exceeded` };
    }
    cardinalityCounters.set(key, current + 1);
    return { allowed: true };
  },
};

/** `authorOnly` caveat (Spec 08 §7.7). */
export const authorOnlyCaveatHandler: CaveatHandler = {
  type: 'authorOnly',
  appliesToNonTripleOps: true,
  async evaluate(_caveat, triple, _action, ctx): Promise<GovernanceValidationResult> {
    if (!triple) return { allowed: true };
    // Compare against the author of the subject's first introducing triple.
    const existing = await ctx.queryTriples({ subject: triple.subject });
    if (existing.length === 0) return { allowed: true };
    // Find the earliest triple.
    let earliest = existing[0];
    for (const t of existing) {
      if (new Date(t.timestamp).getTime() < new Date(earliest.timestamp).getTime()) {
        earliest = t;
      }
    }
    if (earliest.author !== triple.author) {
      return { allowed: false, constraintKind: 'caveat', reason: 'authorOnly: not the original author' };
    }
    return { allowed: true };
  },
};

/** `shape` caveat (Spec 08 §7.8). The framework treats this as a marker —
 *  shape conformance is checked by the shape-validation layer. Here we only
 *  verify the caveat references a non-empty shape IRI. */
export const shapeCaveatHandler: CaveatHandler = {
  type: 'shape',
  appliesToNonTripleOps: false,
  evaluate(caveat): GovernanceValidationResult {
    const { shapeIri } = caveat.value as { shapeIri?: string };
    if (!shapeIri) return { allowed: false, constraintKind: 'caveat', reason: 'Shape caveat missing shapeIri' };
    return { allowed: true };
  },
};

/** `content` caveat (Spec 08 §7.9). Polyfill is a no-op accept — a real
 *  implementation evaluates the SPARQL ASK against the in-memory model. */
export const contentCaveatHandler: CaveatHandler = {
  type: 'content',
  appliesToNonTripleOps: false,
  evaluate(caveat): GovernanceValidationResult {
    const { sparql } = caveat.value as { sparql?: string };
    if (!sparql) return { allowed: true };
    return { allowed: true };
  },
};

/** `credential` caveat (Spec 08 §7.10). Defers to credential-constraint
 *  semantics in §4 of the same spec. Polyfill checks the author's
 *  has_credential links match each required type. */
export const credentialCaveatHandler: CaveatHandler = {
  type: 'credential',
  appliesToNonTripleOps: true,
  async evaluate(caveat, triple, _action, ctx): Promise<GovernanceValidationResult> {
    const { requires } = caveat.value as {
      requires?: Array<{ type: string; issuerPattern?: string }>;
    };
    if (!requires || requires.length === 0) return { allowed: true };
    const author = triple?.author;
    if (!author) {
      return { allowed: false, constraintKind: 'caveat', reason: 'credential caveat requires an author' };
    }
    const credLinks = await ctx.queryTriples({
      subject: author,
      predicate: 'governance://has_credential',
    });
    for (const req of requires) {
      let found = false;
      for (const link of credLinks) {
        const vc = ctx.resolveExpression
          ? await ctx.resolveExpression(link.data.object).catch(() => null)
          : null;
        if (!vc || typeof vc !== 'object') continue;
        const types = (vc as { type?: string | string[] }).type;
        const typeList = Array.isArray(types) ? types : types ? [types] : [];
        if (!typeList.includes(req.type)) continue;
        if (req.issuerPattern) {
          const issuer = (vc as { issuer?: string }).issuer;
          if (!issuer || !globMatch(req.issuerPattern, issuer)) continue;
        }
        found = true;
        break;
      }
      if (!found) {
        return {
          allowed: false,
          constraintKind: 'caveat',
          reason: `credential caveat: missing required credential type ${req.type}`,
        };
      }
    }
    return { allowed: true };
  },
};

/** All standard caveat handlers — pass to `createGovernanceLayer({ caveatTypes: standardCaveatTypes })`. */
export const standardCaveatTypes: CaveatHandler[] = [
  predicateCaveatHandler,
  propertyCaveatHandler,
  subjectCaveatHandler,
  objectCaveatHandler,
  rateLimitCaveatHandler,
  cardinalityCaveatHandler,
  authorOnlyCaveatHandler,
  shapeCaveatHandler,
  contentCaveatHandler,
  credentialCaveatHandler,
];

/** Test helper: clear all per-handler counters (`rateLimit`, `cardinality`). */
export function resetStandardCaveatCounters(): void {
  rateCounters.clear();
  cardinalityCounters.clear();
}

// Suppress unused warnings (kept for symmetry / future use).
void ((): TripleInput | null => null);
