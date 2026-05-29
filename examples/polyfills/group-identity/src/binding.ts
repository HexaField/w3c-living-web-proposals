/**
 * Wire did:graph into personal-graph + identity.
 *
 *   - Provide `groupifyContext(ctx, opts)` — the upgrade operation defined by
 *     [[GROUP-IDENTITY]] §4.2 that takes a graph that does not yet have a DID, mints a
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
import { POLYFILL_DEFAULT_SYNC_MODULE } from './types.js';

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

export interface GroupifyOptions {
  /**
   * Content hash of the sync module that will govern this graph
   * (Spec 03 §4.5 — immutable seed predicate `group://syncModule`).
   * REQUIRED: a graph cannot be groupified without committing to a module.
   */
  syncModule: string;
  /** Additional DIDs to add as capabilityInvocation + assertionMethod delegates. */
  initialDelegates?: string[];
  /** Optional display name to record alongside the binding. */
  displayName?: string;
  /** Override the passphrase used to encrypt the new delegate credential. */
  passphrase?: string;
}

export interface ForkOptions {
  /**
   * Content hash of the new graph's sync module
   * (Spec 03 §4.5 — immutable seed predicate `group://syncModule`).
   * REQUIRED; MAY equal the parent's.
   */
  syncModule: string;
  /**
   * The parent revision the fork is taken at; written as the immutable
   * `group://forkedAtRevision` triple on the child. Defaults to the
   * literal "0" if no revision tracker is supplied by the caller.
   */
  forkRevision?: string;
  /**
   * Write `<parent> group://forkedTo <child>` on the parent. Defaults
   * to true. Subject to the parent's `announceFork` action.
   */
  announceFork?: boolean;
  /** Additional DIDs to seed on the child's DID document. */
  initialDelegates?: string[];
  /** Optional display name for the child credential. */
  displayName?: string;
  /** Override the passphrase used to encrypt the new delegate credential. */
  passphrase?: string;
}

export interface ForkResult {
  /** The newly-minted child graph (groupified, with its own did:graph). */
  readonly graph: Graph;
  /** The child's did:graph. */
  readonly did: string;
  /** Credential holding the forking agent's delegate key on the child. */
  readonly credential: DIDCredential;
  /** The parent DID the child was forked from. */
  readonly forkedFrom: string;
  /** The parent revision the fork was taken at. */
  readonly forkedAtRevision: string;
}

export interface GroupifyResult {
  /** The host graph (now a group — `graph.did` is set). */
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
  options: GroupifyOptions,
): Promise<GroupifyResult> {
  if (graph.did) {
    throw new DOMException(`Graph ${graph.id} already has a did:graph (did=${graph.did})`, 'InvalidStateError');
  }
  if (!options || !options.syncModule) {
    throw new TypeError(
      'groupifyContext: options.syncModule is REQUIRED (Spec 03 §4.5 — immutable seed predicate).',
    );
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

  // Bootstrap atomic (Spec 03 §4.2 step 4): immutable seed predicate +
  // seed DID-document triples. The substrate's atomic boundary is the
  // sequence of writes below; once the graph's `did` slot is set the
  // governance engine starts enforcing the immutable-seed-predicate rule.
  await graph.addTriple({
    subject: did,
    predicate: 'group://syncModule',
    object: options.syncModule,
  });

  // Write the seed DID-document triples. Their subject is the new did:graph;
  // their presence inside this graph is the implicit binding.
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
 * Fork a groupified parent into a new `did:graph` (Spec 03 §4.8). The new
 * graph carries `group://forkedFrom`, `group://forkedAtRevision`, and the
 * supplied `group://syncModule` as immutable seed triples.
 *
 * The polyfill performs an in-memory copy of the parent's triples into the
 * child's per-graph store. Production hosts copy the parent's per-graph
 * store contents directly and atomically commit the seed alongside.
 *
 * Authorisation is the caller's responsibility — production hosts gate
 * this via the `forkGraph` action ([[CAPABILITY-FRAMEWORK]] §4.5.4) on
 * the parent.
 */
export async function forkContext(
  parent: Graph,
  child: Graph,
  options: ForkOptions,
): Promise<ForkResult> {
  if (!parent.did) {
    throw new DOMException(
      `Parent graph ${parent.id} is not groupified — fork requires a did:graph (Spec 03 §4.8).`,
      'InvalidStateError',
    );
  }
  if (child.did) {
    throw new DOMException(
      `Child graph ${child.id} already has a did:graph (did=${child.did}); fork requires a fresh target.`,
      'InvalidStateError',
    );
  }
  if (!options || !options.syncModule) {
    throw new TypeError(
      'forkContext: options.syncModule is REQUIRED (Spec 03 §4.5 — immutable seed predicate).',
    );
  }

  const passphrase = options.passphrase ?? POLYFILL_PASSPHRASE;
  const privateKey = randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const childDid = publicKeyToGraphDID(publicKey);
  const methodId = `${childDid}#${encodeEd25519Multibase(publicKey)}`;
  const createdAt = new Date().toISOString();
  const credLabel = options.displayName ?? `${childDid} signer`;
  const forkRevision = options.forkRevision ?? '0';
  const parentDid = parent.did;

  await storeCredential(methodId, 'Ed25519', credLabel, createdAt, publicKey, privateKey, passphrase);
  const credential = new DIDCredential(childDid, methodId, 'Ed25519', credLabel, createdAt, publicKey, privateKey);

  // Step 4 — copy parent state into the child. Triples are copied
  // verbatim; the child's per-graph store will re-sign reifier-bound
  // copies if its sync module emits them downstream, but the copied
  // initial state is verifiable against the parent at `forkRevision`.
  for (const parentTriple of parent.readAllTriples()) {
    // Skip the parent's own DID-document subjects — the child gets a
    // fresh DID with a fresh document below.
    if (parentTriple.subject === parentDid) continue;
    if (parentTriple.subject.startsWith(`${parentDid}#`)) continue;
    await child.addTriple({
      subject: parentTriple.subject,
      predicate: parentTriple.predicate,
      object: parentTriple.object,
    });
  }

  // Step 5 — bootstrap atomic for the child: immutable seed triples plus
  // the seed DID-document triples.
  await child.addTriple({
    subject: childDid,
    predicate: 'group://syncModule',
    object: options.syncModule,
  });
  await child.addTriple({
    subject: childDid,
    predicate: 'group://forkedFrom',
    object: parentDid,
  });
  await child.addTriple({
    subject: childDid,
    predicate: 'group://forkedAtRevision',
    object: forkRevision,
  });

  const seedTriples = addMethodTriples(childDid, methodId, publicKey, [
    'capabilityInvocation',
    'capabilityDelegation',
    'assertionMethod',
    'authentication',
  ]);
  for (const t of seedTriples) await child.addTriple(t);

  if (options.initialDelegates) {
    for (const delegateDid of options.initialDelegates) {
      const pk = publicKeyFromDid(delegateDid);
      const id = `${childDid}#${delegateDid.split(':').pop()?.slice(0, 16) ?? 'delegate'}`;
      const triples = addMethodTriples(childDid, id, pk, ['capabilityInvocation', 'assertionMethod']);
      for (const t of triples) await child.addTriple(t);
    }
  }

  child.setDid(childDid);

  // Step 7 — announce the fork on the parent. This MAY fail if the
  // parent's governance constrains `announceFork`; failure here does
  // not invalidate the child (the authoritative lineage record is the
  // child's `forkedFrom` triple).
  if (options.announceFork !== false) {
    try {
      await parent.addTriple({
        subject: parentDid,
        predicate: 'group://forkedTo',
        object: childDid,
      });
    } catch {
      // Announcement is best-effort; the child's lineage is authoritative.
    }
  }

  return { graph: child, did: childDid, credential, forkedFrom: parentDid, forkedAtRevision: forkRevision };
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
      | { hostGraphIri?: string; initialDelegates?: string[]; syncModule?: string }
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
      syncModule: graphOptions?.syncModule ?? POLYFILL_DEFAULT_SYNC_MODULE,
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
      // matching its DID.
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
    async currentSectionMembers(graphDid, section: DIDCapabilitySection): Promise<string[]> {
      const graph = findHostGraph(graphDid);
      if (!graph) throw new Error(`Graph ${graphDid} not known locally`);
      const matching = await graph.queryTriples({
        subject: graphDid,
        predicate: DID_DOC_PREDICATES[section],
      });
      // Dedupe — a section MAY be granted multiple times for the same method
      // by replay; the brick-state check operates on distinct method ids.
      return [...new Set(matching.map(t => t.data.object))];
    },
    async resolveTarget(target: string) {
      // A target is either a `graph://<hash>` IRI or a `did:graph:...` alias.
      // Look up the host graph and return its current IRI + DID.
      if (target.startsWith('did:graph:')) {
        const g = findHostGraph(target);
        if (!g) return null;
        return { graphIri: g.iri, graphDid: g.did };
      }
      if (target.startsWith('graph://')) {
        for (const g of manager.knownGraphs()) {
          if (g.iri === target) {
            return { graphIri: g.iri, graphDid: g.did ?? null };
          }
        }
        // The target IRI may name a past state of a graph; we cannot resolve
        // its DID retroactively here.
        return { graphIri: target, graphDid: null };
      }
      return null;
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
