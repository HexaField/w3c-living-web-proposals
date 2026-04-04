// SemanticTriple — §3.1
export class SemanticTriple {
  readonly source: string;
  readonly target: string;
  readonly predicate: string | null;

  constructor(source: string, target: string, predicate?: string | null) {
    if (!isValidURI(source)) throw new TypeError(`Invalid source URI: ${source}`);
    if (predicate != null && !isValidURI(predicate)) throw new TypeError(`Invalid predicate URI: ${predicate}`);
    // target can be URI or literal — accept any non-empty string
    if (typeof target !== 'string' || target.length === 0) throw new TypeError('Target must be a non-empty string');
    this.source = source;
    this.target = target;
    this.predicate = predicate ?? null;
  }
}

// ContentProof — §3.2
export interface ContentProof {
  readonly key: string;
  readonly signature: string;
}

// SignedTriple — §3.2
export interface SignedTriple {
  readonly data: SemanticTriple;
  readonly author: string;
  readonly timestamp: string;
  readonly proof: ContentProof;
}

// TripleQuery — §3.4
export interface TripleQuery {
  source?: string | null;
  target?: string | null;
  predicate?: string | null;
  fromDate?: string | null;
  untilDate?: string | null;
  limit?: number | null;
}

// SparqlResult — §4.6
export interface SparqlResult {
  readonly type: 'bindings' | 'graph';
  readonly bindings: Record<string, string>[];
  readonly triples?: SemanticTriple[];
}

export type GraphSyncState = 'private' | 'syncing' | 'synced' | 'error';

// URI validation — loose check for URIs (scheme:path)
function isValidURI(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:.+$/.test(value);
}

export { isValidURI };
