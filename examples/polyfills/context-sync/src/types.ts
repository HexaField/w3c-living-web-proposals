/**
 * Graph-sync types — GraphDiff + sync spaces + per-graph subscription.
 *
 * Mirrors Spec 05 §5. Key invariants:
 *   - `revision` is content-addressed over (graphDid, additions, removals,
 *     dependencies) — triple-set identity (Spec 05 §5.2.2).
 *   - `commitId` additionally binds (author, timestamp, leaf-ZCAP-id) —
 *     commit identity (Spec 05 §5.2.2).
 *   - `signature` is `sign(authorKey, commitId)` and MUST be verified by
 *     receiving peers before any other validation (Spec 05 §9.2.1 step 0).
 *   - `dependencies` lists every DAG head observable at commit time. A
 *     diff with |deps| > 1 is implicitly a merge (Spec 05 §5.2.1).
 */

import type { SignedTriple } from '@living-web/personal-graph';

export type ContextSyncState = 'idle' | 'resolving' | 'connecting' | 'syncing' | 'synced' | 'error';

export interface Peer {
  readonly did: string;
  readonly sessionId: string;
  readonly deviceLabel?: string;
  /** Omit when `did` is a `did:key` (the DID itself embeds the key).
   *  For other DID methods, multibase-encoded current verification method;
   *  used as a hint to avoid a DID-document round-trip. Not trusted blindly. */
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
  /** VerifiablePresentation objects when the chain has `credential` caveats. */
  presentations?: object[];
}

/**
 * GraphDiff — the unit of gossip. Scoped to a specific did:graph graph.
 * Immutable once constructed.
 */
export class GraphDiff {
  readonly graphDid: string;
  /** Triple-set identity. */
  readonly revision: string;
  /** Commit identity — binds author, timestamp, and leaf ZCAP id. */
  readonly commitId: string;
  readonly additions: readonly SignedTriple[];
  readonly removals: readonly SignedTriple[];
  /** All DAG heads observable to the committer at commit time. */
  readonly dependencies: readonly string[];
  readonly capabilityProof: CapabilityProof | null;
  readonly author: string;
  /** RFC 3339; authoritative commit time. */
  readonly timestamp: string;
  /** Committer-claimed chain depth since the latest snapshot. */
  readonly diffsSinceSnapshot: number;
  /** Bundle signature over `commitId` by the author's key. */
  readonly signature: string;

  constructor(opts: {
    graphDid: string;
    revision: string;
    commitId: string;
    additions: SignedTriple[];
    removals: SignedTriple[];
    dependencies: string[];
    capabilityProof?: CapabilityProof | null;
    author: string;
    timestamp: string;
    diffsSinceSnapshot?: number;
    signature: string;
  }) {
    this.graphDid = opts.graphDid;
    this.revision = opts.revision;
    this.commitId = opts.commitId;
    this.additions = Object.freeze([...opts.additions]);
    this.removals = Object.freeze([...opts.removals]);
    this.dependencies = Object.freeze([...opts.dependencies]);
    this.capabilityProof = opts.capabilityProof ?? null;
    this.author = opts.author;
    this.timestamp = opts.timestamp;
    this.diffsSinceSnapshot = opts.diffsSinceSnapshot ?? 0;
    this.signature = opts.signature;
    Object.freeze(this);
  }
}

export interface SyncValidationResult {
  accepted: boolean;
  /** Matches GovernanceValidationResult.constraintKind in
   *  @living-web/capability-framework. */
  constraintKind?: string;
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

export interface PublishedGraph {
  graphDid: string;
  /** Authoritative — when other peers mount this graph they MUST use this
   *  spaceUri rather than re-deriving from their own local topology
   *  (Spec 05 §7.4). */
  spaceUri: string;
  moduleHash: string;
  relays: readonly string[];
}

export interface SyncSpaceInfo {
  spaceUri: string;
  moduleHash: string;
  /** Spec 05 §6.4 — number of graphs whose diffs flow through this space. */
  graphCount: number;
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
  readonly diff: GraphDiff;
  constructor(diff: GraphDiff) {
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

/**
 * Fired on the GraphManager when a mounted graph's mount mode is invalidated
 * (capability revocation, etc., Spec 05 §8.3). The `Graph` instance MUST be
 * closed by the runtime before this event fires; subsequent calls on it
 * reject with `InvalidStateError`.
 */
export class SubscriptionEvent extends Event {
  readonly graphDid: string;
  readonly previousMode: 'read' | 'write' | 'governance';
  readonly reason?: string;
  constructor(
    type: 'subscriptiongained' | 'subscriptionlost',
    graphDid: string,
    previousMode: 'read' | 'write' | 'governance',
    reason?: string,
  ) {
    super(type);
    this.graphDid = graphDid;
    this.previousMode = previousMode;
    this.reason = reason;
  }
}
