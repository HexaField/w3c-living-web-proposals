import type { SignedTriple } from '@living-web/personal-graph';

// --- SyncState enum (§5.4) ---
export type SyncState = 'idle' | 'connecting' | 'syncing' | 'synced' | 'error';

// --- Peer (§5.2) ---
export interface Peer {
  readonly did: string;
  readonly sessionId: string;
  readonly deviceLabel?: string;
  readonly publicKey?: string;
  readonly lastSeen?: number;
  readonly online: boolean;
}

// --- OnlinePeer (back-compat alias) ---
export interface OnlinePeer {
  readonly did: string;
  readonly lastSeen: number;
}

// --- GraphDiff (§5.3) ---
export class GraphDiff {
  readonly revision: string;
  readonly additions: readonly SignedTriple[];
  readonly removals: readonly SignedTriple[];
  readonly dependencies: readonly string[];
  readonly author: string;
  readonly timestamp: number;

  constructor(opts: {
    revision: string;
    additions: SignedTriple[];
    removals: SignedTriple[];
    dependencies: string[];
    author: string;
    timestamp: number;
  }) {
    this.revision = opts.revision;
    this.additions = Object.freeze([...opts.additions]);
    this.removals = Object.freeze([...opts.removals]);
    this.dependencies = Object.freeze([...opts.dependencies]);
    this.author = opts.author;
    this.timestamp = opts.timestamp;
    Object.freeze(this);
  }
}

// --- ValidationResult (§5.5) ---
export interface ValidationResult {
  accepted: boolean;
  module?: string;
  constraintId?: string;
  reason?: string;
}

// --- SignalEvent ---
export class SignalEvent extends Event {
  readonly senderDid: string;
  readonly payload: any;
  constructor(senderDid: string, payload: any) {
    super('signal');
    this.senderDid = senderDid;
    this.payload = payload;
  }
}

// --- PeerEvent ---
export class PeerEvent extends Event {
  readonly did: string;
  constructor(type: 'peerjoined' | 'peerleft', did: string) {
    super(type);
    this.did = did;
  }
}

// --- SyncStateChangeEvent ---
export class SyncStateChangeEvent extends Event {
  readonly state: SyncState;
  constructor(state: SyncState) {
    super('syncstatechange');
    this.state = state;
  }
}

// --- DiffEvent ---
export class DiffEvent extends Event {
  readonly diff: GraphDiff;
  constructor(diff: GraphDiff) {
    super('diff');
    this.diff = diff;
  }
}

// --- SharedGraphOptions (§5.1) ---
export interface SharedGraphOptions {
  module?: string;
  relays?: string[];
  meta?: { name?: string; description?: string };
}

// --- SharedGraphInfo (§5.1) ---
export interface SharedGraphInfo {
  uri: string;
  name: string | undefined;
  moduleHash: string;
  syncState: SyncState;
  peerCount: number;
}

// --- SyncModuleInfo (§5.1) ---
export type ModuleState = 'running' | 'suspended' | 'error';

export interface SyncModuleInfo {
  contentHash: string;
  name?: string;
  graphCount: number;
  state: ModuleState;
  storageBytes: number;
}

// --- RevisionNode ---
export interface RevisionNode {
  revision: string;
  parents: string[];
  timestamp: number;
}

// --- Wire Protocol Message Types (§11.2) ---
export const MSG_DIFF = 0x01;
export const MSG_SYNC_REQ = 0x02;
export const MSG_SYNC_RESP = 0x03;
export const MSG_SIGNAL = 0x04;
export const MSG_PEER_JOIN = 0x05;
export const MSG_PEER_LEAVE = 0x06;
export const MSG_GOVERNANCE = 0x07;

export interface WireMessage {
  type: number;
  [key: string]: any;
}

export interface DiffMessage extends WireMessage {
  type: typeof MSG_DIFF;
  revision: string;
  author: string;
  timestamp: number;
  additions: SignedTriple[];
  removals: SignedTriple[];
  dependencies: string[];
}

export interface SyncReqMessage extends WireMessage {
  type: typeof MSG_SYNC_REQ;
  fromRevision: string;
  maxDiffs: number;
}

export interface SyncRespMessage extends WireMessage {
  type: typeof MSG_SYNC_RESP;
  diffs: DiffMessage[];
  hasMore: boolean;
}

export interface SignalMessage extends WireMessage {
  type: typeof MSG_SIGNAL;
  senderDid: string;
  recipientDid: string;
  recipientSessionId?: string;
  payload: any;
}

export interface PeerJoinMessage extends WireMessage {
  type: typeof MSG_PEER_JOIN;
  did: string;
  sessionId: string;
  deviceLabel?: string;
  publicKey: string;
  timestamp: number;
}

export interface PeerLeaveMessage extends WireMessage {
  type: typeof MSG_PEER_LEAVE;
  did: string;
  timestamp: number;
}

export interface GovernanceMessage extends WireMessage {
  type: typeof MSG_GOVERNANCE;
  diff: DiffMessage;
}

// --- Message size limits (§11.4) ---
export const MESSAGE_SIZE_LIMITS: Record<number, number> = {
  [MSG_DIFF]: 1_000_000,
  [MSG_SYNC_REQ]: 256,
  [MSG_SYNC_RESP]: 16_000_000,
  [MSG_SIGNAL]: 65_536,
  [MSG_PEER_JOIN]: 1_024,
  [MSG_PEER_LEAVE]: 256,
  [MSG_GOVERNANCE]: 1_000_000,
};

// --- GraphSyncProtocol interface (legacy, retained for back-compat) ---
export interface GraphSyncProtocol {
  sync(): Promise<GraphDiff | null>;
  commit(diff: GraphDiff): Promise<string>;
  peers(): Promise<string[]>;
  currentRevision(): Promise<string | null>;
  ondiff: ((diff: GraphDiff) => void) | null;
  onsyncstatechange: ((state: SyncState) => void) | null;
  destroy(): void;
}

// --- SyncProtocolFactory (legacy) ---
export type SyncProtocolFactory = (doc: any, roomName: string, opts?: any) => GraphSyncProtocol;
