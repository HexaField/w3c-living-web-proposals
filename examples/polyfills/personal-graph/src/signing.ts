import * as ed25519 from '@noble/ed25519';
import { sha512, sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import type { SemanticTriple, SignedTriple, ContentProof } from './types.js';

// Configure sha512 for ed25519 v3 (uses etc.sha512Sync/sha512Async)
if (ed25519.etc && !ed25519.etc.sha512Sync) {
  ed25519.etc.sha512Sync = (...msgs: Uint8Array[]) => {
    const merged = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
    let offset = 0;
    for (const m of msgs) { merged.set(m, offset); offset += m.length; }
    return sha512(merged);
  };
  ed25519.etc.sha512Async = async (...msgs: Uint8Array[]) => {
    return ed25519.etc.sha512Sync!(...msgs);
  };
}

export interface IdentityProvider {
  getDID(): string;
  getKeyURI(): string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  getPublicKey(): Uint8Array;
}

// Ephemeral identity — generates a new key pair per session
export class EphemeralIdentity implements IdentityProvider {
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;
  private did: string;
  private ready: Promise<void>;

  constructor() {
    this.privateKey = ((ed25519.utils as any).randomPrivateKey || ed25519.utils.randomSecretKey)();
    this.publicKey = new Uint8Array(0);
    this.did = '';
    this.ready = this.init();
  }

  private async init() {
    this.publicKey = await ed25519.getPublicKeyAsync(this.privateKey);
    const hex = bytesToHex(this.publicKey);
    this.did = `did:key:z6Mk${hex.slice(0, 32)}`;
  }

  async ensureReady() {
    await this.ready;
  }

  getDID(): string {
    return this.did;
  }

  getKeyURI(): string {
    return `${this.did}#key-1`;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    await this.ready;
    return ed25519.signAsync(data, this.privateKey);
  }

  getPublicKey(): Uint8Array {
    return this.publicKey;
  }
}

export function computeSignaturePayload(triple: SemanticTriple, timestamp: string): Uint8Array {
  const canonical = canonicalize({
    source: triple.source,
    target: triple.target,
    predicate: triple.predicate,
  });
  const message = canonical + timestamp;
  return sha256(new TextEncoder().encode(message));
}

export async function signTriple(
  triple: SemanticTriple,
  identity: IdentityProvider
): Promise<SignedTriple> {
  const timestamp = new Date().toISOString();
  const payload = computeSignaturePayload(triple, timestamp);
  const signature = await identity.sign(payload);

  const proof: ContentProof = {
    key: identity.getKeyURI(),
    signature: bytesToHex(signature),
  };

  return {
    data: triple,
    author: identity.getDID(),
    timestamp,
    proof,
  };
}

export async function verifyTripleSignature(
  signed: SignedTriple,
  publicKey: Uint8Array
): Promise<boolean> {
  const payload = computeSignaturePayload(signed.data, signed.timestamp);
  const sig = hexToBytes(signed.proof.signature);
  return ed25519.verifyAsync(sig, payload, publicKey);
}
