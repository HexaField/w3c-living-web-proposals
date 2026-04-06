/**
 * Service Worker registration helper for background graph sync.
 *
 * The companion Service Worker (`graph-sync-worker.js`) maintains WebSocket
 * connections to relay servers, receives diffs while the page is in background,
 * persists them in IndexedDB, and wakes the page via `postMessage`.
 */

export interface SyncWorkerOptions {
  /** Path to the Service Worker script. Defaults to '/graph-sync-worker.js'. */
  workerUrl?: string;
  /** Service Worker scope. */
  scope?: string;
}

export interface SyncWorkerHandle {
  /** Tell the worker to connect to a relay for a graph. */
  connectRelay(graphId: string, relayUrl: string): void;
  /** Tell the worker to disconnect from a graph relay. */
  disconnectRelay(graphId: string): void;
  /** Listen for diffs arriving from the worker. */
  onDiff(callback: (graphId: string, diff: unknown) => void): () => void;
}

export async function registerSyncWorker(
  options: SyncWorkerOptions = {},
): Promise<SyncWorkerHandle | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[graph-sync] Service Workers not supported — background sync disabled');
    return null;
  }

  const workerUrl = options.workerUrl ?? '/graph-sync-worker.js';
  const registration = await navigator.serviceWorker.register(workerUrl, {
    scope: options.scope,
  });

  // Wait for the worker to be active
  const worker =
    registration.active ?? registration.installing ?? registration.waiting;

  function postToWorker(msg: unknown) {
    const sw = registration.active;
    if (sw) sw.postMessage(msg);
  }

  const diffListeners = new Set<(graphId: string, diff: unknown) => void>();

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NEW_DIFF') {
      const { graphId, diff } = event.data;
      diffListeners.forEach((cb) => cb(graphId, diff));
    }
  });

  return {
    connectRelay(graphId: string, relayUrl: string) {
      postToWorker({ type: 'CONNECT_RELAY', graphId, relayUrl });
    },
    disconnectRelay(graphId: string) {
      postToWorker({ type: 'DISCONNECT_RELAY', graphId });
    },
    onDiff(callback: (graphId: string, diff: unknown) => void) {
      diffListeners.add(callback);
      return () => diffListeners.delete(callback);
    },
  };
}
