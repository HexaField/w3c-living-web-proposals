/**
 * Per-context storage. Each context (did:graph:...) has its own IndexedDB record set.
 */

import { Triple, type Reifier, type SignedTriple } from './types.js';

const DB_VERSION = 1;
const CONTEXTS_STORE = 'contexts';
const TRIPLES_STORE = 'triples';
const REIFIERS_STORE = 'reifiers';
const GRAPH_STORES_STORE = 'graph_stores';

export interface ContextRecord {
  graphDid: string;
  displayName: string | null;
  createdAt: string;
  graphStoreUuid: string | null;
}

export interface GraphStoreRecord {
  uuid: string;
  name: string;
  agentDid: string;
  privateGraphDid: string;
  mounts: Array<{ graphDid: string; mode: string }>;
  createdAt: string;
}

interface StoredTripleRow {
  graphDid: string;
  subject: string;
  predicate: string;
  object: string;
  author: string;
  timestamp: string;
  proofMethod: string;
  proofSignature: string;
}

interface StoredReifierRow {
  id: string;
  graphDid: string;
  subject: string;
  predicate: string;
  object: string;
  author: string;
  timestamp: string;
  method: string;
  signature: string;
}

function openDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONTEXTS_STORE)) {
        db.createObjectStore(CONTEXTS_STORE, { keyPath: 'graphDid' });
      }
      if (!db.objectStoreNames.contains(TRIPLES_STORE)) {
        const s = db.createObjectStore(TRIPLES_STORE, { autoIncrement: true });
        s.createIndex('graphDid', 'graphDid', { unique: false });
      }
      if (!db.objectStoreNames.contains(REIFIERS_STORE)) {
        const s = db.createObjectStore(REIFIERS_STORE, { keyPath: 'id' });
        s.createIndex('graphDid', 'graphDid', { unique: false });
      }
      if (!db.objectStoreNames.contains(GRAPH_STORES_STORE)) {
        db.createObjectStore(GRAPH_STORES_STORE, { keyPath: 'uuid' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class GraphStorage {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;

  constructor(dbName = 'living-web-graph-store') {
    this.dbName = dbName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDB(this.dbName);
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ── GraphStore records ──────────────────────────────────────────────────────

  async saveGraphStore(record: GraphStoreRecord): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction([GRAPH_STORES_STORE], 'readwrite');
    await reqPromise(tx.objectStore(GRAPH_STORES_STORE).put(record));
  }

  async loadGraphStore(uuid: string): Promise<GraphStoreRecord | undefined> {
    const db = await this.getDB();
    const tx = db.transaction([GRAPH_STORES_STORE], 'readonly');
    return reqPromise(tx.objectStore(GRAPH_STORES_STORE).get(uuid)) as Promise<GraphStoreRecord | undefined>;
  }

  async listGraphStores(): Promise<GraphStoreRecord[]> {
    const db = await this.getDB();
    const tx = db.transaction([GRAPH_STORES_STORE], 'readonly');
    return reqPromise(tx.objectStore(GRAPH_STORES_STORE).getAll()) as Promise<GraphStoreRecord[]>;
  }

  async removeGraphStore(uuid: string): Promise<boolean> {
    const db = await this.getDB();
    const existing = await this.loadGraphStore(uuid);
    if (!existing) return false;
    const tx = db.transaction([GRAPH_STORES_STORE], 'readwrite');
    await reqPromise(tx.objectStore(GRAPH_STORES_STORE).delete(uuid));
    return true;
  }

  // ── Context records ─────────────────────────────────────────────────────────

  async saveContext(graphDid: string, displayName: string | null, graphStoreUuid: string | null = null): Promise<void> {
    const db = await this.getDB();
    const record: ContextRecord = {
      graphDid,
      displayName,
      createdAt: new Date().toISOString(),
      graphStoreUuid,
    };
    const tx = db.transaction([CONTEXTS_STORE], 'readwrite');
    await reqPromise(tx.objectStore(CONTEXTS_STORE).put(record));
  }

  async getContext(graphDid: string): Promise<ContextRecord | undefined> {
    const db = await this.getDB();
    const tx = db.transaction([CONTEXTS_STORE], 'readonly');
    return reqPromise(tx.objectStore(CONTEXTS_STORE).get(graphDid)) as Promise<ContextRecord | undefined>;
  }

  async listContexts(): Promise<ContextRecord[]> {
    const db = await this.getDB();
    const tx = db.transaction([CONTEXTS_STORE], 'readonly');
    return reqPromise(tx.objectStore(CONTEXTS_STORE).getAll()) as Promise<ContextRecord[]>;
  }

  async removeContext(graphDid: string): Promise<boolean> {
    const db = await this.getDB();
    const existing = await this.getContext(graphDid);
    if (!existing) return false;
    const tx = db.transaction([CONTEXTS_STORE], 'readwrite');
    await reqPromise(tx.objectStore(CONTEXTS_STORE).delete(graphDid));
    await this.removeAllTriples(graphDid);
    return true;
  }

  // ── Triples & reifiers (keyed by graphDid) ──────────────────────────────────

  async saveTriple(graphDid: string, signed: SignedTriple, reifier: Reifier): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE, REIFIERS_STORE], 'readwrite');
      tx.objectStore(TRIPLES_STORE).add(this.serializeTriple(graphDid, signed));
      tx.objectStore(REIFIERS_STORE).put(this.serializeReifier(graphDid, reifier));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveTriples(graphDid: string, signed: SignedTriple[], reifiers: Reifier[]): Promise<void> {
    if (signed.length !== reifiers.length) {
      throw new Error('saveTriples: signed.length must equal reifiers.length');
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE, REIFIERS_STORE], 'readwrite');
      const triplesStore = tx.objectStore(TRIPLES_STORE);
      const reifiersStore = tx.objectStore(REIFIERS_STORE);
      for (let i = 0; i < signed.length; i++) {
        triplesStore.add(this.serializeTriple(graphDid, signed[i]));
        reifiersStore.put(this.serializeReifier(graphDid, reifiers[i]));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeTriple(graphDid: string, signed: SignedTriple): Promise<boolean> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE], 'readwrite');
      const store = tx.objectStore(TRIPLES_STORE);
      const index = store.index('graphDid');
      const request = index.openCursor(IDBKeyRange.only(graphDid));
      let found = false;
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (this.tripleMatches(cursor.value as StoredTripleRow, signed)) {
            cursor.delete();
            found = true;
          }
          cursor.continue();
        } else {
          resolve(found);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async loadTriples(graphDid: string): Promise<SignedTriple[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE], 'readonly');
      const store = tx.objectStore(TRIPLES_STORE);
      const index = store.index('graphDid');
      const request = index.getAll(IDBKeyRange.only(graphDid));
      request.onsuccess = () => {
        const records = request.result as StoredTripleRow[];
        resolve(records.map(r => this.deserializeTriple(r)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async loadReifiers(graphDid: string): Promise<Reifier[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([REIFIERS_STORE], 'readonly');
      const store = tx.objectStore(REIFIERS_STORE);
      const index = store.index('graphDid');
      const request = index.getAll(IDBKeyRange.only(graphDid));
      request.onsuccess = () => {
        const records = request.result as StoredReifierRow[];
        resolve(records.map(r => this.deserializeReifier(r)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async removeAllTriples(graphDid: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE, REIFIERS_STORE], 'readwrite');
      for (const storeName of [TRIPLES_STORE, REIFIERS_STORE]) {
        const store = tx.objectStore(storeName);
        const index = store.index('graphDid');
        const req = index.openCursor(IDBKeyRange.only(graphDid));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private serializeTriple(graphDid: string, signed: SignedTriple): StoredTripleRow {
    return {
      graphDid,
      subject: signed.data.subject,
      predicate: signed.data.predicate,
      object: signed.data.object,
      author: signed.author,
      timestamp: signed.timestamp,
      proofMethod: signed.proof.method,
      proofSignature: signed.proof.signature,
    };
  }

  private deserializeTriple(record: StoredTripleRow): SignedTriple {
    return {
      data: new Triple(record.subject, record.predicate, record.object),
      author: record.author,
      timestamp: record.timestamp,
      proof: { method: record.proofMethod, signature: record.proofSignature },
    };
  }

  private serializeReifier(graphDid: string, r: Reifier): StoredReifierRow {
    return {
      id: r.id,
      graphDid,
      subject: r.triple.subject,
      predicate: r.triple.predicate,
      object: r.triple.object,
      author: r.author,
      timestamp: r.timestamp,
      method: r.method,
      signature: r.signature,
    };
  }

  private deserializeReifier(record: StoredReifierRow): Reifier {
    return {
      id: record.id,
      triple: new Triple(record.subject, record.predicate, record.object),
      author: record.author,
      timestamp: record.timestamp,
      method: record.method,
      signature: record.signature,
    };
  }

  private tripleMatches(record: StoredTripleRow, signed: SignedTriple): boolean {
    return (
      record.subject === signed.data.subject &&
      record.predicate === signed.data.predicate &&
      record.object === signed.data.object &&
      record.author === signed.author &&
      record.timestamp === signed.timestamp
    );
  }
}
