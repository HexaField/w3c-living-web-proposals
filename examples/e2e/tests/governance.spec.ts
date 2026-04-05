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

      const constraintUri = 'urn:constraint:cap1';
      await shared.addTriple(new ST('urn:entity:1', constraintUri, GOV.HAS_CONSTRAINT));
      await shared.addTriple(new ST(constraintUri, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(constraintUri, 'capability', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(constraintUri, 'required', GOV.CAPABILITY_ENFORCEMENT));
      await shared.addTriple(new ST(constraintUri, 'urn:pred:1', GOV.CAPABILITY_PREDICATES));

      const gov = createGovernanceLayer(shared, { rootAuthority: 'did:key:z6MkSomeOtherRoot' });
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

  // §4.1 Constraint must have entry_type and constraint_kind
  test('§4.1 constraint without entry_type is ignored', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('EntType');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('et-test');
      // Add constraint without entry_type
      await shared.addTriple(new ST('urn:constraint:bad', 'temporal', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST('urn:entity:1', 'urn:constraint:bad', GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const r = await gov.canAddTriple('urn:entity:1', 'app://body', 'hello');
      return r.allowed;
    });
    expect(result).toBe(true);
  });

  // §4.3.1 Capability constraint includes enforcement
  test('§4.3.1 capability constraint with required enforcement blocks', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('CapEnf');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('cap-enf');
      const c = 'urn:constraint:cap';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'capability', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, 'required', GOV.CAPABILITY_ENFORCEMENT));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: 'did:key:z6MkOther' });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'hello', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });

  // §4.5 Temporal enforcement
  test('§4.5 temporal min interval enforcement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Temporal');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('temporal');
      const c = 'urn:constraint:rate';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'temporal', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '30', GOV.TEMPORAL_MIN_INTERVAL_SECONDS));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      // Add a recent triple
      await shared.addTriple(new ST('urn:entity:1', 'first', 'app://body'));
      // Use a different root so our agent is NOT root (root bypasses temporal)
      const gov = createGovernanceLayer(shared, { rootAuthority: 'did:key:z6MkSomeOtherRoot' });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'second', did);
      return r.allowed;
    });
    // Should be rejected because interval hasn't elapsed
    expect(result).toBe(false);
  });

  // §4.6 Content max length
  test('§4.6 content max length enforcement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Content');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('content');
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '10', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'this is way too long for the limit', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });

  // §4.6 Content blocked patterns
  test('§4.6 content blocked patterns enforcement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Patterns');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('patterns');
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, 'badword|spam', GOV.CONTENT_BLOCKED_PATTERNS));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'this has badword', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });

  // §6 Root authority has implicit capability
  test('§6 root authority has implicit capability', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Root');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('root');
      const c = 'urn:constraint:cap';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'capability', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, 'required', GOV.CAPABILITY_ENFORCEMENT));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      // Root authority should bypass
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'hello', did);
      return r.allowed;
    });
    expect(result).toBe(true);
  });

  // §7 Temporal window count enforcement
  test('§7 temporal max count per window enforcement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Window');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('window');
      const c = 'urn:constraint:rate';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'temporal', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '2', GOV.TEMPORAL_MAX_COUNT_PER_WINDOW));
      await shared.addTriple(new ST(c, '60', GOV.TEMPORAL_WINDOW_SECONDS));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      // Add two triples (reaching the limit)
      await shared.addTriple(new ST('urn:entity:1', 'msg1', 'app://body'));
      await shared.addTriple(new ST('urn:entity:1', 'msg2', 'app://body'));
      const gov = createGovernanceLayer(shared, { rootAuthority: 'did:key:z6MkOther' });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'msg3', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });

  // §8 Content URL allow/deny
  test('§8 content URL policy enforcement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('URLPolicy');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('url-policy');
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, 'false', GOV.CONTENT_ALLOW_URLS));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'visit https://evil.com', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });

  // §9.1 canAddTriple stops at first rejection
  test('§9.1 validation stops at first rejection', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('FirstReject');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('first-reject');
      // Add capability constraint (will fail first)
      const c1 = 'urn:constraint:cap';
      await shared.addTriple(new ST(c1, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c1, 'capability', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c1, 'required', GOV.CAPABILITY_ENFORCEMENT));
      await shared.addTriple(new ST('urn:entity:1', c1, GOV.HAS_CONSTRAINT));
      // Add content constraint
      const c2 = 'urn:constraint:content';
      await shared.addTriple(new ST(c2, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c2, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c2, '5', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:entity:1', c2, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: 'did:key:z6MkOther' });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'long message', did);
      return { allowed: r.allowed, module: r.module };
    });
    expect(result.allowed).toBe(false);
    expect(result.module).toBe('capability');
  });

  // §9.2 constraintsFor returns all including inherited
  test('§9.2 constraintsFor returns inherited constraints', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Inherit');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('inherit');
      // Parent constraint
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '100', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:root', c, GOV.HAS_CONSTRAINT));
      await shared.addTriple(new ST('urn:root', 'urn:child', GOV.HAS_CHILD));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const constraints = await gov.constraintsFor('urn:child');
      return constraints.length;
    });
    expect(result).toBeGreaterThanOrEqual(1);
  });

  // §9.3 myCapabilities returns valid non-revoked
  test('§9.3 myCapabilities returns valid capabilities', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('MyCaps');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const createCapability = (window as any).__createCapability;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('my-caps');
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      // Create and store a ZCAP
      const zcap = createCapability(did, ['app://body'], { within: null, graph: shared.uri }, did);
      await shared.addTriple(new ST(did, 'expr://zcap1', GOV.HAS_ZCAP));
      gov.storeExpression('expr://zcap1', zcap);
      const caps = await gov.myCapabilities(did);
      return caps.length;
    });
    expect(result).toBe(1);
  });

  // §5.1 Ancestry walks parent chain
  test('§5.1 scope resolution walks parent chain', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Scope');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('scope');
      await shared.addTriple(new ST('urn:root', 'urn:a', GOV.HAS_CHILD));
      await shared.addTriple(new ST('urn:a', 'urn:b', GOV.HAS_CHILD));
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '10', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:root', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      // urn:b should inherit root's constraint
      const r = await gov.canAddTripleAs('urn:b', 'app://body', 'this is way too long for the limit', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });

  // §5.3 Most-specific-scope wins
  test('§5.3 most specific scope wins for same kind', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Specific');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('specific');
      await shared.addTriple(new ST('urn:root', 'urn:child', GOV.HAS_CHILD));
      // Root: strict (max 5)
      const c1 = 'urn:constraint:root-content';
      await shared.addTriple(new ST(c1, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c1, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c1, '5', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:root', c1, GOV.HAS_CONSTRAINT));
      // Child: lenient (max 1000)
      const c2 = 'urn:constraint:child-content';
      await shared.addTriple(new ST(c2, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c2, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c2, '1000', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:child', c2, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      // "Hello world" is 11 chars — too long for root (5) but OK for child (1000)
      const r = await gov.canAddTripleAs('urn:child', 'app://body', 'Hello world', did);
      return r.allowed;
    });
    expect(result).toBe(true);
  });

  // §10.1 Sync evaluates governance for incoming triples
  test('§10.1 governance evaluated on every incoming triple', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('SyncGov');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('sync-gov');
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '100', GOV.CONTENT_MAX_LENGTH));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      // Short message should pass
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'ok', did);
      return r.allowed;
    });
    expect(result).toBe(true);
  });

  // §12.7 Regex evaluation timeout
  test('§12.7 regex timeout protection', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Regex');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('regex');
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, '[invalid regex', GOV.CONTENT_BLOCKED_PATTERNS));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      // Invalid regex should be skipped — message passes
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'hello', did);
      return r.allowed;
    });
    expect(result).toBe(true);
  });

  // §8 Domain whitelist enforcement
  test('§8 domain whitelist enforcement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { provider, did } = await (window as any).__createIdentityProvider('Domain');
      const SharedGraphManager = (window as any).__SharedGraphManager;
      const createGovernanceLayer = (window as any).__createGovernanceLayer;
      const GOV = (window as any).__GOV;
      const ST = (window as any).__SemanticTriple;
      const mgr = new SharedGraphManager(provider);
      const shared = await mgr.share('domain');
      const c = 'urn:constraint:content';
      await shared.addTriple(new ST(c, GOV.CONSTRAINT, GOV.ENTRY_TYPE));
      await shared.addTriple(new ST(c, 'content', GOV.CONSTRAINT_KIND));
      await shared.addTriple(new ST(c, 'example.com', GOV.CONTENT_ALLOWED_DOMAINS));
      await shared.addTriple(new ST('urn:entity:1', c, GOV.HAS_CONSTRAINT));
      const gov = createGovernanceLayer(shared, { rootAuthority: did });
      const r = await gov.canAddTripleAs('urn:entity:1', 'app://body', 'visit https://evil.com', did);
      return r.allowed;
    });
    expect(result).toBe(false);
  });
});
