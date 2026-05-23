/**
 * The default sync module.
 *
 * Polyfill transport is a BroadcastChannel keyed by spaceUri (so peers in the
 * same browser-origin sync within the namespace without a relay). A real
 * implementation would substitute WebTransport + a relay; the same module
 * interface applies.
 */

import type { Context, SignedTriple } from '@living-web/personal-graph';
import {
  ContextDiff,
  DiffEvent,
  PeerEvent,
  SignalEvent,
  SyncStateChangeEvent,
  computeRevision,
  createContextDiff,
  deriveSpaceUri,
  type ContextSyncRuntime,
  type ContextSyncState,
  type Peer,
  type PublishOptions,
  type PublishedContext,
} from '@living-web/context-sync';

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

function serialiseDiff(diff: ContextDiff): ChannelDiffPayload {
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
    diff: serialiseDiff(diff),
  });
}

export const defaultSyncModule: ContextSyncRuntime = {
  async publish(context: Context, options: PublishOptions = {}): Promise<PublishedContext> {
    const existing = published.get(context);
    if (existing) {
      return {
        graphDid: context.did,
        spaceUri: existing.spaceUri,
        moduleHash: existing.moduleHash,
        relays: existing.relays,
      };
    }

    const moduleHash = options.moduleHash ?? DEFAULT_MODULE_HASH;
    const topology = options.spaceTopology ?? 'unified';
    const spaceUri = deriveSpaceUri(topology, context.did, { customName: options.customSpace });
    const sessionId = getSessionId();

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(`living-web-space-${spaceUri}`);
      channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
        const msg = event.data;
        if (msg.origin === sessionId) return;
        const state = published.get(context);
        if (!state) return;
        if (msg.type === 'DIFF' && msg.diff.graphDid === context.did) {
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
          context.dispatchEvent(new DiffEvent(diff));
        } else if (msg.type === 'SIGNAL') {
          if (msg.to && msg.to.did !== context.getIdentity().getDID()) return;
          if (msg.to?.sessionId && msg.to.sessionId !== sessionId) return;
          context.dispatchEvent(new SignalEvent(msg.from, msg.payload));
        } else if (msg.type === 'PEER_HELLO') {
          const peer: Peer = { ...msg.peer, online: true, lastSeen: Date.now() };
          const key = `${peer.did}@${peer.sessionId}`;
          if (state.peers.has(key)) return;
          state.peers.set(key, peer);
          context.dispatchEvent(new PeerEvent('peerjoined', peer));
          channel?.postMessage({
            type: 'PEER_HELLO',
            origin: sessionId,
            peer: {
              did: context.getIdentity().getDID(),
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
          context.dispatchEvent(new PeerEvent('peerleft', { ...p, online: false }));
        }
      };
    }

    const tripleAddedListener: EventListener = (event) => {
      const triple = (event as CustomEvent<SignedTriple>).detail ?? (event as { triple?: SignedTriple }).triple;
      if (triple) emitDiff(context, [triple], []);
    };
    const tripleRemovedListener: EventListener = (event) => {
      const triple = (event as CustomEvent<SignedTriple>).detail ?? (event as { triple?: SignedTriple }).triple;
      if (triple) emitDiff(context, [], [triple]);
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
    published.set(context, state);

    context.addEventListener('tripleadded', tripleAddedListener);
    context.addEventListener('tripleremoved', tripleRemovedListener);

    const localDid = context.getIdentity().getDID();
    channel?.postMessage({
      type: 'PEER_HELLO',
      origin: sessionId,
      peer: { did: localDid, sessionId, online: true, lastSeen: Date.now() },
    });

    state.syncState = 'synced';
    context.dispatchEvent(new SyncStateChangeEvent('synced'));

    return { graphDid: context.did, spaceUri, moduleHash, relays: [...state.relays] };
  },

  async unpublish(context: Context): Promise<void> {
    const state = published.get(context);
    if (!state) return;
    const localDid = context.getIdentity().getDID();
    state.channel?.postMessage({
      type: 'PEER_BYE',
      origin: state.sessionId,
      peer: { did: localDid, sessionId: state.sessionId, online: false, lastSeen: Date.now() },
    });
    state.channel?.close();
    context.removeEventListener('tripleadded', state.tripleAddedListener);
    context.removeEventListener('tripleremoved', state.tripleRemovedListener);
    published.delete(context);
    context.dispatchEvent(new SyncStateChangeEvent('idle'));
  },

  async syncState(context: Context): Promise<ContextSyncState> {
    return published.get(context)?.syncState ?? 'idle';
  },

  async peers(context: Context): Promise<Peer[]> {
    return [...(published.get(context)?.peers.values() ?? [])];
  },

  async onlinePeers(context: Context): Promise<Peer[]> {
    return [...(published.get(context)?.peers.values() ?? [])].filter(p => p.online);
  },

  async currentRevision(context: Context): Promise<string> {
    const state = published.get(context);
    if (state && state.revisionChain.length > 0) {
      return state.revisionChain[state.revisionChain.length - 1];
    }
    const snap = await context.snapshot();
    return computeRevision(context.did, snap, [], []);
  },

  async sendSignal(context: Context, remoteDid: string, payload: BufferSource): Promise<void> {
    const state = published.get(context);
    if (!state?.channel) return;
    const localDid = context.getIdentity().getDID();
    state.channel.postMessage({
      type: 'SIGNAL',
      origin: state.sessionId,
      from: { did: localDid, sessionId: state.sessionId },
      to: { did: remoteDid },
      payload: toBytes(payload),
    });
  },

  async sendSignalToSession(
    context: Context,
    remoteDid: string,
    sessionId: string,
    payload: BufferSource,
  ): Promise<void> {
    const state = published.get(context);
    if (!state?.channel) return;
    const localDid = context.getIdentity().getDID();
    state.channel.postMessage({
      type: 'SIGNAL',
      origin: state.sessionId,
      from: { did: localDid, sessionId: state.sessionId },
      to: { did: remoteDid, sessionId },
      payload: toBytes(payload),
    });
  },

  async broadcast(context: Context, payload: BufferSource): Promise<void> {
    const state = published.get(context);
    if (!state?.channel) return;
    const localDid = context.getIdentity().getDID();
    state.channel.postMessage({
      type: 'SIGNAL',
      origin: state.sessionId,
      from: { did: localDid, sessionId: state.sessionId },
      to: null,
      payload: toBytes(payload),
    });
  },
};

// Wire messages exchanged over BroadcastChannel ---------------------------

interface ChannelDiffPayload {
  graphDid: string;
  revision: string;
  additions: SignedTriple[];
  removals: SignedTriple[];
  dependencies: string[];
  capabilityProof: { chain: string[]; caveatsSatisfied?: string[]; hasContentCaveats?: boolean } | null;
  author: string;
  timestamp: string;
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
