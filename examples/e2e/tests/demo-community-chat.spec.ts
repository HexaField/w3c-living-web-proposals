import { test, expect } from '@playwright/test';

test.describe('Demo 10 — Community Chat (smoke)', () => {
  test('community chat flow: create identity, create community, send message', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');

    const result = await page.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider, did } = await (window as any).__createIdentityProvider('ChatUser');

      const mgr = new SharedGraphManager(provider);
      const community = await mgr.share('test-community');

      await community.addTriple(new ST(community.uri, 'urn:channel:general', 'urn:schema:hasChannel'));
      await community.addTriple(new ST('urn:channel:general', 'General', 'urn:schema:name'));

      const msgUri = `urn:msg:${Date.now()}`;
      await community.addTriple(new ST('urn:channel:general', msgUri, 'urn:schema:hasMessage'));
      await community.addTriple(new ST(msgUri, 'Hello world!', 'urn:schema:content'));
      await community.addTriple(new ST(msgUri, did, 'urn:schema:author'));

      const messages = await community.queryTriples({ predicate: 'urn:schema:hasMessage' });
      const content = await community.queryTriples({ source: msgUri, predicate: 'urn:schema:content' });

      return { communityUri: community.uri, messageCount: messages.length, content: content[0]?.data.target };
    });

    expect(result.communityUri).toBeTruthy();
    expect(result.messageCount).toBe(1);
    expect(result.content).toBe('Hello world!');
  });
});
