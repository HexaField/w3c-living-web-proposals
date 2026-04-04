import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import {
  PersonalGraph,
  SemanticTriple,
  type SignedTriple,
  type IdentityProvider,
  TripleEvent,
} from '@living-web/personal-graph';
import {
  type SyncState,
  type OnlinePeer,
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
  private _syncState: SyncState = 'idle';
  private _peers = new Map<string, { lastSeen: number }>();
  private _bridge: YjsBridge;
  private _identity: IdentityProvider;
  private _triples: SignedTriple[] = [];
  private _revisionDAG: RevisionNode[] = [];
  private _currentRevision: string | null = null;
  private _name: string | undefined;
  private _destroyed = false;

  // Event handler properties
  private _onpeerjoined: EventHandler = null;
  private _onpeerleft: EventHandler = null;
  private _onsyncstatechange: EventHandler = null;
  private _onsignal: EventHandler = null;

  // Connected peers' SharedGraph instances (for direct sync)
  private _connectedPeers = new Map<string, SharedGraph>();

  // Signals pending delivery (for direct peer connections)
  private _signalHandlers = new Map<string, (payload: any, senderDid: string) => void>();

  constructor(
    uri: string,
    doc: Y.Doc,
    identity: IdentityProvider,
    name?: string
  ) {
    super();
    this.uri = uri;
    this._identity = identity;
    this._name = name;
    this._bridge = new YjsBridge(doc);

    // Listen for remote changes from Y.js and update local triple store
    this._bridge.setOnRemoteChange((additions, removals) => {
      for (const triple of removals) {
        const idx = this._findTripleIndexByKey(triple);
        if (idx !== -1) this._triples.splice(idx, 1);
      }
      for (const t of additions) {
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

  async peers(): Promise<string[]> {
    return Array.from(this._peers.keys());
  }

  async onlinePeers(): Promise<OnlinePeer[]> {
    return Array.from(this._peers.entries()).map(([did, info]) => ({
      did,
      lastSeen: info.lastSeen,
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

  currentRevision(): string | null {
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

  // --- Static factory ---

  static create(identity: IdentityProvider, name?: string, opts?: SharedGraphOptions): SharedGraph {
    const uri = `shared-graph://${uuidv4()}`;
    const doc = new Y.Doc();
    return new SharedGraph(uri, doc, identity, name);
  }

  static join(uri: string, identity: IdentityProvider): SharedGraph {
    const doc = new Y.Doc();
    return new SharedGraph(uri, doc, identity);
  }
}
