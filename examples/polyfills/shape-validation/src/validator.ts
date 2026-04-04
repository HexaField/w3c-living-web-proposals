// Shape definition validation — §4

import type { ShapeDefinition, PropertyDefinition, ConstructorAction } from './types.js';

export function validateShapeDefinition(json: string): ShapeDefinition {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DOMException('Invalid JSON in shape definition', 'SyntaxError');
  }

  if (!parsed.targetClass || typeof parsed.targetClass !== 'string') {
    throw new DOMException('Shape MUST have a targetClass string', 'ConstraintError');
  }

  if (!Array.isArray(parsed.properties)) {
    throw new DOMException('Shape MUST have a properties array', 'ConstraintError');
  }

  if (!Array.isArray(parsed.constructor)) {
    throw new DOMException('Shape MUST have a constructor array', 'ConstraintError');
  }

  const namesSeen = new Set<string>();
  for (const prop of parsed.properties) {
    validatePropertyDef(prop, namesSeen);
  }

  for (const action of parsed.constructor) {
    validateConstructorAction(action);
  }

  return parsed as ShapeDefinition;
}

function validatePropertyDef(prop: any, namesSeen: Set<string>): void {
  if (!prop.path || typeof prop.path !== 'string') {
    throw new DOMException('Property MUST have a path string', 'ConstraintError');
  }
  if (!prop.name || typeof prop.name !== 'string') {
    throw new DOMException('Property MUST have a name string', 'ConstraintError');
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prop.name)) {
    throw new DOMException(`Property name "${prop.name}" MUST match [a-zA-Z_][a-zA-Z0-9_]*`, 'ConstraintError');
  }
  if (namesSeen.has(prop.name)) {
    throw new DOMException(`Duplicate property name "${prop.name}"`, 'ConstraintError');
  }
  namesSeen.add(prop.name);
}

function validateConstructorAction(action: any): void {
  if (!action.action || !['addLink', 'setSingleTarget', 'addCollectionTarget'].includes(action.action)) {
    throw new DOMException('Constructor action MUST be addLink, setSingleTarget, or addCollectionTarget', 'ConstraintError');
  }
  if (action.source !== 'this') {
    throw new DOMException('Constructor action source MUST be "this"', 'ConstraintError');
  }
  if (!action.predicate || typeof action.predicate !== 'string') {
    throw new DOMException('Constructor action MUST have a predicate string', 'ConstraintError');
  }
  if (action.target === undefined || action.target === null) {
    throw new DOMException('Constructor action MUST have a target', 'ConstraintError');
  }
}
