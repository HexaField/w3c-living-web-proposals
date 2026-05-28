/**
 * Per-graph constraint collection (Spec 04 §6).
 *
 * Each graph carries its own constraints and validates writes against its
 * own local state. Cross-graph composition is expressed at the application
 * layer via mutual DID-document delegation (Spec 04 Appendix A).
 *
 * `ScopeSet` is retained as a thin wrapper for API stability — it always
 * contains exactly the target graph at depth 0.
 */

import { GOV } from './predicates.js';
import type {
  GraphConstraint,
  ConstraintKind,
  ValidationContext,
} from './types.js';

const VALID_KINDS = new Set<ConstraintKind>(['capability', 'temporal', 'content', 'credential']);

export interface ScopeSet {
  /** Always `{ targetGraphDid → 0 }` — kept as a Map for API stability. */
  graphs: Map<string, number>;
  overflow: boolean;
}

/** Returns the trivial single-graph scope: just the target graph at depth 0. */
export async function resolveScopeSet(
  targetGraphDid: string,
  _ctx: ValidationContext,
): Promise<ScopeSet> {
  return { graphs: new Map([[targetGraphDid, 0]]), overflow: false };
}

/**
 * Collect every constraint bound to the target graph.
 */
export async function collectConstraints(
  scope: ScopeSet,
  ctx: ValidationContext,
): Promise<GraphConstraint[]> {
  const constraints: GraphConstraint[] = [];
  for (const graphDid of scope.graphs.keys()) {
    const bindings = await ctx.queryTriples({
      subject: graphDid,
      predicate: GOV.HAS_CONSTRAINT,
    });
    for (const binding of bindings) {
      const constraintId = binding.data.object;
      const constraint = await resolveConstraint(constraintId, graphDid, ctx);
      if (constraint) constraints.push(constraint);
    }
  }
  return constraints;
}

async function resolveConstraint(
  constraintId: string,
  scope: string,
  ctx: ValidationContext,
): Promise<GraphConstraint | null> {
  const triples = await ctx.queryTriples({ subject: constraintId });
  const props: Record<string, string> = {};
  for (const t of triples) props[t.data.predicate] = t.data.object;

  const kindRaw = props[GOV.CONSTRAINT_KIND]?.replace(/^"|"$/g, '');
  if (!kindRaw || !VALID_KINDS.has(kindRaw as ConstraintKind)) return null;
  if (props[GOV.ENTRY_TYPE] && props[GOV.ENTRY_TYPE] !== GOV.CONSTRAINT) return null;

  return {
    id: constraintId,
    kind: kindRaw as ConstraintKind,
    scope,
    properties: props,
  };
}

/**
 * Audit-attribution helper: of a set of *rejecting* constraints, return one
 * (ties broken by lexicographically greater constraint id). Per Spec 04 §6.3
 * this affects only the audit field `rejectedBy`, never the accept/reject
 * decision (which is pure deny-wins).
 */
export function pickAuditAttribution(rejecting: GraphConstraint[]): GraphConstraint | null {
  if (rejecting.length === 0) return null;
  return rejecting.reduce((best, c) => (c.id > best.id ? c : best));
}
