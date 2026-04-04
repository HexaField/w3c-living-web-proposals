/**
 * Shape definitions for collaborative document
 */
import type { ShapeDefinition } from '@living-web/shape-validation';

const DOC = 'doc://';
const GRAPH = 'graph://';

export const PREDICATES = {
  ENTRY_TYPE: `${DOC}entry_type`,
  DOCUMENT: `${DOC}document`,
  BLOCK: `${DOC}block`,
  COMMENT: `${DOC}comment`,
  COMMENT_REPLY: `${DOC}comment_reply`,
  COLLABORATOR: `${DOC}collaborator`,

  DOC_TITLE: `${DOC}doc_title`,
  DOC_OWNER: `${DOC}doc_owner`,
  FIRST_BLOCK: `${DOC}first_block`,

  BLOCK_TYPE: `${DOC}block_type`,
  BLOCK_CONTENT: `${DOC}block_content`,
  BLOCK_AUTHOR: `${DOC}block_author`,
  NEXT_BLOCK: `${DOC}next_block`,
  BLOCK_LOCKED: `${DOC}block_locked`,
  BLOCK_LOCKED_BY: `${DOC}block_locked_by`,

  COMMENT_BODY: `${DOC}comment_body`,
  COMMENT_AUTHOR: `${DOC}comment_author`,
  COMMENT_TIME: `${DOC}comment_time`,
  COMMENT_BLOCK: `${DOC}comment_anchor_block`,
  COMMENT_RESOLVED: `${DOC}comment_resolved`,

  REPLY_BODY: `${DOC}reply_body`,
  REPLY_AUTHOR: `${DOC}reply_author`,
  REPLY_TIME: `${DOC}reply_time`,

  COLLAB_DID: `${DOC}collab_did`,
  COLLAB_NAME: `${DOC}collab_name`,
  COLLAB_ROLE: `${DOC}collab_role`,
  COLLAB_COLOR: `${DOC}collab_color`,

  HAS_CHILD: `${GRAPH}has_child`,
  HAS_BLOCK: `${DOC}has_block`,
  HAS_COMMENT: `${DOC}has_comment`,
  HAS_REPLY: `${DOC}has_reply`,
  HAS_COLLABORATOR: `${DOC}has_collaborator`,
} as const;

export const DocumentShape: ShapeDefinition = {
  targetClass: PREDICATES.DOCUMENT,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.DOC_TITLE, name: 'title', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.DOC_OWNER, name: 'owner', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.DOCUMENT },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.DOC_TITLE, target: 'title' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.DOC_OWNER, target: 'owner' },
  ],
};

export const BlockShape: ShapeDefinition = {
  targetClass: PREDICATES.BLOCK,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.BLOCK_TYPE, name: 'type', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.BLOCK_CONTENT, name: 'content', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.BLOCK_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.BLOCK },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BLOCK_TYPE, target: 'type' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BLOCK_CONTENT, target: 'content' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BLOCK_AUTHOR, target: 'author' },
  ],
};

export const CommentShape: ShapeDefinition = {
  targetClass: PREDICATES.COMMENT,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.COMMENT_BODY, name: 'body', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMENT_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMENT_TIME, name: 'time', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMENT_BLOCK, name: 'blockId', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMENT_RESOLVED, name: 'resolved', datatype: 'xsd:string' },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.COMMENT },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMENT_BODY, target: 'body' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMENT_AUTHOR, target: 'author' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMENT_TIME, target: 'time' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMENT_BLOCK, target: 'blockId' },
  ],
};

export const CommentReplyShape: ShapeDefinition = {
  targetClass: PREDICATES.COMMENT_REPLY,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.REPLY_BODY, name: 'body', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.REPLY_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.REPLY_TIME, name: 'time', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.COMMENT_REPLY },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.REPLY_BODY, target: 'body' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.REPLY_AUTHOR, target: 'author' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.REPLY_TIME, target: 'time' },
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
