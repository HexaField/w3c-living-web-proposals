import { v4 as uuidv4 } from 'uuid';
import { PersonalGraph } from './graph.js';
import { EphemeralIdentity, type IdentityProvider } from './signing.js';
import { GraphStorage } from './storage.js';

export class PersonalGraphManager {
  private graphs: Map<string, PersonalGraph> = new Map();
  private identity: IdentityProvider;
  private storage: GraphStorage;
  private initialized = false;

  constructor(identity?: IdentityProvider, dbName?: string) {
    this.identity = identity ?? new EphemeralIdentity();
    this.storage = new GraphStorage(dbName);
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (this.identity instanceof EphemeralIdentity) {
      await this.identity.ensureReady();
    }
    // Rehydrate graphs from storage
    const records = await this.storage.listGraphs();
    for (const record of records) {
      const graph = new PersonalGraph(record.uuid, record.name, this.identity, this.storage);
      await graph._loadFromStorage();
      this.graphs.set(record.uuid, graph);
    }
    this.initialized = true;
  }

  async create(name?: string): Promise<PersonalGraph> {
    await this.ensureInit();
    const uuid = uuidv4();
    const graphName = name ?? null;
    await this.storage.saveGraph(uuid, graphName);
    const graph = new PersonalGraph(uuid, graphName, this.identity, this.storage);
    this.graphs.set(uuid, graph);
    return graph;
  }

  async list(): Promise<PersonalGraph[]> {
    await this.ensureInit();
    return Array.from(this.graphs.values());
  }

  async get(uuid: string): Promise<PersonalGraph | null> {
    await this.ensureInit();
    return this.graphs.get(uuid) ?? null;
  }

  async remove(uuid: string): Promise<boolean> {
    await this.ensureInit();
    if (!this.graphs.has(uuid)) return false;
    const success = await this.storage.removeGraph(uuid);
    if (success) this.graphs.delete(uuid);
    return success;
  }
}
