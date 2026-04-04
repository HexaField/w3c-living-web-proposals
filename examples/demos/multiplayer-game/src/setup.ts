/**
 * Setup — identity, world create/join, cross-tab sync
 */
import { install as installIdentity } from '@living-web/identity';
import { SharedGraph, SharedGraphManager } from '@living-web/graph-sync';
import { installShapeExtension } from '@living-web/shape-validation';
import { PersonalGraph, SemanticTriple } from '@living-web/personal-graph';
import type { IdentityProvider } from '@living-web/personal-graph';
import {
  WorldShape, PlayerShape, GameObjectShape, CollectibleShape, ChatMessageShape, PREDICATES,
} from './graph/shapes.js';
import { setupGovernance, issuePlayerZcap, type GovernanceState } from './graph/governance.js';

installIdentity();
installShapeExtension(PersonalGraph);

const shapeMethods = ['addShape', 'getShapes', 'createShapeInstance', 'getShapeInstances', 'getShapeInstanceData', 'setShapeProperty'];
for (const method of shapeMethods) {
  if ((PersonalGraph.prototype as any)[method]) {
    (SharedGraph.prototype as any)[method] = (PersonalGraph.prototype as any)[method];
  }
}
if (!Object.getOwnPropertyDescriptor(SharedGraph.prototype, 'uuid')) {
  Object.defineProperty(SharedGraph.prototype, 'uuid', { get() { return (this as any).uri; } });
}

const SYNC_CHANNEL = 'living-web-game';
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63'];

export interface GameObjectData {
  id: string;
  type: string;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  color: string;
}

export interface CollectibleData {
  id: string;
  type: string;
  x: number; y: number; z: number;
  value: number;
  color: string;
  collectedBy: string | null;
}

export interface PlayerData {
  id: string;
  did: string;
  name: string;
  color: string;
  x: number; y: number; z: number;
  rotation: number;
  score: number;
}

export interface ChatMsg {
  id: string;
  body: string;
  authorDid: string;
  authorName: string;
  time: number;
}

export interface AppState {
  did: string;
  displayName: string;
  graph: SharedGraph;
  worldId: string;
  worldName: string;
  myPlayer: PlayerData;
  players: Map<string, PlayerData>;
  objects: GameObjectData[];
  collectibles: CollectibleData[];
  chatMessages: ChatMsg[];
  governance: GovernanceState;
  isOwner: boolean;
  bc: BroadcastChannel;
  identity: IdentityProvider;
  governanceLogs: { text: string; accepted: boolean; time: number }[];
}

class CredentialIdentity implements IdentityProvider {
  private cred: any;
  constructor(cred: any) { this.cred = cred; }
  getDID(): string { return this.cred.did; }
  getKeyURI(): string { return `${this.cred.did}#key-1`; }
  async sign(data: Uint8Array): Promise<Uint8Array> { return this.cred.signRaw(data); }
  getPublicKey(): Uint8Array { return this.cred.publicKey; }
}

export async function createIdentity(displayName: string): Promise<{ did: string; identity: IdentityProvider }> {
  const cred = await (navigator.credentials as any).create({ did: { displayName } });
  if (cred.isLocked) await cred.unlock('__living-web-polyfill__');
  return { did: cred.did, identity: new CredentialIdentity(cred) };
}

async function registerShapes(g: any): Promise<void> {
  await g.addShape('World', JSON.stringify(WorldShape));
  await g.addShape('Player', JSON.stringify(PlayerShape));
  await g.addShape('GameObject', JSON.stringify(GameObjectShape));
  await g.addShape('Collectible', JSON.stringify(CollectibleShape));
  await g.addShape('ChatMessage', JSON.stringify(ChatMessageShape));
}

function generateWorldObjects(): GameObjectData[] {
  return [
    // Walls
    { id: `obj:${crypto.randomUUID()}`, type: 'wall', x: -25, y: 2.5, z: 0, width: 1, height: 5, depth: 50, color: '#7f8c8d' },
    { id: `obj:${crypto.randomUUID()}`, type: 'wall', x: 25, y: 2.5, z: 0, width: 1, height: 5, depth: 50, color: '#7f8c8d' },
    { id: `obj:${crypto.randomUUID()}`, type: 'wall', x: 0, y: 2.5, z: -25, width: 50, height: 5, depth: 1, color: '#7f8c8d' },
    { id: `obj:${crypto.randomUUID()}`, type: 'wall', x: 0, y: 2.5, z: 25, width: 50, height: 5, depth: 1, color: '#7f8c8d' },
    // Platforms
    { id: `obj:${crypto.randomUUID()}`, type: 'platform', x: -10, y: 1.5, z: -10, width: 6, height: 3, depth: 6, color: '#e67e22' },
    { id: `obj:${crypto.randomUUID()}`, type: 'platform', x: 10, y: 1, z: 10, width: 4, height: 2, depth: 4, color: '#2ecc71' },
    { id: `obj:${crypto.randomUUID()}`, type: 'platform', x: 8, y: 2, z: -8, width: 5, height: 4, depth: 5, color: '#3498db' },
    // Obstacles
    { id: `obj:${crypto.randomUUID()}`, type: 'wall', x: -5, y: 1, z: 5, width: 2, height: 2, depth: 2, color: '#e74c3c' },
    { id: `obj:${crypto.randomUUID()}`, type: 'wall', x: 5, y: 1.5, z: -3, width: 3, height: 3, depth: 1, color: '#9b59b6' },
  ];
}

function generateCollectibles(): CollectibleData[] {
  const items: CollectibleData[] = [];
  const positions = [
    { x: 5, z: 5 }, { x: -5, z: -5 }, { x: 10, z: -10 }, { x: -10, z: 10 },
    { x: 0, z: 15 }, { x: 15, z: 0 }, { x: -15, z: 0 }, { x: 0, z: -15 },
    { x: -10, z: -10, y: 3.5 }, { x: 10, z: 10, y: 2.5 }, { x: 8, z: -8, y: 4.5 },
  ];
  for (const pos of positions) {
    const isGem = Math.random() > 0.6;
    items.push({
      id: `coll:${crypto.randomUUID()}`,
      type: isGem ? 'gem' : 'coin',
      x: pos.x, y: pos.y ?? 1, z: pos.z,
      value: isGem ? 50 : 10,
      color: isGem ? '#e91e63' : '#f1c40f',
      collectedBy: null,
    });
  }
  return items;
}

export async function createWorld(
  displayName: string, worldName: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.share(worldName);
  await registerShapes(graph as any);

  const worldId = `world:${crypto.randomUUID()}`;
  await (graph as any).createShapeInstance('World', worldId, { name: worldName, owner: did });

  const myColor = PLAYER_COLORS[0];
  const myPlayer: PlayerData = {
    id: `player:${crypto.randomUUID()}`, did, name: displayName, color: myColor,
    x: 0, y: 1, z: 0, rotation: 0, score: 0,
  };

  const objects = generateWorldObjects();
  const collectibles = generateCollectibles();
  const governance = setupGovernance(graph, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, graph, worldId, worldName,
    myPlayer, players: new Map([[did, myPlayer]]),
    objects, collectibles, chatMessages: [],
    governance, isOwner: true, bc, identity,
    governanceLogs: [],
  };

  setupCrossTabSync(state);
  return state;
}

export async function joinWorld(
  displayName: string, graphUri: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.join(graphUri);
  await registerShapes(graph as any);

  const bc = new BroadcastChannel(SYNC_CHANNEL);
  const myColor = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(graph, did);
      const myPlayer: PlayerData = { id: `player:${crypto.randomUUID()}`, did, name: displayName, color: myColor, x: 0, y: 1, z: 0, rotation: 0, score: 0 };
      resolve({
        did, displayName, graph, worldId: 'world:fallback', worldName: 'World',
        myPlayer, players: new Map([[did, myPlayer]]),
        objects: generateWorldObjects(), collectibles: generateCollectibles(),
        chatMessages: [], governance, isOwner: false, bc, identity, governanceLogs: [],
      });
    }, 1000);

    const handler = (ev: MessageEvent) => {
      if (ev.data.type === 'game-sync-response' && ev.data.graphUri === graphUri) {
        clearTimeout(timeout);
        bc.removeEventListener('message', handler);
        const data = ev.data;
        const governance = setupGovernance(graph, data.ownerDid);
        issuePlayerZcap(governance, did, data.ownerDid);
        for (const cid of (data.collectedItems || [])) governance.collectedItems.add(cid);

        const myPlayer: PlayerData = {
          id: `player:${crypto.randomUUID()}`, did, name: displayName, color: myColor,
          x: 0, y: 1, z: 0, rotation: 0, score: 0,
        };

        const players = new Map<string, PlayerData>();
        for (const p of (data.players || [])) players.set(p.did, p);
        players.set(did, myPlayer);

        const state: AppState = {
          did, displayName, graph,
          worldId: data.worldId, worldName: data.worldName,
          myPlayer, players,
          objects: data.objects || generateWorldObjects(),
          collectibles: data.collectibles || [],
          chatMessages: data.chatMessages || [],
          governance, isOwner: false, bc, identity, governanceLogs: [],
        };

        bc.postMessage({ type: 'game-player-joined', graphUri: graph.uri, player: myPlayer });
        setupCrossTabSync(state);
        resolve(state);
      }
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'game-sync-request', graphUri, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, graph } = state;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'game-sync-request' && msg.graphUri === graph.uri && state.isOwner) {
      bc.postMessage({
        type: 'game-sync-response', graphUri: graph.uri, ownerDid: state.did,
        worldId: state.worldId, worldName: state.worldName,
        players: Array.from(state.players.values()),
        objects: state.objects, collectibles: state.collectibles,
        chatMessages: state.chatMessages,
        collectedItems: Array.from(state.governance.collectedItems),
      });
    }

    if (msg.type === 'game-player-joined' && msg.graphUri === graph.uri) {
      if (!state.players.has(msg.player.did)) {
        state.players.set(msg.player.did, msg.player);
        if (state.isOwner) issuePlayerZcap(state.governance, msg.player.did, state.did);
        state.chatMessages.push({ id: crypto.randomUUID(), body: `${msg.player.name} joined the world`, authorDid: 'system', authorName: 'System', time: Date.now() });
        document.dispatchEvent(new CustomEvent('game-update', { detail: { type: 'player' } }));
      }
    }

    if (msg.type === 'game-position' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const p = state.players.get(msg.did);
      if (p) {
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.rotation = msg.rotation;
      }
      document.dispatchEvent(new CustomEvent('game-update', { detail: { type: 'position' } }));
    }

    if (msg.type === 'game-collect' && msg.graphUri === graph.uri) {
      const c = state.collectibles.find(c => c.id === msg.collectibleId);
      if (c && !c.collectedBy) {
        c.collectedBy = msg.did;
        state.governance.collectedItems.add(msg.collectibleId);
        const p = state.players.get(msg.did);
        if (p) p.score += c.value;
        state.chatMessages.push({
          id: crypto.randomUUID(),
          body: `⭐ ${msg.playerName} collected a ${c.type}! (+${c.value})`,
          authorDid: 'system', authorName: 'System', time: Date.now(),
        });
        document.dispatchEvent(new CustomEvent('game-update', { detail: { type: 'collect' } }));
      }
    }

    if (msg.type === 'game-chat' && msg.graphUri === graph.uri && msg.msg.authorDid !== state.did) {
      state.chatMessages.push(msg.msg);
      document.dispatchEvent(new CustomEvent('game-update', { detail: { type: 'chat' } }));
    }
  });
}
