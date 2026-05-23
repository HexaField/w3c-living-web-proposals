/**
 * Caveat vocabulary (Spec 03 §9).
 *
 * Each caveat narrows a ZCAP. Evaluated at write time against the operation.
 */

import type { Caveat, TripleInput, GovernanceValidationResult, ValidationContext } from './types.js';

// Per-(zcapId,window) rate counters
const rateCounters = new Map<string, number[]>();
const cardinalityCounters = new Map<string, number>();

export async function evaluateCaveats(
  caveats: Caveat[],
  triple: TripleInput,
  action: string,
  ctx: ValidationContext,
): Promise<GovernanceValidationResult> {
  const now = ctx.now ? ctx.now() : Date.now();

  for (const c of caveats) {
    const result = await evalCaveat(c, triple, action, now, ctx);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

async function evalCaveat(
  c: Caveat,
  triple: TripleInput,
  _action: string,
  now: number,
  ctx: ValidationContext,
): Promise<GovernanceValidationResult> {
  switch (c.type) {
    case 'expiry': {
      const { expiresAt } = c.value as { expiresAt: string };
      if (expiresAt && new Date(expiresAt).getTime() < now) {
        return { allowed: false, module: 'caveat', reason: 'Capability expired' };
      }
      return { allowed: true };
    }
    case 'predicate': {
      const { allowed, denied } = c.value as { allowed?: string[]; denied?: string[] };
      if (denied?.includes(triple.predicate)) {
        return { allowed: false, module: 'caveat', reason: `Predicate ${triple.predicate} denied` };
      }
      if (allowed && !allowed.includes(triple.predicate)) {
        return { allowed: false, module: 'caveat', reason: `Predicate ${triple.predicate} not allowed` };
      }
      return { allowed: true };
    }
    case 'property': {
      const { allowed, denied } = c.value as { allowed?: string[]; denied?: string[] };
      if (denied?.includes(triple.predicate)) {
        return { allowed: false, module: 'caveat', reason: `Property ${triple.predicate} denied` };
      }
      if (allowed && !allowed.includes(triple.predicate)) {
        return { allowed: false, module: 'caveat', reason: `Property ${triple.predicate} not allowed` };
      }
      return { allowed: true };
    }
    case 'shape': {
      // Shape conformance is checked by the shape-validation layer; here we only
      // verify the caveat references a known shape IRI.
      const { shapeIri } = c.value as { shapeIri: string };
      if (!shapeIri) return { allowed: false, module: 'caveat', reason: 'Shape caveat missing shapeIri' };
      return { allowed: true };
    }
    case 'rateLimit': {
      const { maxPerWindow, windowSeconds } = c.value as { maxPerWindow: number; windowSeconds: number };
      const key = `${triple.author}@${triple.predicate}`;
      const arr = rateCounters.get(key) ?? [];
      const cutoff = now - windowSeconds * 1000;
      const recent = arr.filter(ts => ts >= cutoff);
      if (recent.length >= maxPerWindow) {
        return {
          allowed: false,
          module: 'caveat',
          reason: `Rate limit: ${maxPerWindow} per ${windowSeconds}s exceeded`,
        };
      }
      recent.push(now);
      rateCounters.set(key, recent);
      return { allowed: true };
    }
    case 'cardinality': {
      const { max } = c.value as { max: number };
      const key = `${triple.author}@cardinality`;
      const current = cardinalityCounters.get(key) ?? 0;
      if (current >= max) {
        return { allowed: false, module: 'caveat', reason: `Cardinality cap ${max} exceeded` };
      }
      cardinalityCounters.set(key, current + 1);
      return { allowed: true };
    }
    case 'subject': {
      const { pattern } = c.value as { pattern: string };
      if (!globMatch(pattern, triple.subject)) {
        return { allowed: false, module: 'caveat', reason: `Source does not match ${pattern}` };
      }
      return { allowed: true };
    }
    case 'object': {
      const { pattern } = c.value as { pattern: string };
      if (!globMatch(pattern, triple.object)) {
        return { allowed: false, module: 'caveat', reason: `Target does not match ${pattern}` };
      }
      return { allowed: true };
    }
    case 'content': {
      const { sparql } = c.value as { sparql: string };
      if (!sparql) return { allowed: true };
      // The polyfill doesn't run arbitrary SPARQL against in-flight triples; we
      // accept conservatively (a real runtime would evaluate the ASK query).
      return { allowed: true };
    }
    case 'authorOnly': {
      // The author must be the original instance creator. Polyfill best-effort:
      // we look up an existing rdf://type triple's author and compare.
      const existing = await ctx.queryTriples({ subject: triple.subject, predicate: 'rdf://type' });
      if (existing.length > 0 && existing[0].author !== triple.author) {
        return { allowed: false, module: 'caveat', reason: 'authorOnly: not the original author' };
      }
      return { allowed: true };
    }
    case 'custom':
      // Custom caveats default to allow; applications register handlers separately.
      return { allowed: true };
  }
}

function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return re.test(value);
}

/** Test helper: reset accumulated counters. */
export function resetCaveatCounters(): void {
  rateCounters.clear();
  cardinalityCounters.clear();
}
