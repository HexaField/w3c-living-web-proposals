import type { SignedTriple, TripleQuery } from './types.js';

const DB_VERSION = 1;
const GRAPHS_STORE = 'graphs';
const TRIPLES_STORE = 'triples';

interface GraphRecord {
  uuid: string;
  name: string | null;
  createdAt: string;
}

function openDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GRAPHS_STORE)) {
        db.createObjectStore(GRAPHS_STORE, { keyPath: 'uuid' });
      }
      if (!db.objectStoreNames.contains(TRIPLES_STORE)) {
        const store = db.createObjectStore(TRIPLES_STORE, { autoIncrement: true });
        store.createIndex('graphUuid', 'graphUuid', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const req = fn(transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txAll<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T[]>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const req = fn(transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class GraphStorage {
  private db: IDBDatabase | null = null;
  private dbName: string;

  constructor(dbName: string = 'living-web-personal-graph') {
    this.dbName = dbName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB(this.dbName);
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async saveGraph(uuid: string, name: string | null): Promise<void> {
    const db = await this.getDB();
    const record: GraphRecord = { uuid, name, createdAt: new Date().toISOString() };
    await tx(db, [GRAPHS_STORE], 'readwrite', (t) =>
      t.objectStore(GRAPHS_STORE).put(record)
    );
  }

  async listGraphs(): Promise<GraphRecord[]> {
    const db = await this.getDB();
    return txAll(db, [GRAPHS_STORE], 'readonly', (t) =>
      t.objectStore(GRAPHS_STORE).getAll()
    );
  }

  async getGraph(uuid: string): Promise<GraphRecord | undefined> {
    const db = await this.getDB();
    return tx(db, [GRAPHS_STORE], 'readonly', (t) =>
      t.objectStore(GRAPHS_STORE).get(uuid)
    );
  }

  async removeGraph(uuid: string): Promise<boolean> {
    const db = await this.getDB();
    const existing = await this.getGraph(uuid);
    if (!existing) return false;

    // Remove graph record
    await tx(db, [GRAPHS_STORE], 'readwrite', (t) =>
      t.objectStore(GRAPHS_STORE).delete(uuid)
    );

    // Remove all triples for this graph
    await this.removeAllTriples(uuid);
    return true;
  }

  async saveTriple(graphUuid: string, triple: SignedTriple): Promise<void> {
    const db = await this.getDB();
    await tx(db, [TRIPLES_STORE], 'readwrite', (t) =>
      t.objectStore(TRIPLES_STORE).add({
        graphUuid,
        ...this.serializeTriple(triple),
      })
    );
  }

  async saveTriples(graphUuid: string, triples: SignedTriple[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([TRIPLES_STORE], 'readwrite');
      const store = transaction.objectStore(TRIPLES_STORE);
      for (const triple of triples) {
        store.add({ graphUuid, ...this.serializeTriple(triple) });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async removeTriple(graphUuid: string, triple: SignedTriple): Promise<boolean> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([TRIPLES_STORE], 'readwrite');
      const store = transaction.objectStore(TRIPLES_STORE);
      const index = store.index('graphUuid');
      const request = index.openCursor(IDBKeyRange.only(graphUuid));
      let found = false;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const record = cursor.value;
          if (this.tripleMatches(record, triple)) {
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

  async loadTriples(graphUuid: string): Promise<SignedTriple[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([TRIPLES_STORE], 'readonly');
      const store = transaction.objectStore(TRIPLES_STORE);
      const index = store.index('graphUuid');
      const request = index.getAll(IDBKeyRange.only(graphUuid));
      request.onsuccess = () => {
        const records = request.result;
        resolve(records.map((r: any) => this.deserializeTriple(r)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async removeAllTriples(graphUuid: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([TRIPLES_STORE], 'readwrite');
      const store = transaction.objectStore(TRIPLES_STORE);
      const index = store.index('graphUuid');
      const request = index.openCursor(IDBKeyRange.only(graphUuid));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  private serializeTriple(triple: SignedTriple): any {
    return {
      source: triple.data.source,
      target: triple.data.target,
      predicate: triple.data.predicate,
      author: triple.author,
      timestamp: triple.timestamp,
      proofKey: triple.proof.key,
      proofSignature: triple.proof.signature,
    };
  }

  private deserializeTriple(record: any): SignedTriple {
    const { SemanticTriple: _unused, ...rest } = record;
    return {
      data: {
        source: record.source,
        target: record.target,
        predicate: record.predicate,
      } as any,
      author: record.author,
      timestamp: record.timestamp,
      proof: {
        key: record.proofKey,
        signature: record.proofSignature,
      },
    };
  }

  private tripleMatches(record: any, triple: SignedTriple): boolean {
    return (
      record.source === triple.data.source &&
      record.target === triple.data.target &&
      record.predicate === triple.data.predicate &&
      record.author === triple.author &&
      record.timestamp === triple.timestamp
    );
  }
}
