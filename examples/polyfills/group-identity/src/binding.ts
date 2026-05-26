/**
 * Wire did:graph into personal-graph + identity.
 *
 *   - Provide `groupifyContext(ctx, opts)` — the upgrade operation defined by
 *     [[GROUP-IDENTITY]] §4.2 that takes an ungroupified context, mints a
 *     fresh `did:graph`, writes the binding + DID-document triples into the
 *     context, and persists the creator's delegate credential.
 *   - Register the `did:graph` resolver on identity, drawing triples from the
 *     locally mounted contexts in the GraphStoreManager.
 *   - Register the credential creator for `method: "graph"` so
 *     `navigator.credentials.create({ did: { method: "graph", ... } })`
 *     creates a fresh context and groupifies it.
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
import type { Context, GraphStoreManager } from '@living-web/personal-graph';
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
  /** The host context (now groupified — `context.did` is set). */
  readonly context: Context;
  /** The newly-minted did:graph. */
  readonly did: string;
  /** The credential holding the creator's delegate key. */
  readonly credential: DIDCredential;
}

/**
 * Mint a fresh `did:graph` keypair and groupify the given context. One-way
 * upgrade — if the context already has a `did:graph` (its triples contain
 * a DID-document subject), rejects with `"InvalidStateError"`. The implicit
 * binding between the context and the new `did:graph` is the presence of
 * the DID-document triples themselves in this context.
 */
export async function groupifyContext(
  context: Context,
  options: GroupifyOptions = {},
): Promise<GroupifyResult> {
  if (context.did) {
    throw new DOMException(`Context ${context.id} is already groupified (did=${context.did})`, 'InvalidStateError');
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
  // their presence inside this context is the implicit binding (per Spec 10).
  const seedTriples = addMethodTriples(did, methodId, publicKey, [
    'capabilityInvocation',
    'capabilityDelegation',
    'assertionMethod',
    'authentication',
  ]);
  for (const t of seedTriples) await context.addTriple(t);

  // Write any initial delegates.
  if (options.initialDelegates) {
    for (const delegateDid of options.initialDelegates) {
      const pk = publicKeyFromDid(delegateDid);
      const id = `${did}#${delegateDid.split(':').pop()?.slice(0, 16) ?? 'delegate'}`;
      const triples = addMethodTriples(did, id, pk, ['capabilityInvocation', 'assertionMethod']);
      for (const t of triples) await context.addTriple(t);
    }
  }

  context.setDid(did);
  return { context, did, credential };
}

/**
 * Install did:graph integration. Call once at install time after
 * `@living-web/identity/polyfill` has run. The `manager` is the
 * personal-graph GraphStoreManager (or a thin shim around it).
 */
export function installDIDGraphBinding(manager: GraphStoreManagerLike): void {
  // ── DIDCredential method creator for "graph" ──────────────────────────────
  // For `navigator.credentials.create({ did: { method: "graph", ... } })`:
  // create a fresh context in a fresh GraphStore and groupify it.
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

    let context: Context | null = null;
    if (graphOptions?.hostGraphIri) {
      context = await m.resolveContext(graphOptions.hostGraphIri);
      if (!context) throw new DOMException(`hostGraphIri not found: ${graphOptions.hostGraphIri}`, 'NotFoundError');
    } else {
      // Mint a fresh context in a fresh GraphStore.
      const store = await m.create(opts.displayName || 'Unnamed Graph');
      context = await store.createContext({ displayName: opts.displayName || 'Unnamed Graph' });
    }

    const { credential } = await groupifyContext(context, {
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
      // The resolver receives a `did:graph:...`. Find the host context by
      // looking for the `<did> group://wrapsGraph ?iri` binding (or, as a
      // fallback, the reverse `<?iri> group://didIdentity <did>`).
      for (const store of manager.knownStores()) {
        for (const ctx of store.mounts.values()) {
          if (ctx.did === did) {
            for (const triple of ctx.readAllTriples()) {
              yield { subject: triple.subject, predicate: triple.predicate, object: triple.object };
            }
            return;
          }
        }
      }
    },
  };
  registerResolver('graph', async (did: string): Promise<DIDDocument | null> => {
    if (!isGraphDID(did)) return null;
    return resolveDIDGraph(did, tripleSource);
  });

  // ── DID-document writer for DIDCredential.addDelegate / etc. ──────────────
  // Translates writer-style mutations into context.addTriple / removeTriple
  // against the host context. The DID may be located via its bound context
  // (search by ctx.did === did).
  const findHostContext = async (did: string): Promise<Context | null> => {
    for (const store of manager.knownStores()) {
      for (const ctx of store.mounts.values()) {
        if (ctx.did === did) return ctx;
      }
    }
    return null;
  };

  const writer: GraphDIDWriter = {
    async addMethodToGraph(graphDid, methodId, publicKey, sections) {
      const context = await findHostContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      const triples = addMethodTriples(graphDid, methodId, publicKey, sections);
      for (const t of triples) await context.addTriple(t);
    },
    async removeMethodFromGraph(graphDid, methodId) {
      const context = await findHostContext(graphDid);
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
      const context = await findHostContext(graphDid);
      if (!context) throw new Error(`Graph ${graphDid} not mounted`);
      await context.addTriple({
        subject: graphDid,
        predicate: DID_DOC_PREDICATES[section],
        object: methodId,
      });
    },
    async revokeSectionInGraph(graphDid, methodId, section: DIDCapabilitySection) {
      const context = await findHostContext(graphDid);
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
}

export interface GraphStoreManagerLike {
  knownStores(): Iterable<{
    mounts: Map<string, Context>;
  }>;
  /** Optional escape hatch — provides full GraphStoreManager when available, for credential-creator paths. */
  fullManager?(): GraphStoreManager | null;
}
