/**
 * Wire did:graph into personal-graph + identity.
 *
 *   - Provide `groupifyContext(ctx, opts)` — the upgrade operation defined by
 *     [[GROUP-IDENTITY]] §4.2 that takes an ungroupified graph, mints a
 *     fresh `did:graph`, writes the binding + DID-document triples into the
 *     graph, and persists the creator's delegate credential.
 *   - Register the `did:graph` resolver on identity, drawing triples from the
 *     locally mounted graphs in the GraphManager.
 *   - Register the credential creator for `method: "graph"` so
 *     `navigator.credentials.create({ did: { method: "graph", ... } })`
 *     creates a fresh graph and groupifies it.
 *   - Register a GraphDIDWriter so DIDCredential.addDelegate / etc. work.
 */

import {
  DIDCredential,
  ed25519,
  encodeEd25519Multibase,
  randomPrivateKey,
  storeCredential,
  registerCredentialMethod,
  registerResolver,
  type DIDDocument,
} from '@living-web/identity';
import type { Graph, GraphManager } from '@living-web/personal-graph';
import {
  isGraphDID,
  publicKeyToGraphDID,
  resolveDIDGraph,
  addMethodTriples,
  removeMethodTriples,
  DID_DOC_PREDICATES,
  type GraphTriple,
  type GraphTripleSource,
  type DIDCapabilitySection,
} from './did-graph.js';
import {
  registerGraphDIDWriter,
  publicKeyFromDid,
  type GraphDIDWriter,
} from './credential.js';

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

export interface GroupifyOptions {
  /** Additional DIDs to add as capabilityInvocation + assertionMethod delegates. */
  initialDelegates?: string[];
  /** Optional display name to record alongside the binding. */
  displayName?: string;
  /** Override the passphrase used to encrypt the new delegate credential. */
  passphrase?: string;
}

export interface GroupifyResult {
  /** The host graph (now groupified — `graph.did` is set). */
  readonly graph: Graph;
  /** The newly-minted did:graph. */
  readonly did: string;
  /** The credential holding the creator's delegate key. */
  readonly credential: DIDCredential;
}

/**
 * Mint a fresh `did:graph` keypair and groupify the given graph. One-way
 * upgrade — if the graph already has a `did:graph` (its triples contain
 * a DID-document subject), rejects with `"InvalidStateError"`. The implicit
 * binding between the graph and the new `did:graph` is the presence of
 * the DID-document triples themselves in this graph.
 */
export async function groupifyContext(
  graph: Graph,
  options: GroupifyOptions = {},
): Promise<GroupifyResult> {
  if (graph.did) {
    throw new DOMException(`Graph ${graph.id} is already groupified (did=${graph.did})`, 'InvalidStateError');
  }

  const passphrase = options.passphrase ?? POLYFILL_PASSPHRASE;
  const privateKey = randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const did = publicKeyToGraphDID(publicKey);
  const methodId = `${did}#${encodeEd25519Multibase(publicKey)}`;
  const createdAt = new Date().toISOString();
  const credLabel = options.displayName ?? `${did} signer`;

  // Persist the creator's delegate credential.
  await storeCredential(methodId, 'Ed25519', credLabel, createdAt, publicKey, privateKey, passphrase);
  const credential = new DIDCredential(did, methodId, 'Ed25519', credLabel, createdAt, publicKey, privateKey);

  // Write the seed DID-document triples. Their subject is the new did:graph;
  // their presence inside this graph is the implicit binding (per Spec 10).
  const seedTriples = addMethodTriples(did, methodId, publicKey, [
    'capabilityInvocation',
    'capabilityDelegation',
    'assertionMethod',
    'authentication',
  ]);
  for (const t of seedTriples) await graph.addTriple(t);

  // Write any initial delegates.
  if (options.initialDelegates) {
    for (const delegateDid of options.initialDelegates) {
      const pk = publicKeyFromDid(delegateDid);
      const id = `${did}#${delegateDid.split(':').pop()?.slice(0, 16) ?? 'delegate'}`;
      const triples = addMethodTriples(did, id, pk, ['capabilityInvocation', 'assertionMethod']);
      for (const t of triples) await graph.addTriple(t);
    }
  }

  graph.setDid(did);
  return { graph, did, credential };
}

/**
 * Install did:graph integration. Call once at install time after
 * `@living-web/identity/polyfill` has run. The `manager` is the
 * personal-graph GraphManager (or a thin shim around it).
 */
export function installDIDGraphBinding(manager: GraphManagerLike): void {
  // ── DIDCredential method creator for "graph" ──────────────────────────────
  // For `navigator.credentials.create({ did: { method: "graph", ... } })`:
  // create a fresh graph via the GraphManager and groupify it.
  registerCredentialMethod('graph', async (opts, passphrase, identityManager) => {
    const m = manager.fullManager?.();
    if (!m) {
      throw new DOMException(
        'navigator.credentials.create({did:{method:"graph"}}) requires navigator.graph to be installed first.',
        'InvalidStateError',
      );
    }
    const graphOptions = opts.graphOptions as
      | { hostGraphIri?: string; initialDelegates?: string[] }
      | undefined;

    let graph: Graph | undefined;
    if (graphOptions?.hostGraphIri) {
      await m.ensureInit();
      graph = m.getGraph(graphOptions.hostGraphIri);
      if (!graph) throw new DOMException(`hostGraphIri not found: ${graphOptions.hostGraphIri}`, 'NotFoundError');
    } else {
      graph = await m.create({ displayName: opts.displayName || 'Unnamed Graph' });
    }

    const { credential } = await groupifyContext(graph, {
      displayName: opts.displayName,
      passphrase,
      initialDelegates: graphOptions?.initialDelegates,
    });
    identityManager.register(credential);
    return credential;
  });

  // ── did:graph resolver into identity ──────────────────────────────────────
  const tripleSource: GraphTripleSource = {
    *readGraph(did: string): Iterable<GraphTriple> {
      // The resolver receives a `did:graph:...`. Find the host graph by
      // matching its sovereign DID.
      for (const g of manager.knownGraphs()) {
        if (g.did === did) {
          for (const triple of g.readAllTriples()) {
            yield { subject: triple.subject, predicate: triple.predicate, object: triple.object };
          }
          return;
        }
      }
    },
  };
  registerResolver('graph', async (did: string): Promise<DIDDocument | null> => {
    if (!isGraphDID(did)) return null;
    return resolveDIDGraph(did, tripleSource);
  });

  // ── DID-document writer for DIDCredential.addDelegate / etc. ──────────────
  // Translates writer-style mutations into graph.addTriple / removeTriple
  // against the host graph. The DID is located via its bound graph
  // (search by g.did === did).
  const findHostGraph = (did: string): Graph | null => {
    for (const g of manager.knownGraphs()) {
      if (g.did === did) return g;
    }
    return null;
  };

  const writer: GraphDIDWriter = {
    async addMethodToGraph(graphDid, methodId, publicKey, sections) {
      const graph = findHostGraph(graphDid);
      if (!graph) throw new Error(`Graph ${graphDid} not known locally`);
      const triples = addMethodTriples(graphDid, methodId, publicKey, sections);
      for (const t of triples) await graph.addTriple(t);
    },
    async removeMethodFromGraph(graphDid, methodId) {
      const graph = findHostGraph(graphDid);
      if (!graph) throw new Error(`Graph ${graphDid} not known locally`);
      for (const removal of removeMethodTriples(graphDid, methodId)) {
        const matching = await graph.queryTriples({
          subject: removal.subject,
          predicate: removal.predicate,
          object: removal.object,
        });
        for (const m of matching) await graph.removeTriple(m);
      }
    },
    async grantSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const graph = findHostGraph(graphDid);
      if (!graph) throw new Error(`Graph ${graphDid} not known locally`);
      await graph.addTriple({
        subject: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        object: methodId,
      });
    },
    async revokeSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const graph = findHostGraph(graphDid);
      if (!graph) throw new Error(`Graph ${graphDid} not known locally`);
      const matching = await graph.queryTriples({
        subject: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        object: methodId,
      });
      for (const m of matching) await graph.removeTriple(m);
    },
  };
  registerGraphDIDWriter(writer);
}

export interface GraphManagerLike {
  /** Iterate known graphs. */
  knownGraphs(): Iterable<Graph>;
  /** Optional escape hatch — provides full GraphManager when available, for credential-creator paths. */
  fullManager?(): GraphManager | null;
}
