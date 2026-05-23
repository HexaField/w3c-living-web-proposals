/**
 * Shape definition validation.
 */

import type { ShapeDefinition, ConstructorAction } from './types.js';

const VALID_ACTIONS = new Set<ConstructorAction['action']>([
  'shape://actions/addLink',
  'shape://actions/setSingleTarget',
  'shape://actions/addCollectionTarget',
]);

export function validateShapeDefinition(json: string): ShapeDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DOMException('Invalid JSON in shape definition', 'SyntaxError');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DOMException('Shape must be a JSON object', 'ConstraintError');
  }
  const shape = parsed as Partial<ShapeDefinition>;

  if (!shape.targetClass || typeof shape.targetClass !== 'string') {
    throw new DOMException('Shape MUST have a targetClass string', 'ConstraintError');
  }
  if (!Array.isArray(shape.properties)) {
    throw new DOMException('Shape MUST have a properties array', 'ConstraintError');
  }
  if (!Array.isArray(shape.constructor)) {
    throw new DOMException('Shape MUST have a constructor array', 'ConstraintError');
  }

  const namesSeen = new Set<string>();
  for (const prop of shape.properties) validatePropertyDef(prop, namesSeen);
  for (const action of shape.constructor) validateConstructorAction(action);

  return shape as ShapeDefinition;
}

function validatePropertyDef(prop: unknown, namesSeen: Set<string>): void {
  if (typeof prop !== 'object' || prop === null) {
    throw new DOMException('Property must be an object', 'ConstraintError');
  }
  const p = prop as Record<string, unknown>;
  if (!p.path || typeof p.path !== 'string') {
    throw new DOMException('Property MUST have a path string', 'ConstraintError');
  }
  if (!p.name || typeof p.name !== 'string') {
    throw new DOMException('Property MUST have a name string', 'ConstraintError');
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.name)) {
    throw new DOMException(`Property name "${p.name}" MUST match [a-zA-Z_][a-zA-Z0-9_]*`, 'ConstraintError');
  }
  if (namesSeen.has(p.name)) {
    throw new DOMException(`Duplicate property name "${p.name}"`, 'ConstraintError');
  }
  namesSeen.add(p.name);
}

function validateConstructorAction(action: unknown): void {
  if (typeof action !== 'object' || action === null) {
    throw new DOMException('Constructor action must be an object', 'ConstraintError');
  }
  const a = action as Record<string, unknown>;
  if (typeof a.action !== 'string' || !VALID_ACTIONS.has(a.action as ConstructorAction['action'])) {
    throw new DOMException(
      'Constructor action MUST be one of shape://actions/{addLink,setSingleTarget,addCollectionTarget}',
      'ConstraintError',
    );
  }
  if (a.subject !== 'this') {
    throw new DOMException('Constructor action subject MUST be "this"', 'ConstraintError');
  }
  if (typeof a.predicate !== 'string' || a.predicate.length === 0) {
    throw new DOMException('Constructor action MUST have a predicate string', 'ConstraintError');
  }
  if (a.object === undefined || a.object === null) {
    throw new DOMException('Constructor action MUST have a object', 'ConstraintError');
  }
}
