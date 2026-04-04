import { test, expect } from '@playwright/test';

test.describe('Demo 07 — Collaborative Doc (smoke)', () => {
  test('collaborative doc flow: create identity, create doc, add block', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');

    const result = await page.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Writer');

      const mgr = new SharedGraphManager(provider);
      const doc = await mgr.share('my-document');

      const blockUri = `urn:block:${Date.now()}`;
      await doc.addTriple(new ST(doc.uri, blockUri, 'urn:doc:hasBlock'));
      await doc.addTriple(new ST(blockUri, 'heading', 'urn:doc:blockType'));
      await doc.addTriple(new ST(blockUri, 'My Document', 'urn:doc:content'));

      const blocks = await doc.queryTriples({ predicate: 'urn:doc:hasBlock' });
      const content = await doc.queryTriples({ source: blockUri, predicate: 'urn:doc:content' });
      return { blockCount: blocks.length, content: content[0]?.data.target };
    });

    expect(result.blockCount).toBe(1);
    expect(result.content).toBe('My Document');
  });
});
