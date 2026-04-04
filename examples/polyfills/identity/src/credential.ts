/**
 * DIDCredential — extends Credential-like interface
 */

import { publicKeyToDID, resolveDIDKey, type DIDDocument } from './did-key.js';
import { signData, verifySignedContent, ed25519, type SignedContent } from './signing.js';
import {
  storeCredential,
  loadCredential,
  unlockPrivateKey,
  deleteCredential,
  exportEncrypted,
  importEncrypted,
  hexEncode,
  hexDecode,
  type StoredCredential,
} from './keystore.js';

export class DIDCredential {
  readonly id: string;
  readonly type = 'did' as const;
  readonly did: string;
  readonly algorithm: string;
  readonly displayName: string;
  readonly createdAt: string;

  private _publicKey: Uint8Array;
  private _privateKey: Uint8Array | null = null;
  private _isLocked: boolean = true;

  get isLocked(): boolean {
    return this._isLocked;
  }

  constructor(
    did: string,
    algorithm: string,
    displayName: string,
    createdAt: string,
    publicKey: Uint8Array,
    privateKey?: Uint8Array | null,
  ) {
    this.id = did;
    this.did = did;
    this.algorithm = algorithm;
    this.displayName = displayName;
    this.createdAt = createdAt;
    this._publicKey = publicKey;
    if (privateKey) {
      this._privateKey = privateKey;
      this._isLocked = false;
    }
  }

  get publicKey(): Uint8Array {
    return this._publicKey;
  }

  private get keyURI(): string {
    const multibaseKey = this.did.slice('did:key:'.length);
    return `${this.did}#${multibaseKey}`;
  }

  /** Raw Ed25519 signing — for IdentityProvider integration */
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
    return signData(data, this._privateKey, this.did, this.keyURI);
  }

  async verify(signed: SignedContent): Promise<boolean> {
    return verifySignedContent(signed);
  }

  resolve(): DIDDocument {
    return resolveDIDKey(this.did);
  }

  async lock(): Promise<void> {
    if (this._privateKey) {
      // Zero the key
      this._privateKey.fill(0);
      this._privateKey = null;
    }
    this._isLocked = true;
  }

  async unlock(passphrase: string): Promise<void> {
    const stored = await loadCredential(this.did);
    if (!stored) throw new DOMException('Credential not found in storage', 'NotFoundError');
    this._privateKey = await unlockPrivateKey(stored, passphrase);
    this._isLocked = false;
  }

  async delete(): Promise<void> {
    await this.lock();
    await deleteCredential(this.did);
  }

  async exportKey(exportPassphrase: string): Promise<Uint8Array> {
    if (this._isLocked || !this._privateKey) {
      throw new DOMException('Credential is locked', 'InvalidStateError');
    }
    return exportEncrypted(this._privateKey, exportPassphrase);
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
    const createdAt = new Date().toISOString();
    await storeCredential(did, 'Ed25519', displayName, createdAt, publicKey, privateKey, storePassphrase);
    return new DIDCredential(did, 'Ed25519', displayName, createdAt, publicKey, privateKey);
  }

  /** Create a new DID credential from scratch */
  static async create(
    displayName: string,
    passphrase: string,
    algorithm: string = 'Ed25519',
  ): Promise<DIDCredential> {
    if (algorithm !== 'Ed25519') {
      throw new DOMException(`Unsupported algorithm: ${algorithm}`, 'NotSupportedError');
    }
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = await ed25519.getPublicKeyAsync(privateKey);
    const did = publicKeyToDID(publicKey);
    const createdAt = new Date().toISOString();
    await storeCredential(did, algorithm, displayName, createdAt, publicKey, privateKey, passphrase);
    return new DIDCredential(did, algorithm, displayName, createdAt, publicKey, privateKey);
  }

  /** Load from stored record (locked state) */
  static fromStored(stored: StoredCredential): DIDCredential {
    return new DIDCredential(
      stored.did,
      stored.algorithm,
      stored.displayName,
      stored.createdAt,
      hexDecode(stored.publicKey),
    );
  }
}
