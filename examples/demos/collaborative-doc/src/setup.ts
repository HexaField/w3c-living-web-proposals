/**
 * Collaborative Document — Setup
 */
import { install as installIdentity } from '@living-web/identity';
import { SharedGraph, SharedGraphManager } from '@living-web/graph-sync';
import { installShapeExtension } from '@living-web/shape-validation';
import { PersonalGraph, SemanticTriple } from '@living-web/personal-graph';
import type { IdentityProvider } from '@living-web/personal-graph';
import {
  PREDICATES,
  DocumentShape, BlockShape, CommentShape, CommentReplyShape, CollaboratorShape,
} from './graph/shapes.js';
import {
  setupGovernance, issueRoleZcap,
  type GovernanceState, type DocRole,
} from './graph/governance.js';

installIdentity();
installShapeExtension(PersonalGraph);

const shapeMethods = ['addShape', 'getShapes', 'createShapeInstance', 'getShapeInstances', 'getShapeInstanceData', 'setShapeProperty', 'addToShapeCollection', 'removeFromShapeCollection'];
for (const method of shapeMethods) {
  if ((PersonalGraph.prototype as any)[method]) {
    (SharedGraph.prototype as any)[method] = (PersonalGraph.prototype as any)[method];
  }
}
if (!Object.getOwnPropertyDescriptor(SharedGraph.prototype, 'uuid')) {
  Object.defineProperty(SharedGraph.prototype, 'uuid', { get() { return (this as any).uri; } });
}

const SYNC_CHANNEL = 'living-web-collab-doc';
const CURSOR_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#e91e63', '#00bcd4', '#ff5722'];

export interface Block {
  id: string;
  type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bullet_list' | 'numbered_list' | 'code' | 'quote' | 'divider';
  content: string;
  authorDid: string;
  locked: boolean;
  lockedBy: string | null;
}

export interface Comment {
  id: string;
  body: string;
  authorDid: string;
  authorName: string;
  blockId: string;
  time: number;
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  body: string;
  authorDid: string;
  authorName: string;
  time: number;
}

export interface Collaborator {
  id: string;
  did: string;
  name: string;
  role: DocRole;
  color: string;
}

export interface CursorInfo {
  did: string;
  name: string;
  color: string;
  blockId: string;
}

export interface AppState {
  did: string;
  displayName: string;
  graph: SharedGraph;
  docId: string;
  docTitle: string;
  blocks: Block[];
  comments: Comment[];
  collaborators: Collaborator[];
  governance: GovernanceState;
  isOwner: boolean;
  myRole: DocRole;
  bc: BroadcastChannel;
  identity: IdentityProvider;
  governanceLogs: { text: string; accepted: boolean; time: number }[];
  activeBlockId: string | null;
  remoteCursors: Map<string, CursorInfo>;
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

function nextColor(index: number): string {
  return CURSOR_COLORS[index % CURSOR_COLORS.length];
}

export async function createDoc(
  displayName: string, docTitle: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.share(docTitle);
  const g = graph as any;

  await g.addShape('Document', JSON.stringify(DocumentShape));
  await g.addShape('Block', JSON.stringify(BlockShape));
  await g.addShape('Comment', JSON.stringify(CommentShape));
  await g.addShape('CommentReply', JSON.stringify(CommentReplyShape));
  await g.addShape('Collaborator', JSON.stringify(CollaboratorShape));

  const docId = `doc:${crypto.randomUUID()}`;
  await g.createShapeInstance('Document', docId, { title: docTitle, owner: did });

  // First paragraph block
  const blockId = `block:${crypto.randomUUID()}`;
  await g.createShapeInstance('Block', blockId, { type: 'paragraph', content: ' ', author: did });
  await graph.addTriple(new SemanticTriple(docId, blockId, PREDICATES.HAS_BLOCK));

  // Owner collaborator
  const collabId = `collab:${crypto.randomUUID()}`;
  const color = nextColor(0);
  await g.createShapeInstance('Collaborator', collabId, { did, name: displayName, role: 'owner', color });
  await graph.addTriple(new SemanticTriple(docId, collabId, PREDICATES.HAS_COLLABORATOR));

  const governance = setupGovernance(graph, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, graph, docId, docTitle,
    blocks: [{ id: blockId, type: 'paragraph', content: '', authorDid: did, locked: false, lockedBy: null }],
    comments: [],
    collaborators: [{ id: collabId, did, name: displayName, role: 'owner', color }],
    governance, isOwner: true, myRole: 'owner', bc, identity,
    governanceLogs: [], activeBlockId: blockId,
    remoteCursors: new Map(),
  };

  setupCrossTabSync(state);
  return state;
}

export async function joinDoc(
  displayName: string, graphUri: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.join(graphUri);
  const g = graph as any;

  await g.addShape('Document', JSON.stringify(DocumentShape));
  await g.addShape('Block', JSON.stringify(BlockShape));
  await g.addShape('Comment', JSON.stringify(CommentShape));
  await g.addShape('CommentReply', JSON.stringify(CommentReplyShape));
  await g.addShape('Collaborator', JSON.stringify(CollaboratorShape));

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(graph, did);
      resolve({
        did, displayName, graph,
        docId: 'doc:fallback', docTitle: 'Document',
        blocks: [{ id: `block:${crypto.randomUUID()}`, type: 'paragraph', content: '', authorDid: did, locked: false, lockedBy: null }],
        comments: [], collaborators: [{ id: `collab:${crypto.randomUUID()}`, did, name: displayName, role: 'viewer', color: nextColor(0) }],
        governance, isOwner: false, myRole: 'viewer', bc, identity,
        governanceLogs: [], activeBlockId: null, remoteCursors: new Map(),
      });
    }, 1500);

    const handler = (ev: MessageEvent) => {
      if (ev.data.type === 'doc-sync-response' && ev.data.graphUri === graphUri) {
        clearTimeout(timeout);
        bc.removeEventListener('message', handler);
        const data = ev.data;

        const governance = setupGovernance(graph, data.ownerDid);
        // Default role: viewer (owner can promote)
        const myRole: DocRole = 'viewer';
        const color = nextColor(data.collaborators.length);

        const state: AppState = {
          did, displayName, graph,
          docId: data.docId, docTitle: data.docTitle,
          blocks: data.blocks,
          comments: data.comments || [],
          collaborators: [...data.collaborators],
          governance, isOwner: false, myRole, bc, identity,
          governanceLogs: [], activeBlockId: null, remoteCursors: new Map(),
        };

        const collabId = `collab:${crypto.randomUUID()}`;
        state.collaborators.push({ id: collabId, did, name: displayName, role: myRole, color });

        bc.postMessage({
          type: 'doc-new-collaborator',
          graphUri: graph.uri,
          collaborator: { id: collabId, did, name: displayName, role: myRole, color },
        });

        setupCrossTabSync(state);
        resolve(state);
      }
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'doc-sync-request', graphUri, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, graph } = state;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'doc-sync-request' && msg.graphUri === graph.uri && state.isOwner) {
      bc.postMessage({
        type: 'doc-sync-response',
        graphUri: graph.uri,
        ownerDid: state.did,
        docId: state.docId,
        docTitle: state.docTitle,
        blocks: state.blocks,
        comments: state.comments,
        collaborators: state.collaborators,
      });
    }

    if (msg.type === 'doc-block-update' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const block = state.blocks.find(b => b.id === msg.blockId);
      if (block) {
        block.content = msg.content;
        if (msg.blockType) block.type = msg.blockType;
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'block', blockId: msg.blockId } }));
      }
    }

    if (msg.type === 'doc-new-block' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const idx = state.blocks.findIndex(b => b.id === msg.afterBlockId);
      const block: Block = msg.block;
      if (idx >= 0) {
        state.blocks.splice(idx + 1, 0, block);
      } else {
        state.blocks.push(block);
      }
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'new-block' } }));
    }

    if (msg.type === 'doc-delete-block' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const idx = state.blocks.findIndex(b => b.id === msg.blockId);
      if (idx >= 0 && state.blocks.length > 1) {
        state.blocks.splice(idx, 1);
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'delete-block' } }));
      }
    }

    if (msg.type === 'doc-new-collaborator' && msg.graphUri === graph.uri) {
      if (!state.collaborators.find(c => c.did === msg.collaborator.did)) {
        state.collaborators.push(msg.collaborator);
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'collaborator' } }));
      }
    }

    if (msg.type === 'doc-role-change' && msg.graphUri === graph.uri) {
      const collab = state.collaborators.find(c => c.did === msg.targetDid);
      if (collab) {
        collab.role = msg.newRole;
        if (msg.targetDid === state.did) {
          state.myRole = msg.newRole;
          // Update ZCAP
          issueRoleZcap(state.governance, state.did, msg.newRole, msg.ownerDid);
        }
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'role-change' } }));
      }
    }

    if (msg.type === 'doc-cursor' && msg.graphUri === graph.uri && msg.did !== state.did) {
      state.remoteCursors.set(msg.did, {
        did: msg.did, name: msg.name, color: msg.color, blockId: msg.blockId,
      });
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'cursor' } }));
    }

    if (msg.type === 'doc-new-comment' && msg.graphUri === graph.uri && msg.did !== state.did) {
      state.comments.push(msg.comment);
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'comment' } }));
    }

    if (msg.type === 'doc-new-reply' && msg.graphUri === graph.uri && msg.did !== state.did) {
      const comment = state.comments.find(c => c.id === msg.commentId);
      if (comment) {
        comment.replies.push(msg.reply);
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'comment' } }));
      }
    }

    if (msg.type === 'doc-resolve-comment' && msg.graphUri === graph.uri) {
      const comment = state.comments.find(c => c.id === msg.commentId);
      if (comment) {
        comment.resolved = true;
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'comment' } }));
      }
    }

    if (msg.type === 'doc-title-change' && msg.graphUri === graph.uri && msg.did !== state.did) {
      state.docTitle = msg.title;
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'title' } }));
    }
  });

  // Broadcast cursor position periodically
  setInterval(() => {
    if (state.activeBlockId) {
      const myCollab = state.collaborators.find(c => c.did === state.did);
      bc.postMessage({
        type: 'doc-cursor',
        graphUri: graph.uri,
        did: state.did,
        name: state.displayName,
        color: myCollab?.color || '#5865f2',
        blockId: state.activeBlockId,
      });
    }
  }, 500);
}

export function broadcastBlockUpdate(state: AppState, blockId: string, content: string, blockType?: string): void {
  state.bc.postMessage({
    type: 'doc-block-update',
    graphUri: state.graph.uri,
    did: state.did,
    blockId, content, blockType,
  });
}

export function broadcastNewBlock(state: AppState, afterBlockId: string, block: Block): void {
  state.bc.postMessage({
    type: 'doc-new-block',
    graphUri: state.graph.uri,
    did: state.did,
    afterBlockId, block,
  });
}

export function broadcastDeleteBlock(state: AppState, blockId: string): void {
  state.bc.postMessage({
    type: 'doc-delete-block',
    graphUri: state.graph.uri,
    did: state.did,
    blockId,
  });
}

export function promoteCollaborator(state: AppState, targetDid: string, newRole: DocRole): void {
  const collab = state.collaborators.find(c => c.did === targetDid);
  if (collab) {
    collab.role = newRole;
    issueRoleZcap(state.governance, targetDid, newRole, state.did);
    state.bc.postMessage({
      type: 'doc-role-change',
      graphUri: state.graph.uri,
      targetDid, newRole, ownerDid: state.did,
    });
    document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'role-change' } }));
  }
}
