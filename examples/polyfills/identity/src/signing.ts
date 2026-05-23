/**
 * Signing and verification.
 *
 * For did:key: Ed25519 over SHA-256(JCS(data) || timestamp).
 * For did:graph: same algorithm, with proof.method identifying which verification
 *   method (delegate) signed. Verification resolves the DID document and confirms
 *   the method is currently listed in the appropriate capability section.
 */

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import { decodeEd25519Multibase, didToPublicKey } from './did-key.js';
import { resolve } from './resolver.js';

// @noble/ed25519 v3 takes its SHA-512 implementation via etc.sha512Sync/Async.
// This block configures it from @noble/hashes; it runs once at module load.
const ed25519Etc = ed25519.etc as {
  sha512Sync?: (...msgs: Uint8Array[]) => Uint8Array;
  sha512Async?: (...msgs: Uint8Array[]) => Promise<Uint8Array>;
};
if (!ed25519Etc.sha512Sync) {
  ed25519Etc.sha512Sync = (...msgs: Uint8Array[]) => {
    const merged = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
    let offset = 0;
    for (const m of msgs) {
      merged.set(m, offset);
      offset += m.length;
    }
    return sha512(merged);
  };
  ed25519Etc.sha512Async = async (...msgs: Uint8Array[]) =>
    ed25519Etc.sha512Sync!(...msgs);
}

export { ed25519 };

export type SignatureSection =
  | 'assertionMethod'
  | 'capabilityInvocation'
  | 'capabilityDelegation'
  | 'authentication';

export interface ContentProof {
  /** Verification method id (e.g., "did:graph:abc#key-alice"). */
  readonly method: string;
  /** Hex-encoded Ed25519 signature. */
  readonly signature: string;
  readonly type: string;
}

export interface SignedContent {
  readonly data: unknown;
  /** Signing identity (a DID — did:key:... or did:graph:...). */
  readonly author: string;
  readonly timestamp: string;
  readonly proof: ContentProof;
}

export function computeSigningPayload(data: unknown, timestamp: string): Uint8Array {
  const canonical = canonicalize(data);
  if (canonical === undefined) {
    throw new DOMException('Data cannot be canonicalised (circular or non-JSON)', 'DataCloneError');
  }
  return sha256(new TextEncoder().encode(canonical + timestamp));
}

export async function signData(
  data: unknown,
  privateKey: Uint8Array,
  did: string,
  methodId: string,
): Promise<SignedContent> {
  const timestamp = new Date().toISOString();
  const payload = computeSigningPayload(data, timestamp);
  const signature = await ed25519.signAsync(payload, privateKey);

  return {
    data,
    author: did,
    timestamp,
    proof: {
      method: methodId,
      signature: bytesToHex(signature),
      type: 'Ed25519Signature2020',
    },
  };
}

/**
 * Verify a SignedContent against its claimed author DID.
 *
 * For did:key — derives the public key from the DID, verifies the signature.
 * For did:graph — resolves the DID document, locates proof.method, verifies the
 *   signature against that method's public key, and confirms the method is in
 *   the appropriate capability section (defaults to assertionMethod).
 */
export async function verifySignedContent(
  signed: SignedContent,
  options: { section?: SignatureSection } = {},
): Promise<boolean> {
  try {
    const payload = computeSigningPayload(signed.data, signed.timestamp);
    const sig = hexToBytes(signed.proof.signature);

    if (signed.author.startsWith('did:key:')) {
      return await ed25519.verifyAsync(sig, payload, didToPublicKey(signed.author));
    }
    if (signed.author.startsWith('did:graph:')) {
      const doc = await resolve(signed.author);
      const method = doc.verificationMethod.find(m => m.id === signed.proof.method);
      if (!method) return false;
      const section = options.section ?? 'assertionMethod';
      if (!doc[section]?.includes(method.id)) return false;
      const publicKey = decodeEd25519Multibase(method.publicKeyMultibase);
      return await ed25519.verifyAsync(sig, payload, publicKey);
    }
    return false;
  } catch {
    return false;
  }
}
