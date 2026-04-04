/**
 * Shape definitions for community chat
 */

import type { ShapeDefinition } from '@living-web/shape-validation';

const CHAT = 'chat://';
const RDF = 'rdf://';
const GRAPH = 'graph://';

export const PREDICATES = {
  ENTRY_TYPE: `${CHAT}entry_type`,
  COMMUNITY: `${CHAT}community`,
  CHANNEL: `${CHAT}channel`,
  MESSAGE: `${CHAT}message`,
  ROLE: `${CHAT}role`,
  MEMBER: `${CHAT}member`,
  REACTION: `${CHAT}reaction`,

  NAME: `${RDF}name`,
  BODY: `${CHAT}body`,
  TOPIC: `${CHAT}channel_topic`,
  ROLE_COLOR: `${CHAT}role_color`,
  ROLE_POSITION: `${CHAT}role_position`,
  MEMBER_DID: `${CHAT}member_did`,
  MEMBER_NAME: `${CHAT}member_name`,
  HAS_ROLE: `${CHAT}has_role`,
  REACTION_EMOJI: `${CHAT}reaction_emoji`,
  REACTION_AUTHOR: `${CHAT}reaction_author`,

  HAS_CHILD: `${GRAPH}has_child`,
} as const;

export const CommunityShape: ShapeDefinition = {
  targetClass: PREDICATES.COMMUNITY,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.COMMUNITY },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.NAME, target: 'name' },
  ],
};

export const ChannelShape: ShapeDefinition = {
  targetClass: PREDICATES.CHANNEL,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.TOPIC, name: 'topic', datatype: 'xsd:string' },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.CHANNEL },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.NAME, target: 'name' },
  ],
};

export const MessageShape: ShapeDefinition = {
  targetClass: PREDICATES.MESSAGE,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.BODY, name: 'body', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.MESSAGE },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BODY, target: 'body' },
  ],
};

export const RoleShape: ShapeDefinition = {
  targetClass: PREDICATES.ROLE,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.ROLE_COLOR, name: 'color', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.ROLE_POSITION, name: 'position', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.ROLE },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ROLE_COLOR, target: 'color' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ROLE_POSITION, target: 'position' },
  ],
};

export const MemberShape: ShapeDefinition = {
  targetClass: PREDICATES.MEMBER,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.MEMBER_DID, name: 'did', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.MEMBER_NAME, name: 'displayName', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.MEMBER },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.MEMBER_DID, target: 'did' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.MEMBER_NAME, target: 'displayName' },
  ],
};
