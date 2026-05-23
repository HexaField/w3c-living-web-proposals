/**
 * Shape definitions for multiplayer game
 */
import type { ShapeDefinition } from '@living-web/shape-validation';

const GAME = 'game://';
const GRAPH = 'graph://';

export const PREDICATES = {
  ENTRY_TYPE: `${GAME}entry_type`,
  WORLD: `${GAME}world`,
  PLAYER: `${GAME}player`,
  GAME_OBJECT: `${GAME}game_object`,
  COLLECTIBLE: `${GAME}collectible`,
  CHAT_MSG: `${GAME}chat_message`,

  WORLD_NAME: `${GAME}world_name`,
  WORLD_OWNER: `${GAME}world_owner`,
  WORLD_SPAWN_X: `${GAME}world_spawn_x`,
  WORLD_SPAWN_Y: `${GAME}world_spawn_y`,
  WORLD_SPAWN_Z: `${GAME}world_spawn_z`,

  PLAYER_DID: `${GAME}player_did`,
  PLAYER_NAME: `${GAME}player_name`,
  PLAYER_COLOR: `${GAME}player_color`,
  PLAYER_X: `${GAME}player_x`,
  PLAYER_Y: `${GAME}player_y`,
  PLAYER_Z: `${GAME}player_z`,
  PLAYER_ROT: `${GAME}player_rotation`,
  PLAYER_SCORE: `${GAME}player_score`,

  OBJ_TYPE: `${GAME}object_type`,
  OBJ_X: `${GAME}object_x`,
  OBJ_Y: `${GAME}object_y`,
  OBJ_Z: `${GAME}object_z`,
  OBJ_W: `${GAME}object_width`,
  OBJ_H: `${GAME}object_height`,
  OBJ_D: `${GAME}object_depth`,
  OBJ_COLOR: `${GAME}object_color`,

  COLL_TYPE: `${GAME}collectible_type`,
  COLL_X: `${GAME}collectible_x`,
  COLL_Y: `${GAME}collectible_y`,
  COLL_Z: `${GAME}collectible_z`,
  COLL_VALUE: `${GAME}collectible_value`,
  COLL_COLOR: `${GAME}collectible_color`,
  COLL_BY: `${GAME}collected_by`,

  CHAT_BODY: `${GAME}chat_body`,
  CHAT_AUTHOR: `${GAME}chat_author`,
  CHAT_AUTHOR_NAME: `${GAME}chat_author_name`,

  HAS_CHILD: `${GRAPH}has_child`,
  HAS_PLAYER: `${GAME}has_player`,
  HAS_OBJECT: `${GAME}has_object`,
  HAS_COLLECTIBLE: `${GAME}has_collectible`,
  HAS_CHAT: `${GAME}has_chat`,
} as const;

export const WorldShape: ShapeDefinition = {
  targetClass: PREDICATES.WORLD,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.WORLD_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.WORLD_OWNER, name: 'owner', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.WORLD },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.WORLD_NAME, object: 'name' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.WORLD_OWNER, object: 'owner' },
  ],
};

export const PlayerShape: ShapeDefinition = {
  targetClass: PREDICATES.PLAYER,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.PLAYER_DID, name: 'did', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PLAYER_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PLAYER_COLOR, name: 'color', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PLAYER_SCORE, name: 'score', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.PLAYER },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.PLAYER_DID, object: 'did' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.PLAYER_NAME, object: 'name' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.PLAYER_COLOR, object: 'color' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.PLAYER_SCORE, object: 'score' },
  ],
};

export const GameObjectShape: ShapeDefinition = {
  targetClass: PREDICATES.GAME_OBJECT,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.OBJ_TYPE, name: 'objectType', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_X, name: 'x', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_Y, name: 'y', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_Z, name: 'z', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_W, name: 'width', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_H, name: 'height', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_D, name: 'depth', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.OBJ_COLOR, name: 'color', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.GAME_OBJECT },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_TYPE, object: 'objectType' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_X, object: 'x' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_Y, object: 'y' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_Z, object: 'z' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_W, object: 'width' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_H, object: 'height' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_D, object: 'depth' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.OBJ_COLOR, object: 'color' },
  ],
};

export const CollectibleShape: ShapeDefinition = {
  targetClass: PREDICATES.COLLECTIBLE,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.COLL_TYPE, name: 'collectibleType', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLL_X, name: 'x', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLL_Y, name: 'y', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLL_Z, name: 'z', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLL_VALUE, name: 'value', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLL_COLOR, name: 'color', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COLL_BY, name: 'collectedBy', datatype: 'xsd:string' },
  ],
  constructor: [
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.COLLECTIBLE },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.COLL_TYPE, object: 'collectibleType' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.COLL_X, object: 'x' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.COLL_Y, object: 'y' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.COLL_Z, object: 'z' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.COLL_VALUE, object: 'value' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.COLL_COLOR, object: 'color' },
  ],
};

export const ChatMessageShape: ShapeDefinition = {
  targetClass: PREDICATES.CHAT_MSG,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.CHAT_BODY, name: 'body', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.CHAT_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.CHAT_AUTHOR_NAME, name: 'authorName', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.CHAT_MSG },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.CHAT_BODY, object: 'body' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.CHAT_AUTHOR, object: 'author' },
    { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: PREDICATES.CHAT_AUTHOR_NAME, object: 'authorName' },
  ],
};
