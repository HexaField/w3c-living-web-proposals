/**
 * Shape definitions for collaborative canvas
 */
import type { ShapeDefinition } from '@living-web/shape-validation';

const CANVAS = 'canvas://';
const GRAPH = 'graph://';

export const PREDICATES = {
  ENTRY_TYPE: `${CANVAS}entry_type`,
  CANVAS: `${CANVAS}canvas`,
  LAYER: `${CANVAS}layer`,
  SHAPE: `${CANVAS}shape`,
  PATH: `${CANVAS}path`,
  COLLABORATOR: `${CANVAS}collaborator`,

  CANVAS_NAME: `${CANVAS}canvas_name`,
  CANVAS_OWNER: `${CANVAS}canvas_owner`,
  CANVAS_BG: `${CANVAS}canvas_bg_color`,

  LAYER_NAME: `${CANVAS}layer_name`,
  LAYER_ORDER: `${CANVAS}layer_order`,
  LAYER_VISIBLE: `${CANVAS}layer_visible`,
  LAYER_LOCKED: `${CANVAS}layer_locked`,

  SHAPE_TYPE: `${CANVAS}shape_type`,
  SHAPE_X: `${CANVAS}shape_x`,
  SHAPE_Y: `${CANVAS}shape_y`,
  SHAPE_W: `${CANVAS}shape_width`,
  SHAPE_H: `${CANVAS}shape_height`,
  SHAPE_RADIUS: `${CANVAS}shape_radius`,
  SHAPE_X2: `${CANVAS}shape_x2`,
  SHAPE_Y2: `${CANVAS}shape_y2`,
  SHAPE_FILL: `${CANVAS}shape_fill`,
  SHAPE_STROKE: `${CANVAS}shape_stroke`,
  SHAPE_STROKE_W: `${CANVAS}shape_stroke_width`,
  SHAPE_TEXT: `${CANVAS}shape_text`,
  SHAPE_FONT_SIZE: `${CANVAS}shape_font_size`,
  SHAPE_AUTHOR: `${CANVAS}shape_author`,

  PATH_DATA: `${CANVAS}path_data`,
  PATH_STROKE: `${CANVAS}path_stroke`,
  PATH_STROKE_W: `${CANVAS}path_stroke_width`,
  PATH_FILL: `${CANVAS}path_fill`,
  PATH_AUTHOR: `${CANVAS}path_author`,

  COLLAB_DID: `${CANVAS}collab_did`,
  COLLAB_NAME: `${CANVAS}collab_name`,
  COLLAB_ROLE: `${CANVAS}collab_role`,
  COLLAB_COLOR: `${CANVAS}collab_color`,

  HAS_CHILD: `${GRAPH}has_child`,
  HAS_LAYER: `${CANVAS}has_layer`,
  HAS_SHAPE: `${CANVAS}has_shape`,
} as const;

export const CanvasShape: ShapeDefinition = {
  targetClass: PREDICATES.CANVAS,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.CANVAS_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.CANVAS_OWNER, name: 'owner', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.CANVAS },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CANVAS_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CANVAS_OWNER, target: 'owner' },
  ],
};

export const LayerShape: ShapeDefinition = {
  targetClass: PREDICATES.LAYER,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.LAYER_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.LAYER_ORDER, name: 'order', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.LAYER_VISIBLE, name: 'visible', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.LAYER_LOCKED, name: 'locked', datatype: 'xsd:string' },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.LAYER },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.LAYER_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.LAYER_ORDER, target: 'order' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.LAYER_VISIBLE, target: 'visible' },
  ],
};

export const CanvasShapeShape: ShapeDefinition = {
  targetClass: PREDICATES.SHAPE,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.SHAPE_TYPE, name: 'shapeType', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.SHAPE_X, name: 'x', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.SHAPE_Y, name: 'y', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.SHAPE_W, name: 'width', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_H, name: 'height', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_RADIUS, name: 'radius', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_X2, name: 'x2', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_Y2, name: 'y2', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_FILL, name: 'fill', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_STROKE, name: 'stroke', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.SHAPE_STROKE_W, name: 'strokeWidth', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.SHAPE_TEXT, name: 'text', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_FONT_SIZE, name: 'fontSize', datatype: 'xsd:string' },
    { path: PREDICATES.SHAPE_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.SHAPE },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SHAPE_TYPE, target: 'shapeType' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SHAPE_X, target: 'x' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SHAPE_Y, target: 'y' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SHAPE_STROKE, target: 'stroke' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SHAPE_STROKE_W, target: 'strokeWidth' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SHAPE_AUTHOR, target: 'author' },
  ],
};

export const PathShape: ShapeDefinition = {
  targetClass: PREDICATES.PATH,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.PATH_DATA, name: 'data', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PATH_STROKE, name: 'stroke', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PATH_STROKE_W, name: 'strokeWidth', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PATH_FILL, name: 'fill', datatype: 'xsd:string' },
    { path: PREDICATES.PATH_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.PATH },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PATH_DATA, target: 'data' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PATH_STROKE, target: 'stroke' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PATH_STROKE_W, target: 'strokeWidth' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PATH_AUTHOR, target: 'author' },
  ],
};

export const CollaboratorShape: ShapeDefinition = {
  targetClass: PREDICATES.COLLABORATOR,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.COLLAB_DID, name: 'did', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLLAB_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLLAB_ROLE, name: 'role', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLLAB_COLOR, name: 'color', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.COLLABORATOR },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLLAB_DID, target: 'did' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLLAB_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLLAB_ROLE, target: 'role' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLLAB_COLOR, target: 'color' },
  ],
};
