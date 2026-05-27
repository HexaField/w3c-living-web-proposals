/**
 * Shape definitions for community chat.
 *
 * Action types use the `shape://actions/` namespace.
 * `context://participates_in` is used for cross-graph nesting (e.g., a
 * channel graph that participates in the community). In-graph parent/child
 * relations within the community graph use the topical `chat://has_child`
 * predicate.
 */

import type { ShapeDefinition } from '@living-web/shape-validation';

const CHAT = 'chat://';
const RDF = 'rdf://';
const CTX = 'context://';

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

  /** Topical parent/child for in-graph entities (e.g., channel → message). */
  HAS_CHILD: `${CHAT}has_child`,
  /** Cross-graph nesting (e.g., a channel graph participates in the community). */
  PARTICIPATES_IN: `${CTX}participates_in`,
} as const;

const ACT = 'shape://actions/';

export const CommunityShape: ShapeDefinition = {
  targetClass: PREDICATES.COMMUNITY,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.COMMUNITY },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.NAME, object: 'name' },
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
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.CHANNEL },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.NAME, object: 'name' },
  ],
};

export const MessageShape: ShapeDefinition = {
  targetClass: PREDICATES.MESSAGE,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.BODY, name: 'body', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.MESSAGE },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.BODY, object: 'body' },
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
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.ROLE },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.NAME, object: 'name' },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ROLE_COLOR, object: 'color' },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ROLE_POSITION, object: 'position' },
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
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.ENTRY_TYPE, object: PREDICATES.MEMBER },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.MEMBER_DID, object: 'did' },
    { action: `${ACT}setSingleTarget`, subject: 'this', predicate: PREDICATES.MEMBER_NAME, object: 'displayName' },
  ],
};
