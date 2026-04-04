import { test, expect } from '@playwright/test';

test.describe('Spec 03 — Graph Sync (SharedGraph)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('SharedGraphManager.share() returns a SharedGraph with a URI', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Sharer');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('my-graph');
      return { hasUri: typeof shared.uri === 'string' && shared.uri.length > 0, name: shared.name };
    });
    expect(result.hasUri).toBe(true);
    expect(result.name).toBe('my-graph');
  });

  test('SharedGraphManager.join(uri) joins a shared graph', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('Joiner');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('joinable');
      const joined = await mgr.join(shared.uri);
      return { sameUri: joined.uri === shared.uri };
    });
    expect(result.sameUri).toBe(true);
  });

  test('peers() returns peer list', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('PeerTest');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('peer-test');
      const peers = await shared.peers();
      return Array.isArray(peers);
    });
    expect(result).toBe(true);
  });

  test('syncState is defined', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('SyncTest');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('sync-test');
      return typeof shared.syncState === 'string';
    });
    expect(result).toBe(true);
  });

  test('triples sync between tabs via BroadcastChannel', async ({ context }) => {
    // BroadcastChannel works within the same browsing context (same origin, same process)
    // Two pages in the same context share BroadcastChannel
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    await page1.goto('http://localhost:5173/');
    await page1.waitForSelector('#status:has-text("ready")');
    await page2.goto('http://localhost:5173/');
    await page2.waitForSelector('#status:has-text("ready")');

    // Create graph in page1, add triple
    const graphId = await page1.evaluate(async () => {
      const g = await (navigator as any).graph.create('sync-bc');
      return g.uuid;
    });

    // Page2 needs to load the same graph from IndexedDB
    // Wait for page2 to have it
    await page2.reload();
    await page2.waitForSelector('#status:has-text("ready")');

    // Now add triple in page1 — BroadcastChannel should relay to page2's graph instance
    await page1.evaluate(async (id) => {
      const g = await (navigator as any).graph.get(id);
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:sync:1', 'urn:sync:2', 'urn:pred:bc'));
    }, graphId);

    // Give BroadcastChannel time
    await page2.waitForTimeout(1000);

    // Check page2 got it (via BroadcastChannel relay to in-memory graph)
    const result = await page2.evaluate(async (id) => {
      const g = await (navigator as any).graph.get(id);
      if (!g) return 0;
      const snap = await g.snapshot();
      return snap.length;
    }, graphId);

    expect(result).toBeGreaterThanOrEqual(1);
  });

  test('addTriple and queryTriples work on SharedGraph', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider } = await (window as any).__createIdentityProvider('SharedTriple');
      const mgr = new (window as any).__SharedGraphManager(provider);
      const shared = await mgr.share('triple-test');
      const ST = (window as any).__SemanticTriple;
      await shared.addTriple(new ST('urn:s:1', 'urn:t:1', 'urn:p:1'));
      const results = await shared.queryTriples({ source: 'urn:s:1' });
      return results.length;
    });
    expect(result).toBe(1);
  });
});
