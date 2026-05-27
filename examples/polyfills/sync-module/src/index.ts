/**
 * Sync module architecture — defines the contract a sync module fulfils and
 * the installation function it calls to take over the active runtime.
 *
 * A polyfill of this spec is intentionally minimal: it provides the
 * `SyncModule` interface alias and a thin wrapper around the graph-sync
 * runtime registry. A real implementation supplies a WebAssembly sandbox,
 * module loader, capability mediation, and lifecycle (install/update/suspend/
 * remove); see {@link https://www.w3.org/TR/sync-module-architecture/} for the
 * normative model.
 */

import {
  installSyncRuntime,
  type ContextSyncRuntime,
} from '@living-web/context-sync';

/** The interface a sync module fulfils. Equivalent to {@link ContextSyncRuntime}. */
export type SyncModule = ContextSyncRuntime;

/** Manifest describing a module's identity and capability requirements. */
export interface ModuleManifest {
  readonly contentHash: string;
  readonly name?: string;
  readonly capabilities?: readonly string[];
}

/**
 * Install a sync module as the active runtime. Subsequent
 * `Graph.publish/peers/diff/signal` calls dispatch to this module.
 */
export function installSyncModule(module: SyncModule, _manifest?: ModuleManifest): void {
  installSyncRuntime(module);
}
