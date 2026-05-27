/**
 * Per-graph storage. Each graph has its own IndexedDB record set,
 * keyed by an opaque internal id (NOT the graph IRI — the IRI is a
 * content hash that changes on every mutation, see [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3).
 */

import { Triple, type Reifier, type SignedTriple } from './types.js';

const DB_VERSION = 1;
const GRAPHS_STORE = 'graphs';
const TRIPLES_STORE = 'triples';
const REIFIERS_STORE = 'reifiers';

export interface GraphRecord {
  id: string;
  displayName: string | null;
  createdAt: string;
}

interface StoredTripleRow {
  graphId: string;
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
  graphId: string;
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
      if (!db.objectStoreNames.contains(GRAPHS_STORE)) {
        db.createObjectStore(GRAPHS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TRIPLES_STORE)) {
        const s = db.createObjectStore(TRIPLES_STORE, { autoIncrement: true });
        s.createIndex('graphId', 'graphId', { unique: false });
      }
      if (!db.objectStoreNames.contains(REIFIERS_STORE)) {
        const s = db.createObjectStore(REIFIERS_STORE, { keyPath: 'id' });
        s.createIndex('graphId', 'graphId', { unique: false });
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

  constructor(dbName = 'living-web-graphs') {
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

  // ── Graph records ───────────────────────────────────────────────────────────

  async saveGraph(id: string, displayName: string | null): Promise<void> {
    const db = await this.getDB();
    const record: GraphRecord = {
      id,
      displayName,
      createdAt: new Date().toISOString(),
    };
    const tx = db.transaction([GRAPHS_STORE], 'readwrite');
    await reqPromise(tx.objectStore(GRAPHS_STORE).put(record));
  }

  async getGraph(id: string): Promise<GraphRecord | undefined> {
    const db = await this.getDB();
    const tx = db.transaction([GRAPHS_STORE], 'readonly');
    return reqPromise(tx.objectStore(GRAPHS_STORE).get(id)) as Promise<GraphRecord | undefined>;
  }

  async listGraphs(): Promise<GraphRecord[]> {
    const db = await this.getDB();
    const tx = db.transaction([GRAPHS_STORE], 'readonly');
    return reqPromise(tx.objectStore(GRAPHS_STORE).getAll()) as Promise<GraphRecord[]>;
  }

  async removeGraph(id: string): Promise<boolean> {
    const db = await this.getDB();
    const existing = await this.getGraph(id);
    if (!existing) return false;
    const tx = db.transaction([GRAPHS_STORE], 'readwrite');
    await reqPromise(tx.objectStore(GRAPHS_STORE).delete(id));
    await this.removeAllTriples(id);
    return true;
  }

  // ── Triples & reifiers (keyed by graph id) ──────────────────────────────────

  async saveTriple(graphId: string, signed: SignedTriple, reifier: Reifier): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE, REIFIERS_STORE], 'readwrite');
      tx.objectStore(TRIPLES_STORE).add(this.serializeTriple(graphId, signed));
      tx.objectStore(REIFIERS_STORE).put(this.serializeReifier(graphId, reifier));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveTriples(graphId: string, signed: SignedTriple[], reifiers: Reifier[]): Promise<void> {
    if (signed.length !== reifiers.length) {
      throw new Error('saveTriples: signed.length must equal reifiers.length');
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE, REIFIERS_STORE], 'readwrite');
      const triplesStore = tx.objectStore(TRIPLES_STORE);
      const reifiersStore = tx.objectStore(REIFIERS_STORE);
      for (let i = 0; i < signed.length; i++) {
        triplesStore.add(this.serializeTriple(graphId, signed[i]));
        reifiersStore.put(this.serializeReifier(graphId, reifiers[i]));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeTriple(graphId: string, signed: SignedTriple): Promise<boolean> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE], 'readwrite');
      const store = tx.objectStore(TRIPLES_STORE);
      const index = store.index('graphId');
      const request = index.openCursor(IDBKeyRange.only(graphId));
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

  async loadTriples(graphId: string): Promise<SignedTriple[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE], 'readonly');
      const store = tx.objectStore(TRIPLES_STORE);
      const index = store.index('graphId');
      const request = index.getAll(IDBKeyRange.only(graphId));
      request.onsuccess = () => {
        const records = request.result as StoredTripleRow[];
        resolve(records.map(r => this.deserializeTriple(r)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async loadReifiers(graphId: string): Promise<Reifier[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([REIFIERS_STORE], 'readonly');
      const store = tx.objectStore(REIFIERS_STORE);
      const index = store.index('graphId');
      const request = index.getAll(IDBKeyRange.only(graphId));
      request.onsuccess = () => {
        const records = request.result as StoredReifierRow[];
        resolve(records.map(r => this.deserializeReifier(r)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async removeAllTriples(graphId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TRIPLES_STORE, REIFIERS_STORE], 'readwrite');
      for (const storeName of [TRIPLES_STORE, REIFIERS_STORE]) {
        const store = tx.objectStore(storeName);
        const index = store.index('graphId');
        const req = index.openCursor(IDBKeyRange.only(graphId));
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

  private serializeTriple(graphId: string, signed: SignedTriple): StoredTripleRow {
    return {
      graphId,
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

  private serializeReifier(graphId: string, r: Reifier): StoredReifierRow {
    return {
      id: r.id,
      graphId,
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
