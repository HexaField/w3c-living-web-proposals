/**
 * DIDCredential — represents one DID and (for did:key, or for held graph delegates)
 * its private key.
 *
 * For did:key: the credential's private key IS the DID's only key.
 * For did:graph: the credential's private key is the key of one verification
 *   method listed in the graph's DID document. The same agent may hold multiple
 *   delegate credentials for different graphs.
 */

import {
  publicKeyToDID,
  encodeEd25519Multibase,
  type DIDDocument,
  type DIDDocumentMethod,
} from './did-key.js';
import { publicKeyToGraphDID, type DIDCapabilitySection } from './did-graph.js';
import { signData, type SignedContent, ed25519 } from './signing.js';
import { resolve } from './resolver.js';
import {
  storeCredential,
  loadCredential,
  unlockPrivateKey,
  deleteCredential,
  exportEncrypted,
  importEncrypted,
  hexDecode,
  type StoredCredential,
} from './keystore.js';

export type DIDCredentialKind = 'individual' | 'graph';

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
 * Hooks for writing DID-document changes into a backing graph context.
 * @living-web/personal-graph implements and registers these.
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
      'No GraphDIDWriter registered — install @living-web/personal-graph',
      'InvalidStateError',
    );
  }
  return graphWriter;
}

export class DIDCredential {
  readonly id: string;
  readonly type = 'did' as const;
  readonly did: string;
  readonly method: string;
  readonly kind: DIDCredentialKind;
  readonly algorithm: string;
  readonly displayName: string;
  readonly createdAt: string;
  /** For did:graph: the verification method id whose key this credential holds. */
  readonly methodId: string;

  private _publicKey: Uint8Array;
  private _privateKey: Uint8Array | null = null;
  private _isLocked = true;

  constructor(
    did: string,
    methodId: string,
    algorithm: string,
    displayName: string,
    createdAt: string,
    publicKey: Uint8Array,
    privateKey?: Uint8Array | null,
  ) {
    this.id = did;
    this.did = did;
    this.methodId = methodId;
    this.algorithm = algorithm;
    this.displayName = displayName;
    this.createdAt = createdAt;
    this._publicKey = publicKey;
    if (privateKey) {
      this._privateKey = privateKey;
      this._isLocked = false;
    }
    if (did.startsWith('did:key:')) {
      this.method = 'key';
      this.kind = 'individual';
    } else if (did.startsWith('did:graph:')) {
      this.method = 'graph';
      this.kind = 'graph';
    } else {
      const match = did.match(/^did:([^:]+):/);
      this.method = match?.[1] ?? 'unknown';
      this.kind = 'individual';
    }
  }

  get isLocked(): boolean {
    return this._isLocked;
  }
  get publicKey(): Uint8Array {
    return this._publicKey;
  }

  /** Raw Ed25519 signing for low-level integrations. */
  async signRaw(data: Uint8Array): Promise<Uint8Array> {
    if (this._isLocked || !this._privateKey) {
      throw new DOMException('Credential is locked', 'InvalidStateError');
    }
    return ed25519.signAsync(data, this._privateKey);
  }

  async sign(data: unknown): Promise<SignedContent> {
    if (this._isLocked || !this._privateKey) {
      throw new DOMException('Credential is locked', 'InvalidStateError');
    }
    return signData(data, this._privateKey, this.did, this.methodId);
  }

  /** Sign a graph snapshot. The data is { graphIri, contentHash }. */
  async signGraph(graphIri: string, contentHash: string): Promise<SignedContent> {
    return this.sign({ graphIri, contentHash });
  }

  /** Sign a ZCAP delegation. */
  async signCapability(zcap: object): Promise<SignedContent> {
    return this.sign({ ...zcap, signedAt: new Date().toISOString() });
  }

  /** Resolve this credential's DID to its current DID document. */
  async resolve(): Promise<DIDDocument> {
    return resolve(this.did);
  }

  /** List current delegates (verification methods) on this DID's document. */
  async delegates(): Promise<DIDDocumentMethod[]> {
    const doc = await this.resolve();
    return doc.verificationMethod;
  }

  /**
   * Add a new delegate (verification method) to a did:graph DID document.
   *
   * Rejects for did:key (those documents are immutable).
   */
  async addDelegate(opts: DelegateAddOptions): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('did:key documents are immutable', 'NotSupportedError');
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
  }

  async removeDelegate(methodId: string): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('did:key documents are immutable', 'NotSupportedError');
    }
    await requireGraphWriter().removeMethodFromGraph(this.did, methodId);
  }

  async grantSection(methodId: string, section: DIDCapabilitySection): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('did:key documents are immutable', 'NotSupportedError');
    }
    await requireGraphWriter().grantSectionInGraph(this.did, methodId, section);
  }

  async revokeSection(methodId: string, section: DIDCapabilitySection): Promise<void> {
    if (this.method !== 'graph') {
      throw new DOMException('did:key documents are immutable', 'NotSupportedError');
    }
    await requireGraphWriter().revokeSectionInGraph(this.did, methodId, section);
  }

  async lock(): Promise<void> {
    if (this._privateKey) {
      this._privateKey.fill(0);
      this._privateKey = null;
    }
    this._isLocked = true;
  }

  async unlock(passphrase: string): Promise<void> {
    const stored = await loadCredential(this.storageKey());
    if (!stored) {
      throw new DOMException('Credential not found in storage', 'NotFoundError');
    }
    this._privateKey = await unlockPrivateKey(stored, passphrase);
    this._isLocked = false;
  }

  async delete(): Promise<void> {
    await this.lock();
    await deleteCredential(this.storageKey());
  }

  async exportKey(exportPassphrase: string): Promise<Uint8Array> {
    if (this._isLocked || !this._privateKey) {
      throw new DOMException('Credential is locked', 'InvalidStateError');
    }
    return exportEncrypted(this._privateKey, exportPassphrase);
  }

  /**
   * Storage key — uniquely identifies this credential record across DID and method id.
   * For did:key, methodId == did#<multibase>, so this is just the DID.
   * For did:graph, multiple delegate keys can exist per DID; we key on methodId.
   */
  private storageKey(): string {
    return this.method === 'graph' ? this.methodId : this.did;
  }

  /** Create a new did:key credential (individual identity). */
  static async createIndividual(
    displayName: string,
    passphrase: string,
    algorithm = 'Ed25519',
  ): Promise<DIDCredential> {
    if (algorithm !== 'Ed25519') {
      throw new DOMException(`Unsupported algorithm: ${algorithm}`, 'NotSupportedError');
    }
    const privateKey = randomPrivateKey();
    const publicKey = await ed25519.getPublicKeyAsync(privateKey);
    const did = publicKeyToDID(publicKey);
    const methodId = `${did}#${did.slice('did:key:'.length)}`;
    const createdAt = new Date().toISOString();
    await storeCredential(did, algorithm, displayName, createdAt, publicKey, privateKey, passphrase);
    return new DIDCredential(did, methodId, algorithm, displayName, createdAt, publicKey, privateKey);
  }

  /**
   * Create a new did:graph credential.
   *
   * Returns the credential whose private key is the seed key for the new graph.
   * The corresponding DID-document seed triples should be written to the new
   * context (handled by personal-graph's createContext()).
   */
  static async createGraph(
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

  static async importKey(
    encrypted: Uint8Array,
    exportPassphrase: string,
    displayName: string,
    storePassphrase: string,
  ): Promise<DIDCredential> {
    const privateKey = await importEncrypted(encrypted, exportPassphrase);
    const publicKey = await ed25519.getPublicKeyAsync(privateKey);
    const did = publicKeyToDID(publicKey);
    const methodId = `${did}#${did.slice('did:key:'.length)}`;
    const createdAt = new Date().toISOString();
    await storeCredential(did, 'Ed25519', displayName, createdAt, publicKey, privateKey, storePassphrase);
    return new DIDCredential(did, methodId, 'Ed25519', displayName, createdAt, publicKey, privateKey);
  }

  /** Load from stored record (locked state). */
  static fromStored(stored: StoredCredential): DIDCredential {
    if (stored.did.startsWith('did:key:')) {
      const methodId = `${stored.did}#${stored.did.slice('did:key:'.length)}`;
      return new DIDCredential(
        stored.did,
        methodId,
        stored.algorithm,
        stored.displayName,
        stored.createdAt,
        hexDecode(stored.publicKey),
      );
    }
    if (stored.did.startsWith('did:graph:') && stored.did.includes('#')) {
      const did = stored.did.split('#')[0];
      return new DIDCredential(
        did,
        stored.did,
        stored.algorithm,
        stored.displayName,
        stored.createdAt,
        hexDecode(stored.publicKey),
      );
    }
    throw new Error(`Unrecognised stored credential identifier: ${stored.did}`);
  }
}

function randomPrivateKey(): Uint8Array {
  // @noble/ed25519 v3 renamed randomPrivateKey → randomSecretKey; accept either.
  type RandomFn = () => Uint8Array;
  const utils = ed25519.utils as {
    randomPrivateKey?: RandomFn;
    randomSecretKey?: RandomFn;
  };
  const fn = utils.randomPrivateKey ?? utils.randomSecretKey;
  if (!fn) throw new Error('No random key generator available in @noble/ed25519');
  return fn();
}
