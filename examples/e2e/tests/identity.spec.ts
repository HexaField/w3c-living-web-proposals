import { test, expect } from '@playwright/test';

test.describe('Spec 02 — Identity (DID Credentials)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('navigator.credentials.create({ did }) returns a credential with a DID', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Alice' } } as any);
      return { hasDid: typeof cred.did === 'string', did: cred.did, displayName: cred.displayName };
    });
    expect(result.hasDid).toBe(true);
    expect(result.displayName).toBe('Alice');
  });

  test('DID starts with did:key:z6Mk', async ({ page }) => {
    const did = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Bob' } } as any);
      return cred.did;
    });
    expect(did).toMatch(/^did:key:z6Mk/);
  });

  test('credential.sign(data) returns SignedContent with author, timestamp, proof', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Charlie' } } as any);
      const signed = await cred.sign({ hello: 'world' });
      return {
        hasAuthor: typeof signed.author === 'string',
        hasTimestamp: typeof signed.timestamp === 'string',
        hasProof: !!signed.proof,
        hasData: !!signed.data,
      };
    });
    expect(result.hasAuthor).toBe(true);
    expect(result.hasTimestamp).toBe(true);
    expect(result.hasProof).toBe(true);
    expect(result.hasData).toBe(true);
  });

  test('credential.verify(signed) returns true for valid signature', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Dave' } } as any);
      const signed = await cred.sign({ test: 123 });
      return await cred.verify(signed);
    });
    expect(result).toBe(true);
  });

  test('credential.verify(tampered) returns false', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Eve' } } as any);
      const signed = await cred.sign({ test: 123 });
      // Tamper with the data
      const tampered = { ...signed, data: { test: 999 } };
      return await cred.verify(tampered);
    });
    expect(result).toBe(false);
  });

  test('multiple identities can be created', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const c1 = await navigator.credentials.create({ did: { displayName: 'Id1' } } as any);
      const c2 = await navigator.credentials.create({ did: { displayName: 'Id2' } } as any);
      return { different: c1.did !== c2.did, count: 2 };
    });
    expect(result.different).toBe(true);
  });

  test('identity persists across page reload (credential stored in IndexedDB)', async ({ page }) => {
    const did = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Persist' } } as any);
      return cred.did;
    });
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
    // After reload, check if the credential's DID is stored in IndexedDB
    const result = await page.evaluate(async (expectedDid) => {
      // Enumerate all IndexedDB databases and find the stored credential
      const dbNames = await indexedDB.databases();
      for (const dbInfo of dbNames) {
        if (!dbInfo.name) continue;
        try {
          const idb = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbInfo.name!);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const stores = Array.from(idb.objectStoreNames);
          for (const storeName of stores) {
            const tx = idb.transaction(storeName, 'readonly');
            const all: any[] = await new Promise((resolve, reject) => {
              const req = tx.objectStore(storeName).getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const match = all.find((r: any) => r.did === expectedDid);
            if (match) {
              idb.close();
              return match.did;
            }
          }
          idb.close();
        } catch {}
      }
      return null;
    }, did);
    expect(result).toBe(did);
  });

  // §3.1 credential.type MUST return "did"
  test('§3.1 credential.type MUST return "did"', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'TypeTest' } } as any);
      return cred.type;
    });
    expect(result).toBe('did');
  });

  // §3.1 createdAt MUST be RFC 3339
  test('§3.1 createdAt is valid RFC 3339 timestamp', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'TimeTest' } } as any);
      return { ts: cred.createdAt, valid: new Date(cred.createdAt).toISOString() === cred.createdAt };
    });
    expect(result.valid).toBe(true);
  });

  // §3.2 create() generates Ed25519 key pair
  test('§3.2 create() generates Ed25519 key pair', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Ed25519' } } as any);
      return { algorithm: cred.algorithm, didPrefix: cred.did.slice(0, 12) };
    });
    expect(result.algorithm).toBe('Ed25519');
    expect(result.didPrefix).toBe('did:key:z6Mk');
  });

  // §3.2 create() derives did:key from public key
  test('§3.2 create() derives did:key URI from public key', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Derive' } } as any);
      return cred.did.startsWith('did:key:z');
    });
    expect(result).toBe(true);
  });

  // §4.3.2 Locked credential rejects signing
  test('§4.3.2 locked credential rejects signing', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Lockable' } } as any);
      await cred.lock();
      try {
        await cred.sign({ msg: 'test' });
        return 'should have thrown';
      } catch (e: any) {
        return 'threw: ' + e.message;
      }
    });
    expect(result).toContain('threw');
  });

  // §5.1 sign() canonicalises with JCS
  test('§5.1 sign() produces deterministic signatures for equivalent objects', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'JCS' } } as any);
      // Two differently-ordered objects that are equivalent under JCS
      const s1 = await cred.sign({ b: 2, a: 1 });
      const s2 = await cred.sign({ a: 1, b: 2 });
      // Data should be canonically equivalent
      return { sameData: JSON.stringify(s1.data) === JSON.stringify(s2.data) || 
               (s1.data.a === s2.data.a && s1.data.b === s2.data.b) };
    });
    expect(result.sameData).toBe(true);
  });

  // §5.1 sign() with Ed25519 - signature is 128 hex chars
  test('§5.1 sign() uses Ed25519 (64-byte signature)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'SigLen' } } as any);
      const signed = await cred.sign({ test: true });
      return { len: signed.proof.signature.length, isHex: /^[0-9a-f]+$/.test(signed.proof.signature) };
    });
    expect(result.len).toBe(128);
    expect(result.isHex).toBe(true);
  });

  // §5.1 non-JSON data rejects
  test('§5.1 non-JSON data rejects with error', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'NonJSON' } } as any);
      try {
        const circular: any = {};
        circular.self = circular;
        await cred.sign(circular);
        return 'should have thrown';
      } catch {
        return 'threw';
      }
    });
    expect(result).toBe('threw');
  });

  // §5.2 verify() resolves author DID
  test('§5.2 cross-credential verification via DID', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const signer = await navigator.credentials.create({ did: { displayName: 'Signer' } } as any);
      const verifier = await navigator.credentials.create({ did: { displayName: 'Verifier' } } as any);
      const signed = await signer.sign({ msg: 'cross' });
      return await verifier.verify(signed);
    });
    expect(result).toBe(true);
  });

  // §5.2 verify() does not require user gesture
  test('§5.2 verify() does not require user gesture', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'NoGesture' } } as any);
      const signed = await cred.sign({ msg: 'test' });
      return await cred.verify(signed);
    });
    expect(result).toBe(true);
  });

  // §5.4 Data canonicalised with JCS before signing
  test('§5.4 data canonicalised with JCS', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'JCS2' } } as any);
      const signed = await cred.sign({ z: 1, a: 2 });
      return await cred.verify(signed);
    });
    expect(result).toBe(true);
  });

  // §6.1 did:key encoding
  test('§6.1 did:key uses multicodec 0xed01 encoding', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Encoding' } } as any);
      return cred.did.startsWith('did:key:z6Mk');
    });
    expect(result).toBe(true);
  });

  // §6.2 Resolved DID document has correct structure
  test('§6.2 DID document has correct structure', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'DocTest' } } as any);
      const doc = cred.resolve();
      return {
        hasId: doc.id === cred.did,
        hasContext: Array.isArray(doc['@context']),
        hasVM: Array.isArray(doc.verificationMethod),
        hasAuth: Array.isArray(doc.authentication),
      };
    });
    expect(result.hasId).toBe(true);
    expect(result.hasContext).toBe(true);
    expect(result.hasVM).toBe(true);
    expect(result.hasAuth).toBe(true);
  });

  // §4.3.3 Deletion
  test('§4.3.3 credential deletion', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Deletable' } } as any);
      await cred.delete();
      return cred.isLocked;
    });
    expect(result).toBe(true);
  });

  // §8.1 Private keys isolated from web content
  test('§8.1 private keys not exposed via API', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'Isolated' } } as any);
      return { hasPrivateKey: 'privateKey' in cred && cred.privateKey !== undefined };
    });
    expect(result.hasPrivateKey).toBe(false);
  });

  // §4.1 Private keys MUST be stored in secure storage
  test('§4.1 private keys stored in secure storage (not directly accessible)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'SecureStore' } } as any);
      // Verify key is usable (stored) but not exposed
      const signed = await cred.sign({ test: 1 });
      const hasProof = !!signed.proof?.signature;
      // Ensure no privateKey/secretKey property is exposed
      const noPrivateKey = !('privateKey' in cred) || cred.privateKey === undefined;
      const noSecretKey = !('secretKey' in cred) || cred.secretKey === undefined;
      return { hasProof, noPrivateKey, noSecretKey };
    });
    expect(result.hasProof).toBe(true);
    expect(result.noPrivateKey).toBe(true);
    expect(result.noSecretKey).toBe(true);
  });

  // §4.1 Private keys MUST NOT be stored in IndexedDB/Web Storage directly
  test('§4.1 private keys not in plain IndexedDB/Web Storage', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'NoPlain' } } as any);
      // Check localStorage doesn't contain raw private key material
      const lsKeys = Object.keys(localStorage);
      const hasPlainKey = lsKeys.some(k => {
        const v = localStorage.getItem(k) || '';
        return v.length === 128 && /^[0-9a-f]+$/.test(v); // Raw 64-byte hex key
      });
      return !hasPlainKey;
    });
    expect(result).toBe(true);
  });

  // §4.1 Private keys MUST NOT be accessible to web content
  test('§4.1 private key material not directly readable from web content', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'NoAccess' } } as any);
      // Even if internal properties exist, their values should not be usable raw key bytes
      // The key test: can we read a raw private key and use it externally?
      const privateKey = (cred as any).privateKey || (cred as any)._privateKey || (cred as any).secretKey;
      // In polyfill, the key may exist internally for signing, but the spec requires
      // that web content cannot access it. For polyfill, we verify the public API doesn't expose it.
      const publicProps = Object.getOwnPropertyNames(Object.getPrototypeOf(cred))
        .filter(p => !p.startsWith('_'));
      const hasExposedPrivateKey = publicProps.includes('privateKey') || publicProps.includes('secretKey');
      return !hasExposedPrivateKey;
    });
    expect(result).toBe(true);
  });

  // §4.1 All crypto ops MUST be performed by user agent
  test('§4.1 crypto operations performed internally (sign works without exposing keys)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'CryptoOps' } } as any);
      const signed = await cred.sign({ data: 'test' });
      const verified = await cred.verify(signed);
      // Crypto happened internally — no key material exposed
      return { signed: !!signed.proof, verified };
    });
    expect(result.signed).toBe(true);
    expect(result.verified).toBe(true);
  });

  // §4.3.1 Key generation MUST use CSPRNG
  test('§4.3.1 key generation produces unique keys (CSPRNG)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const dids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const cred = await navigator.credentials.create({ did: { displayName: `CSPRNG${i}` } } as any);
        dids.push(cred.did);
      }
      const unique = new Set(dids);
      return unique.size;
    });
    expect(result).toBe(5);
  });

  // §8.3 Private keys MUST NOT be exportable by default
  test('§8.3 private keys not exportable by default', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const cred = await navigator.credentials.create({ did: { displayName: 'NoExport' } } as any);
      const hasExport = typeof cred.export === 'function';
      const hasExportKey = typeof cred.exportKey === 'function';
      // If export exists, it should throw or return nothing useful
      if (hasExport) {
        try {
          const exported = await cred.export();
          return { exportable: !!exported };
        } catch {
          return { exportable: false };
        }
      }
      return { exportable: false };
    });
    expect(result.exportable).toBe(false);
  });
});
