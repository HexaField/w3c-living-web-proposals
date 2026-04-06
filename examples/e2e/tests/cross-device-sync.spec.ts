import { test, expect, chromium, type Browser } from '@playwright/test';

test.describe('Cross-device sync via WebSocket relay', () => {
  let browser1: Browser;
  let browser2: Browser;

  test.beforeAll(async () => {
    browser1 = await chromium.launch();
    browser2 = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser1?.close();
    await browser2?.close();
  });

  test('two browser contexts sync triples via relay', async () => {
    const context1 = await browser1.newContext();
    const context2 = await browser2.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto('http://localhost:5173/');
    await page2.goto('http://localhost:5173/');
    await page1.waitForSelector('#status:has-text("ready")');
    await page2.waitForSelector('#status:has-text("ready")');

    // Page 1: create shared graph with relay on port 4000
    const uri = await page1.evaluate(async () => {
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Alice');
      const mgr = new SharedGraphManager(provider);
      const graph = await mgr.share('relay-test', { relays: ['localhost:4000'] });
      // Store on window for later access
      (window as any).__sharedGraph = graph;
      (window as any).__sharedMgr = mgr;
      return graph.uri;
    });

    expect(uri).toMatch(/^graph:\/\/localhost:4000\//);

    // Page 2: join via URI
    await page2.evaluate(async (uri: string) => {
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Bob');
      const mgr = new SharedGraphManager(provider);
      const graph = await mgr.join(uri);
      (window as any).__sharedGraph = graph;
      (window as any).__sharedMgr = mgr;
    }, uri);

    // Wait for both WS connections to establish
    await page1.waitForFunction(() => {
      const g = (window as any).__sharedGraph;
      return g?.syncState === 'synced';
    }, { timeout: 5000 });
    await page2.waitForFunction(() => {
      const g = (window as any).__sharedGraph;
      return g?.syncState === 'synced';
    }, { timeout: 5000 });

    // Page 1: add a triple
    await page1.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      const graph = (window as any).__sharedGraph;
      await graph.addTriple(new ST('urn:cross', 'urn:device', 'urn:sync'));
    });

    // Page 2: wait for the triple to arrive via relay
    const synced = await page2.waitForFunction(async () => {
      const graph = (window as any).__sharedGraph;
      const triples = await graph.queryTriples({ source: 'urn:cross' });
      return triples.length > 0;
    }, { timeout: 10000 });

    expect(synced).toBeTruthy();

    // Verify triple content on page 2
    const tripleData = await page2.evaluate(async () => {
      const graph = (window as any).__sharedGraph;
      const triples = await graph.queryTriples({ source: 'urn:cross' });
      return triples.map((t: any) => ({
        source: t.data.source,
        predicate: t.data.predicate,
        target: t.data.target,
      }));
    });

    expect(tripleData).toEqual([
      { source: 'urn:cross', predicate: 'urn:sync', target: 'urn:device' },
    ]);

    await context1.close();
    await context2.close();
  });

  test('bidirectional sync — both sides can add triples', async () => {
    const context1 = await browser1.newContext();
    const context2 = await browser2.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto('http://localhost:5173/');
    await page2.goto('http://localhost:5173/');
    await page1.waitForSelector('#status:has-text("ready")');
    await page2.waitForSelector('#status:has-text("ready")');

    // Page 1: create
    const uri = await page1.evaluate(async () => {
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Carol');
      const mgr = new SharedGraphManager(provider);
      const graph = await mgr.share('bidir-test', { relays: ['localhost:4000'] });
      (window as any).__sharedGraph = graph;
      return graph.uri;
    });

    // Page 2: join
    await page2.evaluate(async (uri: string) => {
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Dave');
      const mgr = new SharedGraphManager(provider);
      const graph = await mgr.join(uri);
      (window as any).__sharedGraph = graph;
    }, uri);

    // Wait for connections
    await page1.waitForFunction(() => (window as any).__sharedGraph?.syncState === 'synced', { timeout: 5000 });
    await page2.waitForFunction(() => (window as any).__sharedGraph?.syncState === 'synced', { timeout: 5000 });

    // Page 1 adds
    await page1.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      await (window as any).__sharedGraph.addTriple(new ST('urn:a', 'urn:from', 'urn:page1'));
    });

    // Page 2 adds
    await page2.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      await (window as any).__sharedGraph.addTriple(new ST('urn:b', 'urn:from', 'urn:page2'));
    });

    // Both should see both triples
    await page1.waitForFunction(async () => {
      const g = (window as any).__sharedGraph;
      const all = await g.snapshot();
      return all.length >= 2;
    }, { timeout: 10000 });

    await page2.waitForFunction(async () => {
      const g = (window as any).__sharedGraph;
      const all = await g.snapshot();
      return all.length >= 2;
    }, { timeout: 10000 });

    const p1Count = await page1.evaluate(async () => (await (window as any).__sharedGraph.snapshot()).length);
    const p2Count = await page2.evaluate(async () => (await (window as any).__sharedGraph.snapshot()).length);

    expect(p1Count).toBe(2);
    expect(p2Count).toBe(2);

    await context1.close();
    await context2.close();
  });
});
