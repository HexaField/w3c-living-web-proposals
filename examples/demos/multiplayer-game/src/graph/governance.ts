/**
 * Governance for multiplayer game
 */
import { SharedGraph } from '@living-web/graph-sync';
import {
  createGovernanceLayer,
  createCapability,
  delegateCapability,
  type ZCAPDocument,
} from '@living-web/governance';
import { PREDICATES } from './shapes.js';

const PLAYER_PREDICATES = [
  PREDICATES.PLAYER_X, PREDICATES.PLAYER_Y, PREDICATES.PLAYER_Z,
  PREDICATES.PLAYER_ROT, PREDICATES.PLAYER_SCORE, PREDICATES.PLAYER_DID,
  PREDICATES.PLAYER_NAME, PREDICATES.PLAYER_COLOR,
  PREDICATES.COLL_BY, PREDICATES.CHAT_BODY, PREDICATES.CHAT_AUTHOR,
  PREDICATES.CHAT_AUTHOR_NAME, PREDICATES.ENTRY_TYPE,
  PREDICATES.HAS_PLAYER, PREDICATES.HAS_CHAT,
];

const ADMIN_PREDICATES = [
  ...PLAYER_PREDICATES,
  PREDICATES.WORLD_NAME, PREDICATES.WORLD_OWNER,
  PREDICATES.OBJ_TYPE, PREDICATES.OBJ_X, PREDICATES.OBJ_Y, PREDICATES.OBJ_Z,
  PREDICATES.OBJ_W, PREDICATES.OBJ_H, PREDICATES.OBJ_D, PREDICATES.OBJ_COLOR,
  PREDICATES.COLL_TYPE, PREDICATES.COLL_X, PREDICATES.COLL_Y, PREDICATES.COLL_Z,
  PREDICATES.COLL_VALUE, PREDICATES.COLL_COLOR,
  PREDICATES.HAS_OBJECT, PREDICATES.HAS_COLLECTIBLE, PREDICATES.HAS_CHILD,
];

export interface GovernanceState {
  layer: ReturnType<typeof createGovernanceLayer>;
  rootZcap: ZCAPDocument;
  zcaps: Map<string, ZCAPDocument>;
  collectedItems: Set<string>;
  lastChatTime: Map<string, number>;
}

export function setupGovernance(graph: SharedGraph, ownerDid: string): GovernanceState {
  const layer = createGovernanceLayer(graph, { rootAuthority: ownerDid });
  const rootZcap = createCapability(
    ownerDid, ADMIN_PREDICATES,
    { within: null, graph: graph.uri },
    ownerDid,
  );
  layer.storeExpression(rootZcap.id, rootZcap);

  return {
    layer, rootZcap,
    zcaps: new Map([[ownerDid, rootZcap]]),
    collectedItems: new Set(),
    lastChatTime: new Map(),
  };
}

export function issuePlayerZcap(state: GovernanceState, playerDid: string, ownerDid: string): ZCAPDocument {
  const zcap = delegateCapability(
    state.rootZcap, playerDid, ownerDid,
    { subsetPredicates: PLAYER_PREDICATES },
  );
  state.layer.storeExpression(zcap.id, zcap);
  state.zcaps.set(playerDid, zcap);
  return zcap;
}

export interface ValidationResult { allowed: boolean; reason?: string; }

export function validateCollect(state: GovernanceState, collectibleId: string, did: string): ValidationResult {
  if (state.collectedItems.has(collectibleId)) return { allowed: false, reason: 'Already collected' };
  if (!state.zcaps.has(did)) return { allowed: false, reason: 'No capability' };
  return { allowed: true };
}

export function validateChat(state: GovernanceState, did: string): ValidationResult {
  if (!state.zcaps.has(did)) return { allowed: false, reason: 'No capability' };
  const last = state.lastChatTime.get(did) || 0;
  if (Date.now() - last < 2000) return { allowed: false, reason: 'Chat rate limited: wait 2s' };
  return { allowed: true };
}

export function recordChat(state: GovernanceState, did: string): void {
  state.lastChatTime.set(did, Date.now());
}
