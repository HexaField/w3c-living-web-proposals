/**
 * Core types — RDF 1.2 with reifier-based provenance.
 */

/** A literal value carried by a triple's target. */
export interface LiteralValue {
  readonly lexicalValue: string;
  readonly datatype: string;        // XSD URI
  readonly language?: string | null;
}

/** A triple (subject, predicate, target). Predicate is REQUIRED (RDF alignment). */
export class Triple {
  readonly source: string;
  readonly predicate: string;
  readonly target: string;             // URI or stringified literal

  constructor(source: string, predicate: string, target: string) {
    if (!isValidURI(source)) throw new TypeError(`Invalid source URI: ${source}`);
    if (!isValidURI(predicate)) throw new TypeError(`Invalid predicate URI: ${predicate}`);
    if (typeof target !== 'string' || target.length === 0) {
      throw new TypeError('Target must be a non-empty string');
    }
    this.source = source;
    this.predicate = predicate;
    this.target = target;
  }

  toString(): string {
    return `<${this.source}> <${this.predicate}> ${literalize(this.target)} .`;
  }

  equals(other: Triple): boolean {
    return (
      this.source === other.source &&
      this.predicate === other.predicate &&
      this.target === other.target
    );
  }
}

/** A reifier — per-triple provenance carried as RDF 1.2 reification. */
export interface Reifier {
  readonly id: string;
  readonly triple: Triple;
  readonly author: string;            // signing DID
  readonly timestamp: string;          // RFC 3339
  readonly method: string;             // verification method URI
  readonly signature: string;          // hex-encoded Ed25519 signature
}

/**
 * A triple plus its provenance reifier. Returned from query methods and
 * carried over the wire by [[P2P-GRAPH-SYNC]].
 */
export interface SignedTriple {
  readonly data: Triple;
  readonly author: string;
  readonly timestamp: string;
  readonly proof: {
    readonly method: string;
    readonly signature: string;
  };
}

/** Query for triples. */
export interface TripleQuery {
  source?: string | null;
  predicate?: string | null;
  target?: string | null;
  author?: string | null;
  fromDate?: string | null;
  untilDate?: string | null;
  limit?: number | null;
}

export interface SparqlResult {
  readonly type: 'bindings' | 'graph';
  readonly bindings: Record<string, string>[];
  readonly triples?: Triple[];
  readonly boolean?: boolean;          // ASK queries
}

export interface SparqlQueryOptions {
  /** Graph DIDs to include in the dataset. */
  graphs?: string[];
  defaultGraphMode?: 'default' | 'union' | 'listed';
  timeout?: number;                    // milliseconds
}

export type MountMode = 'read' | 'write' | 'governance';

export type ContextSubscriptionState = 'local' | 'subscribed' | 'external' | 'error';

export interface MountOptions {
  mode?: MountMode;
  capabilityProof?: unknown;
  snapshotUri?: string;
}

export interface ContextCreationOptions {
  displayName?: string;
  /** did:graph of a parent context to participate in. */
  participatesIn?: string;
  /** Additional DIDs to add as capabilityInvocation delegates. */
  initialDelegates?: string[];
}

export interface MountedContextInfo {
  graphDid: string;
  mode: MountMode;
  displayName?: string;
  state: ContextSubscriptionState;
}

function isValidURI(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:.+$/.test(value) || value.startsWith('_:');
}

function literalize(target: string): string {
  return isValidURI(target) ? `<${target}>` : `"${target.replace(/"/g, '\\"')}"`;
}

export { isValidURI };
