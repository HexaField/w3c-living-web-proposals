/**
 * Context sync extension — mixes publish/peers/diff/signal APIs into
 * `Context.prototype`. All implementations delegate to the active sync runtime
 * (installed by a sync module such as `@living-web/default-sync-module`).
 */

import { Context } from '@living-web/personal-graph';
import { requireSyncRuntime } from './runtime.js';
import type {
  ContextSyncState,
  Peer,
  PublishOptions,
  PublishedContext,
} from './types.js';

async function publish(this: Context, options: PublishOptions = {}): Promise<PublishedContext> {
  return requireSyncRuntime().publish(this, options);
}

async function unpublish(this: Context): Promise<void> {
  return requireSyncRuntime().unpublish(this);
}

async function syncState(this: Context): Promise<ContextSyncState> {
  return requireSyncRuntime().syncState(this);
}

async function peers(this: Context): Promise<Peer[]> {
  return requireSyncRuntime().peers(this);
}

async function onlinePeers(this: Context): Promise<Peer[]> {
  return requireSyncRuntime().onlinePeers(this);
}

async function currentRevision(this: Context): Promise<string> {
  return requireSyncRuntime().currentRevision(this);
}

async function sendSignal(this: Context, remoteDid: string, payload: BufferSource): Promise<void> {
  return requireSyncRuntime().sendSignal(this, remoteDid, payload);
}

async function sendSignalToSession(
  this: Context,
  remoteDid: string,
  sessionId: string,
  payload: BufferSource,
): Promise<void> {
  return requireSyncRuntime().sendSignalToSession(this, remoteDid, sessionId, payload);
}

async function broadcast(this: Context, payload: BufferSource): Promise<void> {
  return requireSyncRuntime().broadcast(this, payload);
}

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

export function installContextSyncExtension(): void {
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
