// Shape definition types — §4

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

export interface ConstructorAction {
  action: 'addLink' | 'setSingleTarget' | 'addCollectionTarget';
  source: string;
  predicate: string;
  target: string;
}

export interface ShapeDefinition {
  targetClass: string;
  properties: PropertyDefinition[];
  constructor: ConstructorAction[];
}

export interface ShapeInfo {
  name: string;
  targetClass: string;
  definitionAddress: string;
  properties: PropertyInfoPublic[];
}

export interface PropertyInfoPublic {
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
}

export const SHAPE_PREDICATE = 'shacl://has_shape';
export const SHAPE_NAME_PREDICATE = 'shacl://shape_name';
