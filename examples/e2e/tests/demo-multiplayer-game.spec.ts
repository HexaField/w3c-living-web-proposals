import { test, expect } from '@playwright/test';

test.describe('Demo 09 — Multiplayer Game (smoke)', () => {
  test('multiplayer game flow: create identity, create world, move player', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');

    const result = await page.evaluate(async () => {
      const ST = (window as any).__SemanticTriple;
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const { provider, did } = await (window as any).__createIdentityProvider('Player1');

      const mgr = new SharedGraphManager(provider);
      const world = await mgr.share('game-world');

      const playerUri = `urn:player:${did}`;
      await world.addTriple(new ST(world.uri, playerUri, 'urn:game:hasPlayer'));
      await world.addTriple(new ST(playerUri, '0,0', 'urn:game:position'));
      await world.addTriple(new ST(playerUri, 'Player1', 'urn:game:displayName'));

      // Move player
      const oldPos = await world.queryTriples({ source: playerUri, predicate: 'urn:game:position' });
      if (oldPos.length > 0) await world.removeTriple(oldPos[0]);
      await world.addTriple(new ST(playerUri, '5,3', 'urn:game:position'));

      const players = await world.queryTriples({ predicate: 'urn:game:hasPlayer' });
      const pos = await world.queryTriples({ source: playerUri, predicate: 'urn:game:position' });
      return { playerCount: players.length, position: pos[0]?.data.target };
    });

    expect(result.playerCount).toBe(1);
    expect(result.position).toBe('5,3');
  });
});
