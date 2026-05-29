/**
 * The default sync module.
 *
 * Polyfill transport is a BroadcastChannel keyed by spaceUri (so peers in the
 * same browser-origin sync within the namespace without a relay). A real
 * implementation would substitute WebTransport + a relay; the same module
 * interface applies.
 *
 * ## Read-side authorisation (Spec 05 §9.2.2, Spec 09 §10.2)
 *
 * Production implementations that add a `PULL`/`SNAPSHOT` exchange (Spec 09
 * §5.3 / §5.4) MUST gate the responder's reply via the governance engine's
 * `validateAction("mountContext", requesterDid, { capabilityProof })`
 * before serving. The reference call site:
 *
 * ```ts
 * import { GraphGovernanceEngine } from '@living-web/capability-framework';
 *
 * async function handlePull(graph: Graph, msg: PullMessage) {
 *   const engine = new GraphGovernanceEngine(graphContextFor(graph));
 *   const r = await engine.validateAction('mountContext', msg.authorDid, {
 *     capabilityProof: msg.capabilityProof,
 *   });
 *   if (!r.allowed) {
 *     send({ type: 'PULL_DENIED', graphDid: graph.did, reason: r.reason });
 *     return;   // MUST NOT send SNAPSHOT or DIFFs
 *   }
 *   send({ type: 'SNAPSHOT', graphDid: graph.did, snapshot: await graph.getAsSnapshot() });
 * }
 * ```
 *
 * The BroadcastChannel-based default module currently gossips live diffs only —
 * it does not implement the PULL request/response pattern. When that
 * protocol is added (or when this module is replaced by a relay-backed
 * production module), the call above is the integration point.
 *
 * The security-critical decision is the `engine.validateAction(...)` call;
 * the validation logic is covered by `@living-web/capability-framework`'s
 * governance-edge-cases conformance suite (read-side authorisation tests).
 */

import type { Graph, SignedTriple } from '@living-web/personal-graph';
import {
  GraphDiff,
  DiffEvent,
  PeerEvent,
  SignalEvent,
  SyncStateChangeEvent,
  computeRevision,
  createContextDiff,
  deriveSpaceUri,
  type CapabilityProof,
  type ContextSyncRuntime,
  type ContextSyncState,
  type Peer,
  type PublishOptions,
  type PublishedGraph,
} from '@living-web/context-sync';
import { defaultValidateDiff } from './validate.js';
import { defaultModuleManifest } from './manifest.js';

const DEFAULT_MODULE_HASH = defaultModuleManifest.wasmContentHash;

/** Spec 05 §5.2.2 signature production helper. Wraps the IdentityProvider's
 *  Ed25519 signer and returns a hex string for the wire payload. */
async function signCommit(graph: Graph, commitIdHex: string): Promise<string> {
  const sig = await graph.getIdentity().sign(hexBytes(commitIdHex));
  return toHex(sig);
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sync requires the graph to have a stable, content-independent identity —
 * a `did:graph` ([[GROUP-IDENTITY]]). Ungroupified graphs have only a
 * content-hash IRI that changes per mutation; they cannot be subscribed to
 * across edits. Throw `NotSupportedError` if the graph isn't groupified.
 */
function requireDid(graph: Graph): string {
  if (!graph.did) {
    throw new DOMException(
      `Graph ${graph.iri} is not groupified — sync requires a did:graph (per [[GROUP-IDENTITY]]). ` +
      `Call store.groupify() or store.createGroup() before publish().`,
      'NotSupportedError',
    );
  }
  return graph.did;
}

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

const published = new WeakMap<Graph, PublishedState>();

function getSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `sess-${Math.random().toString(36).slice(2)}`;
}

function toBytes(payload: BufferSource): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function serialiseDiff(diff: GraphDiff): ChannelDiffPayload {
  return {
    graphDid: diff.graphDid,
    revision: diff.revision,
    commitId: diff.commitId,
    additions: [...diff.additions],
    removals: [...diff.removals],
    dependencies: [...diff.dependencies],
    capabilityProof: diff.capabilityProof,
    author: diff.author,
    timestamp: diff.timestamp,
    diffsSinceSnapshot: diff.diffsSinceSnapshot,
    signature: diff.signature,
  };
}

async function emitDiff(graph: Graph, additions: SignedTriple[], removals: SignedTriple[]): Promise<void> {
  const state = published.get(graph);
  if (!state) return;
  const author = graph.getIdentity().getDID();
  const diff = await createContextDiff({
    graphDid: requireDid(graph),
    additions,
    removals,
    dependencies: state.revisionChain.length === 0 ? [] : [state.revisionChain[state.revisionChain.length - 1]],
    author,
    sign: (commitIdHex) => signCommit(graph, commitIdHex),
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
  async publish(graph: Graph, options: PublishOptions = {}): Promise<PublishedGraph> {
    const existing = published.get(graph);
    if (existing) {
      return {
        graphDid: requireDid(graph),
        spaceUri: existing.spaceUri,
        moduleHash: existing.moduleHash,
        relays: existing.relays,
      };
    }

    // Spec 05 §6.1 — the authoritative module hash is the one bound into
    // the graph's DID seed (Spec 03 §4.5). `options.moduleHash` is a
    // bootstrap hint; if it disagrees with the seed, the seed wins and
    // we reject to surface the mismatch. Ungroupified graphs fall back
    // to the hint or the polyfill default.
    const seedTriples = graph.did
      ? await graph.queryTriples({ subject: graph.did, predicate: 'group://syncModule' })
      : [];
    const seedModule = seedTriples[0]?.data.object;
    if (seedModule && options.moduleHash && options.moduleHash !== seedModule) {
      throw new DOMException(
        `options.moduleHash (${options.moduleHash}) disagrees with the graph's group://syncModule seed (${seedModule}); the seed is authoritative.`,
        'InvalidStateError',
      );
    }
    const moduleHash = seedModule ?? options.moduleHash ?? DEFAULT_MODULE_HASH;
    const topology = options.spaceTopology ?? 'unified';
    const spaceUri = deriveSpaceUri(topology, requireDid(graph), { customName: options.customSpace });
    const sessionId = getSessionId();

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(`living-web-space-${spaceUri}`);
      channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
        const msg = event.data;
        if (msg.origin === sessionId) return;
        const state = published.get(graph);
        if (!state) return;
        if (msg.type === 'DIFF' && msg.diff.graphDid === requireDid(graph)) {
          // Reconstruct the GraphDiff carrying the wire-supplied commitId
          // and signature so Spec 05 §9.2.1 step 0 can verify against the
          // received bundle (not a recomputed one).
          const diff = new GraphDiff({
            graphDid: msg.diff.graphDid,
            revision: msg.diff.revision,
            commitId: msg.diff.commitId,
            additions: msg.diff.additions,
            removals: msg.diff.removals,
            dependencies: msg.diff.dependencies,
            capabilityProof: msg.diff.capabilityProof,
            author: msg.diff.author,
            timestamp: msg.diff.timestamp,
            diffsSinceSnapshot: msg.diff.diffsSinceSnapshot,
            signature: msg.diff.signature,
          });
          // Spec 06 §5.5 — validation runs in-module. Delegates to the
          // module's validateDiff (bundle signature + governance engine).
          // Sync-blocking per Spec 05 §9.3: reject silently if not accepted.
          void (async () => {
            const result = await defaultValidateDiff(graph, diff);
            if (!result.accepted) {
              // Reject: don't store, don't apply, don't re-emit (Spec 05 §9.3).
              // Production modules would log this to an audit channel.
              return;
            }
            if (!state.revisionChain.includes(diff.revision)) state.revisionChain.push(diff.revision);
            graph.dispatchEvent(new DiffEvent(diff));
          })();
        } else if (msg.type === 'SIGNAL') {
          if (msg.to && msg.to.did !== graph.getIdentity().getDID()) return;
          if (msg.to?.sessionId && msg.to.sessionId !== sessionId) return;
          graph.dispatchEvent(new SignalEvent(msg.from, msg.payload));
        } else if (msg.type === 'PEER_HELLO') {
          const peer: Peer = { ...msg.peer, online: true, lastSeen: Date.now() };
          const key = `${peer.did}@${peer.sessionId}`;
          if (state.peers.has(key)) return;
          state.peers.set(key, peer);
          graph.dispatchEvent(new PeerEvent('peerjoined', peer));
          channel?.postMessage({
            type: 'PEER_HELLO',
            origin: sessionId,
            peer: {
              did: graph.getIdentity().getDID(),
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
          graph.dispatchEvent(new PeerEvent('peerleft', { ...p, online: false }));
        }
      };
    }

    const tripleAddedListener: EventListener = (event) => {
      const triple = (event as CustomEvent<SignedTriple>).detail ?? (event as { triple?: SignedTriple }).triple;
      if (triple) void emitDiff(graph, [triple], []);
    };
    const tripleRemovedListener: EventListener = (event) => {
      const triple = (event as CustomEvent<SignedTriple>).detail ?? (event as { triple?: SignedTriple }).triple;
      if (triple) void emitDiff(graph, [], [triple]);
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
    published.set(graph, state);

    graph.addEventListener('tripleadded', tripleAddedListener);
    graph.addEventListener('tripleremoved', tripleRemovedListener);

    const localDid = graph.getIdentity().getDID();
    channel?.postMessage({
      type: 'PEER_HELLO',
      origin: sessionId,
      peer: { did: localDid, sessionId, online: true, lastSeen: Date.now() },
    });

    state.syncState = 'synced';
    graph.dispatchEvent(new SyncStateChangeEvent('synced'));

    return { graphDid: requireDid(graph), spaceUri, moduleHash, relays: [...state.relays] };
  },

  async unpublish(graph: Graph): Promise<void> {
    const state = published.get(graph);
    if (!state) return;
    const localDid = graph.getIdentity().getDID();
    state.channel?.postMessage({
      type: 'PEER_BYE',
      origin: state.sessionId,
      peer: { did: localDid, sessionId: state.sessionId, online: false, lastSeen: Date.now() },
    });
    state.channel?.close();
    graph.removeEventListener('tripleadded', state.tripleAddedListener);
    graph.removeEventListener('tripleremoved', state.tripleRemovedListener);
    published.delete(graph);
    graph.dispatchEvent(new SyncStateChangeEvent('idle'));
  },

  async syncState(graph: Graph): Promise<ContextSyncState> {
    return published.get(graph)?.syncState ?? 'idle';
  },

  async peers(graph: Graph): Promise<Peer[]> {
    return [...(published.get(graph)?.peers.values() ?? [])];
  },

  async onlinePeers(graph: Graph): Promise<Peer[]> {
    return [...(published.get(graph)?.peers.values() ?? [])].filter(p => p.online);
  },

  async currentRevision(graph: Graph): Promise<string> {
    const state = published.get(graph);
    if (state && state.revisionChain.length > 0) {
      return state.revisionChain[state.revisionChain.length - 1];
    }
    const snap = await graph.snapshot();
    return computeRevision(requireDid(graph), snap, [], []);
  },

  async sendSignal(graph: Graph, remoteDid: string, payload: BufferSource): Promise<void> {
    const state = published.get(graph);
    if (!state?.channel) return;
    const localDid = graph.getIdentity().getDID();
    state.channel.postMessage({
      type: 'SIGNAL',
      origin: state.sessionId,
      from: { did: localDid, sessionId: state.sessionId },
      to: { did: remoteDid },
      payload: toBytes(payload),
    });
  },

  async sendSignalToSession(
    graph: Graph,
    remoteDid: string,
    sessionId: string,
    payload: BufferSource,
  ): Promise<void> {
    const state = published.get(graph);
    if (!state?.channel) return;
    const localDid = graph.getIdentity().getDID();
    state.channel.postMessage({
      type: 'SIGNAL',
      origin: state.sessionId,
      from: { did: localDid, sessionId: state.sessionId },
      to: { did: remoteDid, sessionId },
      payload: toBytes(payload),
    });
  },

  async broadcast(graph: Graph, payload: BufferSource): Promise<void> {
    const state = published.get(graph);
    if (!state?.channel) return;
    const localDid = graph.getIdentity().getDID();
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
  commitId: string;
  additions: SignedTriple[];
  removals: SignedTriple[];
  dependencies: string[];
  capabilityProof: {
    chain: string[];
    caveatsSatisfied?: string[];
    hasContentCaveats?: boolean;
    presentations?: object[];
  } | null;
  author: string;
  timestamp: string;
  diffsSinceSnapshot: number;
  signature: string;
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
