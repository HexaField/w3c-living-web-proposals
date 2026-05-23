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
  ValidationResult,
  CapabilityInfo,
  TripleInput,
  ValidationContext,
  EnforcementMode,
} from './types.js';

export interface GovernanceOptions {
  /** Root capability id; if absent, looked up from the context's triples. */
  rootCapabilityId?: string;
  /** Initial enforcement mode; defaults to read from the context (open if absent). */
  enforcementMode?: EnforcementMode;
  resolveExpression?: (address: string) => Promise<unknown>;
  now?: () => number;
}

export function createGovernanceLayer(context: Context, opts: GovernanceOptions = {}) {
  const expressionStore = new Map<string, unknown>();

  const ctx: ValidationContext = {
    graphDid: context.did,
    rootCapabilityId: opts.rootCapabilityId ?? null,
    enforcementMode: opts.enforcementMode ?? 'open',
    queryTriples: async (q) => {
      // Query the context's local store.
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

    async canAddTriple(subject: string, predicate: string, object: string): Promise<ValidationResult> {
      return engine.validate({
        subject, predicate, object,
        author: 'did:key:unknown',
        timestamp: new Date().toISOString(),
      });
    },

    async canAddTripleAs(
      subject: string,
      predicate: string,
      object: string,
      authorDid: string,
    ): Promise<ValidationResult> {
      return engine.validate({
        subject, predicate, object,
        author: authorDid,
        timestamp: new Date().toISOString(),
      });
    },

    async constraintsFor(contextDid?: string): Promise<GraphConstraint[]> {
      return engine.constraintsFor(contextDid ?? context.did);
    },

    async myCapabilities(myDid: string): Promise<CapabilityInfo[]> {
      return engine.myCapabilities(myDid);
    },

    async enforcementMode(): Promise<EnforcementMode> {
      return engine.getEnforcementMode();
    },

    async setEnforcementMode(mode: EnforcementMode): Promise<void> {
      // Persist as a triple on the context.
      await context.addTriple({
        subject: context.did,
        predicate: GOV.ENFORCEMENT_MODE,
        object: `"${mode}"`,
      });
      await engine.setEnforcementMode(mode);
    },

    storeExpression(address: string, doc: unknown): void {
      expressionStore.set(address, doc);
    },

    /** Test helper. */
    resetCounters: resetCaveatCounters,
  };
}
