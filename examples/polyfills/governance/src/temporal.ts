/**
 * Temporal verification module (§7)
 */

import { GOV } from './predicates.js';
import type { GraphConstraint, ValidationResult, TripleInput, ValidationContext } from './types.js';

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

export async function verifyTemporal(
  triple: TripleInput,
  constraints: GraphConstraint[],
  ancestry: string[],
  ctx: ValidationContext,
): Promise<ValidationResult> {
  const temporalConstraints = constraints.filter(c => c.kind === 'temporal');
  if (temporalConstraints.length === 0) return { allowed: true };

  // Root authority bypass
  if (triple.author === ctx.rootAuthority) return { allowed: true };

  const tripleTimestamp = new Date(triple.timestamp).getTime();

  for (const tc of temporalConstraints) {
    const minIntervalStr = tc.properties[GOV.TEMPORAL_MIN_INTERVAL_SECONDS];
    const maxCountStr = tc.properties[GOV.TEMPORAL_MAX_COUNT_PER_WINDOW];
    const windowStr = tc.properties[GOV.TEMPORAL_WINDOW_SECONDS];
    const appliesTo = parseCommaSeparated(tc.properties[GOV.TEMPORAL_APPLIES_TO_PREDICATES]);

    // No-op if neither interval nor window count
    if (!minIntervalStr && !maxCountStr) continue;

    // Predicate match
    if (appliesTo.length > 0 && triple.predicate && !appliesTo.includes(triple.predicate)) continue;
    if (appliesTo.length > 0 && !triple.predicate) continue;

    // Query recent triples by same author in scope
    const recentTriples = await getRecentTriples(triple.author, ancestry, appliesTo, ctx);

    // Interval check
    if (minIntervalStr) {
      const minInterval = parseInt(minIntervalStr, 10);
      if (!isNaN(minInterval) && minInterval > 0) {
        const lastTriple = findMostRecent(recentTriples);
        if (lastTriple) {
          const lastTime = new Date(lastTriple.timestamp).getTime();
          const elapsed = (tripleTimestamp - lastTime) / 1000;
          if (elapsed < minInterval) {
            const remaining = Math.ceil(minInterval - elapsed);
            return {
              allowed: false,
              module: 'temporal',
              reason: `Rate limit: wait ${remaining}s`,
              rejectedBy: tc.id,
            };
          }
        }
      }
    }

    // Window count check
    if (maxCountStr) {
      const maxCount = parseInt(maxCountStr, 10);
      const windowSeconds = parseInt(windowStr || '60', 10);
      if (!isNaN(maxCount) && maxCount > 0) {
        const windowStart = tripleTimestamp - windowSeconds * 1000;
        const countInWindow = recentTriples.filter(t => {
          const ts = new Date(t.timestamp).getTime();
          return ts >= windowStart && ts <= tripleTimestamp;
        }).length;

        if (countInWindow >= maxCount) {
          return {
            allowed: false,
            module: 'temporal',
            reason: `Rate limit: ${maxCount} per ${windowSeconds}s exceeded`,
            rejectedBy: tc.id,
          };
        }
      }
    }
  }

  return { allowed: true };
}

interface RecentTriple {
  predicate: string | null;
  timestamp: string;
}

async function getRecentTriples(
  author: string,
  ancestry: string[],
  appliesTo: string[],
  ctx: ValidationContext,
): Promise<RecentTriple[]> {
  const results: RecentTriple[] = [];
  
  // Query all triples by this author
  const authorTriples = await ctx.queryTriples({ source: null, predicate: null, target: null });
  
  for (const t of authorTriples) {
    if (t.author !== author) continue;
    // Check if triple's source is in the scope (ancestry)
    if (!ancestry.includes(t.data.source)) continue;
    // Check predicate filter
    if (appliesTo.length > 0 && t.data.predicate && !appliesTo.includes(t.data.predicate)) continue;
    if (appliesTo.length > 0 && !t.data.predicate) continue;
    results.push({ predicate: t.data.predicate, timestamp: t.timestamp });
  }

  return results;
}

function findMostRecent(triples: RecentTriple[]): RecentTriple | null {
  if (triples.length === 0) return null;
  return triples.reduce((latest, t) => {
    return new Date(t.timestamp).getTime() > new Date(latest.timestamp).getTime() ? t : latest;
  });
}
