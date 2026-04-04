/**
 * Shape definitions for P2P VCS
 */
import type { ShapeDefinition } from '@living-web/shape-validation';

const VCS = 'vcs://';
const GRAPH = 'graph://';

export const PREDICATES = {
  // Entry types
  ENTRY_TYPE: `${VCS}entry_type`,
  REPOSITORY: `${VCS}repository`,
  BRANCH: `${VCS}branch`,
  COMMIT: `${VCS}commit`,
  TREE_SNAPSHOT: `${VCS}tree_snapshot`,
  FILE_CONTENT: `${VCS}file_content`,
  CONTRIBUTOR: `${VCS}contributor`,

  // Repository
  REPO_NAME: `${VCS}repo_name`,
  REPO_DESCRIPTION: `${VCS}repo_description`,
  REPO_OWNER: `${VCS}repo_owner`,
  DEFAULT_BRANCH: `${VCS}default_branch`,

  // Branch
  BRANCH_NAME: `${VCS}branch_name`,
  HEAD_COMMIT: `${VCS}head_commit`,
  BRANCH_PROTECTED: `${VCS}branch_protected`,
  BRANCH_CREATED_BY: `${VCS}branch_created_by`,

  // Commit
  COMMIT_MESSAGE: `${VCS}commit_message`,
  COMMIT_AUTHOR: `${VCS}commit_author`,
  COMMIT_AUTHOR_NAME: `${VCS}commit_author_name`,
  COMMIT_TIME: `${VCS}commit_time`,
  PARENT_COMMIT: `${VCS}parent_commit`,
  MERGE_PARENT: `${VCS}merge_parent`,
  HAS_SNAPSHOT: `${VCS}has_snapshot`,

  // TreeSnapshot
  SNAPSHOT_ENTRIES: `${VCS}snapshot_entries`,

  // FileContent
  FILE_PATH: `${VCS}file_path`,
  FILE_CONTENT_DATA: `${VCS}file_content_data`,
  FILE_HASH: `${VCS}file_hash`,

  // Contributor
  CONTRIBUTOR_DID: `${VCS}contributor_did`,
  CONTRIBUTOR_NAME: `${VCS}contributor_name`,
  CONTRIBUTOR_ROLE: `${VCS}contributor_role`,

  // Relations
  HAS_CHILD: `${GRAPH}has_child`,
  HAS_BRANCH: `${VCS}has_branch`,
  HAS_CONTRIBUTOR: `${VCS}has_contributor`,
} as const;

export const RepositoryShape: ShapeDefinition = {
  targetClass: PREDICATES.REPOSITORY,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.REPO_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.REPO_DESCRIPTION, name: 'description', datatype: 'xsd:string' },
    { path: PREDICATES.REPO_OWNER, name: 'owner', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.DEFAULT_BRANCH, name: 'defaultBranch', datatype: 'xsd:string' },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.REPOSITORY },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.REPO_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.REPO_DESCRIPTION, target: 'description' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.REPO_OWNER, target: 'owner' },
  ],
};

export const BranchShape: ShapeDefinition = {
  targetClass: PREDICATES.BRANCH,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.BRANCH_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.HEAD_COMMIT, name: 'headCommit', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.BRANCH_PROTECTED, name: 'protected', datatype: 'xsd:string' },
    { path: PREDICATES.BRANCH_CREATED_BY, name: 'createdBy', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.BRANCH },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BRANCH_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.HEAD_COMMIT, target: 'headCommit' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BRANCH_PROTECTED, target: 'protected' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.BRANCH_CREATED_BY, target: 'createdBy' },
  ],
};

export const CommitShape: ShapeDefinition = {
  targetClass: PREDICATES.COMMIT,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.COMMIT_MESSAGE, name: 'message', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMIT_AUTHOR, name: 'author', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMIT_AUTHOR_NAME, name: 'authorName', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.COMMIT_TIME, name: 'time', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.PARENT_COMMIT, name: 'parentCommit', datatype: 'xsd:string' },
    { path: PREDICATES.MERGE_PARENT, name: 'mergeParent', datatype: 'xsd:string' },
    { path: PREDICATES.HAS_SNAPSHOT, name: 'snapshot', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.COMMIT },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMIT_MESSAGE, target: 'message' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMIT_AUTHOR, target: 'author' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMIT_AUTHOR_NAME, target: 'authorName' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.COMMIT_TIME, target: 'time' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.PARENT_COMMIT, target: 'parentCommit' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.HAS_SNAPSHOT, target: 'snapshot' },
  ],
};

export const TreeSnapshotShape: ShapeDefinition = {
  targetClass: PREDICATES.TREE_SNAPSHOT,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.SNAPSHOT_ENTRIES, name: 'entries', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.TREE_SNAPSHOT },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.SNAPSHOT_ENTRIES, target: 'entries' },
  ],
};

export const FileContentShape: ShapeDefinition = {
  targetClass: PREDICATES.FILE_CONTENT,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.FILE_PATH, name: 'path', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.FILE_CONTENT_DATA, name: 'content', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.FILE_HASH, name: 'hash', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.FILE_CONTENT },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.FILE_PATH, target: 'path' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.FILE_CONTENT_DATA, target: 'content' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.FILE_HASH, target: 'hash' },
  ],
};

export const ContributorShape: ShapeDefinition = {
  targetClass: PREDICATES.CONTRIBUTOR,
  properties: [
    { path: PREDICATES.ENTRY_TYPE, name: 'entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { path: PREDICATES.CONTRIBUTOR_DID, name: 'did', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.CONTRIBUTOR_NAME, name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { path: PREDICATES.CONTRIBUTOR_ROLE, name: 'role', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.ENTRY_TYPE, target: PREDICATES.CONTRIBUTOR },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CONTRIBUTOR_DID, target: 'did' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CONTRIBUTOR_NAME, target: 'name' },
    { action: 'setSingleTarget', source: 'this', predicate: PREDICATES.CONTRIBUTOR_ROLE, target: 'role' },
  ],
};
