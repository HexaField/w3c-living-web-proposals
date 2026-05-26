/**
 * Governance setup for collaborative document
 */
import { Context } from '@living-web/personal-graph';
import {
  createGovernanceLayer,
  createCapability,
  delegateCapability,
  type ZCAPDocument,
} from '@living-web/capability-framework';
import { PREDICATES } from './shapes.js';

type SharedGraph = Context;

const EDITOR_PREDICATES = [
  PREDICATES.BLOCK_CONTENT, PREDICATES.BLOCK_TYPE, PREDICATES.BLOCK_AUTHOR,
  PREDICATES.NEXT_BLOCK, PREDICATES.BLOCK_LOCKED, PREDICATES.BLOCK_LOCKED_BY,
  PREDICATES.COMMENT_BODY, PREDICATES.COMMENT_AUTHOR, PREDICATES.COMMENT_TIME,
  PREDICATES.COMMENT_BLOCK, PREDICATES.COMMENT_RESOLVED,
  PREDICATES.REPLY_BODY, PREDICATES.REPLY_AUTHOR, PREDICATES.REPLY_TIME,
  PREDICATES.ENTRY_TYPE, PREDICATES.HAS_BLOCK, PREDICATES.HAS_COMMENT,
  PREDICATES.HAS_REPLY, PREDICATES.FIRST_BLOCK, PREDICATES.HAS_CHILD,
];

const COMMENTER_PREDICATES = [
  PREDICATES.COMMENT_BODY, PREDICATES.COMMENT_AUTHOR, PREDICATES.COMMENT_TIME,
  PREDICATES.COMMENT_BLOCK,
  PREDICATES.REPLY_BODY, PREDICATES.REPLY_AUTHOR, PREDICATES.REPLY_TIME,
  PREDICATES.ENTRY_TYPE, PREDICATES.HAS_COMMENT, PREDICATES.HAS_REPLY, PREDICATES.HAS_CHILD,
];

const OWNER_PREDICATES = [
  ...EDITOR_PREDICATES,
  PREDICATES.DOC_TITLE, PREDICATES.DOC_OWNER,
  PREDICATES.COLLAB_DID, PREDICATES.COLLAB_NAME, PREDICATES.COLLAB_ROLE, PREDICATES.COLLAB_COLOR,
  PREDICATES.HAS_COLLABORATOR,
];

export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface GovernanceState {
  layer: ReturnType<typeof createGovernanceLayer>;
  rootZcap: ZCAPDocument;
  zcaps: Map<string, ZCAPDocument>;
  commentRateLimitMs: number;
  lastCommentTime: Map<string, number>;
}

export function setupGovernance(graph: SharedGraph, ownerDid: string): GovernanceState {
  const layer = createGovernanceLayer(graph, { enforcementMode: 'open' });
  const rootZcap = createCapability(
    ownerDid,
    ['createLink', 'removeLink', 'updateProperty', 'updateSHACL', 'updateGovernance'],
    graph.did!,
    ownerDid,
    { caveats: [{ type: 'predicate', value: { allowed: OWNER_PREDICATES } }] },
  );
  layer.storeExpression(rootZcap.id, rootZcap);

  return {
    layer,
    rootZcap,
    zcaps: new Map([[ownerDid, rootZcap]]),
    commentRateLimitMs: 10000,
    lastCommentTime: new Map(),
  };
}

export function issueRoleZcap(state: GovernanceState, did: string, role: DocRole, ownerDid: string): ZCAPDocument | null {
  if (role === 'viewer') return null;
  const predicates = role === 'editor' ? EDITOR_PREDICATES : COMMENTER_PREDICATES;
  const zcap = delegateCapability(state.rootZcap, did, ownerDid, {
    subsetActions: ['createLink', 'updateProperty'],
    additionalCaveats: [{ type: 'predicate', value: { allowed: predicates } }],
  });
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(did, zcap);
  return zcap;
}

export interface EditValidation {
  allowed: boolean;
  reason?: string;
}

export function validateEdit(state: GovernanceState, did: string, isOwner: boolean): EditValidation {
  if (isOwner) return { allowed: true };
  const zcap = state.zcaps.get(did);
  if (!zcap) return { allowed: false, reason: 'View only: no edit capability' };
  // Check if zcap's predicate caveat permits block_content (editors have it, commenters don't).
  const predicateCaveat = (zcap.caveats ?? []).find((c: any) => c.type === 'predicate');
  const allowed: string[] = (predicateCaveat?.value as any)?.allowed ?? [];
  if (!allowed.includes(PREDICATES.BLOCK_CONTENT)) {
    return { allowed: false, reason: 'Commenter: cannot edit blocks' };
  }
  return { allowed: true };
}

export function validateComment(state: GovernanceState, did: string, isOwner: boolean): EditValidation {
  if (isOwner) return { allowed: true };
  const zcap = state.zcaps.get(did);
  if (!zcap) return { allowed: false, reason: 'View only: cannot comment' };

  // Rate limit
  const last = state.lastCommentTime.get(did) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < state.commentRateLimitMs) {
    const wait = Math.ceil((state.commentRateLimitMs - elapsed) / 1000);
    return { allowed: false, reason: `Rate limited: wait ${wait}s` };
  }
  return { allowed: true };
}

export function recordComment(state: GovernanceState, did: string): void {
  state.lastCommentTime.set(did, Date.now());
}
