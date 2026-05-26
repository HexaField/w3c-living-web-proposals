/**
 * Setup — identity, GraphStore, community context, group convenience layer.
 *
 * A community is a Group (a Context with a did:graph DID). Channels, roles,
 * members are entities within the community's context. Role sub-groups are
 * separate contexts that participate_in the community.
 */

import { install as installIdentity, IdentityManager, DIDIdentityProvider } from '@living-web/identity';
// group-identity/polyfill MUST come before personal-graph: it registers the
// did:graph credential creator, resolver, and ContextMethodBinding that
// personal-graph's createContext depends on.
import '@living-web/group-identity/polyfill';
import { install as installPersonalGraph, Triple, Context, GraphStore, type IdentityProvider } from '@living-web/personal-graph';
import '@living-web/shape-validation/polyfill';
import '@living-web/default-sync-module/polyfill';
import '@living-web/flows/polyfill';

import type { Group } from '@living-web/group-identity';
import {
  CommunityShape, ChannelShape, MessageShape, RoleShape, MemberShape,
  PREDICATES,
} from './shapes.js';
import {
  setupGovernance, issueMemberZcap, issueAdminZcap, type GovernanceState,
} from './governance.js';

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';
const SYNC_CHANNEL = 'living-web-community-chat';

export interface ChatMessage {
  id: string;
  channelId: string;
  body: string;
  authorDid: string;
  authorName: string;
  timestamp: number;
  reactions: Map<string, Set<string>>;
}

export interface AppState {
  did: string;
  displayName: string;
  store: GraphStore;
  context: Context;
  group: Group | null;
  groupDid: string;
  communityId: string;
  communityName: string;
  channels: { id: string; name: string }[];
  roles: { id: string; name: string; color: string; position: number }[];
  roleGroups: Map<string, Group>;
  members: { id: string; did: string; name: string; roleIds: string[] }[];
  messages: Map<string, ChatMessage[]>;
  governance: GovernanceState;
  isOwner: boolean;
  bc: BroadcastChannel;
  identity: IdentityProvider;
  governanceLogs: { text: string; accepted: boolean; time: number }[];
}

let installed = false;
async function ensurePolyfills(): Promise<void> {
  if (installed) return;
  installIdentity();
  await installPersonalGraph();
  installed = true;
}

export async function createIdentity(displayName: string): Promise<{ did: string; identity: IdentityProvider }> {
  await ensurePolyfills();
  const manager = new IdentityManager();
  const credential = await manager.createIndividual(displayName, POLYFILL_PASSPHRASE);
  if (credential.isLocked) await credential.unlock(POLYFILL_PASSPHRASE);
  const provider = new DIDIdentityProvider(credential);
  return { did: provider.getDID(), identity: provider };
}

async function getOrCreateStore(name: string): Promise<GraphStore> {
  const stores = await navigator.graph.list();
  if (stores.length > 0) return stores[0];
  return navigator.graph.create(name);
}

async function registerShapes(context: Context): Promise<void> {
  await context.addShape('Community', JSON.stringify(CommunityShape));
  await context.addShape('Channel', JSON.stringify(ChannelShape));
  await context.addShape('Message', JSON.stringify(MessageShape));
  await context.addShape('Role', JSON.stringify(RoleShape));
  await context.addShape('Member', JSON.stringify(MemberShape));
}

export async function createCommunity(
  displayName: string,
  communityName: string,
  identity: IdentityProvider,
  did: string,
): Promise<AppState> {
  await ensurePolyfills();
  const store = await getOrCreateStore(`${displayName}'s workspace`);

  const communityGroup = await store.createGroup({
    name: communityName,
    description: `Community: ${communityName}`,
    enforcementMode: 'open',
  });
  const context = communityGroup.context;
  await context.publish();
  await registerShapes(context);

  const communityId = `community:${crypto.randomUUID()}`;
  await context.createShapeInstance('Community', communityId, { name: communityName });

  const roles: AppState['roles'] = [];
  const roleGroupsMap = new Map<string, Group>();
  for (const [name, color, pos] of [
    ['Owner', '#f0b232', '100'],
    ['Admin', '#e74c3c', '80'],
    ['Moderator', '#3498db', '60'],
    ['Member', '#2ecc71', '40'],
  ] as const) {
    const roleId = `role:${crypto.randomUUID()}`;
    await context.createShapeInstance('Role', roleId, { name, color, position: pos });
    await context.addTriple(new Triple(communityId, PREDICATES.HAS_CHILD, roleId));

    const roleGroup = await store.createGroup({
      name: `${communityName}/${name}`,
      participatesIn: communityGroup.did,
    });
    await communityGroup.invite(roleGroup.did);
    roleGroupsMap.set(name, roleGroup);
    roles.push({ id: roleId, name, color, position: Number(pos) });
  }

  const generalId = `channel:${crypto.randomUUID()}`;
  await context.createShapeInstance('Channel', generalId, { name: 'general' });
  await context.addTriple(new Triple(communityId, PREDICATES.HAS_CHILD, generalId));

  const memberId = `member:${crypto.randomUUID()}`;
  await context.createShapeInstance('Member', memberId, { did, displayName });
  await context.addTriple(new Triple(communityId, PREDICATES.HAS_CHILD, memberId));
  await context.addTriple(new Triple(memberId, PREDICATES.HAS_ROLE, roles[0].id));

  const ownerRoleGroup = roleGroupsMap.get('Owner');
  if (ownerRoleGroup) await ownerRoleGroup.invite(did);

  const governance = setupGovernance(context, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, store, context,
    group: communityGroup,
    groupDid: communityGroup.did,
    communityId, communityName,
    channels: [{ id: generalId, name: 'general' }],
    roles,
    roleGroups: roleGroupsMap,
    members: [{ id: memberId, did, name: displayName, roleIds: [roles[0].id] }],
    messages: new Map([[generalId, []]]),
    governance,
    isOwner: true,
    bc, identity,
    governanceLogs: [],
  };

  setupCrossTabSync(state);
  return state;
}

export async function joinCommunity(
  displayName: string,
  groupDid: string,
  identity: IdentityProvider,
  did: string,
): Promise<AppState> {
  await ensurePolyfills();
  const store = await getOrCreateStore(`${displayName}'s workspace`);

  // For the polyfill: in this single-origin demo, both tabs share IndexedDB.
  // The "join" path uses the BroadcastChannel sync-response from the owner tab.
  let context: Context;
  try {
    context = await store.mount(groupDid, { mode: 'write' });
  } catch {
    context = await store.createContext({ displayName: 'Joined Community' });
  }
  await context.publish();
  await registerShapes(context);

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(context, did);
      resolve({
        did, displayName, store, context,
        group: null,
        groupDid,
        communityId: `community:fallback`,
        communityName: 'Community',
        channels: [{ id: `channel:general`, name: 'general' }],
        roles: [],
        roleGroups: new Map(),
        members: [{ id: `member:${crypto.randomUUID()}`, did, name: displayName, roleIds: [] }],
        messages: new Map([[`channel:general`, []]]),
        governance, isOwner: false, bc, identity,
        governanceLogs: [],
      });
    }, 1000);

    const handler = (ev: MessageEvent) => {
      const data = ev.data;
      if (data.type !== 'sync-response' || data.groupDid !== groupDid) return;
      clearTimeout(timeout);
      bc.removeEventListener('message', handler);

      const governance = setupGovernance(context, data.ownerDid);
      issueMemberZcap(governance, did, context.did, data.ownerDid);

      if (data.slowModeChannels) for (const [k, v] of Object.entries(data.slowModeChannels)) governance.slowModeChannels.set(k, v as number);
      if (data.readOnlyChannels) for (const ch of data.readOnlyChannels) governance.readOnlyChannels.add(ch as string);
      if (data.bannedDids) for (const d of data.bannedDids) governance.bannedDids.add(d as string);

      const messages = new Map<string, ChatMessage[]>();
      if (data.messages) {
        for (const [chId, msgs] of Object.entries(data.messages)) {
          messages.set(chId, (msgs as ChatMessage[]).map(m => ({
            ...m,
            reactions: new Map(Object.entries(m.reactions || {}).map(([emoji, dids]) => [emoji, new Set(dids as unknown as string[])])),
          })));
        }
      }
      for (const ch of data.channels) if (!messages.has(ch.id)) messages.set(ch.id, []);

      const state: AppState = {
        did, displayName, store, context,
        group: null,
        groupDid: data.groupDid || groupDid,
        communityId: data.communityId,
        communityName: data.communityName,
        channels: data.channels,
        roles: data.roles,
        roleGroups: new Map(),
        members: [...data.members],
        messages,
        governance, isOwner: false, bc, identity,
        governanceLogs: [],
      };

      const memberId = `member:${crypto.randomUUID()}`;
      const memberRole = state.roles.find(r => r.name === 'Member');
      state.members.push({ id: memberId, did, name: displayName, roleIds: memberRole ? [memberRole.id] : [] });

      bc.postMessage({
        type: 'new-member',
        groupDid: state.groupDid,
        member: { id: memberId, did, name: displayName, roleIds: memberRole ? [memberRole.id] : [] },
      });

      setupCrossTabSync(state);
      resolve(state);
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'sync-request', groupDid, did, displayName });
  });
}

function serializeMessages(messages: Map<string, ChatMessage[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [chId, msgs] of messages) {
    out[chId] = msgs.map(m => ({
      ...m,
      reactions: Object.fromEntries([...m.reactions.entries()].map(([emoji, dids]) => [emoji, [...dids]])),
    }));
  }
  return out;
}

function setupCrossTabSync(state: AppState): void {
  const { bc, context } = state;
  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg.type === 'sync-request' && msg.groupDid === context.did && state.isOwner) {
      bc.postMessage({
        type: 'sync-response',
        groupDid: context.did,
        ownerDid: state.did,
        communityId: state.communityId,
        communityName: state.communityName,
        channels: state.channels,
        roles: state.roles,
        members: state.members,
        messages: serializeMessages(state.messages),
        slowModeChannels: Object.fromEntries(state.governance.slowModeChannels),
        readOnlyChannels: [...state.governance.readOnlyChannels],
        bannedDids: [...state.governance.bannedDids],
      });
    }
    if (msg.type === 'new-message' && msg.groupDid === context.did && msg.message.authorDid !== state.did) {
      const chMsgs = state.messages.get(msg.message.channelId) ?? [];
      const m = msg.message;
      chMsgs.push({
        ...m,
        reactions: new Map(Object.entries(m.reactions || {}).map(([emoji, dids]) => [emoji, new Set(dids as string[])])),
      });
      state.messages.set(msg.message.channelId, chMsgs);
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'message' } }));
    }
    if (msg.type === 'new-member' && msg.groupDid === context.did) {
      if (!state.members.find(m => m.did === msg.member.did)) {
        state.members.push(msg.member);
        if (state.isOwner) issueMemberZcap(state.governance, msg.member.did, context.did, state.did);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'member' } }));
      }
    }
    if (msg.type === 'new-channel' && msg.groupDid === context.did) {
      if (!state.channels.find(c => c.id === msg.channel.id)) {
        state.channels.push(msg.channel);
        state.messages.set(msg.channel.id, []);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'channel' } }));
      }
    }
    if (msg.type === 'governance-update' && msg.groupDid === context.did) {
      if (msg.action === 'slow-mode') {
        if (msg.interval > 0) state.governance.slowModeChannels.set(msg.channelId, msg.interval);
        else state.governance.slowModeChannels.delete(msg.channelId);
      } else if (msg.action === 'read-only') {
        if (msg.readOnly) state.governance.readOnlyChannels.add(msg.channelId);
        else state.governance.readOnlyChannels.delete(msg.channelId);
      } else if (msg.action === 'ban') {
        state.governance.bannedDids.add(msg.targetDid);
      } else if (msg.action === 'promote') {
        issueAdminZcap(state.governance, msg.targetDid, msg.ownerDid);
      }
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'governance' } }));
    }
    if (msg.type === 'reaction' && msg.groupDid === context.did) {
      const chMsgs = state.messages.get(msg.channelId) ?? [];
      const chatMsg = chMsgs.find(m => m.id === msg.messageId);
      if (chatMsg) {
        if (!chatMsg.reactions.has(msg.emoji)) chatMsg.reactions.set(msg.emoji, new Set());
        chatMsg.reactions.get(msg.emoji)!.add(msg.authorDid);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'reaction' } }));
      }
    }
    if (msg.type === 'delete-message' && msg.groupDid === context.did) {
      const chMsgs = state.messages.get(msg.channelId) ?? [];
      const idx = chMsgs.findIndex(m => m.id === msg.messageId);
      if (idx !== -1) {
        chMsgs.splice(idx, 1);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'message' } }));
      }
    }
  });
}
