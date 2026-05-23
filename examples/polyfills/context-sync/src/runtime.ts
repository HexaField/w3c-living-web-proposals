/**
 * Sync runtime — the slot for the currently installed sync module.
 *
 * A sync module implements `ContextSyncRuntime` and is registered via
 * `installSyncRuntime()`. The Context prototype extension installed by
 * `installContextSyncExtension()` dispatches all publish/peers/diff/signal
 * calls to whichever runtime is currently installed.
 */

import type { Context } from '@living-web/personal-graph';
import type {
  ContextSyncState,
  Peer,
  PublishOptions,
  PublishedContext,
} from './types.js';

/**
 * The contract a sync module fulfils. Every Context API method delegates here.
 */
export interface ContextSyncRuntime {
  publish(context: Context, options: PublishOptions): Promise<PublishedContext>;
  unpublish(context: Context): Promise<void>;
  syncState(context: Context): Promise<ContextSyncState>;
  peers(context: Context): Promise<Peer[]>;
  onlinePeers(context: Context): Promise<Peer[]>;
  currentRevision(context: Context): Promise<string>;
  sendSignal(context: Context, remoteDid: string, payload: BufferSource): Promise<void>;
  sendSignalToSession(
    context: Context,
    remoteDid: string,
    sessionId: string,
    payload: BufferSource,
  ): Promise<void>;
  broadcast(context: Context, payload: BufferSource): Promise<void>;
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
