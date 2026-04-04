/**
 * P2P VCS — Setup: identity, repo create/fork, state management
 */
import { install as installIdentity } from '@living-web/identity';
import { SharedGraph, SharedGraphManager } from '@living-web/graph-sync';
import { installShapeExtension } from '@living-web/shape-validation';
import { PersonalGraph, SemanticTriple } from '@living-web/personal-graph';
import type { IdentityProvider } from '@living-web/personal-graph';
import {
  PREDICATES,
  RepositoryShape, BranchShape, CommitShape,
  TreeSnapshotShape, FileContentShape, ContributorShape,
} from './graph/shapes.js';
import { setupGovernance, issueContributorZcap, type GovernanceState } from './graph/governance.js';
import { hashContent } from './utils/helpers.js';

installIdentity();
installShapeExtension(PersonalGraph);

// Patch SharedGraph with shape methods
const shapeMethods = ['addShape', 'getShapes', 'createShapeInstance', 'getShapeInstances', 'getShapeInstanceData', 'setShapeProperty', 'addToShapeCollection', 'removeFromShapeCollection'];
for (const method of shapeMethods) {
  if ((PersonalGraph.prototype as any)[method]) {
    (SharedGraph.prototype as any)[method] = (PersonalGraph.prototype as any)[method];
  }
}
if (!Object.getOwnPropertyDescriptor(SharedGraph.prototype, 'uuid')) {
  Object.defineProperty(SharedGraph.prototype, 'uuid', { get() { return (this as any).uri; } });
}

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
  graph: SharedGraph;
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
  editingIndicators: Map<string, string>; // filePath -> displayName
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

export async function createRepo(
  displayName: string, repoName: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.share(repoName);
  const g = graph as any;

  // Register shapes
  await g.addShape('Repository', JSON.stringify(RepositoryShape));
  await g.addShape('Branch', JSON.stringify(BranchShape));
  await g.addShape('Commit', JSON.stringify(CommitShape));
  await g.addShape('TreeSnapshot', JSON.stringify(TreeSnapshotShape));
  await g.addShape('FileContent', JSON.stringify(FileContentShape));
  await g.addShape('Contributor', JSON.stringify(ContributorShape));

  // Create repo
  const repoId = `repo:${crypto.randomUUID()}`;
  await g.createShapeInstance('Repository', repoId, { name: repoName, description: repoName, owner: did });

  // Create initial empty snapshot
  const snapshotId = `snapshot:${crypto.randomUUID()}`;
  await g.createShapeInstance('TreeSnapshot', snapshotId, { entries: '[]' });

  // Create initial commit
  const commitId = `commit:${crypto.randomUUID()}`;
  const now = Date.now();
  await g.createShapeInstance('Commit', commitId, {
    message: 'Initial commit',
    author: did,
    authorName: displayName,
    time: String(now),
    parentCommit: 'none',
    snapshot: snapshotId,
  });

  // Create main branch (protected)
  const mainBranchId = `branch:${crypto.randomUUID()}`;
  await g.createShapeInstance('Branch', mainBranchId, {
    name: 'main',
    headCommit: commitId,
    protected: 'true',
    createdBy: did,
  });
  await graph.addTriple(new SemanticTriple(repoId, mainBranchId, PREDICATES.HAS_BRANCH));

  // Update repo default branch
  await graph.addTriple(new SemanticTriple(repoId, mainBranchId, PREDICATES.DEFAULT_BRANCH));

  // Create owner contributor
  const contribId = `contrib:${crypto.randomUUID()}`;
  await g.createShapeInstance('Contributor', contribId, { did, name: displayName, role: 'owner' });
  await graph.addTriple(new SemanticTriple(repoId, contribId, PREDICATES.HAS_CONTRIBUTOR));

  const governance = setupGovernance(graph, did);
  const bc = new BroadcastChannel(SYNC_CHANNEL);

  const initialCommit: Commit = {
    id: commitId, message: 'Initial commit', authorDid: did, authorName: displayName,
    time: now, parentCommit: null, mergeParent: null, snapshotId, files: [],
  };

  const state: AppState = {
    did, displayName, graph,
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
  displayName: string, graphUri: string, identity: IdentityProvider, did: string,
): Promise<AppState> {
  const manager = new SharedGraphManager(identity);
  const graph = await manager.join(graphUri);
  const g = graph as any;

  await g.addShape('Repository', JSON.stringify(RepositoryShape));
  await g.addShape('Branch', JSON.stringify(BranchShape));
  await g.addShape('Commit', JSON.stringify(CommitShape));
  await g.addShape('TreeSnapshot', JSON.stringify(TreeSnapshotShape));
  await g.addShape('FileContent', JSON.stringify(FileContentShape));
  await g.addShape('Contributor', JSON.stringify(ContributorShape));

  const bc = new BroadcastChannel(SYNC_CHANNEL);

  return new Promise<AppState>((resolve) => {
    const timeout = setTimeout(() => {
      const governance = setupGovernance(graph, did);
      resolve({
        did, displayName, graph,
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
      if (ev.data.type === 'vcs-sync-response' && ev.data.graphUri === graphUri) {
        clearTimeout(timeout);
        bc.removeEventListener('message', handler);
        const data = ev.data;

        const governance = setupGovernance(graph, data.ownerDid);
        issueContributorZcap(governance, did, data.ownerDid);

        const state: AppState = {
          did, displayName, graph,
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

        // Add self as contributor
        const contribId = `contrib:${crypto.randomUUID()}`;
        state.contributors.push({ id: contribId, did, name: displayName, role: 'contributor' });

        bc.postMessage({
          type: 'vcs-new-contributor',
          graphUri: graph.uri,
          contributor: { id: contribId, did, name: displayName, role: 'contributor' },
        });

        setupCrossTabSync(state);
        resolve(state);
      }
    };

    bc.addEventListener('message', handler);
    bc.postMessage({ type: 'vcs-sync-request', graphUri, did, displayName });
  });
}

function setupCrossTabSync(state: AppState): void {
  const { bc, graph } = state;

  bc.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;

    if (msg.type === 'vcs-sync-request' && msg.graphUri === graph.uri && state.isOwner) {
      bc.postMessage({
        type: 'vcs-sync-response',
        graphUri: graph.uri,
        ownerDid: state.did,
        repoId: state.repoId,
        repoName: state.repoName,
        branches: state.branches,
        commits: state.commits,
        workingFiles: state.workingFiles,
        contributors: state.contributors,
      });
    }

    if (msg.type === 'vcs-new-commit' && msg.graphUri === graph.uri && msg.commit.authorDid !== state.did) {
      state.commits.push(msg.commit);
      // Update branch head
      const branch = state.branches.find(b => b.id === msg.branchId);
      if (branch) branch.headCommitId = msg.commit.id;
      // Update working files if on same branch
      if (msg.branchId === state.currentBranchId) {
        state.workingFiles = msg.commit.files;
      }
      document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'commit' } }));
    }

    if (msg.type === 'vcs-new-branch' && msg.graphUri === graph.uri) {
      if (!state.branches.find(b => b.id === msg.branch.id)) {
        state.branches.push(msg.branch);
        document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'branch' } }));
      }
    }

    if (msg.type === 'vcs-new-contributor' && msg.graphUri === graph.uri) {
      if (!state.contributors.find(c => c.did === msg.contributor.did)) {
        state.contributors.push(msg.contributor);
        if (state.isOwner) {
          issueContributorZcap(state.governance, msg.contributor.did, state.did);
        }
        document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'contributor' } }));
      }
    }

    if (msg.type === 'vcs-editing' && msg.graphUri === graph.uri && msg.did !== state.did) {
      if (msg.filePath) {
        state.editingIndicators.set(msg.filePath, msg.displayName);
      } else {
        // Clear
        for (const [k, v] of state.editingIndicators) {
          if (v === msg.displayName) state.editingIndicators.delete(k);
        }
      }
      document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'editing' } }));
    }
  });
}

/**
 * Create a commit in the current branch
 */
export async function createCommit(
  state: AppState, message: string, files: FileEntry[],
): Promise<{ success: boolean; reason?: string }> {
  const branch = state.branches.find(b => b.id === state.currentBranchId);
  if (!branch) return { success: false, reason: 'No branch selected' };

  const validation = (await import('./graph/governance.js')).validateCommit(
    state.governance, state.did, branch.protected, state.isOwner,
  );

  if (!validation.allowed) {
    state.governanceLogs.push({ text: `Commit by ${state.displayName} on ${branch.name} REJECTED — ${validation.reason}`, accepted: false, time: Date.now() });
    document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'governance' } }));
    return { success: false, reason: validation.reason };
  }

  const g = state.graph as any;
  const now = Date.now();

  // Create file content instances
  for (const file of files) {
    const hash = await hashContent(file.content);
    file.hash = hash;
    file.contentId = `file:${crypto.randomUUID()}`;
    await g.createShapeInstance('FileContent', file.contentId, {
      path: file.path, content: file.content, hash,
    });
  }

  // Create tree snapshot
  const snapshotId = `snapshot:${crypto.randomUUID()}`;
  const entries = JSON.stringify(files.map(f => ({ path: f.path, contentId: f.contentId })));
  await g.createShapeInstance('TreeSnapshot', snapshotId, { entries });

  // Create commit
  const commitId = `commit:${crypto.randomUUID()}`;
  await g.createShapeInstance('Commit', commitId, {
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

  // Record for rate limiting
  (await import('./graph/governance.js')).recordCommit(state.governance, state.did);

  state.governanceLogs.push({
    text: `Commit by ${state.displayName} on ${branch.name} ACCEPTED`,
    accepted: true, time: Date.now(),
  });

  // Broadcast
  state.bc.postMessage({
    type: 'vcs-new-commit',
    graphUri: state.graph.uri,
    branchId: state.currentBranchId,
    commit,
  });

  document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'commit' } }));
  return { success: true };
}

/**
 * Create a new branch from current branch HEAD
 */
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
  state.bc.postMessage({ type: 'vcs-new-branch', graphUri: state.graph.uri, branch });
  document.dispatchEvent(new CustomEvent('vcs-update', { detail: { type: 'branch' } }));
  return branch;
}

/**
 * Switch to a branch — load its files from the head commit
 */
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

/**
 * Broadcast editing indicator
 */
export function broadcastEditing(state: AppState, filePath: string | null): void {
  state.bc.postMessage({
    type: 'vcs-editing',
    graphUri: state.graph.uri,
    did: state.did,
    displayName: state.displayName,
    filePath,
  });
}
