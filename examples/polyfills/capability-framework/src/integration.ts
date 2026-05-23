/**
 * Context governance integration — binds a governance engine to a Context.
 *
 * Governance applies per-context (per-graph DID). The `rootCapabilityId` is
 * read from the context's `governance://root_capability` triple, or set
 * explicitly by the caller.
 */

import { Context } from '@living-web/personal-graph';
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
} from './types.js';

export interface GovernanceOptions {
  /** Root capability id; if absent, looked up from the context's triples. */
  rootCapabilityId?: string;
  /** Initial enforcement mode; defaults to read from the context (open if absent). */
  enforcementMode?: EnforcementMode;
  /** Constraint-kind handlers to register on the engine (in addition to the built-in capability check). */
  constraintKinds?: ConstraintHandler[];
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
  resetCounters: typeof resetCaveatCounters;
}

export function createGovernanceLayer(context: Context, opts: GovernanceOptions = {}): GovernanceLayer {
  const expressionStore = new Map<string, unknown>();

  const ctx: ValidationContext = {
    graphDid: context.did,
    rootCapabilityId: opts.rootCapabilityId ?? null,
    enforcementMode: opts.enforcementMode ?? 'open',
    queryTriples: async (q) => {
      const results = await context.queryTriples({
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

  // Load root capability id from triples if not provided.
  (async () => {
    if (!ctx.rootCapabilityId) {
      const triples = await ctx.queryTriples({
        subject: context.did,
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
      return engine.constraintsFor(contextDid ?? context.did);
    },

    async myCapabilities(myDid) {
      return engine.myCapabilities(myDid);
    },

    async enforcementMode() {
      return engine.getEnforcementMode();
    },

    async setEnforcementMode(mode) {
      await context.addTriple({
        subject: context.did,
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

    resetCounters: resetCaveatCounters,
  };
}
