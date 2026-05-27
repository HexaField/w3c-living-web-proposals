/**
 * did:graph credential factory + DIDCredential augmentation.
 *
 * Provides:
 *   - `createGraphCredential(displayName, passphrase, algorithm?)` — mints a
 *     fresh did:graph keypair, persists it via the identity keystore, and
 *     returns a DIDCredential holding the creator's delegate key.
 *   - TypeScript module augmentation + runtime prototype patching of
 *     DIDCredential with `addDelegate`, `removeDelegate`, `grantSection`,
 *     `revokeSection`, and `signGraph` — defined by [[GROUP-IDENTITY]] §5.4.
 *
 * The runtime augmentation is installed by `installCredentialAugmentation()`
 * (called from this package's polyfill entry).
 */

import {
  DIDCredential,
  randomPrivateKey,
  ed25519,
  storeCredential,
  encodeEd25519Multibase,
  didToPublicKey,
  type SignedContent,
} from '@living-web/identity';
import {
  publicKeyToGraphDID,
  graphDIDToPublicKey,
  type DIDCapabilitySection,
} from './did-graph.js';

export interface DelegateAddOptions {
  /** Method id; if omitted, derived from the new key. */
  id?: string;
  /** The new key's public key bytes; if omitted with privateKey, derived. */
  publicKey?: Uint8Array;
  /** A separately-held delegate's private key. */
  privateKey?: Uint8Array;
  /** Sections to grant; defaults to ["capabilityInvocation", "assertionMethod"]. */
  sections?: DIDCapabilitySection[];
}

/**
 * Hooks for writing DID-document changes into a backing graph graph.
 * Implemented by the group-identity polyfill at install time (against the
 * personal-graph GraphManager).
 */
export interface GraphDIDWriter {
  addMethodToGraph(
    graphDid: string,
    methodId: string,
    publicKey: Uint8Array,
    sections: DIDCapabilitySection[],
  ): Promise<void>;
  removeMethodFromGraph(graphDid: string, methodId: string): Promise<void>;
  grantSectionInGraph(
    graphDid: string,
    methodId: string,
    section: DIDCapabilitySection,
  ): Promise<void>;
  revokeSectionInGraph(
    graphDid: string,
    methodId: string,
    section: DIDCapabilitySection,
  ): Promise<void>;
}

let graphWriter: GraphDIDWriter | null = null;

export function registerGraphDIDWriter(writer: GraphDIDWriter): void {
  graphWriter = writer;
}

function requireGraphWriter(): GraphDIDWriter {
  if (!graphWriter) {
    throw new DOMException(
      'No GraphDIDWriter registered — install "@living-web/group-identity/polyfill" after "@living-web/personal-graph/polyfill".',
      'InvalidStateError',
    );
  }
  return graphWriter;
}

/**
 * Mint a fresh did:graph credential. The returned credential holds the
 * "creator" delegate key — the same key encoded into the did:graph
 * identifier itself.
 */
export async function createGraphCredential(
  displayName: string,
  passphrase: string,
  algorithm = 'Ed25519',
): Promise<{ credential: DIDCredential; publicKey: Uint8Array; privateKey: Uint8Array }> {
  if (algorithm !== 'Ed25519') {
    throw new DOMException(`Unsupported algorithm: ${algorithm}`, 'NotSupportedError');
  }
  const privateKey = randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const did = publicKeyToGraphDID(publicKey);
  const methodId = `${did}#${did.slice('did:graph:'.length)}`;
  const createdAt = new Date().toISOString();
  await storeCredential(methodId, algorithm, displayName, createdAt, publicKey, privateKey, passphrase);
  const credential = new DIDCredential(did, methodId, algorithm, displayName, createdAt, publicKey, privateKey);
  return { credential, publicKey, privateKey };
}

// ── DIDCredential augmentation ──────────────────────────────────────────────

declare module '@living-web/identity' {
  interface DIDCredential {
    /** Add a new delegate (verification method) to a did:graph DID document. */
    addDelegate(opts: DelegateAddOptions): Promise<void>;
    /** Remove a delegate by method id. */
    removeDelegate(methodId: string): Promise<void>;
    /** Grant a method an additional capability section. */
    grantSection(methodId: string, section: DIDCapabilitySection): Promise<void>;
    /** Revoke a method's membership in a capability section. */
    revokeSection(methodId: string, section: DIDCapabilitySection): Promise<void>;
    /** Sign a graph snapshot — `{ graphIri, contentHash }`. */
    signGraph(graphIri: string, contentHash: string): Promise<SignedContent>;
  }
}

let augmentationInstalled = false;

export function installCredentialAugmentation(): void {
  if (augmentationInstalled) return;
  augmentationInstalled = true;

  const proto = DIDCredential.prototype;

  proto.addDelegate = async function (this: DIDCredential, opts: DelegateAddOptions): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('addDelegate is only supported for did:graph credentials', 'NotSupportedError');
    }
    const writer = requireGraphWriter();
    let publicKey = opts.publicKey;
    if (!publicKey && opts.privateKey) {
      publicKey = await ed25519.getPublicKeyAsync(opts.privateKey);
    }
    if (!publicKey) throw new Error('addDelegate requires either publicKey or privateKey');
    const methodId = opts.id ?? `${this.did}#${encodeEd25519Multibase(publicKey)}`;
    const sections = opts.sections ?? ['capabilityInvocation', 'assertionMethod'];
    await writer.addMethodToGraph(this.did, methodId, publicKey, sections);
  };

  proto.removeDelegate = async function (this: DIDCredential, methodId: string): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('removeDelegate is only supported for did:graph credentials', 'NotSupportedError');
    }
    await requireGraphWriter().removeMethodFromGraph(this.did, methodId);
  };

  proto.grantSection = async function (
    this: DIDCredential,
    methodId: string,
    section: DIDCapabilitySection,
  ): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('grantSection is only supported for did:graph credentials', 'NotSupportedError');
    }
    await requireGraphWriter().grantSectionInGraph(this.did, methodId, section);
  };

  proto.revokeSection = async function (
    this: DIDCredential,
    methodId: string,
    section: DIDCapabilitySection,
  ): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('revokeSection is only supported for did:graph credentials', 'NotSupportedError');
    }
    await requireGraphWriter().revokeSectionInGraph(this.did, methodId, section);
  };

  proto.signGraph = async function (
    this: DIDCredential,
    graphIri: string,
    contentHash: string,
  ): Promise<SignedContent> {
    return this.sign({ graphIri, contentHash });
  };
}

/** Convenience: decode a DID into its public-key bytes (did:key or did:graph). */
export function publicKeyFromDid(did: string): Uint8Array {
  if (did.startsWith('did:key:')) return didToPublicKey(did);
  if (did.startsWith('did:graph:')) return graphDIDToPublicKey(did);
  throw new Error(`Cannot derive public key from ${did}`);
}
