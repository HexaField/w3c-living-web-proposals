/**
 * GraphStoreManager — top-level `navigator.graph` API.
 */

import { IdentityManager } from '@living-web/identity';
import { GraphStore, credentialAsProvider, newUuid } from './graph-store.js';
import { Context } from './context.js';
import { GraphStorage } from './storage.js';
import type { IdentityProvider } from './signing.js';

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

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
      const store = new GraphStore(r.uuid, r.name, r.agentDid, r.privateGraphDid, agentIdentity, this.storage);
      this.stores.set(r.uuid, store);
    }
    this.initialised = true;
  }

  async create(name = 'Untitled'): Promise<GraphStore> {
    await this.ensureInit();
    const uuid = newUuid();
    const agentIdentity = await this.agentIdentityProvider();

    const im = new IdentityManager();
    const { credential } = await im.createGraph(
      `${name} (private)`,
      POLYFILL_PASSPHRASE,
    );
    const privateGraphDid = credential.did;
    const graphIdentity = credentialAsProvider(credential);

    const store = new GraphStore(uuid, name, agentIdentity.getDID(), privateGraphDid, agentIdentity, this.storage);
    await this.storage.saveContext(privateGraphDid, `${name} (private)`, uuid);
    const privateContext = new Context(privateGraphDid, `${name} (private)`, graphIdentity, this.storage);
    privateContext.mountMode = 'governance';
    store.mounts.set(privateGraphDid, privateContext);
    store.setGraphIdentity(privateGraphDid, graphIdentity);
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

  /** Resolve a context by DID across all known GraphStores. */
  async resolveContext(graphDid: string): Promise<Context | null> {
    for (const store of this.stores.values()) {
      const ctx = store.getContext(graphDid);
      if (ctx) return ctx;
    }
    return null;
  }

  /** Synchronous iteration of the GraphStores known so far (no I/O). */
  knownStores(): Iterable<GraphStore> {
    return this.stores.values();
  }
}
