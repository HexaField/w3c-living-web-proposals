/**
 * Wire did:graph into personal-graph + identity.
 *
 *   - Register a ContextMethodBinding on personal-graph so its createContext
 *     can mint did:graph contexts + seed their DID documents.
 *   - Register a did:graph resolver on identity, drawing triples from the
 *     locally mounted contexts in the GraphStoreManager.
 *   - Register the credential creator for `method: "graph"` so
 *     `navigator.credentials.create({ did: { method: "graph", ... } })`
 *     dispatches into createGraphCredential.
 *   - Register a GraphDIDWriter so DIDCredential.addDelegate / etc. work.
 */

import {
  registerCredentialMethod,
  registerResolver,
  type DIDDocument,
} from '@living-web/identity';
import {
  registerContextMethodBinding,
  type ContextMethodBinding,
  type GraphSeedTriple,
  type DIDCapabilitySection as PGDIDCapabilitySection,
} from '@living-web/personal-graph';
import {
  isGraphDID,
  resolveDIDGraph,
  seedDIDDocumentTriples,
  addMethodTriples,
  removeMethodTriples,
  DID_DOC_PREDICATES,
  type GraphTriple,
  type GraphTripleSource,
  type DIDCapabilitySection,
} from './did-graph.js';
import {
  createGraphCredential,
  registerGraphDIDWriter,
  publicKeyFromDid,
  type GraphDIDWriter,
} from './credential.js';

/**
 * Bind did:graph to a personal-graph GraphStoreManager. Call once at install
 * time after both `@living-web/identity/polyfill` and
 * `@living-web/personal-graph/polyfill` have run.
 */
export function installDIDGraphBinding(manager: GraphStoreManagerLike): void {
  // ── ContextMethodBinding for personal-graph ───────────────────────────────
  const methodBinding: ContextMethodBinding = {
    async mintContextCredential(displayName, passphrase) {
      return createGraphCredential(displayName, passphrase);
    },
    *seedTriples(graphDid): Iterable<GraphSeedTriple> {
      for (const t of seedDIDDocumentTriples(graphDid)) yield t;
    },
    *addDelegateTriples(graphDid, delegateDid, sections): Iterable<GraphSeedTriple> {
      const pk = publicKeyFromDid(delegateDid);
      const methodId = `${graphDid}#${delegateDid.split(':').pop()?.slice(0, 16) ?? 'delegate'}`;
      for (const t of addMethodTriples(graphDid, methodId, pk, sections as DIDCapabilitySection[])) yield t;
    },
    publicKeyFromDid,
  };
  registerContextMethodBinding(methodBinding);

  // ── DIDCredential method creator for "graph" ──────────────────────────────
  registerCredentialMethod('graph', async (opts, passphrase, identityManager) => {
    const { credential } = await createGraphCredential(
      opts.displayName || 'Unnamed Graph',
      passphrase,
      opts.algorithm,
    );
    identityManager.register(credential);
    const graphOptions = opts.graphOptions as
      | { initialDelegates?: string[] }
      | undefined;
    if (graphOptions?.initialDelegates && graphOptions.initialDelegates.length > 0) {
      for (const delegateDid of graphOptions.initialDelegates) {
        await credential.addDelegate({
          id: `${credential.did}#${delegateDid.split(':').pop() ?? 'method'}`,
          publicKey: publicKeyFromDid(delegateDid),
          sections: ['capabilityInvocation', 'assertionMethod'],
        });
      }
    }
    return credential;
  });

  // ── did:graph resolver into identity ──────────────────────────────────────
  const tripleSource: GraphTripleSource = {
    *readGraph(graphDid: string): Iterable<GraphTriple> {
      for (const store of manager.knownStores()) {
        const ctx = store.getContext(graphDid);
        if (!ctx) continue;
        for (const triple of ctx.readAllTriples()) {
          yield { subject: triple.subject, predicate: triple.predicate, object: triple.object };
        }
        return;
      }
    },
  };
  registerResolver('graph', async (did: string): Promise<DIDDocument | null> => {
    if (!isGraphDID(did)) return null;
    return resolveDIDGraph(did, tripleSource);
  });

  // ── DID-document writer for DIDCredential.addDelegate / etc. ──────────────
  const writer: GraphDIDWriter = {
    async addMethodToGraph(graphDid, methodId, publicKey, sections) {
      const context = await manager.resolveContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      const triples = addMethodTriples(graphDid, methodId, publicKey, sections);
      for (const t of triples) await context.addTriple(t);
    },
    async removeMethodFromGraph(graphDid, methodId) {
      const context = await manager.resolveContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      for (const removal of removeMethodTriples(graphDid, methodId)) {
        const matching = await context.queryTriples({
          subject: removal.subject,
          predicate: removal.predicate,
          object: removal.object,
        });
        for (const m of matching) await context.removeTriple(m);
      }
    },
    async grantSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const context = await manager.resolveContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      await context.addTriple({
        subject: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        object: methodId,
      });
    },
    async revokeSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const context = await manager.resolveContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      const matching = await context.queryTriples({
        subject: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        object: methodId,
      });
      for (const m of matching) await context.removeTriple(m);
    },
  };
  registerGraphDIDWriter(writer);

  // Verify type compatibility (personal-graph and group-identity both define
  // DIDCapabilitySection; values are identical strings).
  void (null as PGDIDCapabilitySection | null);
}

interface GraphStoreManagerLike {
  knownStores(): Iterable<{
    getContext(did: string): { readAllTriples(): Iterable<{ subject: string; predicate: string; object: string }> } | undefined;
  }>;
  resolveContext(did: string): Promise<{
    addTriple(t: { subject: string; predicate: string; object: string }): Promise<unknown>;
    removeTriple(t: unknown): Promise<unknown>;
    queryTriples(q: { subject?: string; predicate?: string; object?: string }): Promise<Array<{ data: { subject: string; predicate: string; object: string } }>>;
  } | null>;
}
