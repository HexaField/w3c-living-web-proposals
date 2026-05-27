/**
 * Scope resolution across nested graphs.
 *
 * Walks `context://participates_in` links upward (from the writing graph
 * toward its parent graphs). Mutually-declared `context://accepts_participation`
 * is verified before honouring a participation claim.
 */

import { GOV, CONTEXT } from './predicates.js';
import type {
  GraphConstraint,
  ConstraintKind,
  ValidationContext,
} from './types.js';

const MAX_ANCESTRY_DEPTH = 100;
const VALID_KINDS = new Set<ConstraintKind>(['capability', 'temporal', 'content', 'credential']);

/**
 * Walk from the writing graph up through participates_in links.
 * Each parent must reciprocally declare accepts_participation for the claim
 * to be honoured.
 */
export async function resolveAncestry(
  contextDid: string,
  ctx: ValidationContext,
): Promise<string[]> {
  const ancestry: string[] = [contextDid];
  const visited = new Set<string>([contextDid]);
  let current = contextDid;

  for (let i = 0; i < MAX_ANCESTRY_DEPTH; i++) {
    const participations = await ctx.queryTriples({
      subject: current,
      predicate: CONTEXT.PARTICIPATES_IN,
    });
    if (participations.length === 0) break;
    const parent = participations[0].data.object;
    if (visited.has(parent)) break;
    // Verify mutual acceptance (best-effort: in this polyfill we only check that the
    // accepts_participation triple exists locally).
    const accepts = await ctx.queryTriples({
      subject: parent,
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
      object: current,
    });
    if (accepts.length === 0) {
      // Unilateral participation — skip
      break;
    }
    visited.add(parent);
    ancestry.push(parent);
    current = parent;
  }
  return ancestry;
}

export async function collectConstraints(
  ancestry: string[],
  ctx: ValidationContext,
): Promise<GraphConstraint[]> {
  const constraints: GraphConstraint[] = [];
  for (let depth = 0; depth < ancestry.length; depth++) {
    const contextDid = ancestry[depth];
    const bindings = await ctx.queryTriples({
      subject: contextDid,
      predicate: GOV.HAS_CONSTRAINT,
    });
    for (const binding of bindings) {
      const constraintId = binding.data.object;
      const constraint = await resolveConstraint(constraintId, contextDid, depth, ctx);
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

  const actualScope = props[GOV.CONSTRAINT_SCOPE] || scope;
  return {
    id: constraintId,
    kind: kindRaw as ConstraintKind,
    scope: actualScope,
    depth,
    properties: props,
  };
}

export function applyPrecedence(constraints: GraphConstraint[]): GraphConstraint[] {
  const byKind = new Map<string, GraphConstraint[]>();
  for (const c of constraints) {
    const existing = byKind.get(c.kind) ?? [];
    existing.push(c);
    byKind.set(c.kind, existing);
  }
  const result: GraphConstraint[] = [];
  for (const list of byKind.values()) {
    const minDepth = Math.min(...list.map(c => c.depth));
    result.push(...list.filter(c => c.depth === minDepth));
  }
  return result;
}
