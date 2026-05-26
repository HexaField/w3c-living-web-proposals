/**
 * DIDCredential — represents one DID and (when held locally) its private key.
 *
 * Per [[DECENTRALISED-IDENTITY]] §3 this interface is method-agnostic: it
 * carries a `did`, the DID's `method`, the held public key, and signing
 * primitives. Method-specific extensions (additional fields, delegate
 * management, graph-document writes, etc.) are layered on by the
 * specification that defines the method — for `did:graph`, see
 * `@living-web/group-identity` which augments this class via TypeScript
 * module augmentation and runtime prototype patching.
 */

import {
  publicKeyToDID,
  type DIDDocument,
  type DIDDocumentMethod,
} from './did-key.js';
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

export class DIDCredential {
  readonly id: string;
  readonly type = 'did' as const;
  readonly did: string;
  readonly method: string;
  readonly algorithm: string;
  readonly displayName: string;
  readonly createdAt: string;
  /** Verification method id whose key this credential holds. For did:key, the canonical fragment. */
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
    const match = did.match(/^did:([^:]+):/);
    this.method = match?.[1] ?? 'unknown';
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

  /** Sign a ZCAP delegation. */
  async signCapability(zcap: object): Promise<SignedContent> {
    return this.sign({ ...zcap, signedAt: new Date().toISOString() });
  }

  /** Resolve this credential's DID to its current DID document. */
  async resolve(): Promise<DIDDocument> {
    return resolve(this.did);
  }

  /** List current verification methods on this DID's document. */
  async delegates(): Promise<DIDDocumentMethod[]> {
    const doc = await this.resolve();
    return doc.verificationMethod;
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
   * For methods that put multiple delegate keys under one DID (e.g. did:graph), key
   * on methodId so several delegate credentials can coexist.
   */
  storageKey(): string {
    return this.method === 'key' ? this.did : this.methodId;
  }

  /** Create a new did:key credential — an individual identity. */
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
    // Other methods (e.g. did:graph) store their delegate credentials with the
    // method id (which includes a #fragment) as the storage key. Split on '#'.
    if (stored.did.includes('#')) {
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

export function randomPrivateKey(): Uint8Array {
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
