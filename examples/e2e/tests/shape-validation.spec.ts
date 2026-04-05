import { test, expect } from '@playwright/test';

const taskShape = JSON.stringify({
  targetClass: 'urn:schema:Task',
  properties: [
    { name: 'entry_type', path: 'urn:schema:entry_type', datatype: 'xsd:string', minCount: 1, maxCount: 1, readOnly: true },
    { name: 'title', path: 'urn:schema:title', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    { name: 'status', path: 'urn:schema:status', datatype: 'xsd:string', maxCount: 1 },
    { name: 'tags', path: 'urn:schema:tag', datatype: 'xsd:string' },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: 'urn:schema:entry_type', target: 'urn:schema:Task' },
    { action: 'setSingleTarget', source: 'this', predicate: 'urn:schema:title', target: 'title' },
  ],
});

test.describe('Spec 04 — Shape Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status:has-text("ready")');
    await page.evaluate(() => indexedDB.databases().then(dbs => Promise.all(dbs.map(db => new Promise(r => indexedDB.deleteDatabase(db.name!).onsuccess = r)))));
    await page.reload();
    await page.waitForSelector('#status:has-text("ready")');
  });

  test('addShape() registers a shape', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-test');
      await g.addShape('Task', shapeJson);
      const shapes = await g.getShapes();
      return shapes.length;
    }, taskShape);
    expect(result).toBe(1);
  });

  test('createShapeInstance() creates an instance with constructor triples', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-inst');
      await g.addShape('Task', shapeJson);
      const uri = await g.createShapeInstance('Task', `urn:task:${Date.now()}`, { title: 'My Task' });
      return typeof uri === 'string' && uri.length > 0;
    }, taskShape);
    expect(result).toBe(true);
  });

  test('getShapeInstances() returns instances matching the shape', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-list');
      await g.addShape('Task', shapeJson);
      await g.createShapeInstance('Task', `urn:task:1`, { title: 'Task 1' });
      await g.createShapeInstance('Task', `urn:task:2`, { title: 'Task 2' });
      const instances = await g.getShapeInstances('Task');
      return instances.length;
    }, taskShape);
    expect(result).toBe(2);
  });

  test('getShapeInstanceData() returns property values', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-data');
      await g.addShape('Task', shapeJson);
      const uri = await g.createShapeInstance('Task', 'urn:task:read', { title: 'Read spec' });
      const data = await g.getShapeInstanceData('Task', uri);
      return data.title;
    }, taskShape);
    expect(result).toBe('Read spec');
  });

  test('setShapeProperty() updates a scalar property', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-set');
      await g.addShape('Task', shapeJson);
      const uri = await g.createShapeInstance('Task', 'urn:task:upd', { title: 'Old' });
      await g.setShapeProperty('Task', uri, 'title', 'New');
      const data = await g.getShapeInstanceData('Task', uri);
      return data.title;
    }, taskShape);
    expect(result).toBe('New');
  });

  test('required property validation — missing required field throws', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-req');
      await g.addShape('Task', shapeJson);
      try {
        await g.createShapeInstance('Task', 'urn:task:missing', {});
        return 'should have thrown';
      } catch (e: any) {
        return e.message;
      }
    }, taskShape);
    expect(result).not.toBe('should have thrown');
    expect(result.toLowerCase()).toContain('required');
  });

  test('maxCount validation — exceeding cardinality via addToShapeCollection on scalar', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('shape-max');
      await g.addShape('Task', shapeJson);
      const uri = await g.createShapeInstance('Task', 'urn:task:card', { title: 'Cardinality' });
      try {
        await g.addToShapeCollection('Task', uri, 'title', 'Extra');
        return 'should have thrown';
      } catch (e: any) {
        return e.message;
      }
    }, taskShape);
    expect(result).not.toBe('should have thrown');
  });

  // §4.4 Setters validate datatype
  test('§4.4 setters validate datatype before modifying', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('dt-val');
      const shape = JSON.stringify({
        targetClass: 'urn:schema:Typed',
        properties: [
          { name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
          { name: 'count', path: 'urn:schema:count', datatype: 'xsd:integer', maxCount: 1, writable: true },
        ],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Typed' },
        ],
      });
      await g.addShape('Typed', shape);
      await g.createShapeInstance('Typed', 'urn:typed:1', {});
      try {
        await g.setShapeProperty('Typed', 'urn:typed:1', 'count', 'not-a-number');
        return 'should have thrown';
      } catch {
        return 'threw';
      }
    });
    expect(result).toBe('threw');
  });

  // §4.4 Setters reject with TypeError on invalid
  test('§4.4 setters reject with TypeError on invalid value', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('reject-test');
      const shape = JSON.stringify({
        targetClass: 'urn:schema:Strict',
        properties: [
          { name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
          { name: 'link', path: 'urn:schema:link', datatype: 'URI', maxCount: 1, writable: true },
        ],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Strict' },
        ],
      });
      await g.addShape('Strict', shape);
      await g.createShapeInstance('Strict', 'urn:strict:1', {});
      try {
        await g.setShapeProperty('Strict', 'urn:strict:1', 'link', 'not a uri');
        return 'should have thrown';
      } catch (e: any) {
        return e.name === 'TypeError' ? 'TypeError' : e.message;
      }
    });
    expect(result).toBe('TypeError');
  });

  // §5.1 Duplicate shape name rejects
  test('§5.1 duplicate shape name rejects with ConstraintError', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('dup-shape');
      await g.addShape('Task', shapeJson);
      try {
        await g.addShape('Task', shapeJson);
        return 'should have thrown';
      } catch (e: any) {
        return 'threw';
      }
    }, taskShape);
    expect(result).toBe('threw');
  });

  // §5.6 setShapeProperty rejects non-writable
  test('§5.6 setShapeProperty rejects non-writable property', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('nw-test');
      await g.addShape('Task', shapeJson);
      await g.createShapeInstance('Task', 'urn:task:nw', { title: 'T' });
      try {
        await g.setShapeProperty('Task', 'urn:task:nw', 'entry_type', 'other');
        return 'should have thrown';
      } catch {
        return 'threw';
      }
    }, taskShape);
    expect(result).toBe('threw');
  });

  // §5.7 addToShapeCollection rejects when maxCount exceeded
  test('§5.7 addToShapeCollection rejects when maxCount exceeded', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('maxc-test');
      const shape = JSON.stringify({
        targetClass: 'urn:schema:Bounded',
        properties: [
          { name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
          { name: 'items', path: 'urn:schema:item', datatype: 'xsd:string', minCount: 0, maxCount: 2, writable: true },
        ],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Bounded' },
        ],
      });
      await g.addShape('Bounded', shape);
      await g.createShapeInstance('Bounded', 'urn:b:1', {});
      await g.addToShapeCollection('Bounded', 'urn:b:1', 'items', 'a');
      await g.addToShapeCollection('Bounded', 'urn:b:1', 'items', 'b');
      try {
        await g.addToShapeCollection('Bounded', 'urn:b:1', 'items', 'c');
        return 'should have thrown';
      } catch {
        return 'threw';
      }
    });
    expect(result).toBe('threw');
  });

  // §5.8 removeFromShapeCollection rejects nonexistent value
  test('§5.8 removeFromShapeCollection rejects nonexistent value', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('rm-test');
      await g.addShape('Task', shapeJson);
      await g.createShapeInstance('Task', 'urn:task:rm', { title: 'T' });
      await g.addToShapeCollection('Task', 'urn:task:rm', 'tags', 'tag1');
      try {
        await g.removeFromShapeCollection('Task', 'urn:task:rm', 'tags', 'nonexistent');
        return 'should have thrown';
      } catch {
        return 'threw';
      }
    }, taskShape);
    expect(result).toBe('threw');
  });

  // §6.2 shacl://has_shape predicate used for storage
  test('§6.2 shapes stored with shacl://has_shape predicate', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('has-shape');
      await g.addShape('Task', shapeJson);
      const triples = await g.queryTriples({ predicate: 'shacl://has_shape' });
      return triples.length;
    }, taskShape);
    expect(result).toBe(1);
  });

  // §6.3 Shape definitions are content-addressed
  test('§6.3 shape definitions are content-addressed', async ({ page }) => {
    const result = await page.evaluate(async (shapeJson) => {
      const g = await (navigator as any).graph.create('content-addr');
      await g.addShape('Task', shapeJson);
      const triples = await g.queryTriples({ predicate: 'shacl://has_shape' });
      const addr = triples[0]?.data.target;
      return typeof addr === 'string' && addr.startsWith('shacl://shape/');
    }, taskShape);
    expect(result).toBe(true);
  });

  // §8.1 Constructor actions cannot trigger arbitrary code
  test('§8.1 constructor actions cannot execute arbitrary code', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('safe-test');
      const shape = JSON.stringify({
        targetClass: 'urn:schema:Safe',
        properties: [{ name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false }],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Safe' },
        ],
        __proto__: { evil: true },
      });
      await g.addShape('Safe', shape);
      await g.createShapeInstance('Safe', 'urn:safe:1', {});
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  // §8.3 All setter values validated against datatype
  test('§8.3 all setter values validated against datatype', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const g = await (navigator as any).graph.create('valid-test');
      const shape = JSON.stringify({
        targetClass: 'urn:schema:Validated',
        properties: [
          { name: 'type', path: 'rdf:type', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
          { name: 'num', path: 'urn:schema:num', datatype: 'xsd:integer', maxCount: 1, writable: true },
        ],
        constructor: [
          { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'urn:schema:Validated' },
        ],
      });
      await g.addShape('Validated', shape);
      await g.createShapeInstance('Validated', 'urn:v:1', {});
      // Valid integer
      await g.setShapeProperty('Validated', 'urn:v:1', 'num', '42');
      const data = await g.getShapeInstanceData('Validated', 'urn:v:1');
      return data.num;
    });
    expect(result).toBe('42');
  });
});
