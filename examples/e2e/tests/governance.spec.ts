import { test, expect } from '@playwright/test';

test.describe('Spec 05 — Governance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('canAddTriple() returns { allowed: true } when no constraints', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('GovTest');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('gov-test');
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const result = await gov.canAddTriple('urn:test:1', 'urn:pred:1', 'urn:test:2');
      return result;
    });
    expect(result.allowed).toBe(true);
  });

  test('canAddTriple() returns { allowed: false } when capability constraint blocks', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('GovBlock');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('gov-block');

      // Set up a proper capability constraint with enforcement=required
      const constraintUri = 'urn:constraint:cap1';
      await shared.addTriple(new ST('urn:entity:1', constraintUri, GOV.HAS_CONSTRAINT));
      await shared.addTriple(new ST(constraintUri, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(constraintUri, 'capability', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(constraintUri, 'required', GOV.CAPABILITY_ENFORCEMENT));
      await shared.addTriple(new ST(constraintUri, 'urn:pred:1', GOV.CAPABILITY_PREDICATES));

      // Create governance with a different root authority so the test author is NOT root
      const gov = createGovernanceLayer(shared, { rootAuthority: 'did:key:z6MkSomeOtherRoot' });
      // This agent (did) is not root and has no ZCAPs, so should be blocked
      const result = await gov.canAddTripleAs('urn:entity:1', 'urn:pred:1', 'value', did);
      return result;
    });
    expect(result.allowed).toBe(false);
  });

  test('constraintsFor() returns constraints attached to entity', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('GovConst');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('gov-constraints');

      const constraintUri = 'urn:constraint:admin1';
      await shared.addTriple(new ST('urn:entity:1', constraintUri, GOV.HAS_CONSTRAINT));
      await shared.addTriple(new ST(constraintUri, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(constraintUri, 'capability', GOV.CONSTRAINT_KIND));

      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const constraints = await gov.constraintsFor('urn:entity:1');
      return { isArray: Array.isArray(constraints), length: constraints.length };
    });
    expect(result.isArray).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('myCapabilities() returns agent capabilities', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('GovCaps');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('gov-caps');
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const caps = await gov.myCapabilities(did);
      return Array.isArray(caps);
    });
    expect(result).toBe(true);
  });

  test('GOV predicates are defined', async ({ page }) => {
    const result = await page.evaluate(() => {
      const GOV = (window as any).__GOV;
      return {
        hasConstraintKind: typeof GOV.CONSTRAINT_KIND === 'string',
        hasHasConstraint: typeof GOV.HAS_CONSTRAINT === 'string',
        hasCapabilityEnforcement: typeof GOV.CAPABILITY_ENFORCEMENT === 'string',
        hasTemporal: typeof GOV.TEMPORAL_MIN_INTERVAL_SECONDS === 'string',
        hasContent: typeof GOV.CONTENT_BLOCKED_PATTERNS === 'string',
      };
    });
    expect(result.hasConstraintKind).toBe(true);
    expect(result.hasHasConstraint).toBe(true);
    expect(result.hasCapabilityEnforcement).toBe(true);
    expect(result.hasTemporal).toBe(true);
    expect(result.hasContent).toBe(true);
  });
});
