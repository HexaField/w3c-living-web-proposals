/**
 * Collaborative Document — Setup
 */
import { install as installIdentity, IdentityManager, DIDIdentityProvider } from '@living-web/identity';
import { install as installPersonalGraph, Context, Triple } from '@living-web/personal-graph';
import '@living-web/group-identity/polyfill';
import '@living-web/shape-validation/polyfill';
import '@living-web/default-sync-module/polyfill';
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
installPersonalGraph().catch(err => console.error('[living-web] install failed', err));

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';
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
  context: Context;
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

export async function createIdentity(displayName: string): Promise<{ did: string; identity: IdentityProvider }> {
  const manager = new IdentityManager();
  const credential = await manager.createIndividual(displayName, POLYFILL_PASSPHRASE);
  if (credential.isLocked) await credential.unlock(POLYFILL_PASSPHRASE);
  const provider = new DIDIdentityProvider(credential);
  return { did: provider.getDID(), identity: provider };
}

function nextColor(index: number): string {
  return CURSOR_COLORS[index % CURSOR_COLORS.length];
}

async function ensureShapes(context: Context): Promise<void> {
  await context.addShape('Document', JSON.stringify(DocumentShape));
  await context.addShape('Block', JSON.stringify(BlockShape));
  await context.addShape('Comment', JSON.stringify(CommentShape));
  await context.addShape('CommentReply', JSON.stringify(CommentReplyShape));
  await context.addShape('Collaborator', JSON.stringify(CollaboratorShape));
}

export async function createDoc(
  displayName: string, docTitle: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const store = await navigator.graph.create(docTitle);
  const context = await store.createContext({ displayName: docTitle });
  await context.publish();

  await ensureShapes(context);

  const docId = `doc:${crypto.randomUUID()}`;
  await context.createShapeInstance('Document', docId, { title: docTitle, owner: did });

  const blockId = `block:${crypto.randomUUID()}`;
  await context.createShapeInstance('Block', blockId, { type: 'paragraph', content: ' ', author: did });
  await context.addTriple(new Triple(docId, PREDICATES.HAS_BLOCK, blockId));

  const collabId = `collab:${crypto.randomUUID()}`;
  const color = nextColor(0);
  await context.createShapeInstance('Collaborator', collabId, { did, name: displayName, role: 'owner', color });
  await context.addTriple(new Triple(docId, PREDICATES.HAS_COLLABORATOR, collabId));

  const governance = setupGovernance(context, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const state: AppState = {
    did, displayName, context, docId, docTitle,
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
  displayName: string, contextDid: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  // Cross-tab join: a sibling tab on the same origin will reply via BroadcastChannel
  // with the document state. We create a local placeholder context that mirrors the
  // received state for display purposes.
  const store = await navigator.graph.create(displayName);
  const placeholderContext = await store.createContext({ displayName: 'pending-join' });
  await placeholderContext.publish();
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const fallbackBlockId = `block:${crypto.randomUUID()}`;
      const governance = setupGovernance(placeholderContext, did);
      resolve({
        did, displayName, context: placeholderContext,
        docId: 'doc:fallback', docTitle: 'Document',
        blocks: [{ id: fallbackBlockId, type: 'paragraph', content: '', authorDid: did, locked: false, lockedBy: null }],
        comments: [],
        collaborators: [{ id: `collab:${crypto.randomUUID()}`, did, name: displayName, role: 'viewer', color: nextColor(0) }],
        governance, isOwner: false, myRole: 'viewer', bc, identity,
        governanceLogs: [], activeBlockId: null, remoteCursors: new Map(),
      });
    }, 1500);

    const handler = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.type !== 'doc-sync-response' || msg.contextDid !== contextDid) return;
      clearTimeout(timeout);
      bc.removeEventListener('message', handler);

      const governance = setupGovernance(placeholderContext, msg.ownerDid);
      const myRole: DocRole = 'viewer';
      const color = nextColor(msg.collaborators.length);

      const state: AppState = {
        did, displayName, context: placeholderContext,
        docId: msg.docId, docTitle: msg.docTitle,
        blocks: msg.blocks,
        comments: msg.comments || [],
        collaborators: [...msg.collaborators],
        governance, isOwner: false, myRole, bc, identity,
        governanceLogs: [], activeBlockId: null, remoteCursors: new Map(),
      };

      const collabId = `collab:${crypto.randomUUID()}`;
      state.collaborators.push({ id: collabId, did, name: displayName, role: myRole, color });

      bc.postMessage({
        type: 'doc-new-collaborator',
        contextDid,
        collaborator: { id: collabId, did, name: displayName, role: myRole, color },
      });

      setupCrossTabSync(state);
      resolve(state);
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'doc-sync-request', contextDid, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, context } = state;
  const contextDid = context.did;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'doc-sync-request' && msg.contextDid === contextDid && state.isOwner) {
      bc.postMessage({
        type: 'doc-sync-response',
        contextDid,
        ownerDid: state.did,
        docId: state.docId,
        docTitle: state.docTitle,
        blocks: state.blocks,
        comments: state.comments,
        collaborators: state.collaborators,
      });
    }

    if (msg.type === 'doc-block-update' && msg.contextDid === contextDid && msg.did !== state.did) {
      const block = state.blocks.find(b => b.id === msg.blockId);
      if (block) {
        block.content = msg.content;
        if (msg.blockType) block.type = msg.blockType;
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'block', blockId: msg.blockId } }));
      }
    }

    if (msg.type === 'doc-new-block' && msg.contextDid === contextDid && msg.did !== state.did) {
      const idx = state.blocks.findIndex(b => b.id === msg.afterBlockId);
      const block: Block = msg.block;
      if (idx >= 0) state.blocks.splice(idx + 1, 0, block);
      else state.blocks.push(block);
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'new-block' } }));
    }

    if (msg.type === 'doc-delete-block' && msg.contextDid === contextDid && msg.did !== state.did) {
      const idx = state.blocks.findIndex(b => b.id === msg.blockId);
      if (idx >= 0 && state.blocks.length > 1) {
        state.blocks.splice(idx, 1);
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'delete-block' } }));
      }
    }

    if (msg.type === 'doc-new-collaborator' && msg.contextDid === contextDid) {
      if (!state.collaborators.find(c => c.did === msg.collaborator.did)) {
        state.collaborators.push(msg.collaborator);
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'collaborator' } }));
      }
    }

    if (msg.type === 'doc-role-change' && msg.contextDid === contextDid) {
      const collab = state.collaborators.find(c => c.did === msg.targetDid);
      if (collab) {
        collab.role = msg.newRole;
        if (msg.targetDid === state.did) {
          state.myRole = msg.newRole;
          issueRoleZcap(state.governance, state.did, msg.newRole, msg.ownerDid);
        }
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'role-change' } }));
      }
    }

    if (msg.type === 'doc-cursor' && msg.contextDid === contextDid && msg.did !== state.did) {
      state.remoteCursors.set(msg.did, {
        did: msg.did, name: msg.name, color: msg.color, blockId: msg.blockId,
      });
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'cursor' } }));
    }

    if (msg.type === 'doc-new-comment' && msg.contextDid === contextDid && msg.did !== state.did) {
      state.comments.push(msg.comment);
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'comment' } }));
    }

    if (msg.type === 'doc-new-reply' && msg.contextDid === contextDid && msg.did !== state.did) {
      const comment = state.comments.find(c => c.id === msg.commentId);
      if (comment) {
        comment.replies.push(msg.reply);
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'comment' } }));
      }
    }

    if (msg.type === 'doc-resolve-comment' && msg.contextDid === contextDid) {
      const comment = state.comments.find(c => c.id === msg.commentId);
      if (comment) {
        comment.resolved = true;
        document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'comment' } }));
      }
    }

    if (msg.type === 'doc-title-change' && msg.contextDid === contextDid && msg.did !== state.did) {
      state.docTitle = msg.title;
      document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'title' } }));
    }
  });

  setInterval(() => {
    if (state.activeBlockId) {
      const myCollab = state.collaborators.find(c => c.did === state.did);
      bc.postMessage({
        type: 'doc-cursor',
        contextDid,
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
    contextDid: state.context.did,
    did: state.did,
    blockId, content, blockType,
  });
}

export function broadcastNewBlock(state: AppState, afterBlockId: string, block: Block): void {
  state.bc.postMessage({
    type: 'doc-new-block',
    contextDid: state.context.did,
    did: state.did,
    afterBlockId, block,
  });
}

export function broadcastDeleteBlock(state: AppState, blockId: string): void {
  state.bc.postMessage({
    type: 'doc-delete-block',
    contextDid: state.context.did,
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
      contextDid: state.context.did,
      targetDid, newRole, ownerDid: state.did,
    });
    document.dispatchEvent(new CustomEvent('doc-update', { detail: { type: 'role-change' } }));
  }
}
