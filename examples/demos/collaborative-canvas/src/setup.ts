/**
 * Setup — identity creation, canvas create/join
 */
import { install as installIdentity, IdentityManager, DIDIdentityProvider } from '@living-web/identity';
import { install as installPersonalGraph, Context, Triple } from '@living-web/personal-graph';
import '@living-web/group-identity/polyfill';
import '@living-web/shape-validation/polyfill';
import '@living-web/default-sync-module/polyfill';

import type { IdentityProvider } from '@living-web/personal-graph';
import {
  CanvasShape, LayerShape, CanvasShapeShape, PathShape, CollaboratorShape, PREDICATES,
} from './graph/shapes.js';
import { setupGovernance, issueEditorZcap, type GovernanceState } from './graph/governance.js';

installIdentity();
installPersonalGraph().catch(err => console.error('[living-web] install failed', err));

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';
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
  context: Context;
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

export async function createIdentity(displayName: string): Promise<{ did: string; identity: IdentityProvider }> {
  const manager = new IdentityManager();
  const credential = await manager.createIndividual(displayName, POLYFILL_PASSPHRASE);
  if (credential.isLocked) await credential.unlock(POLYFILL_PASSPHRASE);
  const provider = new DIDIdentityProvider(credential);
  return { did: provider.getDID(), identity: provider };
}

async function registerShapes(context: Context): Promise<void> {
  await context.addShape('Canvas', JSON.stringify(CanvasShape));
  await context.addShape('Layer', JSON.stringify(LayerShape));
  await context.addShape('CanvasShape', JSON.stringify(CanvasShapeShape));
  await context.addShape('Path', JSON.stringify(PathShape));
  await context.addShape('Collaborator', JSON.stringify(CollaboratorShape));
}

export async function createCanvas(
  displayName: string, canvasName: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const store = await navigator.graph.create(canvasName);
  // Use createGroup so the canvas gets a stable did:graph — sync requires it.
  const canvasGroup = await store.createGroup({ displayName: canvasName });
  const context = canvasGroup.context;
  await context.publish();
  await registerShapes(context);

  const canvasId = `canvas:${crypto.randomUUID()}`;
  await context.createShapeInstance('Canvas', canvasId, { name: canvasName, owner: did });

  const bgLayerId = `layer:${crypto.randomUUID()}`;
  await context.createShapeInstance('Layer', bgLayerId, { name: 'Background', order: '0', visible: 'true' });
  await context.addTriple(new Triple(canvasId, PREDICATES.HAS_LAYER, bgLayerId));

  const mainLayerId = `layer:${crypto.randomUUID()}`;
  await context.createShapeInstance('Layer', mainLayerId, { name: 'Main', order: '1', visible: 'true' });
  await context.addTriple(new Triple(canvasId, PREDICATES.HAS_LAYER, mainLayerId));

  const myColor = CURSOR_COLORS[0];
  const collabId = `collab:${crypto.randomUUID()}`;
  await context.createShapeInstance('Collaborator', collabId, { did, name: displayName, role: 'owner', color: myColor });
  await context.addTriple(new Triple(canvasId, PREDICATES.HAS_CHILD, collabId));

  const governance = setupGovernance(context, did);
  governance.lockedLayers.add(bgLayerId);

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, context, canvasId, canvasName,
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
  displayName: string, contextIri: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const store = await navigator.graph.create(displayName);
  const placeholderGroup = await store.createGroup({ displayName: 'pending-join' });
  const placeholderContext = placeholderGroup.context;
  await placeholderContext.publish();
  await registerShapes(placeholderContext);

  const bc = new BroadcastChannel(SYNC_CHANNEL);
  const myColor = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(placeholderContext, did);
      resolve({
        did, displayName, context: placeholderContext, canvasId: 'canvas:fallback', canvasName: 'Canvas',
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
      const msg = ev.data;
      if (msg.type !== 'canvas-sync-response' || msg.contextIri !== contextIri) return;
      clearTimeout(timeout);
      bc.removeEventListener('message', handler);

      const governance = setupGovernance(placeholderContext, msg.ownerDid);
      issueEditorZcap(governance, did, msg.ownerDid);
      for (const lid of (msg.lockedLayers || [])) governance.lockedLayers.add(lid);

      const state: AppState = {
        did, displayName, context: placeholderContext,
        canvasId: msg.canvasId, canvasName: msg.canvasName,
        layers: msg.layers, activeLayerId: msg.layers[msg.layers.length - 1]?.id || '',
        shapes: msg.shapes || [],
        collaborators: [...msg.collaborators],
        cursors: new Map(), governance, isOwner: false, bc, identity,
        governanceLogs: [], selectedShapeId: null,
        currentTool: 'select', currentStroke: '#000000', currentFill: 'transparent', currentStrokeWidth: 2,
        myColor,
      };

      const collabId = `collab:${crypto.randomUUID()}`;
      state.collaborators.push({ id: collabId, did, name: displayName, role: 'editor', color: myColor });
      bc.postMessage({
        type: 'canvas-new-collab',
        contextIri,
        collab: state.collaborators[state.collaborators.length - 1],
      });

      setupCrossTabSync(state);
      resolve(state);
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'canvas-sync-request', contextIri, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, context } = state;
  const contextIri = context.iri;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'canvas-sync-request' && msg.contextIri === contextIri && state.isOwner) {
      bc.postMessage({
        type: 'canvas-sync-response',
        contextIri, ownerDid: state.did,
        canvasId: state.canvasId, canvasName: state.canvasName,
        layers: state.layers, shapes: state.shapes,
        collaborators: state.collaborators,
        lockedLayers: Array.from(state.governance.lockedLayers),
      });
    }

    if (msg.type === 'canvas-new-collab' && msg.contextIri === contextIri) {
      if (!state.collaborators.find(c => c.did === msg.collab.did)) {
        state.collaborators.push(msg.collab);
        if (state.isOwner) issueEditorZcap(state.governance, msg.collab.did, state.did);
        document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'collaborator' } }));
      }
    }

    if (msg.type === 'canvas-shape-add' && msg.contextIri === contextIri && msg.shape.author !== state.did) {
      state.shapes.push(msg.shape);
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'shape' } }));
    }

    if (msg.type === 'canvas-shape-move' && msg.contextIri === contextIri && msg.did !== state.did) {
      const s = state.shapes.find(s => s.id === msg.shapeId);
      if (s) { s.x = msg.x; s.y = msg.y; }
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'shape' } }));
    }

    if (msg.type === 'canvas-shape-delete' && msg.contextIri === contextIri && msg.did !== state.did) {
      const idx = state.shapes.findIndex(s => s.id === msg.shapeId);
      if (idx !== -1) state.shapes.splice(idx, 1);
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'shape' } }));
    }

    if (msg.type === 'canvas-cursor' && msg.contextIri === contextIri && msg.cursor.did !== state.did) {
      state.cursors.set(msg.cursor.did, msg.cursor);
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'cursor' } }));
    }

    if (msg.type === 'canvas-stroke-progress' && msg.contextIri === contextIri && msg.did !== state.did) {
      document.dispatchEvent(new CustomEvent('canvas-stroke', { detail: msg }));
    }

    if (msg.type === 'canvas-layer-add' && msg.contextIri === contextIri) {
      if (!state.layers.find(l => l.id === msg.layer.id)) {
        state.layers.push(msg.layer);
        document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'layer' } }));
      }
    }

    if (msg.type === 'canvas-layer-toggle' && msg.contextIri === contextIri) {
      const l = state.layers.find(l => l.id === msg.layerId);
      if (l) l.visible = msg.visible;
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'layer' } }));
    }

    if (msg.type === 'canvas-layer-lock' && msg.contextIri === contextIri) {
      const l = state.layers.find(l => l.id === msg.layerId);
      if (l) {
        l.locked = msg.locked;
        if (msg.locked) state.governance.lockedLayers.add(msg.layerId);
        else state.governance.lockedLayers.delete(msg.layerId);
      }
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'layer' } }));
    }

    if (msg.type === 'canvas-promote' && msg.contextIri === contextIri && msg.targetDid === state.did) {
      const me = state.collaborators.find(c => c.did === state.did);
      if (me) me.role = 'editor';
      document.dispatchEvent(new CustomEvent('canvas-update', { detail: { type: 'collaborator' } }));
    }
  });
}
