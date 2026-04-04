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
});
