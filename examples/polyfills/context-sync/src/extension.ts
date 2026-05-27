/**
 * Graph sync extension — mixes publish/peers/diff/signal APIs into
 * `Graph.prototype`. All implementations delegate to the active sync runtime
 * (installed by a sync module such as `@living-web/default-sync-module`).
 */

import { Graph } from '@living-web/personal-graph';
import { requireSyncRuntime } from './runtime.js';
import type {
  ContextSyncState,
  Peer,
  PublishOptions,
  PublishedGraph,
} from './types.js';

async function publish(this: Graph, options: PublishOptions = {}): Promise<PublishedGraph> {
  return requireSyncRuntime().publish(this, options);
}

async function unpublish(this: Graph): Promise<void> {
  return requireSyncRuntime().unpublish(this);
}

async function syncState(this: Graph): Promise<ContextSyncState> {
  return requireSyncRuntime().syncState(this);
}

async function peers(this: Graph): Promise<Peer[]> {
  return requireSyncRuntime().peers(this);
}

async function onlinePeers(this: Graph): Promise<Peer[]> {
  return requireSyncRuntime().onlinePeers(this);
}

async function currentRevision(this: Graph): Promise<string> {
  return requireSyncRuntime().currentRevision(this);
}

async function sendSignal(this: Graph, remoteDid: string, payload: BufferSource): Promise<void> {
  return requireSyncRuntime().sendSignal(this, remoteDid, payload);
}

async function sendSignalToSession(
  this: Graph,
  remoteDid: string,
  sessionId: string,
  payload: BufferSource,
): Promise<void> {
  return requireSyncRuntime().sendSignalToSession(this, remoteDid, sessionId, payload);
}

async function broadcast(this: Graph, payload: BufferSource): Promise<void> {
  return requireSyncRuntime().broadcast(this, payload);
}

declare module '@living-web/personal-graph' {
  interface Graph {
    publish(options?: PublishOptions): Promise<PublishedGraph>;
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
  const proto = Graph.prototype as Graph;
  if (typeof proto.publish === 'function') return;
  Object.assign(Graph.prototype, {
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
