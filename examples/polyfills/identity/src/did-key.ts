/**
 * did:key method implementation — Ed25519
 * Encoding: multicodec 0xed01 + 32-byte pubkey → base58btc → "did:key:z" + encoded
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58btcEncode(bytes: Uint8Array): string {
  // Count leading zeros
  let zeroes = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeroes++;

  // Convert to big integer
  const size = Math.ceil(bytes.length * 138 / 100) + 1;
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
  // Count leading '1's
  let zeroes = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) zeroes++;

  const size = Math.ceil(str.length * 733 / 1000) + 1;
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

  // Skip leading zeros in b256
  let start = 0;
  while (start < size && b256[start] === 0) start++;

  const result = new Uint8Array(zeroes + (size - start));
  for (let i = 0; i < zeroes; i++) result[i] = 0;
  for (let i = start; i < size; i++) result[zeroes + (i - start)] = b256[i];
  return result;
}

// Ed25519 multicodec prefix: varint(0xed01) = [0xed, 0x01]
const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export function publicKeyToDID(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  const multicodecKey = new Uint8Array(2 + 32);
  multicodecKey.set(ED25519_MULTICODEC, 0);
  multicodecKey.set(publicKey, 2);
  return `did:key:z${base58btcEncode(multicodecKey)}`;
}

export function didToPublicKey(did: string): Uint8Array {
  if (!did.startsWith('did:key:z')) throw new Error('Invalid did:key URI');
  const encoded = did.slice('did:key:z'.length);
  const decoded = base58btcDecode(encoded);
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Unsupported multicodec prefix (expected Ed25519 0xed01)');
  }
  return decoded.slice(2);
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
}

export function resolveDIDKey(did: string): DIDDocument {
  if (!did.startsWith('did:key:z')) throw new Error('Invalid did:key URI');
  // Extract the multibase-encoded part (the "z..." after "did:key:")
  const multibaseKey = did.slice('did:key:'.length);
  // Verify it's a valid Ed25519 key by decoding
  didToPublicKey(did);

  const keyId = `${did}#${multibaseKey}`;

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
      publicKeyMultibase: multibaseKey,
    }],
    authentication: [keyId],
    assertionMethod: [keyId],
  };
}
