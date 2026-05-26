/**
 * GraphStore — an agent's mount table for contexts.
 *
 * Consists of a small private graph (a context whose only delegate is the
 * owning agent and which is never offered for sync) plus zero or more mounted
 * remote contexts.
 */

import { v4 as uuidv4 } from 'uuid';
import { type DIDCredential } from '@living-web/identity';
import { requireContextMethodBinding } from './method-binding.js';
import {
  type ContextCreationOptions,
  type MountOptions,
  type MountedContextInfo,
  type MountMode,
  type SparqlResult,
  type SparqlQueryOptions,
} from './types.js';
import type { IdentityProvider } from './signing.js';
import { Context } from './context.js';
import { GraphStorage } from './storage.js';
import { runSparql } from './sparql.js';
import { parseSnapshot, type GraphSnapshot } from './snapshot.js';

export class ContextLifecycleEvent extends Event {
  readonly graphDid: string;
  readonly creator?: string;
  readonly timestamp: string;
  constructor(type: string, graphDid: string, creator?: string) {
    super(type);
    this.graphDid = graphDid;
    this.creator = creator;
    this.timestamp = new Date().toISOString();
  }
}

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

/** Identity adapter that wraps a held DID credential to satisfy IdentityProvider. */
function credentialAsProvider(credential: DIDCredential): IdentityProvider {
  return {
    getDID: () => credential.did,
    getKeyURI: () => credential.methodId,
    getPublicKey: () => credential.publicKey,
    sign: data => credential.signRaw(data),
  };
}

export class GraphStore extends EventTarget {
  readonly uuid: string;
  readonly name: string;
  readonly agentDid: string;
  readonly privateGraphDid: string;
  readonly mounts = new Map<string, Context>();

  private readonly storage: GraphStorage;
  private readonly agentIdentity: IdentityProvider;
  private readonly graphIdentities = new Map<string, IdentityProvider>();

  private onContextCreatedHandler: EventListener | null = null;
  private onContextDissolvedHandler: EventListener | null = null;
  private onContextMountedHandler: EventListener | null = null;
  private onContextUnmountedHandler: EventListener | null = null;

  constructor(
    uuid: string,
    name: string,
    agentDid: string,
    privateGraphDid: string,
    agentIdentity: IdentityProvider,
    storage: GraphStorage,
  ) {
    super();
    this.uuid = uuid;
    this.name = name;
    this.agentDid = agentDid;
    this.privateGraphDid = privateGraphDid;
    this.agentIdentity = agentIdentity;
    this.storage = storage;
  }

  /** The store's private graph (a Context for agent-local state). */
  privateGraph(): Context | undefined {
    return this.mounts.get(this.privateGraphDid);
  }

  /** Register the signing identity for a particular graph DID. */
  setGraphIdentity(graphDid: string, identity: IdentityProvider): void {
    this.graphIdentities.set(graphDid, identity);
  }

  getGraphIdentity(graphDid: string): IdentityProvider | undefined {
    return this.graphIdentities.get(graphDid);
  }

  // ── Event accessors ─────────────────────────────────────────────────────────

  get oncontextcreated(): EventListener | null { return this.onContextCreatedHandler; }
  set oncontextcreated(h: EventListener | null) {
    if (this.onContextCreatedHandler) this.removeEventListener('contextcreated', this.onContextCreatedHandler);
    this.onContextCreatedHandler = h;
    if (h) this.addEventListener('contextcreated', h);
  }
  get oncontextdissolved(): EventListener | null { return this.onContextDissolvedHandler; }
  set oncontextdissolved(h: EventListener | null) {
    if (this.onContextDissolvedHandler) this.removeEventListener('contextdissolved', this.onContextDissolvedHandler);
    this.onContextDissolvedHandler = h;
    if (h) this.addEventListener('contextdissolved', h);
  }
  get oncontextmounted(): EventListener | null { return this.onContextMountedHandler; }
  set oncontextmounted(h: EventListener | null) {
    if (this.onContextMountedHandler) this.removeEventListener('contextmounted', this.onContextMountedHandler);
    this.onContextMountedHandler = h;
    if (h) this.addEventListener('contextmounted', h);
  }
  get oncontextunmounted(): EventListener | null { return this.onContextUnmountedHandler; }
  set oncontextunmounted(h: EventListener | null) {
    if (this.onContextUnmountedHandler) this.removeEventListener('contextunmounted', this.onContextUnmountedHandler);
    this.onContextUnmountedHandler = h;
    if (h) this.addEventListener('contextunmounted', h);
  }

  // ── Context lifecycle ───────────────────────────────────────────────────────

  /**
   * Create a new context. Mints a fresh did:graph, mounts it in `"governance"`
   * mode, writes the seed DID-document triples + optional participation link.
   */
  async createContext(options: ContextCreationOptions = {}): Promise<Context> {
    const binding = requireContextMethodBinding();
    const { credential } = await binding.mintContextCredential(
      options.displayName ?? 'Untitled Context',
      POLYFILL_PASSPHRASE,
    );
    const graphDid = credential.did;
    const graphIdentity = credentialAsProvider(credential);

    await this.storage.saveContext(graphDid, options.displayName ?? null, this.uuid);
    const context = new Context(graphDid, options.displayName ?? null, graphIdentity, this.storage);
    context.mountMode = 'governance';
    this.mounts.set(graphDid, context);
    this.graphIdentities.set(graphDid, graphIdentity);
    await this.persist();

    // Seed DID-document triples (signed by the graph itself).
    for (const triple of binding.seedTriples(graphDid)) {
      await context.addTriple(triple);
    }

    // Add initial delegates if requested.
    if (options.initialDelegates) {
      for (const delegateDid of options.initialDelegates) {
        const triples = binding.addDelegateTriples(graphDid, delegateDid, ['capabilityInvocation', 'assertionMethod']);
        for (const t of triples) await context.addTriple(t);
      }
    }

    // Participation link if requested.
    if (options.participatesIn) {
      await context.addTriple({
        subject: graphDid,
        predicate: 'context://participates_in',
        object: options.participatesIn,
      });
    }

    this.dispatchEvent(new ContextLifecycleEvent('contextcreated', graphDid, this.agentDid));
    this.dispatchEvent(new ContextLifecycleEvent('contextmounted', graphDid));
    return context;
  }

  /** Mount an existing context by DID. The context must already exist locally. */
  async mount(graphDid: string, options: MountOptions = {}): Promise<Context> {
    if (this.mounts.has(graphDid)) {
      throw new DOMException('Context already mounted', 'InvalidStateError');
    }
    const mode: MountMode = options.mode ?? 'read';

    if (options.snapshotUri) {
      throw new DOMException(
        'mount() with snapshotUri requires using mountSnapshot() directly',
        'NotSupportedError',
      );
    }

    const existing = await this.storage.getContext(graphDid);
    if (!existing) {
      throw new DOMException(
        `No local store for ${graphDid} — use mountSnapshot() to bootstrap from a snapshot`,
        'NotFoundError',
      );
    }
    const context = new Context(graphDid, existing.displayName, this.agentIdentity, this.storage);
    context.mountMode = mode;
    await context.loadFromStorage();
    this.mounts.set(graphDid, context);
    await this.persist();
    this.dispatchEvent(new ContextLifecycleEvent('contextmounted', graphDid));
    return context;
  }

  /**
   * Mount a snapshot — bootstrap a context's local store from a signed snapshot
   * received from another agent.
   */
  async mountSnapshot(
    snapshot: GraphSnapshot,
    options: { targetGraphDid?: string; trustLevel?: string } = {},
  ): Promise<Context> {
    const targetDid = options.targetGraphDid ?? snapshot.graphDid;
    const existing = this.mounts.get(targetDid);
    if (existing) return existing;
    const parsed = parseSnapshot(snapshot);
    await this.storage.saveContext(targetDid, null, this.uuid);
    const context = new Context(targetDid, null, this.agentIdentity, this.storage);
    context.mountMode = 'read';
    context.trustLevel = options.trustLevel ?? 'external';
    for (const t of parsed.triples) {
      await context.addTriple(t);
    }
    this.mounts.set(targetDid, context);
    await this.persist();
    this.dispatchEvent(new ContextLifecycleEvent('contextmounted', targetDid));
    return context;
  }

  async unmount(graphDid: string): Promise<void> {
    if (!this.mounts.delete(graphDid)) return;
    this.graphIdentities.delete(graphDid);
    await this.persist();
    this.dispatchEvent(new ContextLifecycleEvent('contextunmounted', graphDid));
  }

  async dissolveContext(graphDid: string): Promise<boolean> {
    const removed = await this.storage.removeContext(graphDid);
    if (removed) {
      this.mounts.delete(graphDid);
      this.graphIdentities.delete(graphDid);
      await this.persist();
      this.dispatchEvent(new ContextLifecycleEvent('contextdissolved', graphDid));
    }
    return removed;
  }

  getContext(graphDid: string): Context | undefined {
    return this.mounts.get(graphDid);
  }

  listMounted(): MountedContextInfo[] {
    return [...this.mounts.values()].map(c => ({
      graphDid: c.did,
      mode: c.mountMode,
      displayName: c.displayName ?? undefined,
      state: c.state,
    }));
  }

  /** Cross-context SPARQL query — runs over the union of all mounted contexts. */
  async querySparql(sparql: string, _options?: SparqlQueryOptions): Promise<SparqlResult> {
    const all = [];
    for (const ctx of this.mounts.values()) {
      const snap = await ctx.snapshot();
      all.push(...snap);
    }
    return runSparql(sparql, all);
  }

  inContext(graphDid: string): ContextQueryBuilder {
    const ctx = this.mounts.get(graphDid);
    if (!ctx) throw new DOMException(`Context not mounted: ${graphDid}`, 'NotFoundError');
    return new ContextQueryBuilder(ctx);
  }

  /** Persist the GraphStore record (mount table + metadata). */
  async persist(): Promise<void> {
    await this.storage.saveGraphStore({
      uuid: this.uuid,
      name: this.name,
      agentDid: this.agentDid,
      privateGraphDid: this.privateGraphDid,
      mounts: [...this.mounts.values()].map(c => ({ graphDid: c.did, mode: c.mountMode })),
      createdAt: new Date().toISOString(),
    });
  }
}

export class ContextQueryBuilder {
  private readonly context: Context;
  private filter: Record<string, string> = {};
  private pageOffset = 0;
  private pageSize = 100;

  constructor(context: Context) {
    this.context = context;
  }

  inContext(_graphDid: string): this {
    return this;
  }

  where(filter: Record<string, string>): this {
    this.filter = { ...this.filter, ...filter };
    return this;
  }

  /** Reserved for future cross-context include resolution. */
  include(_predicates: string[]): this {
    return this;
  }

  page(offset: number, size: number): this {
    this.pageOffset = offset;
    this.pageSize = size;
    return this;
  }

  async run() {
    const results = await this.context.queryTriples(this.filter);
    return results.slice(this.pageOffset, this.pageOffset + this.pageSize);
  }
}

/** Create a unique UUID. */
export function newUuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : uuidv4();
}

/** Re-exported for callers that need the credential adapter. */
export { credentialAsProvider };
