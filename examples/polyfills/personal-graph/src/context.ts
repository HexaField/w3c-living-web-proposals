/**
 * Context — a named graph of RDF triples.
 *
 * Its `iri` is a `graph://<content-hash>` URI computed from the current
 * triple set. **Mutations change the IRI** — the IRI identifies a snapshot,
 * not the evolving graph. For sovereign, content-independent identity, the
 * context must be groupified (via @living-web/group-identity) to obtain a
 * stable `did:graph:...` in `context.did`.
 *
 * Internally the context is tracked by an opaque `id` (a fresh UUID at
 * creation, stable for the context's lifetime). Storage is keyed by this
 * id, not by the IRI — the IRI is too volatile.
 */

import { v4 as uuidv4 } from 'uuid';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  Triple,
  type TripleQuery,
  type SparqlResult,
  type SparqlQueryOptions,
  type SignedTriple,
  type Reifier,
  type MountMode,
  type ContextSubscriptionState,
} from './types.js';
import {
  signTripleWithReifier,
  reifierToSigned,
  type IdentityProvider,
} from './signing.js';
import { GraphStorage } from './storage.js';
import { runSparql } from './sparql.js';

export class TripleEvent extends Event {
  readonly triple: SignedTriple;
  constructor(type: string, triple: SignedTriple) {
    super(type);
    this.triple = triple;
  }
}

export class IriChangedEvent extends Event {
  readonly previousIri: string;
  readonly currentIri: string;
  constructor(previousIri: string, currentIri: string) {
    super('irichanged');
    this.previousIri = previousIri;
    this.currentIri = currentIri;
  }
}

const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024;

export interface TriplePattern {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Compute the content-hash IRI for a set of signed triples. The IRI is a
 * pure function of the triples + their reifier metadata — adding, removing,
 * or rewriting any triple changes the IRI. Two contexts with identical
 * triple sets have identical IRIs.
 */
export function computeGraphIri(triples: readonly SignedTriple[]): string {
  const lines = triples.map(t => {
    const isUri = /^[a-zA-Z][\w+\-.]*:.+/.test(t.data.object);
    const obj = isUri ? `<${t.data.object}>` : `"${t.data.object.replace(/"/g, '\\"')}"`;
    return `<${t.data.subject}> <${t.data.predicate}> ${obj} . author=${t.author} ts=${t.timestamp} sig=${t.proof.signature}`;
  }).sort();
  const hash = bytesToHex(sha256(new TextEncoder().encode(lines.join('\n'))));
  return `graph://${hash}`;
}

export class Context extends EventTarget {
  /** Opaque, stable internal id — what storage is keyed by. Not the IRI. */
  readonly id: string;
  /** Optional did:graph:... set by groupification (Spec 10). */
  private _did: string | null = null;
  readonly displayName: string | null;

  mountMode: MountMode = 'governance';
  state: ContextSubscriptionState = 'local';
  trustLevel: string | null = null;

  private triples: SignedTriple[] = [];
  private reifiers: Reifier[] = [];
  private identity: IdentityProvider;
  private readonly storage: GraphStorage;
  private quotaBytesValue = DEFAULT_QUOTA_BYTES;
  private usedBytesValue = 0;

  /** Cached IRI; null forces recomputation on next read. */
  private _cachedIri: string | null = null;

  private tripleAddedHandler: EventListener | null = null;
  private tripleRemovedHandler: EventListener | null = null;
  private iriChangedHandler: EventListener | null = null;

  private readonly channel: BroadcastChannel | null;
  private readonly instanceId: string;

  constructor(
    id: string,
    displayName: string | null,
    identity: IdentityProvider,
    storage: GraphStorage,
  ) {
    super();
    this.id = id;
    this.displayName = displayName;
    this.identity = identity;
    this.storage = storage;
    this.instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : uuidv4();

    // BroadcastChannel is keyed by the stable internal id so all instances
    // of the same context share a channel even as their IRI changes per write.
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`living-web-context-${this.id}`);
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
   * Use `Context.did` for stable identity that survives content changes.
   */
  get iri(): string {
    if (this._cachedIri === null) this._cachedIri = computeGraphIri(this.triples);
    return this._cachedIri;
  }

  /** The did:graph identity if groupified; otherwise null. */
  get did(): string | null {
    return this._did;
  }

  /**
   * Attach a did:graph identity to this context. Called by
   * @living-web/group-identity's groupify() after writing the binding +
   * DID-document triples. Once set, the DID should not change.
   */
  setDid(did: string): void {
    if (this._did && this._did !== did) {
      throw new DOMException(
        `Context ${this.id} is already bound to ${this._did}; cannot rebind to ${did}`,
        'InvalidStateError',
      );
    }
    this._did = did;
  }

  /** Load triples + reifiers from storage. Called by GraphStore after mount. */
  async loadFromStorage(): Promise<void> {
    this.triples = await this.storage.loadTriples(this.id);
    this.reifiers = await this.storage.loadReifiers(this.id);
    this.usedBytesValue = this.triples.reduce((s, t) => s + this.estimateSize(t), 0);
    this.invalidateIri();
    // Pick up the context's did:graph from its DID-document triples, if any.
    // The presence of any `<did:graph:...> did://hasMethod <...>` triple in
    // this context's data is the implicit binding to that DID.
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
  get onirichanged(): EventListener | null {
    return this.iriChangedHandler;
  }
  set onirichanged(handler: EventListener | null) {
    if (this.iriChangedHandler) this.removeEventListener('irichanged', this.iriChangedHandler);
    this.iriChangedHandler = handler;
    if (handler) this.addEventListener('irichanged', handler);
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
    if (!this.identity || !this.identity.getDID()) {
      throw new DOMException('No active identity', 'InvalidStateError');
    }
    const triple = input instanceof Triple
      ? input
      : new Triple(input.subject, input.predicate, input.object);
    // The signing-time "graph identifier" embedded in the reifier is the
    // stable id of this context (the sovereign did:graph if available,
    // otherwise the internal id). Using the volatile IRI would invalidate
    // every reifier on the next write.
    const graphIdForSig = this._did ?? this.id;
    const reifier = await signTripleWithReifier(triple, this.identity, graphIdForSig);
    const signed = reifierToSigned(reifier);
    const size = this.estimateSize(signed);
    this.checkQuota(size);
    const prevIri = this.iri;
    this.triples.push(signed);
    this.reifiers.push(reifier);
    this.usedBytesValue += size;
    this.invalidateIri();
    await this.storage.saveTriple(this.id, signed, reifier);
    this.dispatchEvent(new TripleEvent('tripleadded', signed));
    this.dispatchIriChange(prevIri);
    this.broadcastMessage({ type: 'triple-added', signed, reifier, origin: this.instanceId });
    return signed;
  }

  async addTriples(inputs: Array<Triple | TriplePattern>): Promise<SignedTriple[]> {
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
    const prevIri = this.iri;
    this.triples.push(...signed);
    this.reifiers.push(...reifiers);
    this.usedBytesValue += total;
    this.invalidateIri();
    await this.storage.saveTriples(this.id, signed, reifiers);
    for (let i = 0; i < signed.length; i++) {
      this.dispatchEvent(new TripleEvent('tripleadded', signed[i]));
      this.broadcastMessage({ type: 'triple-added', signed: signed[i], reifier: reifiers[i], origin: this.instanceId });
    }
    this.dispatchIriChange(prevIri);
    return signed;
  }

  async removeTriple(signed: SignedTriple): Promise<boolean> {
    const idx = this.triples.findIndex(t => this.equalSigned(t, signed));
    if (idx === -1) return false;
    const prevIri = this.iri;
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
    this.dispatchIriChange(prevIri);
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
    if (query.limit != null) results = results.slice(0, query.limit);
    return results;
  }

  async querySparql(sparql: string, _options?: SparqlQueryOptions): Promise<SparqlResult> {
    return runSparql(sparql, this.triples);
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

  /** Read all triples currently in the context (synchronous, for DID-document resolvers). */
  readAllTriples(): Triple[] {
    return this.triples.map(t => t.data);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private invalidateIri(): void {
    this._cachedIri = null;
  }

  private dispatchIriChange(previousIri: string): void {
    const currentIri = this.iri;
    if (currentIri === previousIri) return;
    this.dispatchEvent(new IriChangedEvent(previousIri, currentIri));
  }

  private addTripleFromRemote(signed: SignedTriple, reifier?: Reifier): void {
    if (this.triples.some(t => this.equalSigned(t, signed))) return;
    const prevIri = this.iri;
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
    this.dispatchIriChange(prevIri);
  }

  private removeTripleFromRemote(signed: SignedTriple): void {
    const idx = this.triples.findIndex(t => this.equalSigned(t, signed));
    if (idx === -1) return;
    const prevIri = this.iri;
    const [removed] = this.triples.splice(idx, 1);
    this.invalidateIri();
    void this.storage.removeTriple(this.id, removed);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
    this.dispatchIriChange(prevIri);
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
