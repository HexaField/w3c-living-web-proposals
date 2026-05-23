/**
 * Reifier-based triple signing.
 *
 * Each triple gets a reifier carrying author/timestamp/method/signature.
 * The signed payload is SHA-256(canonical-NQuad(triple, graphDid) || timestamp).
 */

import * as ed25519 from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  ed25519 as ed25519Identity,
  encodeEd25519Multibase,
} from '@living-web/identity';
import { Triple, type Reifier, type SignedTriple } from './types.js';

// Re-use the @noble/ed25519 instance configured by @living-web/identity
// (it already wires the sha512 helper). Fall back to local configuration if not.
const ed = ed25519Identity ?? ed25519;
const ed25519Etc = ed.etc as {
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

export interface IdentityProvider {
  getDID(): string;
  getKeyURI(): string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  getPublicKey(): Uint8Array;
}

/**
 * In-memory identity for tests and fallback scenarios — generates a fresh
 * Ed25519 keypair on construction. Not for production use.
 */
export class EphemeralIdentity implements IdentityProvider {
  private privateKey!: Uint8Array;
  private publicKey!: Uint8Array;
  private did!: string;
  private methodId!: string;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    type RandomFn = () => Uint8Array;
    const utils = ed.utils as { randomPrivateKey?: RandomFn; randomSecretKey?: RandomFn };
    const fn = utils.randomPrivateKey ?? utils.randomSecretKey;
    if (!fn) throw new Error('No random key generator available in @noble/ed25519');
    this.privateKey = fn();
    this.publicKey = await ed.getPublicKeyAsync(this.privateKey);
    const multibase = encodeEd25519Multibase(this.publicKey);
    this.did = `did:key:${multibase}`;
    this.methodId = `${this.did}#${multibase}`;
  }

  async ensureReady(): Promise<void> {
    await this.ready;
  }

  getDID(): string {
    return this.did;
  }
  getKeyURI(): string {
    return this.methodId;
  }
  getPublicKey(): Uint8Array {
    return this.publicKey;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    await this.ready;
    return ed.signAsync(data, this.privateKey);
  }
}

export function canonicalNQuad(t: Triple, graphDid?: string): string {
  const target = /^[a-zA-Z][\w+\-.]*:.+/.test(t.target) || t.target.startsWith('_:')
    ? `<${t.target}>`
    : `"${t.target.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const graph = graphDid ? ` <${graphDid}>` : '';
  return `<${t.source}> <${t.predicate}> ${target}${graph} .`;
}

export function computeSignaturePayload(triple: Triple, timestamp: string, graphDid?: string): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalNQuad(triple, graphDid) + timestamp));
}

export async function signTripleWithReifier(
  triple: Triple,
  identity: IdentityProvider,
  graphDid?: string,
): Promise<Reifier> {
  const timestamp = new Date().toISOString();
  const payload = computeSignaturePayload(triple, timestamp, graphDid);
  const signature = await identity.sign(payload);
  const reifierId = `_:r-${bytesToHex(sha256(payload)).slice(0, 16)}`;
  return {
    id: reifierId,
    triple,
    author: identity.getDID(),
    timestamp,
    method: identity.getKeyURI(),
    signature: bytesToHex(signature),
  };
}

export async function verifyReifier(
  reifier: Reifier,
  publicKey: Uint8Array,
  graphDid?: string,
): Promise<boolean> {
  try {
    const payload = computeSignaturePayload(reifier.triple, reifier.timestamp, graphDid);
    return await ed.verifyAsync(hexToBytes(reifier.signature), payload, publicKey);
  } catch {
    return false;
  }
}

/** Convert a Reifier into the SignedTriple wire shape. */
export function reifierToSigned(reifier: Reifier): SignedTriple {
  return {
    data: reifier.triple,
    author: reifier.author,
    timestamp: reifier.timestamp,
    proof: { method: reifier.method, signature: reifier.signature },
  };
}
