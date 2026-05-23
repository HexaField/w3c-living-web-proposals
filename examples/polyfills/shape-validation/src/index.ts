export { installShapeExtension } from './extension.js';
export type {
  ShapeDefinition,
  PropertyDefinition,
  ConstructorAction,
  ConstructorActionType,
  RegisteredShape,
  ShapeInfo,
  PropertyInfo,
} from './types.js';
export {
  ACTION_KIND,
  SHAPE_PREDICATE,
  SHAPE_TYPE,
  SHAPE_NAME_PREDICATE,
  SHAPE_TARGET_CLASS_PREDICATE,
  SHAPE_DEFINITION_PREDICATE,
  actionKind,
} from './types.js';
export { validateShapeDefinition } from './validator.js';
export { validateDatatype } from './xsd.js';
export { contentAddress } from './storage.js';
