/**
 * did:key method implementation — Ed25519.
 * Encoding: multicodec 0xed01 + 32-byte pubkey → base58btc → "did:key:z" + encoded.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58btcEncode(bytes: Uint8Array): string {
  let zeroes = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeroes++;

  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }

  let str = '1'.repeat(zeroes);
  let started = false;
  for (let i = 0; i < size; i++) {
    if (!started && b58[i] === 0) continue;
    started = true;
    str += BASE58_ALPHABET[b58[i]];
  }
  return str || '1';
}

export function base58btcDecode(str: string): Uint8Array {
  let zeroes = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) zeroes++;

  const size = Math.ceil((str.length * 733) / 1000) + 1;
  const b256 = new Uint8Array(size);
  let length = 0;

  for (let i = zeroes; i < str.length; i++) {
    const idx = BASE58_ALPHABET.indexOf(str[i]);
    if (idx === -1) throw new Error(`Invalid base58 character: ${str[i]}`);
    let carry = idx;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * b256[k];
      b256[k] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = j;
  }

  let start = 0;
  while (start < size && b256[start] === 0) start++;

  const result = new Uint8Array(zeroes + (size - start));
  for (let i = 0; i < zeroes; i++) result[i] = 0;
  for (let i = start; i < size; i++) result[zeroes + (i - start)] = b256[i];
  return result;
}

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export function encodeEd25519Multibase(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  const multicodecKey = new Uint8Array(2 + 32);
  multicodecKey.set(ED25519_MULTICODEC, 0);
  multicodecKey.set(publicKey, 2);
  return `z${base58btcEncode(multicodecKey)}`;
}

export function decodeEd25519Multibase(multibase: string): Uint8Array {
  if (!multibase.startsWith('z')) throw new Error('Expected multibase z-prefix');
  const decoded = base58btcDecode(multibase.slice(1));
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Unsupported multicodec prefix (expected Ed25519 0xed01)');
  }
  return decoded.slice(2);
}

export function publicKeyToDID(publicKey: Uint8Array): string {
  return `did:key:${encodeEd25519Multibase(publicKey)}`;
}

export function didToPublicKey(did: string): Uint8Array {
  if (!did.startsWith('did:key:')) throw new Error('Invalid did:key URI');
  return decodeEd25519Multibase(did.slice('did:key:'.length));
}

export interface DIDDocumentMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export type DIDDocumentTrustLevel = 'local' | 'mounted-read' | 'external' | 'cached';

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: DIDDocumentMethod[];
  authentication?: string[];
  assertionMethod?: string[];
  capabilityInvocation?: string[];
  capabilityDelegation?: string[];
  /** Set by the resolver to indicate provenance. */
  trustLevel?: DIDDocumentTrustLevel;
}

export function resolveDIDKey(did: string): DIDDocument {
  if (!did.startsWith('did:key:')) throw new Error('Invalid did:key URI');
  const multibase = did.slice('did:key:'.length);
  // Verify it decodes to a valid Ed25519 key (throws on invalid)
  didToPublicKey(did);

  const keyId = `${did}#${multibase}`;

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: [{
      id: keyId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: multibase,
    }],
    authentication: [keyId],
    assertionMethod: [keyId],
    capabilityInvocation: [keyId],
    capabilityDelegation: [keyId],
    trustLevel: 'local',
  };
}
