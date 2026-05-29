/**
 * Sync module architecture — defines the contract a sync module fulfils and
 * the installation function it calls to take over the active runtime.
 *
 * Two related shapes are exported:
 *
 *   - {@link GraphSyncModule} — the WASM-callable interface defined in Spec 06
 *     §5. Implemented by sync modules themselves. Production hosts run these
 *     in a WebAssembly sandbox with capability-mediated handles.
 *
 *   - {@link SyncModule} (alias of `ContextSyncRuntime`) — the per-graph
 *     runtime surface that the Graph API delegates to. A production host
 *     adapts a {@link GraphSyncModule} into this shape; this polyfill exposes
 *     {@link installSyncModule} that accepts either form.
 *
 * The polyfill is intentionally minimal: it does not provide the WASM
 * sandbox, capability-handle minting, or in-WASM execution-budget enforcement
 * — those are normative for a conforming user agent but out of scope here.
 * See {@link https://www.w3.org/TR/sync-module-architecture/} for the
 * complete normative model.
 */

import {
  installSyncRuntime,
  type ContextSyncRuntime,
  type CapabilityProof,
  type GraphDiff,
  type Peer,
  type SyncValidationResult,
} from '@living-web/context-sync';
import type { Graph } from '@living-web/personal-graph';

// ───── Spec 06 §5: GraphSyncModule interface ──────────────────────────────

/**
 * The contract a sync module implements (Spec 06 §5.1). Production hosts
 * invoke these entry points via WASM exports; this polyfill exposes the
 * same shape as TypeScript methods so reference modules can demonstrate the
 * interface without a sandbox.
 */
export interface GraphSyncModule {
  // Lifecycle
  init(config: ModuleConfig): void | Promise<void>;
  shutdown(): void | Promise<void>;

  // Transport (per space)
  connect(spaceUri: string, localDid: string): void | Promise<void>;
  disconnect(): void | Promise<void>;

  // Sync (per graph)
  commit(graphDid: string, diff: GraphDiff): void | Promise<void>;
  onRemoteDiff(callback: RemoteDiffCallback): void;
  requestSync(graphDid: string, fromRevision: string): void | Promise<void>;

  // Peer management
  peers(): Peer[] | Promise<Peer[]>;
  onlinePeers(): Peer[] | Promise<Peer[]>;
  discoverPeers(spaceUri: string): Peer[] | Promise<Peer[]>;

  // Signalling
  sendSignal(remoteDid: string, payload: Uint8Array): void | Promise<void>;
  onSignal(callback: SignalCallback): void;

  // Governance validation (Spec 06 §5.5 — runs in-module by design)
  validateDiff(
    graphDid: string,
    diff: GraphDiff,
    author: string,
  ): SyncValidationResult | Promise<SyncValidationResult>;
  validateReadAccess(
    graphDid: string,
    authorDid: string,
    proof?: CapabilityProof,
  ): SyncValidationResult | Promise<SyncValidationResult>;
}

/** The module-side callback invoked when a remote diff arrives (Spec 06 §5.1). */
export type RemoteDiffCallback = (
  graphDid: string,
  diff: GraphDiff,
  result: SyncValidationResult,
) => void;

/** The module-side callback invoked when a signal envelope arrives. */
export type SignalCallback = (remoteDid: string, payload: Uint8Array) => void;

/** Spec 06 §5.2. Module-init parameter object. */
export interface ModuleConfig {
  spaceUri: string;
  localDid: string;
  graphWriter: GraphWriter;
  graphReader: GraphReader;
  crypto: CryptoProvider;
  network: NetworkProvider;
  /** WASM linear-memory ceiling, in bytes. */
  maxMemoryBytes: number;
  /** Per-entry-point wall-clock budget, in milliseconds. */
  executionBudgetMs: number;
}

/** Spec 06 §5.3. Per-graph scoped read handle. */
export interface GraphReader {
  queryTriples(graphDid: string, query: Record<string, unknown>): Promise<unknown[]>;
  querySparql(graphDid: string, sparql: string): Promise<unknown>;
  snapshot(graphDid: string): Promise<unknown[]>;
}

/** Spec 06 §5.3. Per-graph scoped write handle. */
export interface GraphWriter {
  apply(graphDid: string, diff: GraphDiff): Promise<void>;
}

/**
 * Spec 06 §5.4. Scoped signing surface — the module cannot sign arbitrary
 * bytes with the user's DID key. Only structured commit IDs (for the
 * module's authorised graphs) and signal envelopes (for its space) are
 * exposed.
 */
export interface CryptoProvider {
  /**
   * Produce a signature over `commitId` for a diff the module has just
   * constructed via {@link GraphSyncModule.commit}. The runtime rejects
   * the call if `commitId` does not correspond to such a diff or if
   * `graphDid` is not in the module's authorised set.
   */
  signCommit(graphDid: string, commitId: string): Promise<string>;
  /** Sign a signal envelope bound to (localDid, remoteDid, spaceUri, payload). */
  signSignal(spaceUri: string, remoteDid: string, payload: Uint8Array): Promise<string>;
  /** Pure verification; no key material involved. */
  verify(signed: { commitId: string; signature: string }, publicKey: Uint8Array): Promise<boolean>;
}

/**
 * Spec 06 §5.4. Mediated network access. `network.fetch` is opaque and
 * credential-free; `network.connect` and `network.peerConnect` are gated
 * by the corresponding `network.*` capability handles.
 */
export interface NetworkProvider {
  connect(endpoint: string): Promise<NetworkSession>;
  peerConnect(remoteDid: string, protocol: string): Promise<NetworkSession>;
  /** Opaque, credential-free HTTP fetch — no cookies, no Authorization headers. */
  fetch(url: string): Promise<Uint8Array>;
}

export interface NetworkSession {
  send(payload: Uint8Array): Promise<void>;
  onMessage(callback: (payload: Uint8Array) => void): void;
  close(): Promise<void>;
}

// ───── Spec 06 §7.2: Module Manifest ──────────────────────────────────────

/**
 * The manifest declared alongside a module bundle (Spec 06 §7.2). Required
 * fields are normative; optional fields aid the management UI.
 */
export interface ModuleManifest {
  /** Human-readable name. */
  readonly name: string;
  /** Module version string (semver recommended). */
  readonly version: string;
  /** SHA-256 of the WASM binary, in `sha256-<hex>` form. */
  readonly wasmContentHash: string;
  /** Publisher DID, when published under a stable identity. */
  readonly publisher?: string;
  /**
   * Constraint kinds the module's `validateDiff`/`validateReadAccess`
   * implement. Consulted at fork time (Spec 03 §4.8.1 step 2): a fork's
   * new module must declare every constraint kind in force on the parent.
   * Because module identity is bound to the DID seed (Spec 03 §4.5),
   * this is a one-time precondition rather than an ongoing runtime check.
   */
  readonly supportedConstraintKinds: readonly string[];
  /** Capability handles the module requires (Spec 06 §7). */
  readonly capabilitiesRequired: readonly string[];
  /** Optional description shown in the management UI. */
  readonly description?: string;
}

// ───── Runtime alias and installation ─────────────────────────────────────

/**
 * The runtime-shape contract that the Graph API delegates to. A production
 * host adapts a {@link GraphSyncModule} into this shape; the polyfill accepts
 * either form via {@link installSyncModule}.
 */
export type SyncModule = ContextSyncRuntime;

/** True if the value walks like a {@link GraphSyncModule} (Spec 06 §5.1). */
function isGraphSyncModule(value: unknown): value is GraphSyncModule {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.init === 'function'
    && typeof v.connect === 'function'
    && typeof v.commit === 'function'
    && typeof v.validateDiff === 'function'
    && typeof v.validateReadAccess === 'function';
}

/**
 * Install a sync module as the active runtime. Accepts either:
 *   - a {@link SyncModule} (runtime-shape, the Graph API surface), or
 *   - a {@link GraphSyncModule} (Spec 06 §5 shape) together with its
 *     {@link ModuleManifest}.
 *
 * When passed a Spec 06 module, an adapter from {@link adaptGraphSyncModuleAsRuntime}
 * is used to expose it as a runtime. A production host would additionally
 * verify the WASM content hash, prompt for user consent, mint capability
 * handles, and run the module in a sandbox — none of which the polyfill does.
 */
export function installSyncModule(module: SyncModule): void;
export function installSyncModule(module: GraphSyncModule, manifest: ModuleManifest): void;
export function installSyncModule(
  module: SyncModule | GraphSyncModule,
  manifest?: ModuleManifest,
): void {
  if (isGraphSyncModule(module)) {
    if (!manifest) {
      throw new TypeError(
        'installSyncModule(GraphSyncModule, manifest) requires a manifest (Spec 06 §7.2).',
      );
    }
    installSyncRuntime(adaptGraphSyncModuleAsRuntime(module, manifest));
    return;
  }
  installSyncRuntime(module);
}

/**
 * Install a {@link GraphSyncModule} explicitly. Equivalent to
 * `installSyncModule(module, manifest)`; provided for callers that prefer
 * the unambiguous spelling.
 */
export function installGraphSyncModule(module: GraphSyncModule, manifest: ModuleManifest): void {
  installSyncModule(module, manifest);
}

/**
 * Adapt a {@link GraphSyncModule} (Spec 06 §5 shape) into a
 * {@link ContextSyncRuntime} (the Graph-API surface).
 *
 * The adapter is intentionally thin in the polyfill: it routes per-Graph
 * runtime calls into the module's lifecycle/transport/sync surface using
 * the Graph's DID as the routing key. A production host would also:
 *
 *   - Instantiate the module in a WASM sandbox per `(content-hash, spaceUri)`
 *     (Spec 06 §4.4 Instancing).
 *   - Provide the {@link ModuleConfig.crypto} and {@link ModuleConfig.network}
 *     handles wrapping the user agent's signing key and capability-gated
 *     network access.
 *   - Track the manifest's `supportedConstraintKinds` and gate fork-time
 *     compatibility (Spec 03 §4.8.1 step 2).
 *
 * The polyfill expects the supplied module to be self-sufficient (it may
 * use ambient APIs such as `BroadcastChannel`); production-grade modules
 * MUST go through the mediated handles only.
 */
export function adaptGraphSyncModuleAsRuntime(
  module: GraphSyncModule,
  manifest: ModuleManifest,
): ContextSyncRuntime {
  void manifest; // referenced for documentation; a real host enforces it
  let started = false;
  let onDiffCb: RemoteDiffCallback | null = null;
  module.onRemoteDiff((graphDid, diff, result) => {
    if (onDiffCb) onDiffCb(graphDid, diff, result);
  });

  async function ensureStarted(graph: Graph, spaceUri: string): Promise<void> {
    if (started) return;
    started = true;
    await module.init(stubModuleConfig(graph, spaceUri));
    await module.connect(spaceUri, graph.getIdentity().getDID());
  }

  return {
    async publish(graph, options = {}) {
      const graphDid = graph.did ?? '';
      const spaceUri = options.spaceTopology
        ? `space://${options.spaceTopology}-${graphDid}`
        : `space://default-${graphDid}`;
      await ensureStarted(graph, spaceUri);
      return {
        graphDid,
        spaceUri,
        moduleHash: manifest.wasmContentHash,
        relays: options.relays ?? [],
      };
    },
    async unpublish() {
      if (!started) return;
      await module.disconnect();
      await module.shutdown();
      started = false;
    },
    async syncState() {
      return started ? 'synced' : 'idle';
    },
    async peers() {
      return await module.peers();
    },
    async onlinePeers() {
      return await module.onlinePeers();
    },
    async currentRevision() {
      // The polyfill adapter does not surface the module's per-graph chain
      // head; production hosts would route to the module's storage view.
      return '0'.repeat(64);
    },
    async sendSignal(_graph, remoteDid, payload) {
      await module.sendSignal(remoteDid, toBytes(payload));
    },
    async sendSignalToSession(_graph, remoteDid, _sessionId, payload) {
      // Spec 06 §5.1 signalling carries remoteDid only; session targeting
      // is a runtime concern. Production hosts may add a session header
      // before handing the payload to the module.
      await module.sendSignal(remoteDid, toBytes(payload));
    },
    async broadcast(_graph, payload) {
      // Best-effort: broadcast to known peers. A production host would
      // expose a dedicated broadcast verb to the module.
      const onlinePeers = await module.onlinePeers();
      const bytes = toBytes(payload);
      await Promise.all(onlinePeers.map(p => module.sendSignal(p.did, bytes)));
    },
  };

  function setRemoteDiffCallback(cb: RemoteDiffCallback): void {
    onDiffCb = cb;
  }
  // Exposed for tests that want to observe module-side diff delivery.
  void setRemoteDiffCallback;
}

/**
 * Minimal {@link ModuleConfig} for the polyfill adapter. A production host
 * would mint properly-scoped {@link CryptoProvider} and {@link NetworkProvider}
 * handles backed by the user agent's signing key and capability-gated
 * network access.
 */
function stubModuleConfig(graph: Graph, spaceUri: string): ModuleConfig {
  const id = graph.getIdentity();
  return {
    spaceUri,
    localDid: id.getDID(),
    graphReader: {
      queryTriples: async () => [],
      querySparql: async () => null,
      snapshot: async () => [],
    },
    graphWriter: {
      apply: async () => undefined,
    },
    crypto: {
      signCommit: async (_graphDid, commitId) => {
        const sig = await id.sign(hexBytes(commitId));
        return toHex(sig);
      },
      signSignal: async () => '',
      verify: async () => true,
    },
    network: {
      connect: async () => stubSession(),
      peerConnect: async () => stubSession(),
      fetch: async () => new Uint8Array(),
    },
    maxMemoryBytes: 64 * 1024 * 1024,
    executionBudgetMs: 5000,
  };
}

function stubSession(): NetworkSession {
  return {
    send: async () => undefined,
    onMessage: () => undefined,
    close: async () => undefined,
  };
}

function toBytes(payload: BufferSource): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
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
