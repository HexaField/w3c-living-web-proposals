import type { SignedTriple } from '@living-web/personal-graph';

// --- SyncState enum ---
export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

// --- OnlinePeer ---
export interface OnlinePeer {
  readonly did: string;
  readonly lastSeen: number;
}

// --- GraphDiff ---
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

// --- SharedGraphOptions ---
export interface SharedGraphOptions {
  syncProtocol?: string;
  meta?: { name?: string; description?: string };
}

// --- SharedGraphInfo ---
export interface SharedGraphInfo {
  uri: string;
  name: string | undefined;
  syncState: SyncState;
  peerCount: number;
}

// --- RevisionNode ---
export interface RevisionNode {
  revision: string;
  parents: string[];
  timestamp: number;
}

// --- GraphSyncProtocol interface ---
export interface GraphSyncProtocol {
  sync(): Promise<GraphDiff | null>;
  commit(diff: GraphDiff): Promise<string>;
  peers(): Promise<string[]>;
  currentRevision(): Promise<string | null>;
  ondiff: ((diff: GraphDiff) => void) | null;
  onsyncstatechange: ((state: SyncState) => void) | null;
  destroy(): void;
}

// --- SyncProtocolFactory ---
export type SyncProtocolFactory = (doc: any, roomName: string, opts?: any) => GraphSyncProtocol;
