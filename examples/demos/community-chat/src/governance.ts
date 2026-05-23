/**
 * Governance setup — realigned to actions+resource ZCAPs targeting did:graph.
 */

import { Context } from '@living-web/personal-graph';
import {
  createGovernanceLayer,
  createCapability,
  delegateCapability,
  revokeCapability,
  type ZCAPDocument,
} from '@living-web/capability-framework';
import { PREDICATES } from './shapes.js';

/** Actions a regular member can perform. */
const MEMBER_ACTIONS = ['createLink', 'updateProperty'];
/** Actions an admin can perform. */
const ADMIN_ACTIONS = ['createLink', 'removeLink', 'updateProperty', 'updateSHACL', 'updateGovernance'];

/** Member predicate caveats — what predicates a member ZCAP can carry. */
const MEMBER_PREDICATES = [
  PREDICATES.BODY,
  PREDICATES.ENTRY_TYPE,
  PREDICATES.REACTION_EMOJI,
  PREDICATES.REACTION_AUTHOR,
  PREDICATES.MEMBER_DID,
  PREDICATES.MEMBER_NAME,
];

export interface GovernanceState {
  layer: ReturnType<typeof createGovernanceLayer>;
  rootZcap: ZCAPDocument;
  memberZcapTemplate: ZCAPDocument | null;
  zcaps: Map<string, ZCAPDocument>;
  slowModeChannels: Map<string, number>;
  readOnlyChannels: Set<string>;
  bannedDids: Set<string>;
  lastMessageTime: Map<string, number>;
}

export function setupGovernance(context: Context, ownerDid: string): GovernanceState {
  const layer = createGovernanceLayer(context, {
    enforcementMode: 'open',  // start in open mode; tighten as needed
  });

  // Root ZCAP — represents the context's root capability
  const rootZcap = createCapability(
    ownerDid,
    [...ADMIN_ACTIONS],
    context.did,
    ownerDid,
  );
  layer.storeExpression(rootZcap.id, rootZcap);

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
  _graphDid: string,
  ownerDid: string,
): ZCAPDocument {
  const zcap = delegateCapability(state.rootZcap, memberDid, ownerDid, {
    subsetActions: MEMBER_ACTIONS,
    additionalCaveats: [
      { type: 'predicate', value: { allowed: MEMBER_PREDICATES } },
    ],
  });
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(memberDid, zcap);
  return zcap;
}

export function issueAdminZcap(
  state: GovernanceState,
  adminDid: string,
  ownerDid: string,
): ZCAPDocument {
  const zcap = delegateCapability(state.rootZcap, adminDid, ownerDid, {
    subsetActions: ADMIN_ACTIONS,
  });
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(adminDid, zcap);
  return zcap;
}

export function banMember(state: GovernanceState, did: string): void {
  state.bannedDids.add(did);
  const zcap = state.zcaps.get(did);
  if (zcap) {
    const rev = revokeCapability(did, zcap.id);
    state.layer.storeExpression(`revoke:${zcap.id}`, rev);
    state.zcaps.delete(did);
  }
}

export function setSlowMode(state: GovernanceState, channelId: string, intervalMs: number): void {
  if (intervalMs <= 0) state.slowModeChannels.delete(channelId);
  else state.slowModeChannels.set(channelId, intervalMs);
}

export function setReadOnly(state: GovernanceState, channelId: string, readOnly: boolean): void {
  if (readOnly) state.readOnlyChannels.add(channelId);
  else state.readOnlyChannels.delete(channelId);
}

export interface SendValidation {
  allowed: boolean;
  reason?: string;
  waitMs?: number;
}

export function validateSend(
  state: GovernanceState,
  authorDid: string,
  channelId: string,
  isOwner: boolean,
): SendValidation {
  if (isOwner) return { allowed: true };
  if (state.bannedDids.has(authorDid)) return { allowed: false, reason: 'You have been banned from this community' };
  if (!state.zcaps.has(authorDid)) return { allowed: false, reason: 'No capability — not a member' };
  if (state.readOnlyChannels.has(channelId)) return { allowed: false, reason: 'This channel is read-only' };
  const interval = state.slowModeChannels.get(channelId);
  if (interval) {
    const key = `${authorDid}:${channelId}`;
    const last = state.lastMessageTime.get(key) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < interval) {
      const wait = interval - elapsed;
      return { allowed: false, reason: `Slow mode: wait ${Math.ceil(wait / 1000)}s`, waitMs: wait };
    }
  }
  return { allowed: true };
}

export function recordSend(state: GovernanceState, authorDid: string, channelId: string): void {
  state.lastMessageTime.set(`${authorDid}:${channelId}`, Date.now());
}
