/**
 * Graph-sync types — ContextDiff + sync spaces + per-context subscription.
 */

import type { SignedTriple } from '@living-web/personal-graph';

export type ContextSyncState = 'idle' | 'resolving' | 'connecting' | 'syncing' | 'synced' | 'error';

export interface Peer {
  readonly did: string;
  readonly sessionId: string;
  readonly deviceLabel?: string;
  readonly publicKey?: string;
  readonly lastSeen?: number;
  readonly online: boolean;
}

export interface CapabilityProof {
  /** Ordered ZCAP chain (leaf → root) as content-addressed references. */
  chain: string[];
  /** Caveat ids the committing agent's executor evaluated. */
  caveatsSatisfied?: string[];
  /** Optimisation hint: true if any caveat depends on link content. */
  hasContentCaveats?: boolean;
}

/**
 * ContextDiff — the unit of gossip. Scoped to a specific did:graph context.
 * Immutable once constructed.
 */
export class ContextDiff {
  readonly graphDid: string;
  readonly revision: string;
  readonly additions: readonly SignedTriple[];
  readonly removals: readonly SignedTriple[];
  readonly dependencies: readonly string[];
  readonly capabilityProof: CapabilityProof | null;
  readonly author: string;
  readonly timestamp: number;
  readonly diffsSinceSnapshot: number;

  constructor(opts: {
    graphDid: string;
    revision: string;
    additions: SignedTriple[];
    removals: SignedTriple[];
    dependencies: string[];
    capabilityProof?: CapabilityProof | null;
    author: string;
    timestamp: number;
    diffsSinceSnapshot?: number;
  }) {
    this.graphDid = opts.graphDid;
    this.revision = opts.revision;
    this.additions = Object.freeze([...opts.additions]);
    this.removals = Object.freeze([...opts.removals]);
    this.dependencies = Object.freeze([...opts.dependencies]);
    this.capabilityProof = opts.capabilityProof ?? null;
    this.author = opts.author;
    this.timestamp = opts.timestamp;
    this.diffsSinceSnapshot = opts.diffsSinceSnapshot ?? 0;
    Object.freeze(this);
  }
}

export interface ValidationResult {
  accepted: boolean;
  module?: string;
  constraintId?: string;
  reason?: string;
}

export type SpaceTopology = 'unified' | 'privacy-tiered' | 'fully-partitioned' | 'custom';

export interface PublishOptions {
  moduleHash?: string;
  relays?: string[];
  spaceTopology?: SpaceTopology;
  customSpace?: string;
}

export interface PublishedContext {
  graphDid: string;
  spaceUri: string;
  moduleHash: string;
  relays: readonly string[];
}

export interface SyncSpaceInfo {
  spaceUri: string;
  moduleHash: string;
  contextCount: number;
  peerCount: number;
}

export interface SyncModuleInfo {
  contentHash: string;
  name?: string;
  spaceCount: number;
  state: 'running' | 'suspended' | 'error';
  storageBytes: number;
}

// Events ------------------------------------------------------------------

export class DiffEvent extends Event {
  readonly diff: ContextDiff;
  constructor(diff: ContextDiff) {
    super('diff');
    this.diff = diff;
  }
}

export class SignalEvent extends Event {
  readonly from: { did: string; sessionId: string };
  readonly payload: Uint8Array;
  constructor(from: { did: string; sessionId: string }, payload: Uint8Array) {
    super('signal');
    this.from = from;
    this.payload = payload;
  }
}

export class PeerEvent extends Event {
  readonly peer: Peer;
  constructor(type: 'peerjoined' | 'peerleft', peer: Peer) {
    super(type);
    this.peer = peer;
  }
}

export class SyncStateChangeEvent extends Event {
  readonly state: ContextSyncState;
  constructor(state: ContextSyncState) {
    super('syncstatechange');
    this.state = state;
  }
}
