/**
 * Governance setup for P2P VCS
 */
import { SharedGraph } from '@living-web/graph-sync';
import {
  createGovernanceLayer,
  createCapability,
  delegateCapability,
  type ZCAPDocument,
} from '@living-web/governance';
import { PREDICATES } from './shapes.js';

const OWNER_PREDICATES = [
  PREDICATES.REPO_NAME, PREDICATES.REPO_DESCRIPTION,
  PREDICATES.BRANCH_NAME, PREDICATES.HEAD_COMMIT, PREDICATES.BRANCH_PROTECTED,
  PREDICATES.COMMIT_MESSAGE, PREDICATES.COMMIT_AUTHOR, PREDICATES.COMMIT_AUTHOR_NAME,
  PREDICATES.COMMIT_TIME, PREDICATES.PARENT_COMMIT, PREDICATES.HAS_SNAPSHOT,
  PREDICATES.SNAPSHOT_ENTRIES,
  PREDICATES.FILE_PATH, PREDICATES.FILE_CONTENT_DATA, PREDICATES.FILE_HASH,
  PREDICATES.CONTRIBUTOR_DID, PREDICATES.CONTRIBUTOR_NAME, PREDICATES.CONTRIBUTOR_ROLE,
  PREDICATES.HAS_CHILD, PREDICATES.HAS_BRANCH, PREDICATES.HAS_CONTRIBUTOR,
  PREDICATES.ENTRY_TYPE, PREDICATES.DEFAULT_BRANCH, PREDICATES.BRANCH_CREATED_BY,
  PREDICATES.MERGE_PARENT,
];

const CONTRIBUTOR_PREDICATES = [
  PREDICATES.BRANCH_NAME, PREDICATES.HEAD_COMMIT,
  PREDICATES.COMMIT_MESSAGE, PREDICATES.COMMIT_AUTHOR, PREDICATES.COMMIT_AUTHOR_NAME,
  PREDICATES.COMMIT_TIME, PREDICATES.PARENT_COMMIT, PREDICATES.HAS_SNAPSHOT,
  PREDICATES.SNAPSHOT_ENTRIES,
  PREDICATES.FILE_PATH, PREDICATES.FILE_CONTENT_DATA, PREDICATES.FILE_HASH,
  PREDICATES.ENTRY_TYPE, PREDICATES.BRANCH_CREATED_BY, PREDICATES.MERGE_PARENT,
  PREDICATES.HAS_CHILD, PREDICATES.HAS_BRANCH,
];

export interface GovernanceState {
  layer: ReturnType<typeof createGovernanceLayer>;
  rootZcap: ZCAPDocument;
  zcaps: Map<string, ZCAPDocument>;
  rateLimitMs: number;
  lastCommitTime: Map<string, number>;
}

export function setupGovernance(graph: SharedGraph, ownerDid: string): GovernanceState {
  const layer = createGovernanceLayer(graph, { rootAuthority: ownerDid });
  const rootZcap = createCapability(ownerDid, OWNER_PREDICATES, { within: null, graph: graph.uri }, ownerDid);
  layer.storeExpression(rootZcap.id, rootZcap);

  return {
    layer,
    rootZcap,
    zcaps: new Map([[ownerDid, rootZcap]]),
    rateLimitMs: 5000,
    lastCommitTime: new Map(),
  };
}

export function issueContributorZcap(state: GovernanceState, did: string, ownerDid: string): ZCAPDocument {
  const zcap = delegateCapability(state.rootZcap, did, ownerDid, { subsetPredicates: CONTRIBUTOR_PREDICATES });
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(did, zcap);
  return zcap;
}

export interface CommitValidation {
  allowed: boolean;
  reason?: string;
}

export function validateCommit(
  state: GovernanceState,
  authorDid: string,
  branchProtected: boolean,
  isOwner: boolean,
): CommitValidation {
  if (isOwner) return { allowed: true };

  if (!state.zcaps.has(authorDid)) {
    return { allowed: false, reason: 'No capability — not a contributor' };
  }

  if (branchProtected) {
    return { allowed: false, reason: 'Protected branch: requires owner' };
  }

  // Rate limit
  const last = state.lastCommitTime.get(authorDid) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < state.rateLimitMs) {
    const wait = Math.ceil((state.rateLimitMs - elapsed) / 1000);
    return { allowed: false, reason: `Rate limited: wait ${wait}s` };
  }

  return { allowed: true };
}

export function recordCommit(state: GovernanceState, authorDid: string): void {
  state.lastCommitTime.set(authorDid, Date.now());
}
