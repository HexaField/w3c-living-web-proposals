/**
 * Graph governance integration — binds a governance engine to a Graph.
 *
 * Governance applies per-graph (per-graph DID). The `rootCapabilityId` is
 * read from the graph's `governance://root_capability` triple, or set
 * explicitly by the caller.
 */

import { Graph } from '@living-web/personal-graph';
import { GraphGovernanceEngine } from './engine.js';
import { GOV } from './predicates.js';
import { resetCaveatCounters } from './caveats.js';
import type {
  GraphConstraint,
  GovernanceValidationResult,
  CapabilityInfo,
  ValidationContext,
  EnforcementMode,
  ConstraintHandler,
  CaveatHandler,
} from './types.js';

export interface GovernanceOptions {
  /** Root capability id; if absent, looked up from the graph's triples. */
  rootCapabilityId?: string;
  /** Initial enforcement mode; defaults to read from the graph (open if absent). */
  enforcementMode?: EnforcementMode;
  /** Constraint-kind handlers to register on the engine (in addition to the built-in capability check). */
  constraintKinds?: ConstraintHandler[];
  /** Caveat-type handlers to register on the engine (in addition to the built-in `expiry`). */
  caveatTypes?: CaveatHandler[];
  resolveExpression?: (address: string) => Promise<unknown>;
  now?: () => number;
}

export interface GovernanceLayer {
  readonly engine: GraphGovernanceEngine;
  readonly expressionStore: Map<string, unknown>;
  canAddTriple(subject: string, predicate: string, object: string): Promise<GovernanceValidationResult>;
  canAddTripleAs(subject: string, predicate: string, object: string, authorDid: string): Promise<GovernanceValidationResult>;
  constraintsFor(contextDid?: string): Promise<GraphConstraint[]>;
  myCapabilities(myDid: string): Promise<CapabilityInfo[]>;
  enforcementMode(): Promise<EnforcementMode>;
  setEnforcementMode(mode: EnforcementMode): Promise<void>;
  storeExpression(address: string, doc: unknown): void;
  registerConstraintKind(handler: ConstraintHandler): void;
  registerCaveatType(handler: CaveatHandler): void;
  resetCounters: typeof resetCaveatCounters;
}

export function createGovernanceLayer(graph: Graph, opts: GovernanceOptions = {}): GovernanceLayer {
  // Long-lived governance requires a identity for the graph.
  // A graph's IRI is a snapshot hash — it changes whenever any triple
  // (including the ZCAP triples we're about to write!) changes. So we'd
  // have no stable resource to anchor capabilities to. Require did:graph
  // from [[GROUP-IDENTITY]]: groupify the graph before setting up
  // governance.
  if (!graph.did) {
    throw new DOMException(
      `createGovernanceLayer requires a groupified graph (no did:graph on ${graph.id}). ` +
      `Capabilities target the graph's DID, not its current snapshot IRI — call ` +
      `store.groupify() or store.createGroup() first.`,
      'InvalidStateError',
    );
  }
  const graphDid = graph.did;
  const expressionStore = new Map<string, unknown>();

  const ctx: ValidationContext = {
    graphDid,
    rootCapabilityId: opts.rootCapabilityId ?? null,
    enforcementMode: opts.enforcementMode ?? 'open',
    queryTriples: async (q) => {
      const results = await graph.queryTriples({
        subject: q.subject ?? undefined,
        predicate: q.predicate ?? undefined,
        object: q.object ?? undefined,
      });
      return results.map(r => ({
        data: { subject: r.data.subject, predicate: r.data.predicate, object: r.data.object },
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
  for (const handler of opts.constraintKinds ?? []) {
    engine.registerConstraintKind(handler);
  }
  for (const handler of opts.caveatTypes ?? []) {
    engine.registerCaveatType(handler);
  }

  // Load root capability id from triples if not provided.
  (async () => {
    if (!ctx.rootCapabilityId) {
      const triples = await ctx.queryTriples({
        subject: graphDid,
        predicate: GOV.ROOT_CAPABILITY,
      });
      if (triples.length > 0) ctx.rootCapabilityId = triples[0].data.object;
    }
  })();

  return {
    engine,
    expressionStore,

    async canAddTriple(subject, predicate, object) {
      return engine.validate({
        subject, predicate, object,
        author: 'did:key:unknown',
        timestamp: new Date().toISOString(),
      });
    },

    async canAddTripleAs(subject, predicate, object, authorDid) {
      return engine.validate({
        subject, predicate, object,
        author: authorDid,
        timestamp: new Date().toISOString(),
      });
    },

    async constraintsFor(contextDid) {
      return engine.constraintsFor(contextDid ?? graphDid);
    },

    async myCapabilities(myDid) {
      return engine.myCapabilities(myDid);
    },

    async enforcementMode() {
      return engine.getEnforcementMode();
    },

    async setEnforcementMode(mode) {
      await graph.addTriple({
        subject: graphDid,
        predicate: GOV.ENFORCEMENT_MODE,
        object: `"${mode}"`,
      });
      await engine.setEnforcementMode(mode);
    },

    storeExpression(address, doc) {
      expressionStore.set(address, doc);
    },

    registerConstraintKind(handler) {
      engine.registerConstraintKind(handler);
    },

    registerCaveatType(handler) {
      engine.registerCaveatType(handler);
    },

    resetCounters: resetCaveatCounters,
  };
}
