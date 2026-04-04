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
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.WORLD },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.WORLD_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.WORLD_OWNER, target: 'owner' },
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
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.PLAYER },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PLAYER_DID, target: 'did' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PLAYER_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PLAYER_COLOR, target: 'color' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PLAYER_SCORE, target: 'score' },
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
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.GAME_OBJECT },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_TYPE, target: 'objectType' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_X, target: 'x' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_Y, target: 'y' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_Z, target: 'z' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_W, target: 'width' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_H, target: 'height' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_D, target: 'depth' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.OBJ_COLOR, target: 'color' },
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
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.COLLECTIBLE },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLL_TYPE, target: 'collectibleType' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLL_X, target: 'x' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLL_Y, target: 'y' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLL_Z, target: 'z' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLL_VALUE, target: 'value' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COLL_COLOR, target: 'color' },
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
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.CHAT_MSG },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CHAT_BODY, target: 'body' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CHAT_AUTHOR, target: 'author' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CHAT_AUTHOR_NAME, target: 'authorName' },
  ],
};
