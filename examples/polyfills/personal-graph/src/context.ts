/**
 * Context — a named graph identified by a did:graph DID.
 *
 * The unit of coherence. Each context has its own backing store, its own
 * governance configuration, and its own participants. Triples carry reifiers
 * with author/timestamp/method/signature.
 */

import { v4 as uuidv4 } from 'uuid';
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

const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024;

export interface TriplePattern {
  source: string;
  predicate: string;
  target: string;
}

export class Context extends EventTarget {
  /** did:graph:... — the canonical identity. */
  readonly did: string;
  /** graph:// alias of the DID. */
  readonly iri: string;
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

  private tripleAddedHandler: EventListener | null = null;
  private tripleRemovedHandler: EventListener | null = null;

  private readonly channel: BroadcastChannel | null;
  private readonly instanceId: string;

  constructor(
    did: string,
    displayName: string | null,
    identity: IdentityProvider,
    storage: GraphStorage,
  ) {
    super();
    this.did = did;
    this.iri = did.startsWith('did:graph:')
      ? `graph://${did.slice('did:graph:'.length)}`
      : did;
    this.displayName = displayName;
    this.identity = identity;
    this.storage = storage;
    this.instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : uuidv4();

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`living-web-context-${this.did}`);
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

  /** Load triples + reifiers from storage. Called by GraphStore after mount. */
  async loadFromStorage(): Promise<void> {
    this.triples = await this.storage.loadTriples(this.did);
    this.reifiers = await this.storage.loadReifiers(this.did);
    this.usedBytesValue = this.triples.reduce((s, t) => s + this.estimateSize(t), 0);
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

  /** Set the identity used to sign writes to this context. */
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
      : new Triple(input.source, input.predicate, input.target);
    const reifier = await signTripleWithReifier(triple, this.identity, this.did);
    const signed = reifierToSigned(reifier);
    const size = this.estimateSize(signed);
    this.checkQuota(size);
    this.triples.push(signed);
    this.reifiers.push(reifier);
    this.usedBytesValue += size;
    await this.storage.saveTriple(this.did, signed, reifier);
    this.dispatchEvent(new TripleEvent('tripleadded', signed));
    this.broadcastMessage({ type: 'triple-added', signed, reifier, origin: this.instanceId });
    return signed;
  }

  async addTriples(inputs: Array<Triple | TriplePattern>): Promise<SignedTriple[]> {
    const signed: SignedTriple[] = [];
    const reifiers: Reifier[] = [];
    let total = 0;
    for (const input of inputs) {
      const triple = input instanceof Triple
        ? input
        : new Triple(input.source, input.predicate, input.target);
      const reifier = await signTripleWithReifier(triple, this.identity, this.did);
      const s = reifierToSigned(reifier);
      signed.push(s);
      reifiers.push(reifier);
      total += this.estimateSize(s);
    }
    this.checkQuota(total);
    this.triples.push(...signed);
    this.reifiers.push(...reifiers);
    this.usedBytesValue += total;
    await this.storage.saveTriples(this.did, signed, reifiers);
    for (let i = 0; i < signed.length; i++) {
      this.dispatchEvent(new TripleEvent('tripleadded', signed[i]));
      this.broadcastMessage({ type: 'triple-added', signed: signed[i], reifier: reifiers[i], origin: this.instanceId });
    }
    return signed;
  }

  async removeTriple(signed: SignedTriple): Promise<boolean> {
    const idx = this.triples.findIndex(t => this.equalSigned(t, signed));
    if (idx === -1) return false;
    const [removed] = this.triples.splice(idx, 1);
    this.reifiers = this.reifiers.filter(r => !(
      r.triple.source === removed.data.source &&
      r.triple.predicate === removed.data.predicate &&
      r.triple.target === removed.data.target &&
      r.author === removed.author &&
      r.timestamp === removed.timestamp
    ));
    await this.storage.removeTriple(this.did, removed);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
    this.broadcastMessage({ type: 'triple-removed', signed: removed, origin: this.instanceId });
    return true;
  }

  async queryTriples(query: TripleQuery): Promise<SignedTriple[]> {
    let results = this.triples.filter(t => {
      if (query.source != null && t.data.source !== query.source) return false;
      if (query.predicate != null && t.data.predicate !== query.predicate) return false;
      if (query.target != null && t.data.target !== query.target) return false;
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
      r.triple.source === triple.source &&
      r.triple.predicate === triple.predicate &&
      r.triple.target === triple.target,
    );
  }

  /** Read all triples currently in the context (synchronous, for DID-document resolvers). */
  readAllTriples(): Triple[] {
    return this.triples.map(t => t.data);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private addTripleFromRemote(signed: SignedTriple, reifier?: Reifier): void {
    if (this.triples.some(t => this.equalSigned(t, signed))) return;
    this.triples.push(signed);
    if (reifier) this.reifiers.push(reifier);
    void this.storage.saveTriple(this.did, signed, reifier ?? {
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
    const idx = this.triples.findIndex(t => this.equalSigned(t, signed));
    if (idx === -1) return;
    const [removed] = this.triples.splice(idx, 1);
    void this.storage.removeTriple(this.did, removed);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
  }

  private equalSigned(a: SignedTriple, b: SignedTriple): boolean {
    return a.data.source === b.data.source &&
           a.data.predicate === b.data.predicate &&
           a.data.target === b.data.target &&
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
