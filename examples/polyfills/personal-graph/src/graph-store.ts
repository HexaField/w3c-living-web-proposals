/**
 * GraphStore — an agent's mount table for contexts.
 *
 * Consists of a small private graph (a context whose only writer is the
 * owning agent and which is never offered for sync) plus zero or more mounted
 * remote contexts.
 *
 * Contexts are tracked internally by opaque ids (fresh UUIDs at creation).
 * The id is the storage key. A context's `iri` is a content hash that
 * changes on every mutation and therefore cannot serve as the storage key;
 * its `did:graph` (when groupified, per [[GROUP-IDENTITY]]) is the sovereign
 * cross-version identifier.
 */

import { v4 as uuidv4 } from 'uuid';
import { type DIDCredential } from '@living-web/identity';
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
  /** The context's stable internal id. */
  readonly contextId: string;
  /** The context's current IRI (a snapshot address; changes per mutation). */
  readonly graphIri: string;
  /** The context's did:graph, if groupified. */
  readonly graphDid: string | null;
  readonly creator?: string;
  readonly timestamp: string;
  constructor(
    type: string,
    contextId: string,
    graphIri: string,
    graphDid: string | null,
    creator?: string,
  ) {
    super(type);
    this.contextId = contextId;
    this.graphIri = graphIri;
    this.graphDid = graphDid;
    this.creator = creator;
    this.timestamp = new Date().toISOString();
  }
}

/** Identity adapter that wraps a held DID credential to satisfy IdentityProvider. */
export function credentialAsProvider(credential: DIDCredential): IdentityProvider {
  return {
    getDID: () => credential.did,
    getKeyURI: () => credential.methodId,
    getPublicKey: () => credential.publicKey,
    sign: data => credential.signRaw(data),
  };
}

export function newUuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : uuidv4();
}

/** Mint a fresh opaque internal id (URN-formatted so it's a valid URI). */
export function newContextId(): string {
  return `urn:context:${newUuid()}`;
}

export class GraphStore extends EventTarget {
  readonly uuid: string;
  readonly name: string;
  readonly agentDid: string;
  /** Internal id of the GraphStore's private context. */
  readonly privateContextId: string;
  /** Mounts are keyed by the context's internal id. */
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
    privateContextId: string,
    agentIdentity: IdentityProvider,
    storage: GraphStorage,
  ) {
    super();
    this.uuid = uuid;
    this.name = name;
    this.agentDid = agentDid;
    this.privateContextId = privateContextId;
    this.agentIdentity = agentIdentity;
    this.storage = storage;
  }

  /** The store's private graph (a Context for agent-local state). */
  privateGraph(): Context | undefined {
    return this.mounts.get(this.privateContextId);
  }

  /** Register an additional signing identity associated with a context. */
  setGraphIdentity(contextId: string, identity: IdentityProvider): void {
    this.graphIdentities.set(contextId, identity);
  }

  getGraphIdentity(contextId: string): IdentityProvider | undefined {
    return this.graphIdentities.get(contextId);
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
   * Create a new ungroupified context. Mints a fresh internal id, persists
   * an empty per-context store, mounts the context in `"governance"` mode,
   * and optionally writes a participation link. Triples are signed by the
   * agent's own identity. No `did:graph` is attached — call
   * `@living-web/group-identity`'s `groupifyContext()` if you need one (the
   * IRI is a content hash that changes on every write, so for any reference
   * that needs to survive mutations, groupification is required).
   */
  async createContext(options: ContextCreationOptions = {}): Promise<Context> {
    const id = newContextId();
    await this.storage.saveContext(id, options.displayName ?? null, this.uuid);
    const context = new Context(id, options.displayName ?? null, this.agentIdentity, this.storage);
    context.mountMode = 'governance';
    this.mounts.set(id, context);
    await this.persist();

    if (options.participatesIn) {
      // The subject is the stable id, not the volatile IRI — the
      // participation link must outlive any single snapshot.
      await context.addTriple({
        subject: context.did ?? context.id,
        predicate: 'context://participates_in',
        object: options.participatesIn,
      });
    }

    this.dispatchEvent(new ContextLifecycleEvent('contextcreated', id, context.iri, context.did, this.agentDid));
    this.dispatchEvent(new ContextLifecycleEvent('contextmounted', id, context.iri, context.did));
    return context;
  }

  /**
   * Mount an existing context by its internal id. The context's per-context
   * store must already exist locally (from a prior createContext or
   * mountSnapshot). Use `getContext(iriOrDid)` to look up by IRI or DID.
   */
  async mount(contextId: string, options: MountOptions = {}): Promise<Context> {
    if (this.mounts.has(contextId)) {
      throw new DOMException('Context already mounted', 'InvalidStateError');
    }
    const mode: MountMode = options.mode ?? 'read';

    if (options.snapshotUri) {
      throw new DOMException(
        'mount() with snapshotUri requires using mountSnapshot() directly',
        'NotSupportedError',
      );
    }

    const existing = await this.storage.getContext(contextId);
    if (!existing) {
      throw new DOMException(
        `No local store for ${contextId} — use mountSnapshot() to bootstrap from a snapshot`,
        'NotFoundError',
      );
    }
    const context = new Context(contextId, existing.displayName, this.agentIdentity, this.storage);
    context.mountMode = mode;
    await context.loadFromStorage();
    this.mounts.set(contextId, context);
    await this.persist();
    this.dispatchEvent(new ContextLifecycleEvent('contextmounted', contextId, context.iri, context.did));
    return context;
  }

  /**
   * Mount a snapshot — bootstrap a context's local store from a signed
   * snapshot received from another agent. Allocates a fresh internal id;
   * the resulting context's IRI matches `snapshot.graphIri` until the
   * first mutation.
   */
  async mountSnapshot(
    snapshot: GraphSnapshot,
    options: { trustLevel?: string } = {},
  ): Promise<Context> {
    const parsed = parseSnapshot(snapshot);
    const id = newContextId();
    await this.storage.saveContext(id, null, this.uuid);
    const context = new Context(id, null, this.agentIdentity, this.storage);
    context.mountMode = 'read';
    context.trustLevel = options.trustLevel ?? 'external';
    for (const t of parsed.triples) {
      await context.addTriple(t);
    }
    this.mounts.set(id, context);
    await this.persist();
    this.dispatchEvent(new ContextLifecycleEvent('contextmounted', id, context.iri, context.did));
    return context;
  }

  async unmount(contextId: string): Promise<void> {
    const ctx = this.mounts.get(contextId);
    if (!this.mounts.delete(contextId)) return;
    this.graphIdentities.delete(contextId);
    await this.persist();
    this.dispatchEvent(new ContextLifecycleEvent('contextunmounted', contextId, ctx?.iri ?? '', ctx?.did ?? null));
  }

  async dissolveContext(contextId: string): Promise<boolean> {
    const ctx = this.mounts.get(contextId);
    const removed = await this.storage.removeContext(contextId);
    if (removed) {
      this.mounts.delete(contextId);
      this.graphIdentities.delete(contextId);
      await this.persist();
      this.dispatchEvent(new ContextLifecycleEvent('contextdissolved', contextId, ctx?.iri ?? '', ctx?.did ?? null));
    }
    return removed;
  }

  /**
   * Look up a mounted context by any of: its internal id, its current IRI,
   * or its did:graph alias (when groupified).
   */
  getContext(idOrIriOrDid: string): Context | undefined {
    const direct = this.mounts.get(idOrIriOrDid);
    if (direct) return direct;
    for (const ctx of this.mounts.values()) {
      if (ctx.iri === idOrIriOrDid) return ctx;
      if (ctx.did && ctx.did === idOrIriOrDid) return ctx;
    }
    return undefined;
  }

  listMounted(): MountedContextInfo[] {
    return [...this.mounts.values()].map(c => ({
      contextId: c.id,
      graphIri: c.iri,
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

  inContext(idOrIriOrDid: string): ContextQueryBuilder {
    const ctx = this.getContext(idOrIriOrDid);
    if (!ctx) throw new DOMException(`Context not mounted: ${idOrIriOrDid}`, 'NotFoundError');
    return new ContextQueryBuilder(ctx);
  }

  /** Persist the GraphStore record (mount table + metadata). */
  async persist(): Promise<void> {
    await this.storage.saveGraphStore({
      uuid: this.uuid,
      name: this.name,
      agentDid: this.agentDid,
      privateContextId: this.privateContextId,
      mounts: [...this.mounts.values()].map(c => ({ id: c.id, mode: c.mountMode })),
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

  inContext(_idOrIriOrDid: string): this {
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
