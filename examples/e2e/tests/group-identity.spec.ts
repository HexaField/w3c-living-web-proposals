import { test, expect } from '@playwright/test';

test.describe('Spec 06 — Group Identity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('createGroup() generates a group DID and shared graph', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { GroupManager } = (window as any).__GroupIdentity;
      const { provider, did } = await (window as any).__createIdentityProvider('Alice');
      const mgr = new GroupManager(provider);
      const group = await mgr.createGroup({ name: 'Test Group' });
      return {
        did: group.did,
        name: group.name,
        hasGraph: !!group.graph,
        memberCount: (await group.members()).length,
        creatorIsMember: await group.isMember(did),
      };
    });
    expect(result.did).toMatch(/^did:group:/);
    expect(result.name).toBe('Test Group');
    expect(result.hasGraph).toBe(true);
    expect(result.memberCount).toBe(1);
    expect(result.creatorIsMember).toBe(true);
  });

  test('add and remove members', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { GroupManager } = (window as any).__GroupIdentity;
      const { provider: aliceProv, did: aliceDid } = await (window as any).__createIdentityProvider('Alice');
      const { did: bobDid } = await (window as any).__createIdentityProvider('Bob');
      const mgr = new GroupManager(aliceProv);
      const group = await mgr.createGroup({ name: 'Test' });

      await group.addMember(bobDid);
      const afterAdd = (await group.members()).length;
      const bobIsMember = await group.isMember(bobDid);

      await group.removeMember(bobDid);
      const afterRemove = (await group.members()).length;
      const bobRemoved = await group.isMember(bobDid);

      return { afterAdd, bobIsMember, afterRemove, bobRemoved };
    });
    expect(result.afterAdd).toBe(2);
    expect(result.bobIsMember).toBe(true);
    expect(result.afterRemove).toBe(1);
    expect(result.bobRemoved).toBe(false);
  });

  test('nested groups and transitive members', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { GroupManager, DefaultGroupRegistry } = (window as any).__GroupIdentity;
      const { provider: aliceProv, did: aliceDid } = await (window as any).__createIdentityProvider('Alice');
      const { did: bobDid } = await (window as any).__createIdentityProvider('Bob');
      const registry = new DefaultGroupRegistry();
      const mgr = new GroupManager(aliceProv, registry);

      const org = await mgr.createGroup({ name: 'Org' });
      const team = await mgr.createGroup({ name: 'Team' });
      await team.addMember(bobDid);
      await org.addMember(team.did);

      const children = await org.childGroups();
      const transitive = await org.transitiveMembers();
      const dids = transitive.map((m: any) => m.did);

      return {
        childCount: children.length,
        childDid: children[0]?.did,
        transitiveDids: dids,
        hasBob: dids.includes(bobDid),
        hasAlice: dids.includes(aliceDid),
      };
    });
    expect(result.childCount).toBe(1);
    expect(result.hasBob).toBe(true);
    expect(result.hasAlice).toBe(true);
  });

  test('group DID persists across membership changes', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { GroupManager } = (window as any).__GroupIdentity;
      const { provider: aliceProv } = await (window as any).__createIdentityProvider('Alice');
      const { did: bobDid } = await (window as any).__createIdentityProvider('Bob');
      const { did: charlieDid } = await (window as any).__createIdentityProvider('Charlie');
      const mgr = new GroupManager(aliceProv);
      const group = await mgr.createGroup({ name: 'Test' });
      const original = group.did;

      await group.addMember(bobDid);
      const afterAdd = group.did;
      await group.removeMember(bobDid);
      const afterRemove = group.did;
      await group.addMember(charlieDid);
      const afterAnother = group.did;

      return { original, afterAdd, afterRemove, afterAnother };
    });
    expect(result.afterAdd).toBe(result.original);
    expect(result.afterRemove).toBe(result.original);
    expect(result.afterAnother).toBe(result.original);
  });

  test('listGroups returns only groups caller is member of', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { GroupManager } = (window as any).__GroupIdentity;
      const { provider: aliceProv } = await (window as any).__createIdentityProvider('Alice');
      const mgr = new GroupManager(aliceProv);
      await mgr.createGroup({ name: 'G1' });
      await mgr.createGroup({ name: 'G2' });
      const groups = await mgr.listGroups();
      return groups.map((g: any) => g.name);
    });
    expect(result).toHaveLength(2);
    expect(result).toContain('G1');
    expect(result).toContain('G2');
  });
});
