import { v4 as uuidv4 } from 'uuid';
import { SemanticTriple, SignedTriple, TripleQuery, SparqlResult, GraphSyncState } from './types.js';
import { signTriple, EphemeralIdentity, type IdentityProvider } from './signing.js';
import { GraphStorage } from './storage.js';

// TripleEvent for ontripleadded / ontripleremoved
export class TripleEvent extends Event {
  readonly triple: SignedTriple;
  constructor(type: string, triple: SignedTriple) {
    super(type);
    this.triple = triple;
  }
}

/** §7.4 Storage quota — configurable per-graph limit (bytes of serialized triples) */
const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB default

export class PersonalGraph extends EventTarget {
  readonly uuid: string;
  readonly name: string | null;
  readonly state: GraphSyncState = 'private';

  private triples: SignedTriple[] = [];
  private identity: IdentityProvider;
  private storage: GraphStorage;
  private _ontripleadded: EventHandler | null = null;
  private _ontripleremoved: EventHandler | null = null;
  private _quotaBytes: number = DEFAULT_QUOTA_BYTES;
  private _usedBytes: number = 0;

  // BroadcastChannel relay for multi-tab sync
  private _channel: BroadcastChannel | null = null;
  private _instanceId: string;

  constructor(uuid: string, name: string | null, identity: IdentityProvider, storage: GraphStorage) {
    super();
    this.uuid = uuid;
    this.name = name;
    this.identity = identity;
    this.storage = storage;
    this._instanceId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : uuidv4();

    // Set up BroadcastChannel for cross-tab triple relay
    if (typeof BroadcastChannel !== 'undefined') {
      this._channel = new BroadcastChannel(`living-web-graph-${this.uuid}`);
      this._channel.onmessage = (event: MessageEvent) => {
        if (event.data.origin === this._instanceId) return;
        if (event.data.type === 'triple-added') {
          this._addTripleFromRemote(event.data.triple);
        } else if (event.data.type === 'triple-removed') {
          this._removeTripleFromRemote(event.data.triple);
        }
      };
    }
  }

  /** Add a triple received from another tab (no re-broadcast) */
  private _addTripleFromRemote(triple: SignedTriple): void {
    // Deduplicate
    const exists = this.triples.some(
      (t) =>
        t.data.source === triple.data.source &&
        t.data.target === triple.data.target &&
        t.data.predicate === triple.data.predicate &&
        t.author === triple.author &&
        t.timestamp === triple.timestamp
    );
    if (exists) return;
    this.triples.push(triple);
    this.storage.saveTriple(this.uuid, triple);
    this.dispatchEvent(new TripleEvent('tripleadded', triple));
  }

  /** Remove a triple received from another tab (no re-broadcast) */
  private _removeTripleFromRemote(triple: SignedTriple): void {
    const idx = this.triples.findIndex(
      (t) =>
        t.data.source === triple.data.source &&
        t.data.target === triple.data.target &&
        t.data.predicate === triple.data.predicate &&
        t.author === triple.author &&
        t.timestamp === triple.timestamp
    );
    if (idx === -1) return;
    const removed = this.triples.splice(idx, 1)[0];
    this.storage.removeTriple(this.uuid, triple);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
  }

  // Load triples from storage on init
  async _loadFromStorage(): Promise<void> {
    this.triples = await this.storage.loadTriples(this.uuid);
    this._usedBytes = this.triples.reduce((sum, t) => sum + this._estimateTripleSize(t), 0);
  }

  get ontripleadded(): EventHandler | null { return this._ontripleadded; }
  set ontripleadded(handler: EventHandler | null) {
    if (this._ontripleadded) this.removeEventListener('tripleadded', this._ontripleadded);
    this._ontripleadded = handler;
    if (handler) this.addEventListener('tripleadded', handler);
  }

  get ontripleremoved(): EventHandler | null { return this._ontripleremoved; }
  set ontripleremoved(handler: EventHandler | null) {
    if (this._ontripleremoved) this.removeEventListener('tripleremoved', this._ontripleremoved);
    this._ontripleremoved = handler;
    if (handler) this.addEventListener('tripleremoved', handler);
  }

  /** §7.4 Get/set storage quota in bytes */
  get quotaBytes(): number { return this._quotaBytes; }
  set quotaBytes(value: number) { this._quotaBytes = value; }
  get usedBytes(): number { return this._usedBytes; }

  private _estimateTripleSize(signed: SignedTriple): number {
    return JSON.stringify(signed).length * 2; // rough estimate: 2 bytes per char
  }

  private _checkQuota(additionalBytes: number): void {
    if (this._usedBytes + additionalBytes > this._quotaBytes) {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    }
  }

  async addTriple(triple: SemanticTriple): Promise<SignedTriple> {
    if (!this.identity.getDID()) {
      throw new DOMException('No active identity', 'InvalidStateError');
    }
    const signed = await signTriple(triple, this.identity);
    const size = this._estimateTripleSize(signed);
    this._checkQuota(size);
    this.triples.push(signed);
    this._usedBytes += size;
    await this.storage.saveTriple(this.uuid, signed);
    this.dispatchEvent(new TripleEvent('tripleadded', signed));
    this._broadcast('triple-added', signed);
    return signed;
  }

  async addTriples(triples: SemanticTriple[]): Promise<SignedTriple[]> {
    if (!this.identity.getDID()) {
      throw new DOMException('No active identity', 'InvalidStateError');
    }
    // Sign all first (atomic — if any fails, none persist)
    const signed: SignedTriple[] = [];
    let totalSize = 0;
    for (const triple of triples) {
      const s = await signTriple(triple, this.identity);
      signed.push(s);
      totalSize += this._estimateTripleSize(s);
    }
    // Check quota for entire batch
    this._checkQuota(totalSize);
    // Persist all
    this.triples.push(...signed);
    this._usedBytes += totalSize;
    await this.storage.saveTriples(this.uuid, signed);
    for (const s of signed) {
      this.dispatchEvent(new TripleEvent('tripleadded', s));
      this._broadcast('triple-added', s);
    }
    return signed;
  }

  async removeTriple(triple: SignedTriple): Promise<boolean> {
    const idx = this.triples.findIndex(
      (t) =>
        t.data.source === triple.data.source &&
        t.data.target === triple.data.target &&
        t.data.predicate === triple.data.predicate &&
        t.author === triple.author &&
        t.timestamp === triple.timestamp
    );
    if (idx === -1) return false;
    const removed = this.triples.splice(idx, 1)[0];
    await this.storage.removeTriple(this.uuid, triple);
    this.dispatchEvent(new TripleEvent('tripleremoved', removed));
    this._broadcast('triple-removed', removed);
    return true;
  }

  /** Broadcast a triple event to other tabs */
  private _broadcast(type: string, triple: SignedTriple): void {
    this._channel?.postMessage({
      type,
      triple,
      origin: this._instanceId,
    });
  }

  async queryTriples(query: TripleQuery): Promise<SignedTriple[]> {
    let results = this.triples.filter((t) => {
      if (query.source != null && t.data.source !== query.source) return false;
      if (query.target != null && t.data.target !== query.target) return false;
      if (query.predicate != null && t.data.predicate !== query.predicate) return false;
      if (query.fromDate != null && t.timestamp < query.fromDate) return false;
      if (query.untilDate != null && t.timestamp >= query.untilDate) return false;
      return true;
    });
    // Order by timestamp descending
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (query.limit != null) {
      results = results.slice(0, query.limit);
    }
    return results;
  }

  async querySparql(sparql: string): Promise<SparqlResult> {
    // Basic SPARQL SELECT parser for simple BGPs
    // Pattern: SELECT ?vars WHERE { ?s ?p ?o . } LIMIT n
    const selectMatch = sparql.match(/SELECT\s+([\s\S]*?)\s+WHERE\s*\{([\s\S]*?)\}/i);
    if (!selectMatch) {
      throw new DOMException('Only basic SELECT queries are supported in this polyfill', 'NotSupportedError');
    }

    const varsStr = selectMatch[1].trim();
    const bodyStr = selectMatch[2].trim();
    const limitMatch = sparql.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1]) : undefined;

    // Parse variable names
    const vars = varsStr.split(/\s+/).filter((v) => v.startsWith('?')).map((v) => v.slice(1));

    // Parse triple patterns from the WHERE body
    const patterns = this.parseBGPs(bodyStr);
    if (patterns.length === 0) {
      return { type: 'bindings', bindings: [] };
    }

    // Evaluate patterns against in-memory triples
    let bindings: Record<string, string>[] = [{}];
    for (const pattern of patterns) {
      bindings = this.matchPattern(bindings, pattern);
    }

    // Project only requested variables
    let projected = bindings.map((b) => {
      const result: Record<string, string> = {};
      for (const v of vars) {
        if (b[v] !== undefined) result[v] = b[v];
      }
      return result;
    });

    if (limit !== undefined) {
      projected = projected.slice(0, limit);
    }

    return { type: 'bindings', bindings: projected };
  }

  private parseBGPs(body: string): { s: string; p: string; o: string }[] {
    const patterns: { s: string; p: string; o: string }[] = [];
    const normalized = body.replace(/\s+/g, ' ').trim();
    
    // Remove trailing period outside of URIs by finding the last '.' that's not inside < >
    // Split statements on ' . ' pattern but only when not inside < >
    const statements: string[] = [];
    let current = '';
    let inBracket = false;
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      if (ch === '<') inBracket = true;
      if (ch === '>') inBracket = false;
      if (ch === '.' && !inBracket) {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = '';
      } else {
        current += ch;
      }
    }
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    
    for (const stmt of statements) {
      const parts = stmt.match(/^(\S+)\s+((?:<[^>]+>)|\S+)\s+((?:<[^>]+>)|\S+|"[^"]*")$/);
      if (parts) {
        patterns.push({ s: parts[1], p: parts[2], o: parts[3] });
      }
    }
    return patterns;
  }

  private matchPattern(
    bindings: Record<string, string>[],
    pattern: { s: string; p: string; o: string }
  ): Record<string, string>[] {
    const results: Record<string, string>[] = [];

    for (const binding of bindings) {
      for (const triple of this.triples) {
        const newBinding = { ...binding };
        if (!this.matchTerm(pattern.s, triple.data.source, newBinding)) continue;
        if (!this.matchTerm(pattern.p, triple.data.predicate ?? '', newBinding)) continue;
        if (!this.matchTerm(pattern.o, triple.data.target, newBinding)) continue;
        results.push(newBinding);
      }
    }

    return results;
  }

  private matchTerm(pattern: string, value: string, binding: Record<string, string>): boolean {
    if (pattern.startsWith('?')) {
      const varName = pattern.slice(1);
      if (binding[varName] !== undefined) {
        return binding[varName] === value;
      }
      binding[varName] = value;
      return true;
    }
    // Strip angle brackets for URI comparison
    const clean = pattern.replace(/^<|>$/g, '');
    return clean === value;
  }

  async snapshot(): Promise<SignedTriple[]> {
    // Return all triples ordered by timestamp ascending
    return [...this.triples].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}

type EventHandler = ((event: Event) => void) | null;
