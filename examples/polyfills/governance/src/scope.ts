/**
 * Scope resolution — ancestry traversal and constraint collection (§5)
 */

import { GOV } from './predicates.js';
import type { GraphConstraint, ConstraintKind, ValidationContext, TripleRecord } from './types.js';

const MAX_ANCESTRY_DEPTH = 100;
const VALID_KINDS = new Set<string>(['capability', 'temporal', 'content', 'credential']);

/**
 * Walk ancestry from an entity up to graph root via has_child in reverse.
 * Returns ordered list: [entity, parent, grandparent, ...].
 */
export async function resolveAncestry(
  entityAddress: string,
  ctx: ValidationContext,
): Promise<string[]> {
  const ancestry: string[] = [entityAddress];
  const visited = new Set<string>([entityAddress]);
  let current = entityAddress;

  for (let i = 0; i < MAX_ANCESTRY_DEPTH; i++) {
    // Find parent: who has current as a child?
    const parents = await ctx.queryTriples({ predicate: GOV.HAS_CHILD, target: current });
    if (parents.length === 0) break;
    const parent = parents[0].data.source;
    if (visited.has(parent)) break; // cycle
    visited.add(parent);
    ancestry.push(parent);
    current = parent;
  }

  return ancestry;
}

/**
 * Collect constraints from an ancestry chain.
 * Returns constraints tagged with depth (0 = most specific).
 */
export async function collectConstraints(
  ancestry: string[],
  ctx: ValidationContext,
): Promise<GraphConstraint[]> {
  const constraints: GraphConstraint[] = [];

  for (let depth = 0; depth < ancestry.length; depth++) {
    const entity = ancestry[depth];
    const bindings = await ctx.queryTriples({
      source: entity,
      predicate: GOV.HAS_CONSTRAINT,
    });

    for (const binding of bindings) {
      const constraintId = binding.data.target;
      const constraint = await resolveConstraint(constraintId, entity, depth, ctx);
      if (constraint) constraints.push(constraint);
    }
  }

  return constraints;
}

async function resolveConstraint(
  constraintId: string,
  boundEntity: string,
  depth: number,
  ctx: ValidationContext,
): Promise<GraphConstraint | null> {
  const triples = await ctx.queryTriples({ source: constraintId });
  const props: Record<string, string> = {};

  for (const t of triples) {
    if (t.data.predicate) {
      props[t.data.predicate] = t.data.target;
    }
  }

  // Validate required fields
  if (props[GOV.ENTRY_TYPE] !== GOV.CONSTRAINT) return null;
  const kind = props[GOV.CONSTRAINT_KIND];
  if (!VALID_KINDS.has(kind)) return null;

  const scope = props[GOV.CONSTRAINT_SCOPE] || boundEntity;

  return {
    id: constraintId,
    kind: kind as ConstraintKind,
    scope,
    depth,
    properties: props,
  };
}

/**
 * Apply precedence: same-kind most-specific wins.
 * Different kinds accumulate.
 */
export function applyPrecedence(constraints: GraphConstraint[]): GraphConstraint[] {
  const byKind = new Map<string, GraphConstraint[]>();

  for (const c of constraints) {
    const existing = byKind.get(c.kind) || [];
    existing.push(c);
    byKind.set(c.kind, existing);
  }

  const result: GraphConstraint[] = [];
  for (const [_kind, kindConstraints] of byKind) {
    // Find minimum depth (most specific)
    const minDepth = Math.min(...kindConstraints.map(c => c.depth));
    // Keep only constraints at the most-specific depth
    const mostSpecific = kindConstraints.filter(c => c.depth === minDepth);
    result.push(...mostSpecific);
  }

  return result;
}
