/**
 * Signing and verification — Ed25519 over SHA-256(JCS(data) || timestamp)
 */

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import { didToPublicKey } from './did-key.js';

// Configure sha512 for ed25519 (required in @noble/ed25519 v3)
// v3 uses etc.sha512Sync / etc.sha512Async instead of hashes.sha512
const etc = ed25519.etc as Record<string, unknown>;
if (etc && !etc.sha512Sync) {
  etc.sha512Sync = (...msgs: Uint8Array[]) => {
    const merged = new Uint8Array(msgs.reduce((acc: number, m: Uint8Array) => acc + m.length, 0));
    let offset = 0;
    for (const m of msgs) { merged.set(m, offset); offset += m.length; }
    return sha512(merged);
  };
  etc.sha512Async = async (...msgs: Uint8Array[]) => {
    return (etc.sha512Sync as (...m: Uint8Array[]) => Uint8Array)(...msgs);
  };
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
