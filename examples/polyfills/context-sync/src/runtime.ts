/**
 * Sync runtime — the slot for the currently installed sync module.
 *
 * A sync module implements `ContextSyncRuntime` and is registered via
 * `installSyncRuntime()`. The Graph prototype extension installed by
 * `installContextSyncExtension()` dispatches all publish/peers/diff/signal
 * calls to whichever runtime is currently installed.
 */

import type { Graph } from '@living-web/personal-graph';
import type {
  ContextSyncState,
  Peer,
  PublishOptions,
  PublishedGraph,
} from './types.js';

/**
 * The contract a sync module fulfils. Every Graph API method delegates here.
 */
export interface ContextSyncRuntime {
  publish(graph: Graph, options: PublishOptions): Promise<PublishedGraph>;
  unpublish(graph: Graph): Promise<void>;
  syncState(graph: Graph): Promise<ContextSyncState>;
  peers(graph: Graph): Promise<Peer[]>;
  onlinePeers(graph: Graph): Promise<Peer[]>;
  currentRevision(graph: Graph): Promise<string>;
  sendSignal(graph: Graph, remoteDid: string, payload: BufferSource): Promise<void>;
  sendSignalToSession(
    graph: Graph,
    remoteDid: string,
    sessionId: string,
    payload: BufferSource,
  ): Promise<void>;
  broadcast(graph: Graph, payload: BufferSource): Promise<void>;
}

let activeRuntime: ContextSyncRuntime | null = null;

/** Install the sync runtime. Called by sync modules (typically via {@link SyncModule}). */
export function installSyncRuntime(runtime: ContextSyncRuntime): void {
  activeRuntime = runtime;
}

/** Return the active runtime, or throw `"NotSupportedError"` if none is installed. */
export function requireSyncRuntime(): ContextSyncRuntime {
  if (!activeRuntime) {
    throw new DOMException(
      'No sync module installed. Install a module that calls installSyncRuntime().',
      'NotSupportedError',
    );
  }
  return activeRuntime;
}

/** Return the active runtime, or `null` if none is installed. */
export function getSyncRuntime(): ContextSyncRuntime | null {
  return activeRuntime;
}
