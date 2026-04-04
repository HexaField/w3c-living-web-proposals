import { test, expect } from '@playwright/test';

test.describe('Demo 08 — Collaborative Canvas (smoke)', () => {
  test('collaborative canvas flow: create identity, create canvas, draw shape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');

    const result = await page.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Artist');

      const mgr = new SharedGraphManager(provider);
      const canvas = await mgr.share('my-canvas');

      const shapeUri = `urn:shape:${Date.now()}`;
      await canvas.addTriple(new ST(canvas.uri, shapeUri, 'urn:canvas:hasShape'));
      await canvas.addTriple(new ST(shapeUri, 'rectangle', 'urn:canvas:type'));
      await canvas.addTriple(new ST(shapeUri, '100,100,200,150', 'urn:canvas:bounds'));
      await canvas.addTriple(new ST(shapeUri, '#ff0000', 'urn:canvas:fill'));

      const shapes = await canvas.queryTriples({ predicate: 'urn:canvas:hasShape' });
      return { shapeCount: shapes.length };
    });

    expect(result.shapeCount).toBe(1);
  });
});
