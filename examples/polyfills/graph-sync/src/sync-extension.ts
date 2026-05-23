/**
 * Sync extension — mixed into Context.prototype at install time.
 *
 * Methods added to Context:
 *   publish(options)
 *   unpublish()
 *   syncState()
 *   peers() / onlinePeers()
 *   currentRevision()
 *   sendSignal / sendSignalToSession / broadcast
 *
 * Polyfill transport is a BroadcastChannel keyed by spaceUri. A real
 * implementation would substitute WebTransport + a relay, governed by the
 * sync module identified by `moduleHash`.
 */

import { Context, type SignedTriple } from '@living-web/personal-graph';
import { deriveSpaceUri } from './space.js';
import { createContextDiff, computeRevision } from './diff.js';
import {
  ContextDiff,
  type Peer,
  type PublishOptions,
  type PublishedContext,
  type ContextSyncState,
  DiffEvent,
  SignalEvent,
  PeerEvent,
  SyncStateChangeEvent,
} from './types.js';

const DEFAULT_MODULE_HASH = 'sha256-default-or-set-crdt-v1';

interface PublishedState {
  spaceUri: string;
  moduleHash: string;
  relays: string[];
  channel: BroadcastChannel | null;
  sessionId: string;
  peers: Map<string, Peer>;
  syncState: ContextSyncState;
  tripleAddedListener: EventListener;
  tripleRemovedListener: EventListener;
  revisionChain: string[];
}

const published = new WeakMap<Context, PublishedState>();

function getSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `sess-${Math.random().toString(36).slice(2)}`;
}

function toBytes(payload: BufferSource): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function serialiseDiff(diff: ContextDiff): unknown {
  return {
    graphDid: diff.graphDid,
    revision: diff.revision,
    additions: [...diff.additions],
    removals: [...diff.removals],
    dependencies: [...diff.dependencies],
    capabilityProof: diff.capabilityProof,
    author: diff.author,
    timestamp: diff.timestamp,
    diffsSinceSnapshot: diff.diffsSinceSnapshot,
  };
}

async function publish(this: Context, options: PublishOptions = {}): Promise<PublishedContext> {
  const existing = published.get(this);
  if (existing) {
    return {
      graphDid: this.did,
      spaceUri: existing.spaceUri,
      moduleHash: existing.moduleHash,
      relays: existing.relays,
    };
  }

  const moduleHash = options.moduleHash ?? DEFAULT_MODULE_HASH;
  const topology = options.spaceTopology ?? 'unified';
  const spaceUri = deriveSpaceUri(topology, this.did, { customName: options.customSpace });
  const sessionId = getSessionId();
  const ctx = this;

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`living-web-space-${spaceUri}`);
    channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      const msg = event.data;
      if (msg.origin === sessionId) return;
      const state = published.get(ctx);
      if (!state) return;
      if (msg.type === 'DIFF' && msg.diff.graphDid === ctx.did) {
        const diff = new ContextDiff({
          graphDid: msg.diff.graphDid,
          revision: msg.diff.revision,
          additions: msg.diff.additions,
          removals: msg.diff.removals,
          dependencies: msg.diff.dependencies,
          capabilityProof: msg.diff.capabilityProof,
          author: msg.diff.author,
          timestamp: msg.diff.timestamp,
          diffsSinceSnapshot: msg.diff.diffsSinceSnapshot,
        });
        if (!state.revisionChain.includes(diff.revision)) state.revisionChain.push(diff.revision);
        ctx.dispatchEvent(new DiffEvent(diff));
      } else if (msg.type === 'SIGNAL') {
        if (msg.to && msg.to.did !== ctx.getIdentity().getDID()) return;
        if (msg.to?.sessionId && msg.to.sessionId !== sessionId) return;
        ctx.dispatchEvent(new SignalEvent(msg.from, msg.payload));
      } else if (msg.type === 'PEER_HELLO') {
        const peer: Peer = { ...msg.peer, online: true, lastSeen: Date.now() };
        const key = `${peer.did}@${peer.sessionId}`;
        if (state.peers.has(key)) return;
        state.peers.set(key, peer);
        ctx.dispatchEvent(new PeerEvent('peerjoined', peer));
        // Reply so the joiner learns about us.
        channel?.postMessage({
          type: 'PEER_HELLO',
          origin: sessionId,
          peer: {
            did: ctx.getIdentity().getDID(),
            sessionId,
            online: true,
            lastSeen: Date.now(),
          },
        });
      } else if (msg.type === 'PEER_BYE') {
        const key = `${msg.peer.did}@${msg.peer.sessionId}`;
        const p = state.peers.get(key);
        if (!p) return;
        state.peers.delete(key);
        ctx.dispatchEvent(new PeerEvent('peerleft', { ...p, online: false }));
      }
    };
  }

  const tripleAddedListener: EventListener = (event) => {
    const triple = (event as CustomEvent<SignedTriple>).detail ?? (event as { triple?: SignedTriple }).triple;
    if (triple) emitDiff(ctx, [triple], []);
  };
  const tripleRemovedListener: EventListener = (event) => {
    const triple = (event as CustomEvent<SignedTriple>).detail ?? (event as { triple?: SignedTriple }).triple;
    if (triple) emitDiff(ctx, [], [triple]);
  };

  const state: PublishedState = {
    spaceUri,
    moduleHash,
    relays: options.relays ?? [],
    channel,
    sessionId,
    peers: new Map(),
    syncState: 'syncing',
    tripleAddedListener,
    tripleRemovedListener,
    revisionChain: [],
  };
  published.set(this, state);

  this.addEventListener('tripleadded', tripleAddedListener);
  this.addEventListener('tripleremoved', tripleRemovedListener);

  const localDid = this.getIdentity().getDID();
  channel?.postMessage({
    type: 'PEER_HELLO',
    origin: sessionId,
    peer: { did: localDid, sessionId, online: true, lastSeen: Date.now() },
  });

  state.syncState = 'synced';
  this.dispatchEvent(new SyncStateChangeEvent('synced'));

  return { graphDid: this.did, spaceUri, moduleHash, relays: [...state.relays] };
}

function emitDiff(context: Context, additions: SignedTriple[], removals: SignedTriple[]): void {
  const state = published.get(context);
  if (!state) return;
  const author = context.getIdentity().getDID();
  const diff = createContextDiff({
    graphDid: context.did,
    additions,
    removals,
    dependencies: state.revisionChain.length === 0 ? [] : [state.revisionChain[state.revisionChain.length - 1]],
    author,
  });
  state.revisionChain.push(diff.revision);
  state.channel?.postMessage({
    type: 'DIFF',
    origin: state.sessionId,
    from: { did: author, sessionId: state.sessionId },
    diff: serialiseDiff(diff) as ChannelDiffPayload,
  });
}

async function unpublish(this: Context): Promise<void> {
  const state = published.get(this);
  if (!state) return;
  const localDid = this.getIdentity().getDID();
  state.channel?.postMessage({
    type: 'PEER_BYE',
    origin: state.sessionId,
    peer: { did: localDid, sessionId: state.sessionId, online: false, lastSeen: Date.now() },
  });
  state.channel?.close();
  this.removeEventListener('tripleadded', state.tripleAddedListener);
  this.removeEventListener('tripleremoved', state.tripleRemovedListener);
  published.delete(this);
  this.dispatchEvent(new SyncStateChangeEvent('idle'));
}

async function syncState(this: Context): Promise<ContextSyncState> {
  return published.get(this)?.syncState ?? 'idle';
}

async function peers(this: Context): Promise<Peer[]> {
  return [...(published.get(this)?.peers.values() ?? [])];
}

async function onlinePeers(this: Context): Promise<Peer[]> {
  return [...(published.get(this)?.peers.values() ?? [])].filter(p => p.online);
}

async function currentRevision(this: Context): Promise<string> {
  const state = published.get(this);
  if (state && state.revisionChain.length > 0) {
    return state.revisionChain[state.revisionChain.length - 1];
  }
  const snap = await this.snapshot();
  return computeRevision(this.did, snap, [], []);
}

async function sendSignal(this: Context, remoteDid: string, payload: BufferSource): Promise<void> {
  const state = published.get(this);
  if (!state?.channel) return;
  const localDid = this.getIdentity().getDID();
  state.channel.postMessage({
    type: 'SIGNAL',
    origin: state.sessionId,
    from: { did: localDid, sessionId: state.sessionId },
    to: { did: remoteDid },
    payload: toBytes(payload),
  });
}

async function sendSignalToSession(
  this: Context,
  remoteDid: string,
  sessionId: string,
  payload: BufferSource,
): Promise<void> {
  const state = published.get(this);
  if (!state?.channel) return;
  const localDid = this.getIdentity().getDID();
  state.channel.postMessage({
    type: 'SIGNAL',
    origin: state.sessionId,
    from: { did: localDid, sessionId: state.sessionId },
    to: { did: remoteDid, sessionId },
    payload: toBytes(payload),
  });
}

async function broadcast(this: Context, payload: BufferSource): Promise<void> {
  const state = published.get(this);
  if (!state?.channel) return;
  const localDid = this.getIdentity().getDID();
  state.channel.postMessage({
    type: 'SIGNAL',
    origin: state.sessionId,
    from: { did: localDid, sessionId: state.sessionId },
    to: null,
    payload: toBytes(payload),
  });
}

// Wire messages exchanged over BroadcastChannel ---------------------------

interface ChannelDiffPayload {
  graphDid: string;
  revision: string;
  additions: SignedTriple[];
  removals: SignedTriple[];
  dependencies: string[];
  capabilityProof: { chain: string[]; caveatsSatisfied?: string[]; hasContentCaveats?: boolean } | null;
  author: string;
  timestamp: number;
  diffsSinceSnapshot: number;
}

type ChannelMessage =
  | { type: 'DIFF'; origin: string; from: { did: string; sessionId: string }; diff: ChannelDiffPayload }
  | {
      type: 'SIGNAL';
      origin: string;
      from: { did: string; sessionId: string };
      to: { did: string; sessionId?: string } | null;
      payload: Uint8Array;
    }
  | { type: 'PEER_HELLO'; origin: string; peer: Peer }
  | { type: 'PEER_BYE'; origin: string; peer: Peer };

declare module '@living-web/personal-graph' {
  interface Context {
    publish(options?: PublishOptions): Promise<PublishedContext>;
    unpublish(): Promise<void>;
    syncState(): Promise<ContextSyncState>;
    peers(): Promise<Peer[]>;
    onlinePeers(): Promise<Peer[]>;
    currentRevision(): Promise<string>;
    sendSignal(remoteDid: string, payload: BufferSource): Promise<void>;
    sendSignalToSession(remoteDid: string, sessionId: string, payload: BufferSource): Promise<void>;
    broadcast(payload: BufferSource): Promise<void>;
  }
}

export function installSyncExtension(): void {
  const proto = Context.prototype as Context;
  if (typeof proto.publish === 'function') return;
  Object.assign(Context.prototype, {
    publish,
    unpublish,
    syncState,
    peers,
    onlinePeers,
    currentRevision,
    sendSignal,
    sendSignalToSession,
    broadcast,
  });
}
