/**
 * GraphStoreManager — top-level `navigator.graph` API.
 */

import { GraphStore, newUuid, newContextId } from './graph-store.js';
import { Context } from './context.js';
import { GraphStorage } from './storage.js';
import type { IdentityProvider } from './signing.js';

export class GraphStoreManager {
  private readonly stores = new Map<string, GraphStore>();
  private readonly storage: GraphStorage;
  private readonly agentIdentityProvider: () => Promise<IdentityProvider>;
  private initialised = false;

  constructor(
    storage: GraphStorage,
    agentIdentityProvider: () => Promise<IdentityProvider>,
  ) {
    this.storage = storage;
    this.agentIdentityProvider = agentIdentityProvider;
  }

  private async ensureInit(): Promise<void> {
    if (this.initialised) return;
    const records = await this.storage.listGraphStores();
    const agentIdentity = await this.agentIdentityProvider();
    for (const r of records) {
      if (this.stores.has(r.uuid)) continue;
      const store = new GraphStore(r.uuid, r.name, r.agentDid, r.privateContextId, agentIdentity, this.storage);
      this.stores.set(r.uuid, store);
    }
    this.initialised = true;
  }

  async create(name = 'Untitled'): Promise<GraphStore> {
    await this.ensureInit();
    const uuid = newUuid();
    const agentIdentity = await this.agentIdentityProvider();

    const privateContextId = newContextId();
    const store = new GraphStore(uuid, name, agentIdentity.getDID(), privateContextId, agentIdentity, this.storage);
    await this.storage.saveContext(privateContextId, `${name} (private)`, uuid);
    const privateContext = new Context(privateContextId, `${name} (private)`, agentIdentity, this.storage);
    privateContext.mountMode = 'governance';
    store.mounts.set(privateContextId, privateContext);
    await store.persist();

    this.stores.set(uuid, store);
    return store;
  }

  async list(): Promise<GraphStore[]> {
    await this.ensureInit();
    return [...this.stores.values()];
  }

  async get(uuid: string): Promise<GraphStore | null> {
    await this.ensureInit();
    return this.stores.get(uuid) ?? null;
  }

  async remove(uuid: string): Promise<boolean> {
    await this.ensureInit();
    const removed = await this.storage.removeGraphStore(uuid);
    if (removed) this.stores.delete(uuid);
    return removed;
  }

  /** Resolve a context by id, current IRI, or did:graph across all known GraphStores. */
  async resolveContext(idOrIriOrDid: string): Promise<Context | null> {
    for (const store of this.stores.values()) {
      const ctx = store.getContext(idOrIriOrDid);
      if (ctx) return ctx;
    }
    return null;
  }

  /** Synchronous iteration of the GraphStores known so far (no I/O). */
  knownStores(): Iterable<GraphStore> {
    return this.stores.values();
  }
}
