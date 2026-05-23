/**
 * P2P VCS — Setup: identity, repo create/fork, state management
 */
import { install as installIdentity, IdentityManager, DIDIdentityProvider } from '@living-web/identity';
import { install as installPersonalGraph, Context, Triple, type IdentityProvider } from '@living-web/personal-graph';
import '@living-web/shape-validation/polyfill';
import '@living-web/graph-sync/polyfill';

import {
  PREDICATES,
  RepositoryShape, BranchShape, CommitShape,
  TreeSnapshotShape, FileContentShape, ContributorShape,
} from './graph/shapes.js';
import { setupGovernance, issueContributorZcap, validateCommit, recordCommit, type GovernanceState } from './graph/governance.js';
import { hashContent } from './utils/helpers.js';

installIdentity();
installPersonalGraph().catch(err => console.error('[living-web] install failed', err));

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';
const SYNC_CHANNEL = 'living-web-p2p-vcs';

export interface FileEntry {
  path: string;
  contentId: string;
  content: string;
  hash: string;
}

export interface Commit {
  id: string;
  message: string;
  authorDid: string;
  authorName: string;
  time: number;
  parentCommit: string | null;
  mergeParent: string | null;
  snapshotId: string;
  files: FileEntry[];
}

export interface Branch {
  id: string;
  name: string;
  headCommitId: string;
  protected: boolean;
  createdBy: string;
}

export interface Contributor {
  id: string;
  did: string;
  name: string;
  role: 'owner' | 'contributor' | 'reader';
}

export interface AppState {
  did: string;
  displayName: string;
  context: Context;
  repoId: string;
  repoName: string;
  branches: Branch[];
  currentBranchId: string;
  commits: Commit[];
  workingFiles: FileEntry[];
  contributors: Contributor[];
  governance: GovernanceState;
  isOwner: boolean;
  bc: BroadcastChannel;
  identity: IdentityProvider;
  governanceLogs: { text: string; accepted: boolean; time: number }[];
  selectedFile: string | null;
  viewingCommit: string | null;
  editingIndicators: Map<string, string>;
}

export async function createIdentity(displayName: string): Promise<{ did: string; identity: IdentityProvider }> {
  const manager = new IdentityManager();
  const credential = await manager.createIndividual(displayName, POLYFILL_PASSPHRASE);
  if (credential.isLocked) await credential.unlock(POLYFILL_PASSPHRASE);
  const provider = new DIDIdentityProvider(credential);
  return { did: provider.getDID(), identity: provider };
}

async function registerShapes(context: Context): Promise<void> {
  await context.addShape('Repository', JSON.stringify(RepositoryShape));
  await context.addShape('Branch', JSON.stringify(BranchShape));
  await context.addShape('Commit', JSON.stringify(CommitShape));
  await context.addShape('TreeSnapshot', JSON.stringify(TreeSnapshotShape));
  await context.addShape('FileContent', JSON.stringify(FileContentShape));
  await context.addShape('Contributor', JSON.stringify(ContributorShape));
}

export async function createRepo(
  displayName: string, repoName: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const store = await navigator.graph.create(repoName);
  const context = await store.createContext({ displayName: repoName });
  await context.publish();
  await registerShapes(context);

  const repoId = `repo:${crypto.randomUUID()}`;
  await context.createShapeInstance('Repository', repoId, { name: repoName, description: repoName, owner: did });

  const snapshotId = `snapshot:${crypto.randomUUID()}`;
  await context.createShapeInstance('TreeSnapshot', snapshotId, { entries: '[]' });

  const commitId = `commit:${crypto.randomUUID()}`;
  const now = Date.now();
  await context.createShapeInstance('Commit', commitId, {
    message: 'Initial commit',
    author: did,
    authorName: displayName,
    time: String(now),
    parentCommit: 'none',
    snapshot: snapshotId,
  });

  const mainBranchId = `branch:${crypto.randomUUID()}`;
  await context.createShapeInstance('Branch', mainBranchId, {
    name: 'main',
    headCommit: commitId,
    protected: 'true',
    createdBy: did,
  });
  await context.addTriple(new Triple(repoId, PREDICATES.HAS_BRANCH, mainBranchId));
  await context.addTriple(new Triple(repoId, PREDICATES.DEFAULT_BRANCH, mainBranchId));

  const contribId = `contrib:${crypto.randomUUID()}`;
  await context.createShapeInstance('Contributor', contribId, { did, name: displayName, role: 'owner' });
  await context.addTriple(new Triple(repoId, PREDICATES.HAS_CONTRIBUTOR, contribId));

  const governance = setupGovernance(context, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const initialCommit: Commit = {
    id: commitId, message: 'Initial commit', authorDid: did, authorName: displayName,
    time: now, parentCommit: null, mergeParent: null, snapshotId, files: [],
  };

  const state: AppState = {
    did, displayName, context,
    repoId, repoName,
    branches: [{ id: mainBranchId, name: 'main', headCommitId: commitId, protected: true, createdBy: did }],
    currentBranchId: mainBranchId,
    commits: [initialCommit],
    workingFiles: [],
    contributors: [{ id: contribId, did, name: displayName, role: 'owner' }],
    governance, isOwner: true, bc, identity,
    governanceLogs: [],
    selectedFile: null,
    viewingCommit: null,
    editingIndicators: new Map(),
  };

  setupCrossTabSync(state);
  return state;
}

export async function forkRepo(
  displayName: string, contextDid: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const store = await navigator.graph.create(displayName);
  const placeholderContext = await store.createContext({ displayName: 'pending-fork' });
  await placeholderContext.publish();
  await registerShapes(placeholderContext);

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(placeholderContext, did);
      resolve({
        did, displayName, context: placeholderContext,
        repoId: 'repo:fallback', repoName: 'Repository',
        branches: [], currentBranchId: '',
        commits: [], workingFiles: [],
        contributors: [{ id: `contrib:${crypto.randomUUID()}`, did, name: displayName, role: 'reader' }],
        governance, isOwner: false, bc, identity,
        governanceLogs: [], selectedFile: null, viewingCommit: null,
        editingIndicators: new Map(),
      });
    }, 1500);

    const handler = (ev: MessageEvent) => {
      const data = ev.data;
      if (data.type !== 'vcs-sync-response' || data.contextDid !== contextDid) return;
      clearTimeout(timeout);
      bc.removeEventListener('message', handler);

      const governance = setupGovernance(placeholderContext, data.ownerDid);
      issueContributorZcap(governance, did, data.ownerDid);

      const state: AppState = {
        did, displayName, context: placeholderContext,
        repoId: data.repoId,
        repoName: data.repoName,
        branches: data.branches,
        currentBranchId: data.branches[0]?.id || '',
        commits: data.commits,
        workingFiles: data.workingFiles || [],
        contributors: [...data.contributors],
        governance, isOwner: false, bc, identity,
        governanceLogs: [], selectedFile: null, viewingCommit: null,
        editingIndicators: new Map(),
      };

      const contribId = `contrib:${crypto.randomUUID()}`;
      state.contributors.push({ id: contribId, did, name: displayName, role: 'contributor' });

      bc.postMessage({
        type: 'vcs-new-contributor',
        contextDid,
        contributor: { id: contribId, did, name: displayName, role: 'contributor' },
      });

      setupCrossTabSync(state);
      resolve(state);
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'vcs-sync-request', contextDid, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, context } = state;
  const contextDid = context.did;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'vcs-sync-request' && msg.contextDid === contextDid && state.isOwner) {
      bc.postMessage({
        type: 'vcs-sync-response',
        contextDid,
        ownerDid: state.did,
        repoId: state.repoId,
        repoName: state.repoName,
        branches: state.branches,
        commits: state.commits,
        workingFiles: state.workingFiles,
        contributors: state.contributors,
      });
    }

    if (msg.type === 'vcs-new-commit' && msg.contextDid === contextDid && msg.commit.authorDid !== state.did) {
      state.commits.push(msg.commit);
      const branch = state.branches.find(b => b.id === msg.branchId);
      if (branch) branch.headCommitId = msg.commit.id;
      if (msg.branchId === state.currentBranchId) {
        state.workingFiles = msg.commit.files;
      }
      document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'commit' } }));
    }

    if (msg.type === 'vcs-new-branch' && msg.contextDid === contextDid) {
      if (!state.branches.find(b => b.id === msg.branch.id)) {
        state.branches.push(msg.branch);
        document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'branch' } }));
      }
    }

    if (msg.type === 'vcs-new-contributor' && msg.contextDid === contextDid) {
      if (!state.contributors.find(c => c.did === msg.contributor.did)) {
        state.contributors.push(msg.contributor);
        if (state.isOwner) issueContributorZcap(state.governance, msg.contributor.did, state.did);
        document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'contributor' } }));
      }
    }

    if (msg.type === 'vcs-editing' && msg.contextDid === contextDid && msg.did !== state.did) {
      if (msg.filePath) {
        state.editingIndicators.set(msg.filePath, msg.displayName);
      } else {
        for (const [k, v] of state.editingIndicators) {
          if (v === msg.displayName) state.editingIndicators.delete(k);
        }
      }
      document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'editing' } }));
    }
  });
}

/** Create a commit in the current branch. */
export async function createCommit(
  state: AppState, message: string, files: FileEntry[],
): Promise<{ success: boolean; reason?: string }> {
  const branch = state.branches.find(b => b.id === state.currentBranchId);
  if (!branch) return { success: false, reason: 'No branch selected' };

  const validation = validateCommit(state.governance, state.did, branch.protected, state.isOwner);
  if (!validation.allowed) {
    state.governanceLogs.push({ text: `Commit by ${state.displayName} on ${branch.name} REJECTED — ${validation.reason}`, accepted: false, time: Date.now() });
    document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'governance' } }));
    return { success: false, reason: validation.reason };
  }

  const now = Date.now();

  for (const file of files) {
    const hash = await hashContent(file.content);
    file.hash = hash;
    file.contentId = `file:${crypto.randomUUID()}`;
    await state.context.createShapeInstance('FileContent', file.contentId, {
      path: file.path, content: file.content, hash,
    });
  }

  const snapshotId = `snapshot:${crypto.randomUUID()}`;
  const entries = JSON.stringify(files.map(f => ({ path: f.path, contentId: f.contentId })));
  await state.context.createShapeInstance('TreeSnapshot', snapshotId, { entries });

  const commitId = `commit:${crypto.randomUUID()}`;
  await state.context.createShapeInstance('Commit', commitId, {
    message,
    author: state.did,
    authorName: state.displayName,
    time: String(now),
    parentCommit: branch.headCommitId || 'none',
    snapshot: snapshotId,
  });

  const commit: Commit = {
    id: commitId, message, authorDid: state.did, authorName: state.displayName,
    time: now, parentCommit: branch.headCommitId, mergeParent: null,
    snapshotId, files: [...files],
  };

  state.commits.push(commit);
  branch.headCommitId = commitId;
  state.workingFiles = [...files];

  recordCommit(state.governance, state.did);

  state.governanceLogs.push({
    text: `Commit by ${state.displayName} on ${branch.name} ACCEPTED`,
    accepted: true, time: Date.now(),
  });

  state.bc.postMessage({
    type: 'vcs-new-commit',
    contextDid: state.context.did,
    branchId: state.currentBranchId,
    commit,
  });

  document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'commit' } }));
  return { success: true };
}

/** Create a new branch from current branch HEAD. */
export function createBranch(state: AppState, name: string): Branch {
  const currentBranch = state.branches.find(b => b.id === state.currentBranchId);
  const headCommit = currentBranch?.headCommitId || '';

  const branch: Branch = {
    id: `branch:${crypto.randomUUID()}`,
    name,
    headCommitId: headCommit,
    protected: false,
    createdBy: state.did,
  };

  state.branches.push(branch);
  state.bc.postMessage({ type: 'vcs-new-branch', contextDid: state.context.did, branch });
  document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'branch' } }));
  return branch;
}

/** Switch to a branch — load its files from the head commit. */
export function switchBranch(state: AppState, branchId: string): void {
  state.currentBranchId = branchId;
  const branch = state.branches.find(b => b.id === branchId);
  if (branch) {
    const headCommit = state.commits.find(c => c.id === branch.headCommitId);
    if (headCommit) {
      state.workingFiles = [...headCommit.files];
    }
  }
  state.selectedFile = null;
  state.viewingCommit = null;
  document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'branch-switch' } }));
}

export function broadcastEditing(state: AppState, filePath: string | null): void {
  state.bc.postMessage({
    type: 'vcs-editing',
    contextDid: state.context.did,
    did: state.did,
    displayName: state.displayName,
    filePath,
  });
}
