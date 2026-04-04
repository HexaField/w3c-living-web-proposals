/**
 * Setup — identity creation, canvas create/join
 */
import { install as installIdentity } from '@living-web/identity';
import { SharedGraph, SharedGraphManager } from '@living-web/graph-sync';
import { installShapeExtension } from '@living-web/shape-validation';
import { PersonalGraph, SemanticTriple } from '@living-web/personal-graph';
import type { IdentityProvider } from '@living-web/personal-graph';
import {
  CanvasShape, LayerShape, CanvasShapeShape, PathShape, CollaboratorShape, PREDICATES,
} from './graph/shapes.js';
import { setupGovernance, issueEditorZcap, type GovernanceState } from './graph/governance.js';

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

const SYNC_CHANNEL = 'living-web-canvas';

const CURSOR_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63'];

export interface CanvasShapeData {
  id: string;
  layerId: string;
  type: 'rect' | 'circle' | 'line' | 'path' | 'text';
  x: number; y: number;
  width?: number; height?: number;
  radius?: number;
  x2?: number; y2?: number;
  fill: string; stroke: string; strokeWidth: number;
  text?: string; fontSize?: number;
  pathData?: string;
  author: string;
}

export interface LayerData {
  id: string;
  name: string;
  order: number;
  visible: boolean;
  locked: boolean;
}

export interface CollaboratorData {
  id: string;
  did: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  color: string;
}

export interface CursorData {
  did: string;
  name: string;
  color: string;
  x: number;
  y: number;
  tool: string;
}

export interface AppState {
  did: string;
  displayName: string;
  graph: SharedGraph;
  canvasId: string;
  canvasName: string;
  layers: LayerData[];
  activeLayerId: string;
  shapes: CanvasShapeData[];
  collaborators: CollaboratorData[];
  cursors: Map<string, CursorData>;
  governance: GovernanceState;
  isOwner: boolean;
  bc: BroadcastChannel;
  identity: IdentityProvider;
  governanceLogs: { text: string; accepted: boolean; time: number }[];
  selectedShapeId: string | null;
  currentTool: string;
  currentStroke: string;
  currentFill: string;
  currentStrokeWidth: number;
  myColor: string;
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
  await g.addShape('Canvas', JSON.stringify(CanvasShape));
  await g.addShape('Layer', JSON.stringify(LayerShape));
  await g.addShape('CanvasShape', JSON.stringify(CanvasShapeShape));
  await g.addShape('Path', JSON.stringify(PathShape));
  await g.addShape('Collaborator', JSON.stringify(CollaboratorShape));
}

export async function createCanvas(
  displayName: string, canvasName: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.share(canvasName);
  const g = graph as any;
  await registerShapes(g);

  const canvasId = `canvas:${crypto.randomUUID()}`;
  await g.createShapeInstance('Canvas', canvasId, { name: canvasName, owner: did });

  // Create layers
  const bgLayerId = `layer:${crypto.randomUUID()}`;
  await g.createShapeInstance('Layer', bgLayerId, { name: 'Background', order: '0', visible: 'true' });
  await graph.addTriple(new SemanticTriple(canvasId, bgLayerId, PREDICATES.HAS_LAYER));

  const mainLayerId = `layer:${crypto.randomUUID()}`;
  await g.createShapeInstance('Layer', mainLayerId, { name: 'Main', order: '1', visible: 'true' });
  await graph.addTriple(new SemanticTriple(canvasId, mainLayerId, PREDICATES.HAS_LAYER));

  // Create collaborator
  const myColor = CURSOR_COLORS[0];
  const collabId = `collab:${crypto.randomUUID()}`;
  await g.createShapeInstance('Collaborator', collabId, { did, name: displayName, role: 'owner', color: myColor });
  await graph.addTriple(new SemanticTriple(canvasId, collabId, PREDICATES.HAS_CHILD));

  const governance = setupGovernance(graph, did);
  governance.lockedLayers.add(bgLayerId);

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, graph, canvasId, canvasName,
    layers: [
      { id: bgLayerId, name: 'Background', order: 0, visible: true, locked: true },
      { id: mainLayerId, name: 'Main', order: 1, visible: true, locked: false },
    ],
    activeLayerId: mainLayerId,
    shapes: [],
    collaborators: [{ id: collabId, did, name: displayName, role: 'owner', color: myColor }],
    cursors: new Map(),
    governance, isOwner: true, bc, identity,
    governanceLogs: [],
    selectedShapeId: null,
    currentTool: 'select',
    currentStroke: '#000000',
    currentFill: 'transparent',
    currentStrokeWidth: 2,
    myColor,
  };

  setupCrossTabSync(state);
  return state;
}

export async function joinCanvas(
  displayName: string, graphUri: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.join(graphUri);
  await registerShapes(graph as any);

  const bc = new BroadcastChannel(SYNC_CHANNEL);
  const myColor = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(graph, did);
      resolve({
        did, displayName, graph, canvasId: 'canvas:fallback', canvasName: 'Canvas',
        layers: [{ id: 'layer:main', name: 'Main', order: 0, visible: true, locked: false }],
        activeLayerId: 'layer:main', shapes: [],
        collaborators: [{ id: `collab:${crypto.randomUUID()}`, did, name: displayName, role: 'viewer', color: myColor }],
        cursors: new Map(), governance, isOwner: false, bc, identity,
        governanceLogs: [], selectedShapeId: null,
        currentTool: 'select', currentStroke: '#000000', currentFill: 'transparent', currentStrokeWidth: 2,
        myColor,
      });
    }, 1000);

    const handler = (ev: MessageEvent) => {
      if (ev.data.type === 'canvas-sync-response' && ev.data.graphUri === graphUri) {
        clearTimeout(timeout);
        bc.removeEventListener('message', handler);
        const data = ev.data;
        const governance = setupGovernance(graph, data.ownerDid);
        issueEditorZcap(governance, did, data.ownerDid);
        for (const lid of (data.lockedLayers || [])) governance.lockedLayers.add(lid);

        const state: AppState = {
          did, displayName, graph,
          canvasId: data.canvasId, canvasName: data.canvasName,
          layers: data.layers, activeLayerId: data.layers[data.layers.length - 1]?.id || '',
          shapes: data.shapes || [],
          collaborators: [...data.collaborators],
          cursors: new Map(), governance, isOwner: false, bc, identity,
          governanceLogs: [], selectedShapeId: null,
          currentTool: 'select', currentStroke: '#000000', currentFill: 'transparent', currentStrokeWidth: 2,
          myColor,
        };

        const collabId = `collab:${crypto.randomUUID()}`;
        state.collaborators.push({ id: collabId, did, name: displayName, role: 'editor', color: myColor });
        bc.postMessage({ type: 'canvas-new-collab', graphUri: graph.uri, collab: state.collaborators[state.collaborators.length - 1] });

        setupCrossTabSync(state);
        resolve(state);
      }
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'canvas-sync-request', graphUri, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, graph } = state;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'canvas-sync-request' && msg.graphUri === graph.uri && state.isOwner) {
      bc.postMessage({
        type: 'canvas-sync-response',
        graphUri: graph.uri, ownerDid: state.did,
        canvasId: state.canvasId, canvasName: state.canvasName,
        layers: state.layers, shapes: state.shapes,
        collaborators: state.collaborators,
        lockedLayers: Array.from(state.governance.lockedLayers),
      });
    }

    if (msg.type === 'canvas-new-collab' && msg.graphUri === graph.uri) {
      if (!state.collaborators.find(c => c.did === msg.collab.did)) {
        state.collaborators.push(msg.collab);
        if (state.isOwner) issueEditorZcap(state.governance, msg.collab.did, state.did);
        document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'collaborator' } }));
      }
    }

    if (msg.type === 'canvas-shape-add' && msg.graphUri === graph.uri && msg.shape.author !== state.did) {
      state.shapes.push(msg.shape);
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'shape' } }));
    }

    if (msg.type === 'canvas-shape-move' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const s = state.shapes.find(s => s.id === msg.shapeId);
      if (s) { s.x = msg.x; s.y = msg.y; }
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'shape' } }));
    }

    if (msg.type === 'canvas-shape-delete' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const idx = state.shapes.findIndex(s => s.id === msg.shapeId);
      if (idx !== -1) state.shapes.splice(idx, 1);
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'shape' } }));
    }

    if (msg.type === 'canvas-cursor' && msg.graphUri === graph.uri && msg.cursor.did !== state.did) {
      state.cursors.set(msg.cursor.did, msg.cursor);
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'cursor' } }));
    }

    if (msg.type === 'canvas-stroke-progress' && msg.graphUri === graph.uri && msg.did !== state.did) {
      document.dispatchEvent(new CustomEvent('canvas-stroke', { detail: msg }));
    }

    if (msg.type === 'canvas-layer-add' && msg.graphUri === graph.uri) {
      if (!state.layers.find(l => l.id === msg.layer.id)) {
        state.layers.push(msg.layer);
        document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'layer' } }));
      }
    }

    if (msg.type === 'canvas-layer-toggle' && msg.graphUri === graph.uri) {
      const l = state.layers.find(l => l.id === msg.layerId);
      if (l) l.visible = msg.visible;
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'layer' } }));
    }

    if (msg.type === 'canvas-layer-lock' && msg.graphUri === graph.uri) {
      const l = state.layers.find(l => l.id === msg.layerId);
      if (l) {
        l.locked = msg.locked;
        if (msg.locked) state.governance.lockedLayers.add(msg.layerId);
        else state.governance.lockedLayers.delete(msg.layerId);
      }
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'layer' } }));
    }

    if (msg.type === 'canvas-promote' && msg.graphUri === graph.uri && msg.targetDid === state.did) {
      // We got promoted to editor
      const me = state.collaborators.find(c => c.did === state.did);
      if (me) me.role = 'editor';
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'collaborator' } }));
    }
  });
}
