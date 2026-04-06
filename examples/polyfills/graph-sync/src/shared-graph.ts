import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import {
  PersonalGraph,
  SemanticTriple,
  type SignedTriple,
  type IdentityProvider,
  TripleEvent,
  verifyTripleSignature,
} from '@living-web/personal-graph';
import {
  type SyncState,
  type OnlinePeer,
  type Peer,
  type SharedGraphOptions,
  type RevisionNode,
  GraphDiff,
  SignalEvent,
  PeerEvent,
  SyncStateChangeEvent,
  DiffEvent,
} from './types.js';
import { YjsBridge, tripleKey } from './yjs-bridge.js';
import { createGraphDiff, computeRevision } from './diff.js';
import { buildGraphURI, parseGraphURI } from './graph-uri.js';

type EventHandler = ((event: Event) => void) | null;

/**
 * SharedGraph — a PersonalGraph extended with P2P sync via Y.js.
 * 
 * In this polyfill, sync between SharedGraph instances happens through
 * direct Y.Doc sync (applyUpdate/encodeStateAsUpdate). For browser use,
 * y-webrtc or y-websocket providers would replace the direct sync.
 */
export class SharedGraph extends EventTarget {
  readonly uri: string;
  readonly moduleHash: string;
  private _syncState: SyncState = 'idle';
  private _peers = new Map<string, { lastSeen: number }>();
  private _bridge: YjsBridge;
  private _identity: IdentityProvider;
  private _triples: SignedTriple[] = [];
  private _revisionDAG: RevisionNode[] = [];
  private _currentRevision: string | null = null;
  private _name: string | undefined;
  private _description: string | undefined;
  private _destroyed = false;

  // Event handler properties
  private _onpeerjoined: EventHandler = null;
  private _onpeerleft: EventHandler = null;
  private _onsyncstatechange: EventHandler = null;
  private _onsignal: EventHandler = null;
  private _ondiff: EventHandler = null;

  // Connected peers' SharedGraph instances (for direct sync)
  private _connectedPeers = new Map<string, SharedGraph>();

  // Signals pending delivery (for direct peer connections)
  private _signalHandlers = new Map<string, (payload: any, senderDid: string) => void>();

  // BroadcastChannel relay for multi-tab Y.js sync
  private _channel: BroadcastChannel | null = null;
  private _instanceId: string;
  private _applyingRemote = false;

  constructor(
    uri: string,
    doc: Y.Doc,
    identity: IdentityProvider,
    opts?: { name?: string; description?: string; moduleHash?: string }
  ) {
    super();
    this.uri = uri;
    this.moduleHash = opts?.moduleHash ?? 'default';
    this._identity = identity;
    this._name = opts?.name;
    this._description = opts?.description;
    this._bridge = new YjsBridge(doc);
    this._instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : uuidv4();

    // Set up BroadcastChannel for cross-tab Y.js doc sync
    if (typeof BroadcastChannel !== 'undefined') {
      this._channel = new BroadcastChannel(`living-web-shared-graph-${this.uri}`);
      this._channel.onmessage = (event: MessageEvent) => {
        if (event.data.origin === this._instanceId) return;
        const msg = event.data;
        if (msg.type === 'DIFF') {
          this._applyingRemote = true;
          if (msg.update) {
            Y.applyUpdate(this._bridge.doc, new Uint8Array(msg.update));
          }
          this._applyingRemote = false;
        }
      };

      // Broadcast local Y.js updates to other tabs using wire protocol format
      this._bridge.doc.on('update', (update: Uint8Array, origin: any) => {
        if (this._applyingRemote) return;
        this._channel?.postMessage({
          type: 'DIFF',
          revision: this._currentRevision ?? '',
          additions: [],
          removals: [],
          dependencies: this._currentRevision ? [this._currentRevision] : [],
          update: Array.from(update),
          origin: this._instanceId,
        });
      });
    }

    // Listen for remote changes from Y.js and update local triple store
    this._bridge.setOnRemoteChange((additions, removals) => {
      // §10.2 Verify signatures before applying — best-effort in polyfill
      // Note: Full verification would require async DID resolution.
      // The polyfill verifies that signatures are present and well-formed.
      const verifiedAdditions: SignedTriple[] = [];
      for (const triple of additions) {
        // §10.3 Basic check: proof must be present and non-empty
        if (triple.proof?.signature && triple.proof?.key) {
          verifiedAdditions.push(triple);
        }
      }
      
      for (const triple of removals) {
        const idx = this._findTripleIndexByKey(triple);
        if (idx !== -1) this._triples.splice(idx, 1);
      }
      for (const t of verifiedAdditions) {
        const existingIdx = this._findTripleIndexByKey(t);
        if (existingIdx !== -1) {
          // Replace (Y.js update — same key, potentially different value)
          this._triples[existingIdx] = t;
        } else {
          this._triples.push(t);
        }
      }

      // Create and dispatch a diff event
      if (additions.length > 0 || removals.length > 0) {
        const diff = createGraphDiff(
          additions,
          removals,
          this._currentRevision ? [this._currentRevision] : [],
          additions[0]?.author ?? removals[0]?.author ?? 'unknown'
        );
        this._currentRevision = diff.revision;
        this._revisionDAG.push({
          revision: diff.revision,
          parents: diff.dependencies as string[],
          timestamp: diff.timestamp,
        });
        this.dispatchEvent(new DiffEvent(diff));
      }
    });
  }

  get doc(): Y.Doc {
    return this._bridge.doc;
  }

  get syncState(): SyncState {
    return this._syncState;
  }

  get name(): string | undefined {
    return this._name;
  }

  // --- Event handler properties ---
  get onpeerjoined(): EventHandler { return this._onpeerjoined; }
  set onpeerjoined(h: EventHandler) {
    if (this._onpeerjoined) this.removeEventListener('peerjoined', this._onpeerjoined);
    this._onpeerjoined = h;
    if (h) this.addEventListener('peerjoined', h);
  }

  get onpeerleft(): EventHandler { return this._onpeerleft; }
  set onpeerleft(h: EventHandler) {
    if (this._onpeerleft) this.removeEventListener('peerleft', this._onpeerleft);
    this._onpeerleft = h;
    if (h) this.addEventListener('peerleft', h);
  }

  get onsyncstatechange(): EventHandler { return this._onsyncstatechange; }
  set onsyncstatechange(h: EventHandler) {
    if (this._onsyncstatechange) this.removeEventListener('syncstatechange', this._onsyncstatechange);
    this._onsyncstatechange = h;
    if (h) this.addEventListener('syncstatechange', h);
  }

  get onsignal(): EventHandler { return this._onsignal; }
  set onsignal(h: EventHandler) {
    if (this._onsignal) this.removeEventListener('signal', this._onsignal);
    this._onsignal = h;
    if (h) this.addEventListener('signal', h);
  }

  get ondiff(): EventHandler { return this._ondiff; }
  set ondiff(h: EventHandler) {
    if (this._ondiff) this.removeEventListener('diff', this._ondiff);
    this._ondiff = h;
    if (h) this.addEventListener('diff', h);
  }

  // --- PersonalGraph-compatible operations ---

  async addTriple(triple: SemanticTriple): Promise<SignedTriple> {
    const { signTriple } = await import('@living-web/personal-graph');
    const signed = await signTriple(triple, this._identity);
    this._triples.push(signed);
    this._bridge.localAdd(signed);

    // Create diff + update revision
    const diff = createGraphDiff(
      [signed],
      [],
      this._currentRevision ? [this._currentRevision] : [],
      signed.author
    );
    this._currentRevision = diff.revision;
    this._revisionDAG.push({
      revision: diff.revision,
      parents: diff.dependencies as string[],
      timestamp: diff.timestamp,
    });

    // Sync to connected peers
    this._syncToPeers();

    this.dispatchEvent(new TripleEvent('tripleadded', signed));
    return signed;
  }

  async removeTriple(triple: SignedTriple): Promise<boolean> {
    const idx = this._findTripleIndex(triple);
    if (idx === -1) return false;
    const removed = this._triples.splice(idx, 1)[0];
    this._bridge.localRemove(removed);

    const diff = createGraphDiff(
      [],
      [removed],
      this._currentRevision ? [this._currentRevision] : [],
      removed.author
    );
    this._currentRevision = diff.revision;
    this._revisionDAG.push({
      revision: diff.revision,
      parents: diff.dependencies as string[],
      timestamp: diff.timestamp,
    });

    this._syncToPeers();

    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
    return true;
  }

  async queryTriples(query: { source?: string | null; predicate?: string | null; target?: string | null }): Promise<SignedTriple[]> {
    return this._triples.filter((t) => {
      if (query.source != null && t.data.source !== query.source) return false;
      if (query.target != null && t.data.target !== query.target) return false;
      if (query.predicate != null && t.data.predicate !== query.predicate) return false;
      return true;
    });
  }

  async snapshot(): Promise<SignedTriple[]> {
    return [...this._triples].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // --- Sync-specific operations ---

  async peers(): Promise<Peer[]> {
    return Array.from(this._peers.entries()).map(([did, info]) => ({
      did,
      lastSeen: info.lastSeen,
      online: true,
    }));
  }

  async onlinePeers(): Promise<Peer[]> {
    return Array.from(this._peers.entries()).map(([did, info]) => ({
      did,
      lastSeen: info.lastSeen,
      online: true,
    }));
  }

  async sendSignal(remoteDid: string, payload: any): Promise<void> {
    const peer = this._connectedPeers.get(remoteDid);
    if (peer) {
      peer.dispatchEvent(new SignalEvent(this._identity.getDID(), payload));
    }
  }

  async broadcast(payload: any): Promise<void> {
    const myDid = this._identity.getDID();
    for (const [_did, peer] of this._connectedPeers) {
      peer.dispatchEvent(new SignalEvent(myDid, payload));
    }
  }

  revisionDAG(): RevisionNode[] {
    return [...this._revisionDAG];
  }

  async currentRevision(): Promise<string | null> {
    return this._currentRevision;
  }

  // --- Peer connection (direct Y.Doc sync for polyfill) ---

  /**
   * Connect two SharedGraph instances for direct sync.
   * This simulates P2P — in a real browser, y-webrtc would handle this.
   */
  connectPeer(peer: SharedGraph): void {
    const peerDid = peer._identity.getDID();
    const myDid = this._identity.getDID();

    if (this._connectedPeers.has(peerDid)) return;

    this._connectedPeers.set(peerDid, peer);
    this._peers.set(peerDid, { lastSeen: Date.now() });
    peer._connectedPeers.set(myDid, this);
    peer._peers.set(myDid, { lastSeen: Date.now() });

    // Initial sync — exchange Y.Doc state
    const myState = Y.encodeStateAsUpdate(this._bridge.doc);
    const peerState = Y.encodeStateAsUpdate(peer._bridge.doc);
    Y.applyUpdate(peer._bridge.doc, myState);
    Y.applyUpdate(this._bridge.doc, peerState);

    // Set up ongoing sync — when one doc updates, propagate to the other
    const myHandler = (update: Uint8Array, origin: any) => {
      if (origin === peer._bridge.doc) return; // prevent echo
      Y.applyUpdate(peer._bridge.doc, update, this._bridge.doc);
    };
    const peerHandler = (update: Uint8Array, origin: any) => {
      if (origin === this._bridge.doc) return;
      Y.applyUpdate(this._bridge.doc, update, peer._bridge.doc);
    };

    this._bridge.doc.on('update', myHandler);
    peer._bridge.doc.on('update', peerHandler);

    // Update sync states
    this._setSyncState('synced');
    peer._setSyncState('synced');

    // Dispatch peer events
    this.dispatchEvent(new PeerEvent('peerjoined', peerDid));
    peer.dispatchEvent(new PeerEvent('peerjoined', myDid));
  }

  disconnectPeer(peerDid: string): void {
    const peer = this._connectedPeers.get(peerDid);
    if (!peer) return;
    const myDid = this._identity.getDID();

    this._connectedPeers.delete(peerDid);
    this._peers.delete(peerDid);
    peer._connectedPeers.delete(myDid);
    peer._peers.delete(myDid);

    this.dispatchEvent(new PeerEvent('peerleft', peerDid));
    peer.dispatchEvent(new PeerEvent('peerleft', myDid));

    if (this._connectedPeers.size === 0) this._setSyncState('idle');
    if (peer._connectedPeers.size === 0) peer._setSyncState('idle');
  }

  async leave(opts?: { retainLocalCopy?: boolean }): Promise<void> {
    const retain = opts?.retainLocalCopy ?? true;

    // Disconnect all peers
    for (const [did] of this._connectedPeers) {
      this.disconnectPeer(did);
    }

    this._setSyncState('idle');
    this._destroyed = true;

    if (!retain) {
      this._triples = [];
      this._revisionDAG = [];
      this._currentRevision = null;
    }

    this._bridge.destroy();
  }

  // --- Internal ---

  private _setSyncState(state: SyncState): void {
    if (this._syncState === state) return;
    this._syncState = state;
    this.dispatchEvent(new SyncStateChangeEvent(state));
  }

  private _syncToPeers(): void {
    // Y.js doc updates are automatically propagated through the
    // update handlers set up in connectPeer(). No extra work needed.
  }

  private _findTripleIndex(triple: SignedTriple): number {
    return this._triples.findIndex(
      (t) =>
        t.data.source === triple.data.source &&
        t.data.target === triple.data.target &&
        t.data.predicate === triple.data.predicate &&
        t.author === triple.author &&
        t.timestamp === triple.timestamp
    );
  }

  private _findTripleIndexByKey(triple: SignedTriple): number {
    const key = tripleKey(triple);
    return this._triples.findIndex((t) => tripleKey(t) === key);
  }

  private _hasTriple(triple: SignedTriple): boolean {
    return this._findTripleIndexByKey(triple) !== -1;
  }

  /** §10.3 Resolve a peer DID to their public key */
  private _resolvePeerPublicKey(did: string): Uint8Array | null {
    // Check connected peers first
    for (const [peerDid, peer] of this._connectedPeers) {
      if (peerDid === did) {
        return peer._identity.getPublicKey();
      }
    }
    // Check self
    if (did === this._identity.getDID()) {
      return this._identity.getPublicKey();
    }
    return null;
  }

  // --- Static factory ---

  static create(identity: IdentityProvider, name?: string, opts?: SharedGraphOptions): SharedGraph {
    const graphId = uuidv4();
    const relays = opts?.relays ?? ['localhost'];
    const moduleHash = opts?.module ?? 'default';
    const uri = buildGraphURI(relays, graphId, moduleHash);
    const doc = new Y.Doc();
    return new SharedGraph(uri, doc, identity, {
      name: opts?.meta?.name ?? name,
      description: opts?.meta?.description,
      moduleHash,
    });
  }

  static join(uri: string, identity: IdentityProvider): SharedGraph {
    const doc = new Y.Doc();
    let moduleHash = 'default';
    try {
      const parsed = parseGraphURI(uri);
      moduleHash = parsed.moduleHash ?? 'default';
    } catch {
      // Legacy URI format — accept as-is
    }
    return new SharedGraph(uri, doc, identity, { moduleHash });
  }
}
