import type { IdentityProvider } from '@living-web/personal-graph';
import { SharedGraph } from './shared-graph.js';
import type { SharedGraphInfo, SharedGraphOptions } from './types.js';
import { SyncProtocolRegistry } from './protocol-registry.js';

/**
 * SharedGraphManager — manages shared graphs.
 * Extends the concept of PersonalGraphManager with join/share/listShared.
 */
export class SharedGraphManager {
  private sharedGraphs = new Map<string, SharedGraph>();
  private identity: IdentityProvider;

  constructor(identity: IdentityProvider) {
    this.identity = identity;
  }

  /**
   * Share a new graph — creates a SharedGraph with a unique URI.
   */
  async share(name?: string, opts?: SharedGraphOptions): Promise<SharedGraph> {
    const graph = SharedGraph.create(this.identity, name, opts);
    this.sharedGraphs.set(graph.uri, graph);
    return graph;
  }

  /**
   * Join an existing shared graph by URI.
   */
  async join(uri: string): Promise<SharedGraph> {
    if (this.sharedGraphs.has(uri)) {
      return this.sharedGraphs.get(uri)!;
    }
    const graph = SharedGraph.join(uri, this.identity);
    this.sharedGraphs.set(uri, graph);
    return graph;
  }

  /**
   * List all shared graphs.
   */
  async listShared(): Promise<SharedGraphInfo[]> {
    return Array.from(this.sharedGraphs.values()).map((g) => ({
      uri: g.uri,
      name: g.name,
      syncState: g.syncState,
      peerCount: 0, // updated lazily
    }));
  }

  /**
   * Get a shared graph by URI.
   */
  async get(uri: string): Promise<SharedGraph | null> {
    return this.sharedGraphs.get(uri) ?? null;
  }

  /**
   * Leave a shared graph.
   */
  async leave(uri: string, opts?: { retainLocalCopy?: boolean }): Promise<boolean> {
    const graph = this.sharedGraphs.get(uri);
    if (!graph) return false;
    await graph.leave(opts);
    if (!opts?.retainLocalCopy) {
      this.sharedGraphs.delete(uri);
    }
    return true;
  }
}
