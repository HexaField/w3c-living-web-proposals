/**
 * Temporal constraint handler — rate limits and minimum intervals.
 */

import type {
  ConstraintHandler,
  GraphConstraint,
  GovernanceValidationResult,
  TripleInput,
  ValidationContext,
} from '@living-web/capability-framework';
import { VOCAB } from './predicates.js';

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

interface RecentTriple {
  predicate: string | null;
  timestamp: string;
}

async function getRecentTriples(
  author: string,
  scope: string,
  appliesTo: string[],
  ctx: ValidationContext,
): Promise<RecentTriple[]> {
  const results: RecentTriple[] = [];
  const all = await ctx.queryTriples({ subject: null, predicate: null, object: null });
  for (const t of all) {
    if (t.author !== author) continue;
    if (t.data.subject !== scope) continue;
    if (appliesTo.length > 0 && t.data.predicate && !appliesTo.includes(t.data.predicate)) continue;
    if (appliesTo.length > 0 && !t.data.predicate) continue;
    results.push({ predicate: t.data.predicate, timestamp: t.timestamp });
  }
  return results;
}

function findMostRecent(triples: RecentTriple[]): RecentTriple | null {
  if (triples.length === 0) return null;
  return triples.reduce((latest, t) =>
    new Date(t.timestamp).getTime() > new Date(latest.timestamp).getTime() ? t : latest,
  );
}

export const temporalConstraintHandler: ConstraintHandler = {
  kind: 'temporal',

  async validate(
    triple: TripleInput,
    constraint: GraphConstraint,
    ctx: ValidationContext,
  ): Promise<GovernanceValidationResult> {
    const minIntervalStr = constraint.properties[VOCAB.TEMPORAL_MIN_INTERVAL_SECONDS];
    const maxCountStr = constraint.properties[VOCAB.TEMPORAL_MAX_COUNT_PER_WINDOW];
    const windowStr = constraint.properties[VOCAB.TEMPORAL_WINDOW_SECONDS];
    const appliesTo = parseCommaSeparated(constraint.properties[VOCAB.TEMPORAL_APPLIES_TO_PREDICATES]);

    if (!minIntervalStr && !maxCountStr) return { allowed: true };

    if (appliesTo.length > 0 && triple.predicate && !appliesTo.includes(triple.predicate)) {
      return { allowed: true };
    }
    if (appliesTo.length > 0 && !triple.predicate) return { allowed: true };

    const tripleTime = new Date(triple.timestamp).getTime();
    const recent = await getRecentTriples(triple.author, constraint.scope, appliesTo, ctx);

    if (minIntervalStr) {
      const minInterval = parseInt(minIntervalStr, 10);
      if (!isNaN(minInterval) && minInterval > 0) {
        const last = findMostRecent(recent);
        if (last) {
          const elapsed = (tripleTime - new Date(last.timestamp).getTime()) / 1000;
          if (elapsed < minInterval) {
            const remaining = Math.ceil(minInterval - elapsed);
            return {
              allowed: false,
              module: 'temporal',
              reason: `Rate limit: wait ${remaining}s`,
              rejectedBy: constraint.id,
            };
          }
        }
      }
    }

    if (maxCountStr) {
      const maxCount = parseInt(maxCountStr, 10);
      const windowSeconds = parseInt(windowStr || '60', 10);
      if (!isNaN(maxCount) && maxCount > 0) {
        const windowStart = tripleTime - windowSeconds * 1000;
        const countInWindow = recent.filter(t => {
          const ts = new Date(t.timestamp).getTime();
          return ts >= windowStart && ts <= tripleTime;
        }).length;
        if (countInWindow >= maxCount) {
          return {
            allowed: false,
            module: 'temporal',
            reason: `Rate limit: ${maxCount} per ${windowSeconds}s exceeded`,
            rejectedBy: constraint.id,
          };
        }
      }
    }

    return { allowed: true };
  },
};
