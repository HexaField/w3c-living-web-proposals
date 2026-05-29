/**
 * Spec 06 §5 `GraphSyncModule` view of the default module.
 *
 * The polyfill's transport remains the {@link defaultSyncModule} runtime
 * (BroadcastChannel-based). This file exposes the same module under the
 * Spec 06 surface — chiefly to demonstrate the in-module validation
 * contract (Spec 06 §5.5): `validateDiff` and `validateReadAccess` are
 * real implementations delegating to {@link @living-web/capability-framework}.
 *
 * A production WASM module would resolve graphs via its
 * `ModuleConfig.graphReader` handle; the polyfill works with `Graph`
 * instances directly via the resolver passed to
 * {@link createDefaultGraphSyncModule}.
 */

import type { Graph } from '@living-web/personal-graph';
import type {
  GraphSyncModule,
  ModuleConfig,
  RemoteDiffCallback,
  SignalCallback,
} from '@living-web/sync-module';
import type {
  CapabilityProof,
  GraphDiff,
  Peer,
  SyncValidationResult,
} from '@living-web/context-sync';
import { defaultValidateDiff, defaultValidateReadAccess } from './validate.js';

/** Resolves a `did:graph:…` to the local `Graph` instance, or `null` if unknown. */
export type GraphResolver = (graphDid: string) => Graph | null;

/**
 * Construct a {@link GraphSyncModule} backed by the default validation logic.
 *
 * Transport methods (`connect`, `disconnect`, `commit`, `onRemoteDiff`,
 * `peers`, etc.) are minimal in the polyfill — the BroadcastChannel-based
 * transport lives in {@link defaultSyncModule} (the runtime view). The
 * validate methods are real and suitable for production-shape testing.
 */
export function createDefaultGraphSyncModule(resolver: GraphResolver): GraphSyncModule {
  let config: ModuleConfig | null = null;
  let diffCallback: RemoteDiffCallback | null = null;
  let signalCallback: SignalCallback | null = null;
  const peerSet = new Map<string, Peer>();

  function resolve(graphDid: string): Graph | null {
    return resolver(graphDid);
  }

  return {
    async init(c: ModuleConfig): Promise<void> {
      config = c;
    },

    async shutdown(): Promise<void> {
      config = null;
      diffCallback = null;
      signalCallback = null;
      peerSet.clear();
    },

    async connect(_spaceUri: string, _localDid: string): Promise<void> {
      // Polyfill transport lives in defaultSyncModule (the runtime view);
      // a production WASM module would open its NetworkProvider session here.
      void config;
    },

    async disconnect(): Promise<void> {
      // Polyfill no-op.
    },

    async commit(_graphDid: string, _diff: GraphDiff): Promise<void> {
      // Polyfill no-op — the runtime view emits diffs through its own path.
      // A production module would package and emit via NetworkProvider here,
      // first calling `config.crypto.signCommit(graphDid, diff.commitId)`.
    },

    onRemoteDiff(cb: RemoteDiffCallback): void {
      diffCallback = cb;
    },

    async requestSync(_graphDid: string, _fromRevision: string): Promise<void> {
      // Polyfill no-op. A production module would issue a PULL on
      // NetworkProvider and feed received diffs through `diffCallback`.
    },

    async peers(): Promise<Peer[]> {
      return [...peerSet.values()];
    },

    async onlinePeers(): Promise<Peer[]> {
      return [...peerSet.values()].filter(p => p.online);
    },

    async discoverPeers(_spaceUri: string): Promise<Peer[]> {
      return [...peerSet.values()];
    },

    async sendSignal(_remoteDid: string, _payload: Uint8Array): Promise<void> {
      // Polyfill no-op — runtime view handles signal transport.
    },

    onSignal(cb: SignalCallback): void {
      signalCallback = cb;
    },

    async validateDiff(
      graphDid: string,
      diff: GraphDiff,
      _author: string,
    ): Promise<SyncValidationResult> {
      const graph = resolve(graphDid);
      if (!graph) {
        return {
          accepted: false,
          constraintKind: 'capability',
          reason: 'graph_not_resolvable',
        };
      }
      return defaultValidateDiff(graph, diff);
    },

    async validateReadAccess(
      graphDid: string,
      authorDid: string,
      proof?: CapabilityProof,
    ): Promise<SyncValidationResult> {
      const graph = resolve(graphDid);
      if (!graph) {
        return {
          accepted: false,
          constraintKind: 'capability',
          reason: 'graph_not_resolvable',
        };
      }
      return defaultValidateReadAccess(graph, authorDid, proof);
    },
  };
  // Exposed for tests that want to inject inbound diffs through the module.
  void diffCallback;
  void signalCallback;
}
