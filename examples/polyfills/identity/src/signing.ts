/**
 * Signing and verification — Ed25519 over SHA-256(JCS(data) || timestamp)
 */

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import canonicalize from 'canonicalize';
import { didToPublicKey } from './did-key.js';

// Configure sha512 for ed25519
if (!ed25519.etc.sha512Sync) {
  ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));
  ed25519.etc.sha512Async = async (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));
}

export { ed25519 };

export interface ContentProof {
  readonly key: string;
  readonly signature: string;
}

export interface SignedContent {
  readonly data: unknown;
  readonly author: string;
  readonly timestamp: string;
  readonly proof: ContentProof;
}

export function computeSigningPayload(data: unknown, timestamp: string): Uint8Array {
  const canonical = canonicalize(data);
  if (canonical === undefined) {
    throw new DOMException('Data cannot be canonicalised (circular or non-JSON)', 'DataCloneError');
  }
  const message = canonical + timestamp;
  return sha256(new TextEncoder().encode(message));
}

export async function signData(
  data: unknown,
  privateKey: Uint8Array,
  did: string,
  keyURI: string,
): Promise<SignedContent> {
  const timestamp = new Date().toISOString();
  const payload = computeSigningPayload(data, timestamp);
  const signature = await ed25519.signAsync(payload, privateKey);

  return {
    data,
    author: did,
    timestamp,
    proof: {
      key: keyURI,
      signature: bytesToHex(signature),
    },
  };
}

export async function verifySignedContent(signed: SignedContent): Promise<boolean> {
  try {
    const publicKey = didToPublicKey(signed.author);
    const payload = computeSigningPayload(signed.data, signed.timestamp);
    const sig = hexToBytes(signed.proof.signature);
    return await ed25519.verifyAsync(sig, payload, publicKey);
  } catch {
    return false;
  }
}
