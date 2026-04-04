/**
 * Governance setup — ZCAP-based role permissions, constraints
 */

import { SharedGraph } from '@living-web/graph-sync';
import {
  createGovernanceLayer,
  createCapability,
  delegateCapability,
  revokeCapability,
  GOV,
  type ZCAPDocument,
  type ValidationResult,
} from '@living-web/governance';
import { PREDICATES } from './shapes.js';

// All message-related predicates a member can use
const MEMBER_PREDICATES = [
  PREDICATES.BODY,
  PREDICATES.ENTRY_TYPE,
  PREDICATES.REACTION_EMOJI,
  PREDICATES.REACTION_AUTHOR,
  PREDICATES.MEMBER_DID,
  PREDICATES.MEMBER_NAME,
];

const ADMIN_PREDICATES = [
  ...MEMBER_PREDICATES,
  PREDICATES.NAME,
  PREDICATES.TOPIC,
  PREDICATES.ROLE_COLOR,
  PREDICATES.ROLE_POSITION,
  PREDICATES.HAS_ROLE,
  PREDICATES.HAS_CHILD,
];

export interface GovernanceState {
  layer: ReturnType<typeof createGovernanceLayer>;
  rootZcap: ZCAPDocument;
  memberZcapTemplate: ZCAPDocument | null;
  zcaps: Map<string, ZCAPDocument>; // did -> zcap
  slowModeChannels: Map<string, number>; // channelId -> interval ms
  readOnlyChannels: Set<string>;
  bannedDids: Set<string>;
  lastMessageTime: Map<string, number>; // `${did}:${channelId}` -> timestamp
}

export function setupGovernance(graph: SharedGraph, ownerDid: string): GovernanceState {
  const layer = createGovernanceLayer(graph, {
    rootAuthority: ownerDid,
  });

  // Root ZCAP for owner
  const rootZcap = createCapability(
    ownerDid,
    [...ADMIN_PREDICATES],
    { within: null, graph: graph.uri },
    ownerDid,
  );
  layer.storeExpression(rootZcap.id, rootZcap);

  // Store ZCAP in graph so governance engine can find it
  // (We do this via the expression store rather than as triples for simplicity)

  return {
    layer,
    rootZcap,
    memberZcapTemplate: null,
    zcaps: new Map([[ownerDid, rootZcap]]),
    slowModeChannels: new Map(),
    readOnlyChannels: new Set(),
    bannedDids: new Set(),
    lastMessageTime: new Map(),
  };
}

export function issueMemberZcap(
  state: GovernanceState,
  memberDid: string,
  graphUri: string,
  ownerDid: string,
): ZCAPDocument {
  const zcap = delegateCapability(
    state.rootZcap,
    memberDid,
    ownerDid,
    { subsetPredicates: MEMBER_PREDICATES },
  );
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(memberDid, zcap);
  return zcap;
}

export function issueAdminZcap(
  state: GovernanceState,
  adminDid: string,
  ownerDid: string,
): ZCAPDocument {
  const zcap = delegateCapability(
    state.rootZcap,
    adminDid,
    ownerDid,
    { subsetPredicates: ADMIN_PREDICATES },
  );
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(adminDid, zcap);
  return zcap;
}

export function banMember(state: GovernanceState, did: string): void {
  state.bannedDids.add(did);
  const zcap = state.zcaps.get(did);
  if (zcap) {
    // Revoke
    const rev = revokeCapability(did, zcap.id);
    state.layer.storeExpression(`revoke:${zcap.id}`, rev);
    state.zcaps.delete(did);
  }
}

export function setSlowMode(state: GovernanceState, channelId: string, intervalMs: number): void {
  if (intervalMs <= 0) {
    state.slowModeChannels.delete(channelId);
  } else {
    state.slowModeChannels.set(channelId, intervalMs);
  }
}

export function setReadOnly(state: GovernanceState, channelId: string, readOnly: boolean): void {
  if (readOnly) {
    state.readOnlyChannels.add(channelId);
  } else {
    state.readOnlyChannels.delete(channelId);
  }
}

export interface SendValidation {
  allowed: boolean;
  reason?: string;
  waitMs?: number;
}

/**
 * Validate whether a DID can send a message in a channel.
 * This is our custom governance logic that layers on top of the ZCAP engine.
 */
export function validateSend(
  state: GovernanceState,
  authorDid: string,
  channelId: string,
  isOwner: boolean,
): SendValidation {
  // Owner bypasses all
  if (isOwner) return { allowed: true };

  // Ban check
  if (state.bannedDids.has(authorDid)) {
    return { allowed: false, reason: 'You have been banned from this community' };
  }

  // ZCAP check
  if (!state.zcaps.has(authorDid)) {
    return { allowed: false, reason: 'No capability — not a member' };
  }

  // Read-only channel check
  if (state.readOnlyChannels.has(channelId)) {
    return { allowed: false, reason: 'This channel is read-only (announcements only)' };
  }

  // Slow mode check
  const interval = state.slowModeChannels.get(channelId);
  if (interval) {
    const key = `${authorDid}:${channelId}`;
    const last = state.lastMessageTime.get(key) ?? 0;
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed < interval) {
      const wait = interval - elapsed;
      return { allowed: false, reason: `Slow mode: wait ${Math.ceil(wait / 1000)}s`, waitMs: wait };
    }
  }

  return { allowed: true };
}

export function recordSend(state: GovernanceState, authorDid: string, channelId: string): void {
  const key = `${authorDid}:${channelId}`;
  state.lastMessageTime.set(key, Date.now());
}
