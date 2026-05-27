/**
 * GraphManager — the `navigator.graph` entry point.
 *
 * Per Spec 02, the public surface is intentionally minimal:
 *   - `create(options?)` to mint a fresh empty graph
 *   - `fromSnapshot(snapshot, options?)` to materialise a graph from a snapshot
 *
 * Mechanisms for enumerating, re-opening, mounting remote graphs,
 * groupifying, and so on are out of scope here and are layered on by
 * extension polyfills (e.g. `@living-web/group-identity`,
 * `@living-web/context-sync`) via TypeScript module augmentation +
 * runtime prototype patching.
 *
 * Internal hooks (marked @internal) are exposed for those extensions.
 */

import { v4 as uuidv4 } from 'uuid';
import { Graph, type GraphManagerHooks } from './graph.js';
import { GraphStorage } from './storage.js';
import type { IdentityProvider } from './signing.js';
import {
  parseSnapshot,
  type GraphSnapshot,
} from './snapshot.js';
import type { GraphCreationOptions, GraphFromSnapshotOptions } from './types.js';

/** Mint a fresh opaque internal id (URN-formatted so it's a valid URI). */
export function newGraphId(): string {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : uuidv4();
  return `urn:graph:${uuid}`;
}

export class GraphManager {
  /** @internal */ readonly graphs = new Map<string, Graph>();
  /** @internal */ readonly storage: GraphStorage;
  private readonly agentIdentityProvider: () => Promise<IdentityProvider>;
  private readonly graphIdentities = new Map<string, IdentityProvider>();
  private readonly hooks: GraphManagerHooks;
  private initialised = false;

  constructor(
    storage: GraphStorage,
    agentIdentityProvider: () => Promise<IdentityProvider>,
  ) {
    this.storage = storage;
    this.agentIdentityProvider = agentIdentityProvider;
    this.hooks = {
      notifyDissolved: (graph: Graph) => {
        this.graphs.delete(graph.id);
        this.graphIdentities.delete(graph.id);
      },
      resolveGraphIdentity: (graph: Graph) => this.graphIdentities.get(graph.id),
    };
  }

  /** Lazily load known-graph metadata from persistent storage. */
  /** @internal */
  async ensureInit(): Promise<void> {
    if (this.initialised) return;
    const agentIdentity = await this.agentIdentityProvider();
    const records = await this.storage.listGraphs();
    for (const r of records) {
      if (this.graphs.has(r.id)) continue;
      const graph = new Graph(r.id, r.displayName, agentIdentity, this.storage, this.hooks);
      await graph.loadFromStorage();
      this.graphs.set(r.id, graph);
    }
    this.initialised = true;
  }

  /** Create a fresh, empty graph owned by the calling agent. */
  async create(options: GraphCreationOptions = {}): Promise<Graph> {
    await this.ensureInit();
    const id = newGraphId();
    const agentIdentity = await this.agentIdentityProvider();
    await this.storage.saveGraph(id, options.displayName ?? null);
    const graph = new Graph(id, options.displayName ?? null, agentIdentity, this.storage, this.hooks);
    graph.trustLevel = 'local';
    this.graphs.set(id, graph);
    return graph;
  }

  /**
   * Materialise a graph from a previously-serialised snapshot. Accepts any
   * RDF 1.2 serialisation defined by Spec 02 §5.3 (`nquads-canonical`,
   * `nquads`, `turtle`, `jsonld`) — every format carries the full triple
   * set including reifiers and is round-trippable.
   *
   * The resulting graph's IRI matches `snapshot.graphIri` exactly until the
   * first mutation, because the original signed triples + reifiers are
   * reinstated as-is rather than re-signed by the receiving agent.
   *
   * Per Spec 02 §5.5, rejects with `"DataError"` if the recomputed IRI
   * does not match `snapshot.graphIri`.
   */
  async fromSnapshot(snapshot: GraphSnapshot, options: GraphFromSnapshotOptions = {}): Promise<Graph> {
    await this.ensureInit();
    const parsed = parseSnapshot(snapshot);
    const id = newGraphId();
    const agentIdentity = await this.agentIdentityProvider();
    await this.storage.saveGraph(id, null);
    const graph = new Graph(id, null, agentIdentity, this.storage, this.hooks);
    graph.trustLevel = options.trustLevel ?? 'external';
    graph.ingestSnapshotTriples(parsed.triples);
    if (graph.iri !== snapshot.graphIri) {
      await graph.dissolve();
      throw new DOMException(
        `Materialised IRI ${graph.iri} does not match snapshot ${snapshot.graphIri}`,
        'DataError',
      );
    }
    if (snapshot.graphDid) graph.setDid(snapshot.graphDid);
    this.graphs.set(id, graph);
    return graph;
  }

  // ── Internal hooks for extension polyfills ─────────────────────────────────

  /** @internal Iterate known graphs without forcing initialisation I/O. */
  knownGraphs(): Iterable<Graph> {
    return this.graphs.values();
  }

  /** @internal Look up a graph by internal id, current IRI, or sovereign DID. */
  getGraph(idOrIriOrDid: string): Graph | undefined {
    const direct = this.graphs.get(idOrIriOrDid);
    if (direct) return direct;
    for (const g of this.graphs.values()) {
      if (g.iri === idOrIriOrDid) return g;
      if (g.did && g.did === idOrIriOrDid) return g;
    }
    return undefined;
  }

  /** @internal Register an additional signing identity for a specific graph. */
  setGraphIdentity(graphId: string, identity: IdentityProvider): void {
    this.graphIdentities.set(graphId, identity);
  }

  /** @internal Look up a graph-bound signing identity. */
  getGraphIdentity(graphId: string): IdentityProvider | undefined {
    return this.graphIdentities.get(graphId);
  }

  /** @internal The hooks object passed to Graph instances. */
  get graphHooks(): GraphManagerHooks {
    return this.hooks;
  }

  /** @internal Resolve the agent's current identity (delegated to the provider). */
  async getAgentIdentity(): Promise<IdentityProvider> {
    return this.agentIdentityProvider();
  }
}
