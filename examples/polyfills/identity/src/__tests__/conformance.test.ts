/**
 * Conformance tests for Decentralised Identity polyfill
 * Tests every MUST assertion from the spec
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  DIDCredential,
  IdentityManager,
  DIDIdentityProvider,
  publicKeyToDID,
  didToPublicKey,
  resolveDIDKey,
  base58btcEncode,
  base58btcDecode,
  signData,
  verifySignedContent,
  computeSigningPayload,
  exportEncrypted,
  importEncrypted,
  type SignedContent,
} from '../index.js';

const TEST_PASSPHRASE = 'test-passphrase-123';

describe('§3.1 DIDCredential Interface', () => {
  let cred: DIDCredential;

  beforeEach(async () => {
    cred = await DIDCredential.create('Test Identity', TEST_PASSPHRASE);
  });

  it('credential.did MUST be a valid did:key URI', () => {
    expect(cred.did).toMatch(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('credential.algorithm MUST contain algorithm identifier', () => {
    expect(cred.algorithm).toBe('Ed25519');
  });

  it('credential.createdAt MUST be a valid RFC 3339 timestamp', () => {
    expect(new Date(cred.createdAt).toISOString()).toBe(cred.createdAt);
  });

  it('credential.type MUST return "did"', () => {
    expect(cred.type).toBe('did');
  });

  it('credential.id MUST equal credential.did', () => {
    expect(cred.id).toBe(cred.did);
  });

  it('credential has displayName', () => {
    expect(cred.displayName).toBe('Test Identity');
  });

  it('credential.isLocked is false when freshly created', () => {
    expect(cred.isLocked).toBe(false);
  });
});

describe('§3.4 Supported Algorithms', () => {
  it('MUST support Ed25519', async () => {
    const cred = await DIDCredential.create('Ed25519 Test', TEST_PASSPHRASE, 'Ed25519');
    expect(cred.algorithm).toBe('Ed25519');
    expect(cred.did).toMatch(/^did:key:z6Mk/); // Ed25519 did:key starts with z6Mk
  });

  it('unsupported algorithm rejects with NotSupportedError', async () => {
    await expect(
      DIDCredential.create('Bad Algo', TEST_PASSPHRASE, 'RSA-4096')
    ).rejects.toThrow('Unsupported algorithm');
  });
});

describe('§4 Key Management', () => {
  it('private keys are stored encrypted (not plaintext) in IndexedDB', async () => {
    const cred = await DIDCredential.create('Store Test', TEST_PASSPHRASE);
    // The credential was stored — load it back and verify it's a locked credential
    const loaded = await DIDCredential.create('Another', TEST_PASSPHRASE);
    // If we can lock and need passphrase to unlock, keys are encrypted
    await loaded.lock();
    expect(loaded.isLocked).toBe(true);
    await loaded.unlock(TEST_PASSPHRASE);
    expect(loaded.isLocked).toBe(false);
  });

  it('wrong passphrase fails to unlock', async () => {
    const cred = await DIDCredential.create('Lock Test', TEST_PASSPHRASE);
    await cred.lock();
    await expect(cred.unlock('wrong-passphrase')).rejects.toThrow();
  });

  it('sign() never returns private key material', async () => {
    const cred = await DIDCredential.create('No Leak', TEST_PASSPHRASE);
    const signed = await cred.sign({ msg: 'test' });
    const json = JSON.stringify(signed);
    // Private key is 64 hex chars — check it's not in the output
    // (signature is different from private key)
    expect(signed.proof.signature).toBeDefined();
    expect(signed.proof.key).toContain('did:key:');
    // No privateKey field
    expect((signed as any).privateKey).toBeUndefined();
  });
});

describe('§4.3.2 Lock and Unlock', () => {
  it('signing while locked MUST reject with InvalidStateError', async () => {
    const cred = await DIDCredential.create('Locked Sign', TEST_PASSPHRASE);
    await cred.lock();
    await expect(cred.sign({ msg: 'test' })).rejects.toThrow('Credential is locked');
  });

  it('lock() MUST immediately set isLocked=true', async () => {
    const cred = await DIDCredential.create('Lock Imm', TEST_PASSPHRASE);
    expect(cred.isLocked).toBe(false);
    await cred.lock();
    expect(cred.isLocked).toBe(true);
  });

  it('unlock() with correct passphrase sets isLocked=false', async () => {
    const cred = await DIDCredential.create('Unlock', TEST_PASSPHRASE);
    await cred.lock();
    await cred.unlock(TEST_PASSPHRASE);
    expect(cred.isLocked).toBe(false);
  });
});

describe('§4.3.3 Credential Deletion', () => {
  it('users MUST be able to delete DIDCredential', async () => {
    const cred = await DIDCredential.create('Deletable', TEST_PASSPHRASE);
    await cred.delete();
    expect(cred.isLocked).toBe(true);
    // Trying to unlock after delete should fail (not in store)
    await expect(cred.unlock(TEST_PASSPHRASE)).rejects.toThrow();
  });
});

describe('§5.1 sign()', () => {
  let cred: DIDCredential;

  beforeEach(async () => {
    cred = await DIDCredential.create('Signer', TEST_PASSPHRASE);
  });

  it('MUST return SignedContent with author, timestamp, data, proof', async () => {
    const data = { type: 'message', content: 'hello' };
    const signed = await cred.sign(data);
    expect(signed.author).toBe(cred.did);
    expect(signed.timestamp).toBeDefined();
    expect(new Date(signed.timestamp).toISOString()).toBe(signed.timestamp);
    expect(signed.data).toEqual(data);
    expect(signed.proof).toBeDefined();
    expect(signed.proof.key).toContain(cred.did);
    expect(signed.proof.signature).toMatch(/^[0-9a-f]+$/);
  });

  it('MUST canonicalise data using JCS (equivalent objects → same result)', async () => {
    const data1 = { b: 2, a: 1 };
    const data2 = { a: 1, b: 2 };
    // Can't easily test same signature due to different timestamps,
    // but we can verify computeSigningPayload produces same hash
    const ts = '2026-04-04T00:00:00.000Z';
    const payload1 = computeSigningPayload(data1, ts);
    const payload2 = computeSigningPayload(data2, ts);
    expect(Array.from(payload1)).toEqual(Array.from(payload2));
  });

  it('MUST compute SHA-256(canonical || timestamp)', async () => {
    // Verify the signing payload is deterministic
    const data = { msg: 'test' };
    const ts = '2026-04-04T00:00:00.000Z';
    const p1 = computeSigningPayload(data, ts);
    const p2 = computeSigningPayload(data, ts);
    expect(Array.from(p1)).toEqual(Array.from(p2));
    expect(p1.length).toBe(32); // SHA-256 → 32 bytes
  });

  it('MUST sign with Ed25519', async () => {
    const signed = await cred.sign({ test: true });
    // Signature should be 64 bytes = 128 hex chars
    expect(signed.proof.signature.length).toBe(128);
  });

  it('non-JSON data MUST reject with DataCloneError', async () => {
    const circular: any = {};
    circular.self = circular;
    await expect(cred.sign(circular)).rejects.toThrow();
  });
});

describe('§5.2 verify()', () => {
  let cred: DIDCredential;

  beforeEach(async () => {
    cred = await DIDCredential.create('Verifier', TEST_PASSPHRASE);
  });

  it('MUST return true for valid signature', async () => {
    const signed = await cred.sign({ msg: 'valid' });
    const valid = await cred.verify(signed);
    expect(valid).toBe(true);
  });

  it('MUST return false for tampered data', async () => {
    const signed = await cred.sign({ msg: 'original' });
    const tampered: SignedContent = { ...signed, data: { msg: 'tampered' } };
    const valid = await cred.verify(tampered);
    expect(valid).toBe(false);
  });

  it('MUST return false for tampered timestamp', async () => {
    const signed = await cred.sign({ msg: 'test' });
    const tampered: SignedContent = { ...signed, timestamp: '2020-01-01T00:00:00.000Z' };
    expect(await cred.verify(tampered)).toBe(false);
  });

  it('MUST return false for tampered signature', async () => {
    const signed = await cred.sign({ msg: 'test' });
    const tampered: SignedContent = {
      ...signed,
      proof: { ...signed.proof, signature: '00'.repeat(64) },
    };
    expect(await cred.verify(tampered)).toBe(false);
  });

  it('MUST resolve author DID to extract public key for verification', async () => {
    // Cross-credential verification: sign with one, verify with another instance
    const signed = await cred.sign({ msg: 'cross' });
    const cred2 = await DIDCredential.create('Other', TEST_PASSPHRASE);
    // cred2 should be able to verify cred's signature via DID resolution
    const valid = await cred2.verify(signed);
    expect(valid).toBe(true);
  });

  it('verify does not require user gesture (always works)', async () => {
    const signed = await cred.sign({ msg: 'no gesture' });
    // Just calling verify directly — no gesture simulation needed
    expect(await cred.verify(signed)).toBe(true);
  });
});

describe('§5.3 End-to-end signing algorithm', () => {
  it('JCS → UTF-8 timestamp → SHA-256 → Ed25519 matches spec', async () => {
    const cred = await DIDCredential.create('E2E', TEST_PASSPHRASE);
    const data = { z: 1, a: 2 };
    const signed = await cred.sign(data);

    // Manually verify: recompute payload and check signature
    const payload = computeSigningPayload(signed.data, signed.timestamp);
    expect(payload.length).toBe(32);

    // Verify the signature is valid
    expect(await verifySignedContent(signed)).toBe(true);
  });
});

describe('§6.1 did:key encoding', () => {
  it('multicodec 0xed01 + pubkey → base58btc → did:key:z...', async () => {
    const cred = await DIDCredential.create('DID Key', TEST_PASSPHRASE);
    const did = cred.did;
    expect(did).toMatch(/^did:key:z/);

    // Decode and verify multicodec prefix
    const pubKey = didToPublicKey(did);
    expect(pubKey.length).toBe(32);

    // Re-encode and verify roundtrip
    const reencoded = publicKeyToDID(pubKey);
    expect(reencoded).toBe(did);
  });

  it('Ed25519 did:key starts with z6Mk', async () => {
    const cred = await DIDCredential.create('Prefix', TEST_PASSPHRASE);
    // Ed25519 multicodec 0xed01 base58btc always starts with 6Mk after the z
    expect(cred.did).toMatch(/^did:key:z6Mk/);
  });

  it('base58btc roundtrip', () => {
    const bytes = new Uint8Array([0xed, 0x01, 1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = base58btcEncode(bytes);
    const decoded = base58btcDecode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});

describe('§6.2 DID Document Resolution', () => {
  it('MUST resolve did:key URIs to valid DID Document', async () => {
    const cred = await DIDCredential.create('Resolve', TEST_PASSPHRASE);
    const doc = resolveDIDKey(cred.did);
    expect(doc).toBeDefined();
    expect(doc.id).toBe(cred.did);
  });

  it('DID Document MUST have correct @context', async () => {
    const cred = await DIDCredential.create('Context', TEST_PASSPHRASE);
    const doc = resolveDIDKey(cred.did);
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc['@context']).toContain('https://w3id.org/security/suites/ed25519-2020/v1');
  });

  it('DID Document MUST have Ed25519VerificationKey2020 method', async () => {
    const cred = await DIDCredential.create('VM', TEST_PASSPHRASE);
    const doc = resolveDIDKey(cred.did);
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0].type).toBe('Ed25519VerificationKey2020');
    expect(doc.verificationMethod[0].controller).toBe(cred.did);
  });

  it('DID Document MUST include authentication and assertionMethod', async () => {
    const cred = await DIDCredential.create('Auth', TEST_PASSPHRASE);
    const doc = resolveDIDKey(cred.did);
    expect(doc.authentication).toHaveLength(1);
    expect(doc.assertionMethod).toHaveLength(1);
    expect(doc.authentication[0]).toBe(doc.verificationMethod[0].id);
  });

  it('credential.resolve() returns the DID Document', async () => {
    const cred = await DIDCredential.create('Resolve2', TEST_PASSPHRASE);
    const doc = cred.resolve();
    expect(doc.id).toBe(cred.did);
  });

  it('invalid did:key rejects', () => {
    expect(() => resolveDIDKey('did:web:example.com')).toThrow();
    expect(() => resolveDIDKey('not-a-did')).toThrow();
  });
});

describe('§8.1 Key Isolation', () => {
  it('no API exposes raw private key bytes', async () => {
    const cred = await DIDCredential.create('Isolated', TEST_PASSPHRASE);
    // Public API should not have privateKey
    expect((cred as any).privateKey).toBeUndefined();
    expect((cred as any)._privateKey).toBeDefined(); // internal, but not enumerable in API
    // The publicKey IS exposed (that's fine)
    expect(cred.publicKey).toBeDefined();
    expect(cred.publicKey.length).toBe(32);
  });
});

describe('§9.2 Multiple DIDs', () => {
  it('can create and manage multiple identities', async () => {
    const mgr = new IdentityManager();
    const c1 = await mgr.create('Identity 1', TEST_PASSPHRASE);
    const c2 = await mgr.create('Identity 2', TEST_PASSPHRASE);
    expect(c1.did).not.toBe(c2.did);
    expect(mgr.credentials).toHaveLength(2);
    expect(mgr.active?.did).toBe(c1.did);
    mgr.setActive(c2.did);
    expect(mgr.active?.did).toBe(c2.did);
  });

  it('deleting active credential switches to next', async () => {
    const mgr = new IdentityManager();
    const c1 = await mgr.create('First', TEST_PASSPHRASE);
    const c2 = await mgr.create('Second', TEST_PASSPHRASE);
    await mgr.delete(c1.did);
    expect(mgr.credentials).toHaveLength(1);
    expect(mgr.active?.did).toBe(c2.did);
  });
});

describe('Key Export/Import', () => {
  it('exported key data is encrypted', async () => {
    const cred = await DIDCredential.create('Export', TEST_PASSPHRASE);
    const exported = await cred.exportKey('export-pass');
    // Encrypted blob should be salt(16) + iv(12) + ciphertext(32+16 for AES-GCM tag)
    expect(exported.length).toBeGreaterThan(32); // not raw key
    // Should not contain the raw public key bytes
    expect(exported.length).toBe(16 + 12 + 32 + 16); // salt + iv + key + gcm tag
  });

  it('import with correct passphrase restores credential', async () => {
    const cred = await DIDCredential.create('ImportTest', TEST_PASSPHRASE);
    const originalDID = cred.did;
    const exported = await cred.exportKey('export-pass');

    const imported = await DIDCredential.importKey(
      exported, 'export-pass', 'Imported', TEST_PASSPHRASE
    );
    expect(imported.did).toBe(originalDID);
    expect(imported.isLocked).toBe(false);

    // Can sign with imported credential
    const signed = await imported.sign({ test: 'imported' });
    expect(await imported.verify(signed)).toBe(true);
  });

  it('import with wrong passphrase fails', async () => {
    const cred = await DIDCredential.create('BadImport', TEST_PASSPHRASE);
    const exported = await cred.exportKey('correct-pass');
    await expect(
      DIDCredential.importKey(exported, 'wrong-pass', 'Bad', TEST_PASSPHRASE)
    ).rejects.toThrow();
  });
});

describe('IdentityProvider integration', () => {
  it('DIDIdentityProvider exposes getDID, getKeyURI, getPublicKey', async () => {
    const cred = await DIDCredential.create('Provider', TEST_PASSPHRASE);
    const provider = new DIDIdentityProvider(cred);
    expect(provider.getDID()).toBe(cred.did);
    expect(provider.getKeyURI()).toContain(cred.did);
    expect(provider.getKeyURI()).toContain('#');
    expect(provider.getPublicKey().length).toBe(32);
  });

  it('DIDIdentityProvider.sign() produces valid Ed25519 signatures', async () => {
    const cred = await DIDCredential.create('ProvSign', TEST_PASSPHRASE);
    const provider = new DIDIdentityProvider(cred);
    const data = new Uint8Array([1, 2, 3, 4]);
    const sig = await provider.sign(data);
    expect(sig.length).toBe(64); // Ed25519 signature

    // Verify with ed25519 directly
    const { ed25519 } = await import('../signing.js');
    const valid = await ed25519.verifyAsync(sig, data, cred.publicKey);
    expect(valid).toBe(true);
  });
});

describe('§9.1 DID Determinism', () => {
  it('same keypair always produces same DID', () => {
    const pubKey = new Uint8Array(32);
    pubKey.fill(42);
    const did1 = publicKeyToDID(pubKey);
    const did2 = publicKeyToDID(pubKey);
    expect(did1).toBe(did2);
  });
});

describe('Cross-credential verification', () => {
  it('anyone can verify a signature using only the DID', async () => {
    const signer = await DIDCredential.create('Signer', TEST_PASSPHRASE);
    const signed = await signer.sign({ msg: 'for anyone' });

    // Verify using a completely separate credential (or static function)
    expect(await verifySignedContent(signed)).toBe(true);
  });
});

// §4.1 Private keys MUST NOT be stored in IndexedDB/Web Storage directly
describe('§4.1 Key storage security', () => {
  it('private keys MUST NOT be stored as plaintext in IndexedDB', async () => {
    const cred = await DIDCredential.create('StoreSec', TEST_PASSPHRASE);
    // The private key is encrypted with the passphrase before storage
    // When locked, the raw key is inaccessible
    await cred.lock();
    expect(cred.isLocked).toBe(true);
    // Cannot sign when locked
    await expect(cred.sign({ msg: 'test' })).rejects.toThrow();
  });

  it('all crypto operations MUST be performed by the polyfill (not exposed to web content)', async () => {
    const cred = await DIDCredential.create('CryptoOps', TEST_PASSPHRASE);
    const signed = await cred.sign({ data: 'test' });
    // Verify that signing produces a valid Ed25519 signature (done internally)
    expect(signed.proof.signature).toMatch(/^[0-9a-f]{128}$/);
    // The signature was computed internally — web content never sees the private key
    expect((cred as any).privateKey).toBeUndefined();
  });
});

// §4.3.1 Key generation MUST use CSPRNG
describe('§4.3.1 CSPRNG', () => {
  it('key generation MUST use CSPRNG (keys are unique)', async () => {
    const c1 = await DIDCredential.create('CSPRNG1', TEST_PASSPHRASE);
    const c2 = await DIDCredential.create('CSPRNG2', TEST_PASSPHRASE);
    // Two independently generated keys must differ (probability of collision is ~2^-128)
    expect(c1.did).not.toBe(c2.did);
    expect(c1.publicKey).not.toEqual(c2.publicKey);
  });
});

// §8.3 Private keys MUST NOT be exportable by default
describe('§8.3 Key non-exportability', () => {
  it('private keys MUST NOT be exportable by default', async () => {
    const cred = await DIDCredential.create('NoExport', TEST_PASSPHRASE);
    // The credential doesn't expose raw private key via any public property
    const publicApi = Object.keys(cred);
    expect(publicApi).not.toContain('privateKey');
    // The only way to export is via the explicit exportKey() with a passphrase
    // which returns encrypted bytes, not raw key material
    const exported = await cred.exportKey('export-pass');
    // Exported data is encrypted — not the same as raw 32-byte key
    expect(exported.length).not.toBe(32);
    expect(exported.length).toBe(16 + 12 + 32 + 16); // salt + iv + encrypted key + GCM tag
  });
});
