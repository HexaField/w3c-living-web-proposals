import * as Y from 'yjs';
import type { SignedTriple } from '@living-web/personal-graph';

/**
 * Triple key for Y.Map — deterministic key from triple content.
 */
export function tripleKey(t: { data: { source: string; predicate: string | null; target: string } }): string {
  return `${t.data.source}|${t.data.predicate ?? ''}|${t.data.target}`;
}

/**
 * Serialise a SignedTriple for storage in Y.Map.
 */
function serialiseTriple(t: SignedTriple): any {
  return {
    source: t.data.source,
    predicate: t.data.predicate,
    target: t.data.target,
    author: t.author,
    timestamp: t.timestamp,
    proofKey: t.proof.key,
    proofSignature: t.proof.signature,
  };
}

/**
 * Deserialise a stored triple back to SignedTriple shape.
 */
function deserialiseTriple(record: any): SignedTriple {
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

export type BridgeChangeCallback = (
  additions: SignedTriple[],
  removals: SignedTriple[]
) => void;

/**
 * YjsBridge — bidirectional bridge between Y.Doc and triple store.
 * 
 * Local changes are pushed via `localAdd` / `localRemove`.
 * Remote Y.js changes trigger `onRemoteChange` callback.
 */
export class YjsBridge {
  readonly doc: Y.Doc;
  private tripleMap: Y.Map<any>;
  private suppressEcho = false;
  private onRemoteChange: BridgeChangeCallback | null = null;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.tripleMap = doc.getMap('triples');

    // Observe remote changes
    this.tripleMap.observe((event) => {
      if (this.suppressEcho) return;
      if (!this.onRemoteChange) return;

      const additions: SignedTriple[] = [];
      const removals: SignedTriple[] = [];

      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add' || change.action === 'update') {
          const val = this.tripleMap.get(key);
          if (val) additions.push(deserialiseTriple(val));
        } else if (change.action === 'delete') {
          if (change.oldValue) {
            removals.push(deserialiseTriple(change.oldValue));
          }
        }
      });

      if (additions.length > 0 || removals.length > 0) {
        this.onRemoteChange(additions, removals);
      }
    });
  }

  setOnRemoteChange(cb: BridgeChangeCallback): void {
    this.onRemoteChange = cb;
  }

  /**
   * Push a locally-added triple into Y.js (will propagate to peers).
   */
  localAdd(triple: SignedTriple): void {
    const key = tripleKey(triple);
    this.suppressEcho = true;
    try {
      this.tripleMap.set(key, serialiseTriple(triple));
    } finally {
      this.suppressEcho = false;
    }
  }

  /**
   * Push a local removal into Y.js.
   */
  localRemove(triple: SignedTriple): void {
    const key = tripleKey(triple);
    this.suppressEcho = true;
    try {
      this.tripleMap.delete(key);
    } finally {
      this.suppressEcho = false;
    }
  }

  /**
   * Get all triples currently in the Y.Map.
   */
  allTriples(): SignedTriple[] {
    const result: SignedTriple[] = [];
    this.tripleMap.forEach((val) => {
      result.push(deserialiseTriple(val));
    });
    return result;
  }

  /**
   * Check if a triple exists in the Y.Map.
   */
  has(triple: SignedTriple): boolean {
    return this.tripleMap.has(tripleKey(triple));
  }

  destroy(): void {
    this.onRemoteChange = null;
  }
}
