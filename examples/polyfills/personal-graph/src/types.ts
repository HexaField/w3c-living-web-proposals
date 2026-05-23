/**
 * Core types — RDF 1.2 with reifier-based provenance.
 */

/** A literal value carried by a triple's object. */
export interface LiteralValue {
  readonly lexicalValue: string;
  readonly datatype: string;        // XSD URI
  readonly language?: string | null;
}

/** A triple (subject, predicate, object). Predicate is REQUIRED (RDF alignment). */
export class Triple {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;             // URI or stringified literal

  constructor(subject: string, predicate: string, object: string) {
    if (!isValidURI(subject)) throw new TypeError(`Invalid subject URI: ${subject}`);
    if (!isValidURI(predicate)) throw new TypeError(`Invalid predicate URI: ${predicate}`);
    if (typeof object !== 'string' || object.length === 0) {
      throw new TypeError('Target must be a non-empty string');
    }
    this.subject = subject;
    this.predicate = predicate;
    this.object = object;
  }

  toString(): string {
    return `<${this.subject}> <${this.predicate}> ${literalize(this.object)} .`;
  }

  equals(other: Triple): boolean {
    return (
      this.subject === other.subject &&
      this.predicate === other.predicate &&
      this.object === other.object
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
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
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

function literalize(object: string): string {
  return isValidURI(object) ? `<${object}>` : `"${object.replace(/"/g, '\\"')}"`;
}

export { isValidURI };
