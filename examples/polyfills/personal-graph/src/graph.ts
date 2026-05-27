/**
 * Graph — a named set of RDF triples.
 *
 * Its `iri` is a `graph://<content-hash>` URI computed from the current
 * triple set. **Mutations change the IRI** — the IRI identifies a snapshot,
 * not the evolving graph itself. For sovereign, content-independent
 * identity, an extension specification must attach a DID to `graph.did`
 * (see `@living-web/group-identity` for the `did:graph` method).
 *
 * Internally the graph is tracked by an opaque `id` (a fresh UUID at
 * creation, stable for the graph's lifetime). Storage is keyed by this
 * id, not by the IRI — the IRI is too volatile.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Triple,
  type TripleQuery,
  type SparqlResult,
  type SparqlQueryOptions,
  type SignedTriple,
  type Reifier,
} from './types.js';
import {
  signTripleWithReifier,
  reifierToSigned,
  type IdentityProvider,
} from './signing.js';
import { GraphStorage } from './storage.js';
import { runSparql } from './sparql.js';
import {
  getAsSnapshot as buildSnapshot,
  computeContentHash,
  type GraphSnapshot,
  type GetAsSnapshotOptions,
} from './snapshot.js';

export class TripleEvent extends Event {
  readonly triple: SignedTriple;
  constructor(type: string, triple: SignedTriple) {
    super(type);
    this.triple = triple;
  }
}

const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024;

export interface TriplePattern {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Compute the content-hash IRI for a set of signed triples. Hashes the
 * canonical-dataset form (data triples + reifier triples) so that
 * `graph.iri` always equals the IRI a snapshot of the same triples would
 * carry. The canonical definition lives in snapshot.ts (Spec 02 §5.2).
 */
export function computeGraphIri(triples: readonly SignedTriple[]): string {
  return computeContentHash(triples);
}

/**
 * Receiver interface that the GraphManager implements; lets a Graph call
 * back when it is dissolved or wants to surface a sovereign-DID binding.
 */
export interface GraphManagerHooks {
  notifyDissolved(graph: Graph): void;
  resolveGraphIdentity?(graph: Graph): IdentityProvider | undefined;
}

export class Graph extends EventTarget {
  /** Opaque, stable internal id — what storage is keyed by. Not the IRI. */
  readonly id: string;
  /**
   * Optional sovereign DID (content-independent identity) attached by an
   * extension specification. Null until attached.
   */
  private _did: string | null = null;
  readonly displayName: string | null;
  /**
   * Provenance tag for this graph instance. `"local"` for graphs created by
   * the calling agent; `"external"` for graphs materialised from a snapshot
   * received from another source. Extension specifications MAY define
   * additional values (e.g., `"mounted-read"`).
   */
  trustLevel: string | null = 'local';

  private triples: SignedTriple[] = [];
  private reifiers: Reifier[] = [];
  private identity: IdentityProvider;
  private readonly storage: GraphStorage;
  private quotaBytesValue = DEFAULT_QUOTA_BYTES;
  private usedBytesValue = 0;
  private dissolved = false;

  /** Cached IRI; null forces recomputation on next read. */
  private _cachedIri: string | null = null;

  private tripleAddedHandler: EventListener | null = null;
  private tripleRemovedHandler: EventListener | null = null;

  private readonly channel: BroadcastChannel | null;
  private readonly instanceId: string;
  private readonly hooks: GraphManagerHooks | null;

  constructor(
    id: string,
    displayName: string | null,
    identity: IdentityProvider,
    storage: GraphStorage,
    hooks: GraphManagerHooks | null = null,
  ) {
    super();
    this.id = id;
    this.displayName = displayName;
    this.identity = identity;
    this.storage = storage;
    this.hooks = hooks;
    this.instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : uuidv4();

    // BroadcastChannel is keyed by the stable internal id so all instances
    // of the same graph share a channel even as their IRI changes per write.
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`living-web-graph-${this.id}`);
      this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        if (event.data.origin === this.instanceId) return;
        if (event.data.type === 'triple-added') {
          this.addTripleFromRemote(event.data.signed, event.data.reifier);
        } else if (event.data.type === 'triple-removed') {
          this.removeTripleFromRemote(event.data.signed);
        }
      };
    } else {
      this.channel = null;
    }
  }

  /**
   * The graph's current content-hash IRI. **Changes on every mutation.**
   * Use `Graph.did` for stable identity that survives content changes.
   */
  get iri(): string {
    if (this._cachedIri === null) this._cachedIri = computeGraphIri(this.triples);
    return this._cachedIri;
  }

  /** The sovereign DID if attached by an extension; otherwise null. */
  get did(): string | null {
    return this._did;
  }

  /**
   * Attach a sovereign DID to this graph. Called by an extension
   * specification (e.g. `@living-web/group-identity`) after writing the
   * binding + DID-document triples. Once set, the DID should not change.
   */
  setDid(did: string): void {
    if (this._did && this._did !== did) {
      throw new DOMException(
        `Graph ${this.id} is already bound to ${this._did}; cannot rebind to ${did}`,
        'InvalidStateError',
      );
    }
    this._did = did;
  }

  /** Load triples + reifiers from storage. Called by the manager after creation/materialisation. */
  async loadFromStorage(): Promise<void> {
    this.triples = await this.storage.loadTriples(this.id);
    this.reifiers = await this.storage.loadReifiers(this.id);
    this.usedBytesValue = this.triples.reduce((s, t) => s + this.estimateSize(t), 0);
    this.invalidateIri();
    // Pick up the graph's sovereign DID from its DID-document triples, if any.
    if (!this._did) {
      const docTriple = this.triples.find(
        t => t.data.predicate === 'did://hasMethod' && t.data.subject.startsWith('did:graph:'),
      );
      if (docTriple) this._did = docTriple.data.subject;
    }
  }

  get ontripleadded(): EventListener | null {
    return this.tripleAddedHandler;
  }
  set ontripleadded(handler: EventListener | null) {
    if (this.tripleAddedHandler) this.removeEventListener('tripleadded', this.tripleAddedHandler);
    this.tripleAddedHandler = handler;
    if (handler) this.addEventListener('tripleadded', handler);
  }
  get ontripleremoved(): EventListener | null {
    return this.tripleRemovedHandler;
  }
  set ontripleremoved(handler: EventListener | null) {
    if (this.tripleRemovedHandler) this.removeEventListener('tripleremoved', this.tripleRemovedHandler);
    this.tripleRemovedHandler = handler;
    if (handler) this.addEventListener('tripleremoved', handler);
  }

  get quotaBytes(): number {
    return this.quotaBytesValue;
  }
  set quotaBytes(value: number) {
    this.quotaBytesValue = value;
  }
  get usedBytes(): number {
    return this.usedBytesValue;
  }

  setIdentity(identity: IdentityProvider): void {
    this.identity = identity;
  }
  getIdentity(): IdentityProvider {
    return this.identity;
  }

  // ── Triple operations ──────────────────────────────────────────────────────

  async addTriple(input: Triple | TriplePattern): Promise<SignedTriple> {
    this.assertLive();
    if (!this.identity || !this.identity.getDID()) {
      throw new DOMException('No active identity', 'InvalidStateError');
    }
    const triple = input instanceof Triple
      ? input
      : new Triple(input.subject, input.predicate, input.object);
    // The signing-time "graph identifier" embedded in the reifier is the
    // stable id of this graph (the sovereign DID if available, otherwise the
    // internal id). Using the volatile IRI would invalidate every reifier on
    // the next write.
    const graphIdForSig = this._did ?? this.id;
    const reifier = await signTripleWithReifier(triple, this.identity, graphIdForSig);
    const signed = reifierToSigned(reifier);
    const size = this.estimateSize(signed);
    this.checkQuota(size);
    this.triples.push(signed);
    this.reifiers.push(reifier);
    this.usedBytesValue += size;
    this.invalidateIri();
    await this.storage.saveTriple(this.id, signed, reifier);
    this.dispatchEvent(new TripleEvent('tripleadded', signed));
    this.broadcastMessage({ type: 'triple-added', signed, reifier, origin: this.instanceId });
    return signed;
  }

  async addTriples(inputs: Array<Triple | TriplePattern>): Promise<SignedTriple[]> {
    this.assertLive();
    const signed: SignedTriple[] = [];
    const reifiers: Reifier[] = [];
    const graphIdForSig = this._did ?? this.id;
    let total = 0;
    for (const input of inputs) {
      const triple = input instanceof Triple
        ? input
        : new Triple(input.subject, input.predicate, input.object);
      const reifier = await signTripleWithReifier(triple, this.identity, graphIdForSig);
      const s = reifierToSigned(reifier);
      signed.push(s);
      reifiers.push(reifier);
      total += this.estimateSize(s);
    }
    this.checkQuota(total);
    this.triples.push(...signed);
    this.reifiers.push(...reifiers);
    this.usedBytesValue += total;
    this.invalidateIri();
    await this.storage.saveTriples(this.id, signed, reifiers);
    for (let i = 0; i < signed.length; i++) {
      this.dispatchEvent(new TripleEvent('tripleadded', signed[i]));
      this.broadcastMessage({ type: 'triple-added', signed: signed[i], reifier: reifiers[i], origin: this.instanceId });
    }
    return signed;
  }

  async removeTriple(signed: SignedTriple): Promise<boolean> {
    this.assertLive();
    const idx = this.triples.findIndex(t => this.equalSigned(t, signed));
    if (idx === -1) return false;
    const [removed] = this.triples.splice(idx, 1);
    this.reifiers = this.reifiers.filter(r => !(
      r.triple.subject === removed.data.subject &&
      r.triple.predicate === removed.data.predicate &&
      r.triple.object === removed.data.object &&
      r.author === removed.author &&
      r.timestamp === removed.timestamp
    ));
    this.invalidateIri();
    await this.storage.removeTriple(this.id, removed);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
    this.broadcastMessage({ type: 'triple-removed', signed: removed, origin: this.instanceId });
    return true;
  }

  async queryTriples(query: TripleQuery): Promise<SignedTriple[]> {
    let results = this.triples.filter(t => {
      if (query.subject != null && t.data.subject !== query.subject) return false;
      if (query.predicate != null && t.data.predicate !== query.predicate) return false;
      if (query.object != null && t.data.object !== query.object) return false;
      if (query.author != null && t.author !== query.author) return false;
      if (query.fromDate != null && t.timestamp < query.fromDate) return false;
      if (query.untilDate != null && t.timestamp >= query.untilDate) return false;
      return true;
    });
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const start = query.offset ?? 0;
    if (query.limit != null) results = results.slice(start, start + query.limit);
    else if (start > 0) results = results.slice(start);
    return results;
  }

  async querySparql(sparql: string, options?: SparqlQueryOptions): Promise<SparqlResult> {
    // Holonic dataset: default = this graph; named = each Graph in options.namedGraphs.
    const named: Array<{ iri: string; triples: SignedTriple[] }> = [];
    if (options?.namedGraphs) {
      for (const g of options.namedGraphs) {
        named.push({ iri: g.iri, triples: await g.snapshot() });
      }
    }
    return runSparql(sparql, this.triples, named);
  }

  async snapshot(): Promise<SignedTriple[]> {
    return [...this.triples].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** Get reifier(s) attached to a specific triple. */
  async provenance(triple: Triple): Promise<Reifier[]> {
    return this.reifiers.filter(r =>
      r.triple.subject === triple.subject &&
      r.triple.predicate === triple.predicate &&
      r.triple.object === triple.object,
    );
  }

  /** Produce a serialised, signed snapshot of this graph's current state. */
  async getAsSnapshot(options?: GetAsSnapshotOptions): Promise<GraphSnapshot> {
    const graphIdentity = this.hooks?.resolveGraphIdentity?.(this) ?? null;
    return buildSnapshot(
      this.iri,
      this._did,
      this.triples,
      this.identity,
      graphIdentity,
      options,
    );
  }

  /** Release this graph's local persistent storage. */
  async dissolve(): Promise<void> {
    if (this.dissolved) return;
    this.dissolved = true;
    await this.storage.removeGraph(this.id);
    this.channel?.close();
    this.hooks?.notifyDissolved(this);
  }

  /** Read all triples currently in the graph (synchronous, for DID-document resolvers). */
  readAllTriples(): Triple[] {
    return this.triples.map(t => t.data);
  }

  /**
   * Insert pre-signed triples (with their original reifier metadata) without
   * re-signing them. Used by `GraphManager.fromSnapshot()` so the
   * materialised graph reproduces the source snapshot's IRI bit-for-bit.
   *
   * @internal
   */
  ingestSnapshotTriples(signed: readonly SignedTriple[]): void {
    this.assertLive();
    for (const s of signed) {
      const reifier: Reifier = {
        id: `_:r-${s.timestamp}-${s.proof.signature.slice(0, 16)}`,
        triple: s.data,
        author: s.author,
        timestamp: s.timestamp,
        method: s.proof.method,
        signature: s.proof.signature,
      };
      this.triples.push(s);
      this.reifiers.push(reifier);
      this.usedBytesValue += this.estimateSize(s);
      void this.storage.saveTriple(this.id, s, reifier);
    }
    this.invalidateIri();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private assertLive(): void {
    if (this.dissolved) {
      throw new DOMException('Graph has been dissolved', 'InvalidStateError');
    }
  }

  private invalidateIri(): void {
    this._cachedIri = null;
  }

  private addTripleFromRemote(signed: SignedTriple, reifier?: Reifier): void {
    if (this.dissolved) return;
    if (this.triples.some(t => this.equalSigned(t, signed))) return;
    this.triples.push(signed);
    if (reifier) this.reifiers.push(reifier);
    this.invalidateIri();
    void this.storage.saveTriple(this.id, signed, reifier ?? {
      id: `_:r-${signed.timestamp}`,
      triple: signed.data,
      author: signed.author,
      timestamp: signed.timestamp,
      method: signed.proof.method,
      signature: signed.proof.signature,
    });
    this.dispatchEvent(new TripleEvent('tripleadded', signed));
  }

  private removeTripleFromRemote(signed: SignedTriple): void {
    if (this.dissolved) return;
    const idx = this.triples.findIndex(t => this.equalSigned(t, signed));
    if (idx === -1) return;
    const [removed] = this.triples.splice(idx, 1);
    this.invalidateIri();
    void this.storage.removeTriple(this.id, removed);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
  }

  private equalSigned(a: SignedTriple, b: SignedTriple): boolean {
    return a.data.subject === b.data.subject &&
           a.data.predicate === b.data.predicate &&
           a.data.object === b.data.object &&
           a.author === b.author &&
           a.timestamp === b.timestamp;
  }

  private broadcastMessage(message: BroadcastMessage): void {
    this.channel?.postMessage(message);
  }

  private estimateSize(signed: SignedTriple): number {
    return JSON.stringify(signed).length * 2;
  }

  private checkQuota(additional: number): void {
    if (this.usedBytesValue + additional > this.quotaBytesValue) {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    }
  }
}

type BroadcastMessage =
  | { type: 'triple-added'; signed: SignedTriple; reifier: Reifier; origin: string }
  | { type: 'triple-removed'; signed: SignedTriple; origin: string };
