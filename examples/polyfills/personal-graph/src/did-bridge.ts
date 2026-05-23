/**
 * Bridge between this polyfill and @living-web/identity.
 *
 * Registers:
 *   - A GraphTripleSource so identity's `resolve(did:graph:...)` works.
 *   - A GraphDIDWriter so DIDCredential.addDelegate/removeDelegate work.
 *
 * Called once at install time.
 */

import {
  registerGraphSource,
  registerGraphDIDWriter,
  addMethodTriples,
  removeMethodTriples,
  DID_DOC_PREDICATES,
  type GraphTriple,
  type GraphTripleSource,
  type GraphDIDWriter,
  type DIDCapabilitySection,
} from '@living-web/identity';
import type { GraphStoreManager } from './manager.js';

export function installDIDBridge(manager: GraphStoreManager): void {
  const source: GraphTripleSource = {
    *readGraph(graphDid: string): Iterable<GraphTriple> {
      // Synchronous read for the resolver: collect from the first GraphStore
      // that has the graph mounted.
      for (const store of manager.knownStores()) {
        const ctx = store.getContext(graphDid);
        if (!ctx) continue;
        for (const triple of ctx.readAllTriples()) {
          yield { source: triple.source, predicate: triple.predicate, target: triple.target };
        }
        return;
      }
    },
  };

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
          source: removal.source,
          predicate: removal.predicate,
          target: removal.target,
        });
        for (const m of matching) await context.removeTriple(m);
      }
    },
    async grantSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const context = await manager.resolveContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      await context.addTriple({
        source: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        target: methodId,
      });
    },
    async revokeSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const context = await manager.resolveContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      const matching = await context.queryTriples({
        source: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        target: methodId,
      });
      for (const m of matching) await context.removeTriple(m);
    },
  };

  registerGraphSource(source);
  registerGraphDIDWriter(writer);
}
