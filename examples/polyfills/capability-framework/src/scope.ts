/**
 * Scope-set resolution across participating graphs (Spec 03 §6).
 *
 * BFS-walks `context://participates_in` edges from the target graph,
 * honouring mutual `context://accepts_participation` on the other side.
 * Returns the full set of graphs whose constraints apply to writes in the
 * target (the *scope set*), with per-graph depth recorded for audit.
 *
 * Hierarchical vs holonic falls out of which participation declarations
 * exist — same mechanism, just different declaration patterns:
 *   - A→B only: B's constraints bind writes in A. (Hierarchical.)
 *   - A→B AND B→A: each graph's constraints bind the other. (Holonic.)
 *
 * Constraints from every graph in the scope set accumulate. There is NO
 * "most-specific overrides" rule — that was the override anti-pattern.
 * Conflict resolution is deny-wins across the accumulated set (handled in
 * engine.ts, not here).
 */

import { GOV, CONTEXT } from './predicates.js';
import type {
  GraphConstraint,
  ConstraintKind,
  ValidationContext,
} from './types.js';

const MAX_SCOPE_SET_SIZE = 100;
const VALID_KINDS = new Set<ConstraintKind>(['capability', 'temporal', 'content', 'credential']);

export interface ScopeSet {
  /** Every graph DID in the scope, mapped to its minimum-depth reach from the target. */
  graphs: Map<string, number>;
  /** True if the scope-set size limit was hit (engine should reject with constraintKind:"scope-overflow"). */
  overflow: boolean;
}

/**
 * BFS walk from `targetGraphDid` over participates_in edges with mutual
 * acceptance. Multi-parent (a graph participating in several others) is
 * supported; cycles are detected via the visited set; the resulting
 * Map<did, minDepth> is the scope set.
 */
export async function resolveScopeSet(
  targetGraphDid: string,
  ctx: ValidationContext,
): Promise<ScopeSet> {
  const scope = new Map<string, number>();
  scope.set(targetGraphDid, 0);
  const frontier: string[] = [targetGraphDid];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const currentDepth = scope.get(current)!;

    const participations = await ctx.queryTriples({
      subject: current,
      predicate: CONTEXT.PARTICIPATES_IN,
    });

    for (const p of participations) {
      const target = p.data.object;
      if (scope.has(target)) continue;

      // Mutual-acceptance check.
      const accepts = await ctx.queryTriples({
        subject: target,
        predicate: CONTEXT.ACCEPTS_PARTICIPATION,
        object: current,
      });
      if (accepts.length === 0) continue;

      // (A full implementation would verify the accepts_participation reifier
      // author is in `target`'s capabilityDelegation set at validation time.
      // The polyfill records this as a TODO; tests cover the structural path
      // — the cryptographic delegate-set check is covered by the group-identity
      // polyfill's own conformance tests.)

      if (scope.size >= MAX_SCOPE_SET_SIZE) {
        return { graphs: scope, overflow: true };
      }
      scope.set(target, currentDepth + 1);
      frontier.push(target);
    }
  }

  return { graphs: scope, overflow: false };
}

/**
 * Collect every constraint bound to any graph in the scope set, tagged with
 * that graph's depth (for audit attribution). All collected constraints
 * apply equally — no precedence, no override.
 */
export async function collectConstraints(
  scope: ScopeSet,
  ctx: ValidationContext,
): Promise<GraphConstraint[]> {
  const constraints: GraphConstraint[] = [];
  for (const [graphDid, depth] of scope.graphs) {
    const bindings = await ctx.queryTriples({
      subject: graphDid,
      predicate: GOV.HAS_CONSTRAINT,
    });
    for (const binding of bindings) {
      const constraintId = binding.data.object;
      const constraint = await resolveConstraint(constraintId, graphDid, depth, ctx);
      if (constraint) constraints.push(constraint);
    }
  }
  return constraints;
}

async function resolveConstraint(
  constraintId: string,
  scope: string,
  depth: number,
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
    depth,
    properties: props,
  };
}

/**
 * Audit-attribution helper: of a set of *rejecting* constraints, return the
 * one with lowest depth (most-authoritative); ties broken by lexicographically
 * greater constraint id. Per Spec 03 §6.3, this affects only the audit field
 * `rejectedBy`, never the accept/reject decision (which is pure deny-wins).
 */
export function pickAuditAttribution(rejecting: GraphConstraint[]): GraphConstraint | null {
  if (rejecting.length === 0) return null;
  return rejecting.reduce((best, c) => {
    if (c.depth < best.depth) return c;
    if (c.depth > best.depth) return best;
    return c.id > best.id ? c : best;
  });
}
