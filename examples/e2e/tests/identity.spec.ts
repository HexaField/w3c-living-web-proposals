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
});
