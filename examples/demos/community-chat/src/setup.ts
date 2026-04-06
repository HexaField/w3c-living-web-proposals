/**
 * Setup — identity creation, community create/join
 */

import { install as installIdentity } from '@living-web/identity';
import { SharedGraph, SharedGraphManager } from '@living-web/graph-sync';
import { installShapeExtension } from '@living-web/shape-validation';
import { PersonalGraph, SemanticTriple } from '@living-web/personal-graph';
import type { IdentityProvider } from '@living-web/personal-graph';
import { GroupManager, DefaultGroupRegistry, type Group } from '@living-web/group-identity';
import {
  CommunityShape, ChannelShape, MessageShape, RoleShape, MemberShape,
  PREDICATES,
} from './shapes.js';
import {
  setupGovernance, issueMemberZcap, issueAdminZcap, type GovernanceState,
} from './governance.js';

// Install polyfills
installIdentity();
installShapeExtension(PersonalGraph);

// Patch SharedGraph prototype with shape methods from PersonalGraph
// SharedGraph has the same triple API (addTriple, queryTriples, removeTriple)
const shapeMethods = ['addShape', 'getShapes', 'createShapeInstance', 'getShapeInstances', 'getShapeInstanceData', 'setShapeProperty', 'addToShapeCollection', 'removeFromShapeCollection'];
for (const method of shapeMethods) {
  if ((PersonalGraph.prototype as any)[method]) {
    (SharedGraph.prototype as any)[method] = (PersonalGraph.prototype as any)[method];
  }
}
// SharedGraph uses `uri` instead of `uuid` — add compatibility getter
if (!Object.getOwnPropertyDescriptor(SharedGraph.prototype, 'uuid')) {
  Object.defineProperty(SharedGraph.prototype, 'uuid', {
    get() { return (this as any).uri; },
  });
}

const SYNC_CHANNEL = 'living-web-community-chat';

export interface ChatMessage {
  id: string;
  channelId: string;
  body: string;
  authorDid: string;
  authorName: string;
  timestamp: number;
  reactions: Map<string, Set<string>>; // emoji -> set of DIDs
}

export interface AppState {
  did: string;
  displayName: string;
  graph: SharedGraph;
  group: Group | null;       // The community Group (Spec 06)
  groupDid: string;          // The community's group DID
  communityId: string;
  communityName: string;
  channels: { id: string; name: string }[];
  roles: { id: string; name: string; color: string; position: number }[];
  roleGroups: Map<string, Group>; // role name -> sub-group
  members: { id: string; did: string; name: string; roleIds: string[] }[];
  messages: Map<string, ChatMessage[]>; // channelId -> messages
  governance: GovernanceState;
  isOwner: boolean;
  bc: BroadcastChannel;
  identity: IdentityProvider;
  governanceLogs: { text: string; accepted: boolean; time: number }[];
}

/** Wrapper to adapt DIDCredential to IdentityProvider interface */
class CredentialIdentity implements IdentityProvider {
  private cred: any;
  constructor(cred: any) { this.cred = cred; }
  getDID(): string { return this.cred.did; }
  getKeyURI(): string { return `${this.cred.did}#key-1`; }
  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.cred.signRaw(data);
  }
  getPublicKey(): Uint8Array { return this.cred.publicKey; }
}

export async function createIdentity(displayName: string): Promise<{ did: string; identity: IdentityProvider }> {
  const cred = await (navigator.credentials as any).create({ did: { displayName } });
  if (cred.isLocked) await cred.unlock('__living-web-polyfill__');
  const identity = new CredentialIdentity(cred);
  return { did: cred.did, identity };
}

export async function createCommunity(
  displayName: string,
  communityName: string,
  identity: IdentityProvider,
  did: string,
): Promise<AppState> {
  // Create a Group for the community (Spec 06)
  const registry = new DefaultGroupRegistry();
  const groupMgr = new GroupManager(identity, registry);
  const communityGroup = await groupMgr.createGroup({ name: communityName, description: `Community: ${communityName}` });
  const graph = communityGroup.graph;
  const g = graph as any;

  // Register shapes
  await g.addShape('Community', JSON.stringify(CommunityShape));
  await g.addShape('Channel', JSON.stringify(ChannelShape));
  await g.addShape('Message', JSON.stringify(MessageShape));
  await g.addShape('Role', JSON.stringify(RoleShape));
  await g.addShape('Member', JSON.stringify(MemberShape));

  // Create community
  const communityId = `community:${crypto.randomUUID()}`;
  await g.createShapeInstance('Community', communityId, { name: communityName });

  // Create roles — each role is a sub-group of the community (Spec 06 holonic nesting)
  const roles: AppState['roles'] = [];
  const roleGroupsMap = new Map<string, Group>();
  for (const [name, color, pos] of [
    ['Owner', '#f0b232', '100'],
    ['Admin', '#e74c3c', '80'],
    ['Moderator', '#3498db', '60'],
    ['Member', '#2ecc71', '40'],
  ] as const) {
    const roleId = `role:${crypto.randomUUID()}`;
    await g.createShapeInstance('Role', roleId, { name, color, position: pos });
    await graph.addTriple(new SemanticTriple(communityId, roleId, PREDICATES.HAS_CHILD));

    // Create a sub-group for this role
    const roleGroup = await groupMgr.createGroup({ name: `${communityName}/${name}` });
    await communityGroup.addMember(roleGroup.did); // holonic nesting
    roleGroupsMap.set(name, roleGroup);

    roles.push({ id: roleId, name, color, position: Number(pos) });
  }

  // Create general channel
  const generalId = `channel:${crypto.randomUUID()}`;
  await g.createShapeInstance('Channel', generalId, { name: 'general' });
  await graph.addTriple(new SemanticTriple(communityId, generalId, PREDICATES.HAS_CHILD));

  // Create owner member
  const memberId = `member:${crypto.randomUUID()}`;
  await g.createShapeInstance('Member', memberId, { did, displayName });
  await graph.addTriple(new SemanticTriple(communityId, memberId, PREDICATES.HAS_CHILD));
  await graph.addTriple(new SemanticTriple(memberId, roles[0].id, PREDICATES.HAS_ROLE));

  // Add owner to the Owner role sub-group
  const ownerRoleGroup = roleGroupsMap.get('Owner');
  if (ownerRoleGroup) await ownerRoleGroup.addMember(did);

  const governance = setupGovernance(graph, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, graph,
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
  graphUri: string,
  identity: IdentityProvider,
  did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.join(graphUri);
  const g = graph as any;

  await g.addShape('Community', JSON.stringify(CommunityShape));
  await g.addShape('Channel', JSON.stringify(ChannelShape));
  await g.addShape('Message', JSON.stringify(MessageShape));
  await g.addShape('Role', JSON.stringify(RoleShape));
  await g.addShape('Member', JSON.stringify(MemberShape));

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      // No owner tab found — minimal state
      const governance = setupGovernance(graph, did);
      resolve({
        did, displayName, graph,
        group: null,
        groupDid: '',
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
      if (ev.data.type === 'sync-response' && ev.data.graphUri === graphUri) {
        clearTimeout(timeout);
        bc.removeEventListener('message', handler);

        const data = ev.data;
        const governance = setupGovernance(graph, data.ownerDid);
        issueMemberZcap(governance, did, graph.uri, data.ownerDid);

        // Copy existing governance state
        if (data.slowModeChannels) {
          for (const [k, v] of Object.entries(data.slowModeChannels)) {
            governance.slowModeChannels.set(k, v as number);
          }
        }
        if (data.readOnlyChannels) {
          for (const ch of data.readOnlyChannels) {
            governance.readOnlyChannels.add(ch as string);
          }
        }
        if (data.bannedDids) {
          for (const d of data.bannedDids) {
            governance.bannedDids.add(d as string);
          }
        }

        const messages = new Map<string, ChatMessage[]>();
        if (data.messages) {
          for (const [chId, msgs] of Object.entries(data.messages)) {
            messages.set(chId, (msgs as any[]).map(m => ({
              ...m,
              reactions: new Map(Object.entries(m.reactions || {}).map(
                ([emoji, dids]) => [emoji, new Set(dids as string[])]
              )),
            })));
          }
        }
        // Ensure all channels have entries
        for (const ch of data.channels) {
          if (!messages.has(ch.id)) messages.set(ch.id, []);
        }

        const state: AppState = {
          did, displayName, graph,
          group: null, // Joined groups don't have local Group object yet
          groupDid: data.groupDid || '',
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

        // Add self as member
        const memberId = `member:${crypto.randomUUID()}`;
        const memberRole = state.roles.find(r => r.name === 'Member');
        state.members.push({ id: memberId, did, name: displayName, roleIds: memberRole ? [memberRole.id] : [] });

        // Broadcast new member
        bc.postMessage({
          type: 'new-member',
          graphUri: graph.uri,
          member: { id: memberId, did, name: displayName, roleIds: memberRole ? [memberRole.id] : [] },
        });

        setupCrossTabSync(state);
        resolve(state);
      }
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'sync-request', graphUri, did, displayName });
  });
}

function serializeMessages(messages: Map<string, ChatMessage[]>): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const [chId, msgs] of messages) {
    out[chId] = msgs.map(m => ({
      ...m,
      reactions: Object.fromEntries(
        Array.from(m.reactions.entries()).map(([emoji, dids]) => [emoji, Array.from(dids)])
      ),
    }));
  }
  return out;
}

function setupCrossTabSync(state: AppState): void {
  const { bc, graph } = state;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'sync-request' && msg.graphUri === graph.uri && state.isOwner) {
      bc.postMessage({
        type: 'sync-response',
        graphUri: graph.uri,
        ownerDid: state.did,
        groupDid: state.groupDid,
        communityId: state.communityId,
        communityName: state.communityName,
        channels: state.channels,
        roles: state.roles,
        members: state.members,
        messages: serializeMessages(state.messages),
        slowModeChannels: Object.fromEntries(state.governance.slowModeChannels),
        readOnlyChannels: Array.from(state.governance.readOnlyChannels),
        bannedDids: Array.from(state.governance.bannedDids),
      });
    }

    if (msg.type === 'new-message' && msg.graphUri === graph.uri && msg.message.authorDid !== state.did) {
      const chMsgs = state.messages.get(msg.message.channelId) ?? [];
      const m = msg.message;
      chMsgs.push({
        ...m,
        reactions: new Map(Object.entries(m.reactions || {}).map(
          ([emoji, dids]: [string, any]) => [emoji, new Set(dids as string[])]
        )),
      });
      state.messages.set(msg.message.channelId, chMsgs);
      document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'message' } }));
    }

    if (msg.type === 'new-member' && msg.graphUri === graph.uri) {
      if (!state.members.find(m => m.did === msg.member.did)) {
        state.members.push(msg.member);
        // Issue ZCAP for new member if we're owner
        if (state.isOwner) {
          issueMemberZcap(state.governance, msg.member.did, graph.uri, state.did);
        }
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'member' } }));
      }
    }

    if (msg.type === 'new-channel' && msg.graphUri === graph.uri) {
      if (!state.channels.find(c => c.id === msg.channel.id)) {
        state.channels.push(msg.channel);
        state.messages.set(msg.channel.id, []);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'channel' } }));
      }
    }

    if (msg.type === 'governance-update' && msg.graphUri === graph.uri) {
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

    if (msg.type === 'reaction' && msg.graphUri === graph.uri) {
      const chMsgs = state.messages.get(msg.channelId) ?? [];
      const chatMsg = chMsgs.find(m => m.id === msg.messageId);
      if (chatMsg) {
        if (!chatMsg.reactions.has(msg.emoji)) chatMsg.reactions.set(msg.emoji, new Set());
        chatMsg.reactions.get(msg.emoji)!.add(msg.authorDid);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'reaction' } }));
      }
    }

    if (msg.type === 'delete-message' && msg.graphUri === graph.uri) {
      const chMsgs = state.messages.get(msg.channelId) ?? [];
      const idx = chMsgs.findIndex(m => m.id === msg.messageId);
      if (idx !== -1) {
        chMsgs.splice(idx, 1);
        document.dispatchEvent(new CustomEvent('chat-update', { detail: { type: 'message' } }));
      }
    }
  });
}
