/**
 * Shape definition types.
 *
 * Constructor action types are URIs under the `shape://actions/` namespace.
 */

export interface PropertyDefinition {
  path: string;
  name: string;
  datatype?: string;
  minCount?: number;
  maxCount?: number;
  writable?: boolean;
  readOnly?: boolean;
  resolveProtocol?: string;
  getter?: string;
}

export type ConstructorActionType =
  | 'shape://actions/addLink'
  | 'shape://actions/setSingleTarget'
  | 'shape://actions/addCollectionTarget';

export const ACTION_KIND = {
  addLink: 'shape://actions/addLink',
  setSingleTarget: 'shape://actions/setSingleTarget',
  addCollectionTarget: 'shape://actions/addCollectionTarget',
} as const satisfies Record<string, ConstructorActionType>;

export interface ConstructorAction {
  action: ConstructorActionType;
  /** "this" — the new ShapeInstance address. */
  subject: string;
  predicate: string;
  /** Either a property name (from initialValues) or a literal/URI. */
  object: string;
}

export interface ShapeDefinition {
  targetClass: string;
  properties: PropertyDefinition[];
  constructor: ConstructorAction[];
  /** Optional parent shape (by name) to extend. */
  extends?: string;
}

export interface ShapeInfo {
  name: string;
  targetClass: string;
  definitionAddress: string;
  /** did:graph of the graph where this shape is registered. */
  sourceContextDid: string;
  properties: PropertyInfo[];
}

export interface PropertyInfo {
  name: string;
  path: string;
  datatype?: string;
  minCount: number;
  maxCount?: number;
  writable: boolean;
  readOnly: boolean;
}

export interface RegisteredShape {
  name: string;
  definition: ShapeDefinition;
  address: string;
  contextDid: string;
}

/** Canonical predicates. */
export const SHAPE_PREDICATE = 'shape://has_shape';
export const SHAPE_TYPE = 'shape://Shape';
export const SHAPE_NAME_PREDICATE = 'shape://name';
export const SHAPE_TARGET_CLASS_PREDICATE = 'shape://targetClass';
export const SHAPE_DEFINITION_PREDICATE = 'shape://definition';

/** Get the bare action name from a `shape://actions/X` URI. */
export function actionKind(action: ConstructorActionType): 'addLink' | 'setSingleTarget' | 'addCollectionTarget' {
  if (!action.startsWith('shape://actions/')) {
    throw new TypeError(`Constructor action must be a shape://actions/ URI, got: ${action}`);
  }
  const kind = action.slice('shape://actions/'.length);
  if (kind !== 'addLink' && kind !== 'setSingleTarget' && kind !== 'addCollectionTarget') {
    throw new TypeError(`Unknown action kind: ${kind}`);
  }
  return kind;
}
