import { test, expect } from '@playwright/test';

test.describe('Demo 06 — P2P Version Control (smoke)', () => {
  test('p2p-vcs flow: create identity, create repo, create file', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');

    const result = await page.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider } = await (window as any).__createIdentityProvider('Dev');

      const mgr = new SharedGraphManager(provider);
      const repo = await mgr.share('my-repo');

      const fileUri = `urn:file:${Date.now()}`;
      await repo.addTriple(new ST(repo.uri, fileUri, 'urn:vcs:hasFile'));
      await repo.addTriple(new ST(fileUri, 'README.md', 'urn:vcs:fileName'));
      await repo.addTriple(new ST(fileUri, '# Hello', 'urn:vcs:content'));

      const files = await repo.queryTriples({ predicate: 'urn:vcs:hasFile' });
      return { repoUri: repo.uri, fileCount: files.length };
    });

    expect(result.repoUri).toBeTruthy();
    expect(result.fileCount).toBe(1);
  });
});
