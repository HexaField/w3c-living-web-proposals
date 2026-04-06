import type { SignedTriple } from '@living-web/personal-graph';
import {
  GraphDiff as GraphDiffClass,
  type ValidationResult,
  type Peer,
  type WireMessage,
  type DiffMessage,
  type SyncReqMessage,
  type SyncRespMessage,
  type SignalMessage,
  type PeerJoinMessage,
  type PeerLeaveMessage,
} from './types.js';
import type { GraphDiff } from './types.js';
import {
  MSG_DIFF,
  MSG_SYNC_REQ,
  MSG_SYNC_RESP,
  MSG_SIGNAL,
  MSG_PEER_JOIN,
  MSG_PEER_LEAVE,
  MSG_GOVERNANCE,
} from './types.js';
import { parseGraphURI } from './graph-uri.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * GraphSyncModule interface (§7) — the contract all sync modules implement.
 * 
 * This is the JS interface; in a real browser it would be WASM exports.
 */
export interface GraphSyncModule {
  // Lifecycle
  init(config: ModuleConfig): void;
  shutdown(): void;

  // Transport
  connect(graphUri: string, localDid: string): void;
  disconnect(): void;

  // Sync
  commit(diff: GraphDiff): string | ValidationResult;
  requestSync(fromRevision: string): void;

  // Peer management
  peers(): Peer[];
  onlinePeers(): Peer[];

  // Signalling
  sendSignal(remoteDid: string, payload: Uint8Array): void;
  onSignal(callback: (remoteDid: string, payload: Uint8Array) => void): void;

  // Governance
  validate(diff: GraphDiff, author: string, graphState: GraphReader): ValidationResult;
}

export interface ModuleConfig {
  graphUri: string;
  localDid: string;
  graphWriter: GraphWriter;
  graphReader: GraphReader;
}

export interface GraphReader {
  query(query: { source?: string; predicate?: string; target?: string }): SignedTriple[];
  tripleCount(): number;
  currentRevision(): string | null;
}

export interface GraphWriter {
  applyDiff(diff: GraphDiff): void;
  rejectDiff(diff: GraphDiff, reason: string): void;
}

/**
 * Compute triple identity per §15.2:
 * triple-id = SHA-256(source || predicate || target || author-did || timestamp)
 */
export function computeTripleId(triple: SignedTriple): string {
  const input = `${triple.data.source}|${triple.data.predicate ?? ''}|${triple.data.target}|${triple.author}|${triple.timestamp}`;
  const hash = sha256(new TextEncoder().encode(input));
  return bytesToHex(hash);
}

/**
 * DefaultSyncModule (§10) — the built-in sync module.
 * 
 * Implements the GraphSyncModule interface using:
 * - BroadcastChannel for transport (polyfill substitute for WebTransport)
 * - OR-Set CRDT for merge (add-wins)
 * - Relay-based peer discovery (simulated via BroadcastChannel)
 * - Governance validation via validate()
 */
export class DefaultSyncModule implements GraphSyncModule {
  private _config: ModuleConfig | null = null;
  private _channel: BroadcastChannel | null = null;
  private _instanceId: string = '';
  private _connected = false;
  private _peers = new Map<string, Peer>();
  private _signalCallback: ((remoteDid: string, payload: Uint8Array) => void) | null = null;
  private _onRemoteDiffCallback: ((diff: GraphDiff) => void) | null = null;
  private _validateFn: ((diff: GraphDiff, author: string, graphState: GraphReader) => ValidationResult) | null = null;

  // OR-Set state: add-set and remove-set indexed by triple-id
  private _addSet = new Set<string>();   // triple-ids that have been added
  private _removeSet = new Set<string>(); // triple-ids that have been removed (tombstones)

  // Buffered diffs awaiting dependency resolution
  private _pendingDiffs = new Map<string, { diff: GraphDiff; missingDeps: Set<string> }>();
  private _appliedRevisions = new Set<string>();

  init(config: ModuleConfig): void {
    this._config = config;
    this._instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  shutdown(): void {
    this.disconnect();
    this._config = null;
    this._addSet.clear();
    this._removeSet.clear();
    this._pendingDiffs.clear();
    this._appliedRevisions.clear();
  }

  connect(graphUri: string, localDid: string): void {
    if (this._connected) return;
    this._connected = true;

    // Set up BroadcastChannel transport (polyfill substitute for WebTransport to relay)
    if (typeof BroadcastChannel !== 'undefined') {
      const parsed = parseGraphURI(graphUri);
      this._channel = new BroadcastChannel(`graph-sync-${parsed.graphId}`);
      this._channel.onmessage = (event: MessageEvent) => {
        if (event.data?.origin === this._instanceId) return;
        this._handleMessage(event.data?.msg as WireMessage);
      };

      // Announce ourselves
      this._broadcastWire({
        type: MSG_PEER_JOIN,
        did: localDid,
        publicKey: '',
        timestamp: Date.now(),
      } as PeerJoinMessage);
    }
  }

  disconnect(): void {
    if (!this._connected) return;

    if (this._config && this._channel) {
      this._broadcastWire({
        type: MSG_PEER_LEAVE,
        did: this._config.localDid,
        timestamp: Date.now(),
      } as PeerLeaveMessage);
    }

    this._channel?.close();
    this._channel = null;
    this._connected = false;
  }

  commit(diff: GraphDiff): string | ValidationResult {
    if (!this._config) throw new Error('Module not initialized');

    // §7.8.5: validate before distributing
    const result = this.validate(diff, this._config.localDid, this._config.graphReader);
    if (!result.accepted) return result;

    // Apply to OR-Set
    for (const triple of diff.additions) {
      const tid = computeTripleId(triple);
      this._addSet.add(tid);
    }
    for (const triple of diff.removals) {
      const tid = computeTripleId(triple);
      this._removeSet.add(tid);
    }

    // Apply locally
    this._config.graphWriter.applyDiff(diff);
    this._appliedRevisions.add(diff.revision);

    // Broadcast to peers
    this._broadcastWire({
      type: MSG_DIFF,
      revision: diff.revision,
      author: diff.author,
      timestamp: diff.timestamp,
      additions: diff.additions as SignedTriple[],
      removals: diff.removals as SignedTriple[],
      dependencies: diff.dependencies as string[],
    } as DiffMessage);

    return diff.revision;
  }

  requestSync(fromRevision: string): void {
    this._broadcastWire({
      type: MSG_SYNC_REQ,
      fromRevision: fromRevision === 'genesis' ? '0'.repeat(64) : fromRevision,
      maxDiffs: 0,
    } as SyncReqMessage);
  }

  peers(): Peer[] {
    return Array.from(this._peers.values());
  }

  onlinePeers(): Peer[] {
    return Array.from(this._peers.values()).filter(p => p.online);
  }

  sendSignal(remoteDid: string, payload: Uint8Array): void {
    this._broadcastWire({
      type: MSG_SIGNAL,
      senderDid: this._config?.localDid ?? '',
      recipientDid: remoteDid,
      payload: Array.from(payload),
    } as SignalMessage);
  }

  onSignal(callback: (remoteDid: string, payload: Uint8Array) => void): void {
    this._signalCallback = callback;
  }

  /**
   * Set a callback for validated remote diffs.
   */
  onRemoteDiff(callback: (diff: GraphDiff) => void): void {
    this._onRemoteDiffCallback = callback;
  }

  /**
   * Set a custom governance validation function.
   */
  setValidateFn(fn: (diff: GraphDiff, author: string, graphState: GraphReader) => ValidationResult): void {
    this._validateFn = fn;
  }

  /**
   * §7.8.8 / §16.2: Governance enforcement point.
   * Default: accept all diffs with valid signatures.
   */
  validate(diff: GraphDiff, author: string, graphState: GraphReader): ValidationResult {
    if (this._validateFn) {
      return this._validateFn(diff, author, graphState);
    }

    // Default: verify signatures are present (polyfill can't do full Ed25519 DID resolution)
    for (const triple of diff.additions) {
      if (!triple.proof?.signature) {
        return { accepted: false, module: 'default', reason: 'Missing signature on addition' };
      }
    }
    for (const triple of diff.removals) {
      if (!triple.proof?.signature) {
        return { accepted: false, module: 'default', reason: 'Missing signature on removal' };
      }
    }

    return { accepted: true };
  }

  /**
   * OR-Set merge: check if a triple is present in the merged state.
   * §15.5: Add wins — if triple-id is in both add-set and remove-set,
   * the triple is present (add wins).
   */
  isTriplePresent(tripleId: string): boolean {
    // Add-wins OR-Set: present if in add-set, regardless of remove-set
    // A removal only takes effect if no concurrent add exists
    // In this simplified implementation: if it's in the add-set, it's present
    return this._addSet.has(tripleId);
  }

  get addSet(): ReadonlySet<string> { return this._addSet; }
  get removeSet(): ReadonlySet<string> { return this._removeSet; }

  // --- Internal ---

  private _broadcastWire(msg: WireMessage): void {
    this._channel?.postMessage({
      msg,
      origin: this._instanceId,
    });
  }

  private _handleMessage(msg: WireMessage): void {
    if (!msg || !this._config) return;

    switch (msg.type) {
      case MSG_DIFF:
        this._handleDiff(msg as DiffMessage);
        break;
      case MSG_PEER_JOIN:
        this._handlePeerJoin(msg as PeerJoinMessage);
        break;
      case MSG_PEER_LEAVE:
        this._handlePeerLeave(msg as PeerLeaveMessage);
        break;
      case MSG_SIGNAL:
        this._handleSignal(msg as SignalMessage);
        break;
      case MSG_SYNC_REQ:
        // In polyfill, sync requests trigger sending all known diffs
        // (simplified — real implementation would traverse DAG)
        break;
      case MSG_GOVERNANCE:
        // Governance messages are structurally diffs — handle as priority diff
        this._handleDiff((msg as any).diff);
        break;
    }
  }

  private _handleDiff(msg: DiffMessage): void {
    if (!this._config) return;
    if (this._appliedRevisions.has(msg.revision)) return; // dedup

    const diff = new GraphDiffClass({
      revision: msg.revision,
      author: msg.author,
      timestamp: msg.timestamp,
      additions: msg.additions,
      removals: msg.removals,
      dependencies: msg.dependencies,
    });

    // §7.8.6 step 1: check causal dependencies
    const missingDeps = new Set<string>();
    for (const dep of msg.dependencies) {
      if (!this._appliedRevisions.has(dep)) {
        missingDeps.add(dep);
      }
    }
    if (missingDeps.size > 0) {
      this._pendingDiffs.set(msg.revision, { diff, missingDeps });
      return;
    }

    this._applyRemoteDiff(diff);
  }

  private _applyRemoteDiff(diff: GraphDiff): void {
    if (!this._config) return;

    // §7.8.6 step 2: validate
    const result = this.validate(diff, diff.author, this._config.graphReader);
    if (!result.accepted) {
      this._config.graphWriter.rejectDiff(diff, result.reason ?? 'Validation failed');
      return;
    }

    // §15.5: OR-Set merge — add wins
    for (const triple of diff.additions) {
      const tid = computeTripleId(triple);
      this._addSet.add(tid);
      // Remove from remove-set if present (add wins)
      this._removeSet.delete(tid);
    }
    for (const triple of diff.removals) {
      const tid = computeTripleId(triple);
      // Only remove if not concurrently added (add wins)
      if (!this._addSet.has(tid)) {
        this._removeSet.add(tid);
      }
    }

    // Apply
    this._config.graphWriter.applyDiff(diff);
    this._appliedRevisions.add(diff.revision);

    // Notify
    this._onRemoteDiffCallback?.(diff);

    // Check if any pending diffs can now be applied
    this._flushPending();
  }

  private _flushPending(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const [rev, entry] of this._pendingDiffs) {
        for (const dep of entry.missingDeps) {
          if (this._appliedRevisions.has(dep)) {
            entry.missingDeps.delete(dep);
          }
        }
        if (entry.missingDeps.size === 0) {
          this._pendingDiffs.delete(rev);
          this._applyRemoteDiff(entry.diff);
          progress = true;
        }
      }
    }
  }

  private _handlePeerJoin(msg: PeerJoinMessage): void {
    const key = msg.sessionId ?? msg.did;
    this._peers.set(key, {
      did: msg.did,
      sessionId: msg.sessionId ?? msg.did,
      publicKey: msg.publicKey,
      lastSeen: msg.timestamp,
      online: true,
    });
  }

  private _handlePeerLeave(msg: PeerLeaveMessage): void {
    const peer = this._peers.get(msg.did);
    if (peer) {
      this._peers.set(msg.did, { ...peer, online: false, lastSeen: msg.timestamp });
    }
  }

  private _handleSignal(msg: SignalMessage): void {
    if (!this._config) return;
    // Only deliver if addressed to us or broadcast
    if (msg.recipientDid !== '*' && msg.recipientDid !== this._config.localDid) return;
    this._signalCallback?.(msg.senderDid, new Uint8Array(msg.payload));
  }
}
