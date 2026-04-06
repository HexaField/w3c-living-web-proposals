/**
 * Graph Sync Service Worker
 *
 * Maintains WebSocket connections to relay servers in the background,
 * persists incoming diffs in IndexedDB, and notifies clients via postMessage.
 */

/* eslint-env serviceworker */
/* global self, clients, indexedDB, WebSocket */

const DB_NAME = 'graph-sync-diffs';
const DB_VERSION = 1;
const STORE_NAME = 'diffs';

/** @type {Map<string, WebSocket>} */
const connections = new Map();

/**
 * Open (or create) the IndexedDB database for storing diffs.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex('graphId', 'graphId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Store a diff in IndexedDB.
 * @param {IDBDatabase} db
 * @param {string} graphId
 * @param {object} diff
 * @returns {Promise<void>}
 */
function storeDiff(db, graphId, diff) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ graphId, diff, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener('message', (event) => {
  const { type } = event.data;

  if (type === 'CONNECT_RELAY') {
    const { graphId, relayUrl } = event.data;

    // Close existing connection for this graph if any
    if (connections.has(graphId)) {
      connections.get(graphId).close();
    }

    const ws = new WebSocket(`${relayUrl}/graph/${graphId}`);
    connections.set(graphId, ws);

    ws.onmessage = async (msg) => {
      try {
        const diff = JSON.parse(msg.data);

        // Persist to IndexedDB
        const db = await openDB();
        await storeDiff(db, graphId, diff);
        db.close();

        // Notify all clients
        const allClients = await self.clients.matchAll();
        allClients.forEach((client) =>
          client.postMessage({ type: 'NEW_DIFF', graphId, diff }),
        );
      } catch (err) {
        console.error('[graph-sync-worker] Error processing message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error(`[graph-sync-worker] WebSocket error for ${graphId}:`, err);
    };

    ws.onclose = () => {
      connections.delete(graphId);
    };
  }

  if (type === 'DISCONNECT_RELAY') {
    const { graphId } = event.data;
    if (connections.has(graphId)) {
      connections.get(graphId).close();
      connections.delete(graphId);
    }
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
