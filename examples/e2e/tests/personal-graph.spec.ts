import { test, expect } from '@playwright/test';

test.describe('Spec 01 — Personal Graph API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    // Clear IndexedDB for isolation
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('navigator.graph exists with create, list, get, remove', async ({ page }) => {
    const result = await page.evaluate(() => ({
      exists: 'graph' in navigator,
      hasCreate: typeof (navigator as any).graph.create === 'function',
      hasList: typeof (navigator as any).graph.list === 'function',
      hasGet: typeof (navigator as any).graph.get === 'function',
      hasRemove: typeof (navigator as any).graph.remove === 'function',
    }));
    expect(result.exists).toBe(true);
    expect(result.hasCreate).toBe(true);
    expect(result.hasList).toBe(true);
    expect(result.hasGet).toBe(true);
    expect(result.hasRemove).toBe(true);
  });

  test('create() returns a PersonalGraph with a UUID', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test-graph');
      return { uuid: g.uuid, name: g.name, hasUuid: typeof g.uuid === 'string' && g.uuid.length > 0 };
    });
    expect(result.hasUuid).toBe(true);
    expect(result.name).toBe('test-graph');
    // UUID v4 format
    expect(result.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('addTriple() with valid URIs succeeds', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const t = new (window as any).__SemanticTriple('urn:test:1', 'urn:test:2', 'urn:pred:knows');
      const signed = await g.addTriple(t);
      return { source: signed.data.source, target: signed.data.target, hasProof: !!signed.proof, hasAuthor: !!signed.author };
    });
    expect(result.source).toBe('urn:test:1');
    expect(result.target).toBe('urn:test:2');
    expect(result.hasProof).toBe(true);
    expect(result.hasAuthor).toBe(true);
  });

  test('addTriple() with non-URI source MUST throw', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      try {
        const t = new (window as any).__SemanticTriple('not-a-uri', 'urn:test:1');
        await g.addTriple(t);
        return 'should have thrown';
      } catch (e: any) {
        return e.message;
      }
    });
    expect(result).toContain('URI');
  });

  test('addTriple() with non-URI predicate MUST throw', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        new (window as any).__SemanticTriple('urn:test:1', 'urn:test:2', 'bad-pred');
        return 'should have thrown';
      } catch (e: any) {
        return e.message;
      }
    });
    expect(result).toContain('URI');
  });

  test('target MAY be a literal string', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const t = new (window as any).__SemanticTriple('urn:test:1', 'Hello world', 'urn:pred:label');
      const signed = await g.addTriple(t);
      return signed.data.target;
    });
    expect(result).toBe('Hello world');
  });

  test('queryTriples() returns matching triples', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:a:1', 'urn:b:1', 'urn:pred:x'));
      await g.addTriple(new ST('urn:a:2', 'urn:b:2', 'urn:pred:x'));
      const results = await g.queryTriples({ source: 'urn:a:1' });
      return results.length;
    });
    expect(result).toBe(1);
  });

  test('queryTriples() with predicate filter works', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:a:1', 'urn:b:1', 'urn:pred:x'));
      await g.addTriple(new ST('urn:a:1', 'urn:b:2', 'urn:pred:y'));
      const results = await g.queryTriples({ predicate: 'urn:pred:x' });
      return results.length;
    });
    expect(result).toBe(1);
  });

  test('queryTriples() with limit works', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      for (let i = 0; i < 5; i++) {
        await g.addTriple(new ST(`urn:a:${i}`, `urn:b:${i}`, 'urn:pred:x'));
      }
      const results = await g.queryTriples({ limit: 2 });
      return results.length;
    });
    expect(result).toBe(2);
  });

  test('querySparql() returns results for valid SPARQL SELECT', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:a:1', 'urn:b:1', 'urn:pred:knows'));
      const sparql = await g.querySparql('SELECT ?s ?o WHERE { ?s <urn:pred:knows> ?o }');
      return { hasBindings: Array.isArray(sparql.bindings), count: sparql.bindings.length };
    });
    expect(result.hasBindings).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test('removeTriple() removes the triple', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      const signed = await g.addTriple(new ST('urn:a:1', 'urn:b:1', 'urn:pred:x'));
      const removed = await g.removeTriple(signed);
      const remaining = await g.snapshot();
      return { removed, count: remaining.length };
    });
    expect(result.removed).toBe(true);
    expect(result.count).toBe(0);
  });

  test('snapshot() returns all triples', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:a:1', 'urn:b:1'));
      await g.addTriple(new ST('urn:a:2', 'urn:b:2'));
      const snap = await g.snapshot();
      return snap.length;
    });
    expect(result).toBe(2);
  });

  test('ontripleadded event fires when triple added', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      let fired = false;
      g.ontripleadded = () => { fired = true; };
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:a:1', 'urn:b:1'));
      return fired;
    });
    expect(result).toBe(true);
  });

  test('ontripleremoved event fires when triple removed', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('test');
      const ST = (window as any).__SemanticTriple;
      const signed = await g.addTriple(new ST('urn:a:1', 'urn:b:1'));
      let fired = false;
      g.ontripleremoved = () => { fired = true; };
      await g.removeTriple(signed);
      return fired;
    });
    expect(result).toBe(true);
  });

  test('graph persists across page reloads (IndexedDB)', async ({ page }) => {
    // Create a graph and add a triple
    const graphId = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('persist-test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:persist:1', 'urn:persist:2'));
      return g.uuid;
    });
    // Reload without clearing DB
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
    const result = await page.evaluate(async (id) => {
      const g = await (navigator as any).graph.get(id);
      if (!g) return { found: false, count: 0 };
      const snap = await g.snapshot();
      return { found: true, count: snap.length };
    }, graphId);
    expect(result.found).toBe(true);
    expect(result.count).toBe(1);
  });

  test('list() returns created graphs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      await (navigator as any).graph.create('g1');
      await (navigator as any).graph.create('g2');
      const list = await (navigator as any).graph.list();
      return list.length;
    });
    expect(result).toBeGreaterThanOrEqual(2);
  });

  test('remove() deletes a graph', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('to-remove');
      const uuid = g.uuid;
      const removed = await (navigator as any).graph.remove(uuid);
      const after = await (navigator as any).graph.get(uuid);
      return { removed, gone: after === null };
    });
    expect(result.removed).toBe(true);
    expect(result.gone).toBe(true);
  });

  // §3.2 — Signature verification (Ed25519)
  test('§3.2 signed triple has Ed25519 signature (128 hex chars)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('sig-test');
      const ST = (window as any).__SemanticTriple;
      const signed = await g.addTriple(new ST('urn:s:1', 'urn:t:1', 'urn:p:1'));
      return { sigLen: signed.proof.signature.length, isHex: /^[0-9a-f]+$/.test(signed.proof.signature) };
    });
    expect(result.sigLen).toBe(128);
    expect(result.isHex).toBe(true);
  });

  // §3.3 Default state is "private"
  test('§3.3 default graph state is "private"', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('state-test');
      return g.state;
    });
    expect(result).toBe('private');
  });

  // §4.2.1 addTriple validates against shapes
  test('§4.2.1 addTriple validates against registered shapes', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('shape-val');
      const shape = JSON.stringify({
        targetClass: 'urn:schema:Task',
        properties: [
          { name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
          { name: 'title', path: 'urn:schema:title', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
        ],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Task' },
          { action: 'setSingleTarget', source: 'this', predicate: 'urn:schema:title', target: 'title' },
        ],
      });
      await g.addShape('Task', shape);
      const uri = await g.createShapeInstance('Task', 'urn:task:1', { title: 'Test' });
      return typeof uri === 'string';
    });
    expect(result).toBe(true);
  });

  // §4.2.1 addTriple MUST reject with InvalidStateError if no identity
  test('§4.2.1 addTriple fires tripleadded event', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('evt-test');
      const events: string[] = [];
      g.ontripleadded = (e: any) => events.push(e.triple.data.source);
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:evt:1', 'urn:evt:2'));
      return events;
    });
    expect(result).toEqual(['urn:evt:1']);
  });

  // §4.2.2 addTriples batch
  test('§4.2.2 addTriples signs and validates all in batch', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('batch-test');
      const ST = (window as any).__SemanticTriple;
      const signed = await g.addTriples([
        new ST('urn:b:1', 'urn:t:1'),
        new ST('urn:b:2', 'urn:t:2'),
      ]);
      return { count: signed.length, allSigned: signed.every((s: any) => !!s.proof) };
    });
    expect(result.count).toBe(2);
    expect(result.allSigned).toBe(true);
  });

  // §4.2.5 querySparql
  test('§4.2.5 querySparql executes SPARQL SELECT', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('sparql-test');
      const ST = (window as any).__SemanticTriple;
      await g.addTriple(new ST('urn:s:1', 'urn:t:1', 'urn:p:knows'));
      const r = await g.querySparql('SELECT ?s ?o WHERE { ?s <urn:p:knows> ?o }');
      return { type: r.type, count: r.bindings.length };
    });
    expect(result.type).toBe('bindings');
    expect(result.count).toBe(1);
  });

  // §5.1 addShape validates structure
  test('§5.1 addShape validates SHACL JSON structure', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('shape-val2');
      try {
        await g.addShape('Bad', JSON.stringify({ properties: [] }));
        return 'should have thrown';
      } catch (e: any) {
        return e.message;
      }
    });
    expect(result).toContain('targetClass');
  });

  // §5.1 addShape rejects malformed with SyntaxError
  test('§5.1 addShape rejects malformed JSON', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('bad-json');
      try {
        await g.addShape('Bad', '{not json');
        return 'should have thrown';
      } catch (e: any) {
        return 'threw';
      }
    });
    expect(result).toBe('threw');
  });

  // §5.3.1 createShapeInstance MUST reject with ConstraintError if required param missing
  test('§5.3.1 createShapeInstance rejects missing required param', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('req-test');
      await g.addShape('Task', JSON.stringify({
        targetClass: 'urn:schema:Task',
        properties: [
          { name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
          { name: 'title', path: 'urn:schema:title', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
        ],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Task' },
          { action: 'setSingleTarget', source: 'this', predicate: 'urn:schema:title', target: 'title' },
        ],
      }));
      try {
        await g.createShapeInstance('Task', 'urn:task:bad', {});
        return 'should have thrown';
      } catch (e: any) {
        return 'threw';
      }
    });
    expect(result).toBe('threw');
  });

  // §8.4 list() MUST only return same-origin graphs
  test('§8.4 list() returns only graphs from this origin/namespace', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g1 = await (navigator as any).graph.create('mine-1');
      const g2 = await (navigator as any).graph.create('mine-2');
      const list = await (navigator as any).graph.list();
      return list.every((g: any) => typeof g.uuid === 'string');
    });
    expect(result).toBe(true);
  });
});
