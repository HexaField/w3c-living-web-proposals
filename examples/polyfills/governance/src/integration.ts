/**
 * SharedGraph governance integration — extends SharedGraph with governance methods
 */

import { SharedGraph } from '@living-web/graph-sync';
import { GraphGovernanceEngine } from './engine.js';
import { GOV } from './predicates.js';
import type {
  GraphConstraint,
  ValidationResult,
  CapabilityInfo,
  TripleInput,
  ValidationContext,
  TripleRecord,
  ZCAPDocument,
} from './types.js';

export interface GovernedSharedGraphOptions {
  rootAuthority: string;
  resolveExpression?: (address: string) => Promise<unknown>;
  now?: () => number;
}

/**
 * Create a governance engine bound to a SharedGraph.
 * Returns governance methods that can be used alongside the SharedGraph.
 */
export function createGovernanceLayer(
  graph: SharedGraph,
  opts: GovernedSharedGraphOptions,
) {
  const expressionStore = new Map<string, unknown>();

  const ctx: ValidationContext = {
    graphUri: graph.uri,
    rootAuthority: opts.rootAuthority,
    queryTriples: async (q) => {
      const results = await graph.queryTriples({
        source: q.source ?? undefined,
        predicate: q.predicate ?? undefined,
        target: q.target ?? undefined,
      });
      return results.map(r => ({
        data: { source: r.data.source, predicate: r.data.predicate, target: r.data.target },
        author: r.author,
        timestamp: r.timestamp,
      }));
    },
    resolveExpression: opts.resolveExpression ?? (async (address: string) => {
      return expressionStore.get(address) ?? null;
    }),
    now: opts.now,
  };

  const engine = new GraphGovernanceEngine(ctx);

  return {
    engine,
    expressionStore,

    async canAddTriple(source: string, predicate: string | null, target: string): Promise<ValidationResult> {
      const triple: TripleInput = {
        source,
        predicate,
        target,
        author: opts.rootAuthority, // will be overridden
        timestamp: new Date().toISOString(),
      };
      return engine.validate(triple);
    },

    async canAddTripleAs(
      source: string,
      predicate: string | null,
      target: string,
      authorDid: string,
    ): Promise<ValidationResult> {
      const triple: TripleInput = {
        source,
        predicate,
        target,
        author: authorDid,
        timestamp: new Date().toISOString(),
      };
      return engine.validate(triple);
    },

    async constraintsFor(entityAddress: string): Promise<GraphConstraint[]> {
      return engine.constraintsFor(entityAddress);
    },

    async myCapabilities(myDid: string): Promise<CapabilityInfo[]> {
      return engine.myCapabilities(myDid);
    },

    /**
     * Store an expression (ZCAP or VC document) at an address for resolution
     */
    storeExpression(address: string, doc: unknown): void {
      expressionStore.set(address, doc);
    },
  };
}
