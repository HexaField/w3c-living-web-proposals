/**
 * Conformance tests for @living-web/shape-validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Graph,
  GraphStorage,
  EphemeralIdentity,
  type IdentityProvider,
} from '@living-web/personal-graph';
import { installShapeExtension, SHAPE_PREDICATE, contentAddress } from '../index.js';

installShapeExtension();

const TASK_SHAPE = {
  targetClass: 'https://schema.org/Action',
  properties: [
    { path: 'rdf://type',          name: 'type_flag', datatype: 'URI',         minCount: 1, maxCount: 1, writable: false },
    { path: 'schema://name',       name: 'title',     datatype: 'xsd:string',  minCount: 1, maxCount: 1 },
    { path: 'schema://status',     name: 'status',    datatype: 'xsd:string',  minCount: 1, maxCount: 1 },
    { path: 'schema://agent',      name: 'assignees', datatype: 'URI',         minCount: 0 },
  ],
  constructor: [
    { action: 'shape://actions/setSingleTarget' as const, subject: 'this', predicate: 'rdf://type',      object: 'https://schema.org/Action' },
    { action: 'shape://actions/setSingleTarget' as const, subject: 'this', predicate: 'schema://name',   object: 'title' },
    { action: 'shape://actions/setSingleTarget' as const, subject: 'this', predicate: 'schema://status', object: 'status' },
  ],
};

let storage: GraphStorage;
let identity: IdentityProvider;
let graph: Graph;

beforeEach(async () => {
  storage = new GraphStorage(`test-${crypto.randomUUID()}`);
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  identity = eph;
  graph = new Graph('did:graph:test-shape-ctx', 'Test', identity, storage);
});

describe('Shape registration', () => {
  it('registers a shape and stores it as content-addressed triples', async () => {
    await graph.addShape('Task', JSON.stringify(TASK_SHAPE));
    const links = await graph.queryTriples({
      subject: graph.did,
      predicate: SHAPE_PREDICATE,
    });
    expect(links).toHaveLength(1);
    expect(links[0].data.object).toBe(contentAddress(JSON.stringify(TASK_SHAPE)));
  });

  it('rejects re-registering the same shape name', async () => {
    await graph.addShape('Task', JSON.stringify(TASK_SHAPE));
    await expect(graph.addShape('Task', JSON.stringify(TASK_SHAPE))).rejects.toThrow(/already exists/);
  });

  it('removeShape removes the shape link from the graph', async () => {
    await graph.addShape('Task', JSON.stringify(TASK_SHAPE));
    await graph.removeShape('Task');
    const links = await graph.queryTriples({
      predicate: SHAPE_PREDICATE,
    });
    expect(links).toHaveLength(0);
  });

  it('getShapes returns registered shapes', async () => {
    await graph.addShape('Task', JSON.stringify(TASK_SHAPE));
    const shapes = await graph.getShapes();
    expect(shapes.find(s => s.name === 'Task')).toBeDefined();
  });
});

describe('Shape instances', () => {
  beforeEach(async () => {
    await graph.addShape('Task', JSON.stringify(TASK_SHAPE));
  });

  it('createShapeInstance writes constructor triples', async () => {
    const uri = await graph.createShapeInstance('Task', 'task:1', {
      title: 'Write spec',
      status: 'InProgress',
    });
    expect(uri).toBe('task:1');
    const triples = await graph.queryTriples({ subject: 'task:1' });
    expect(triples.find(t => t.data.predicate === 'rdf://type')?.data.object).toBe('https://schema.org/Action');
    expect(triples.find(t => t.data.predicate === 'schema://name')?.data.object).toBe('Write spec');
    expect(triples.find(t => t.data.predicate === 'schema://status')?.data.object).toBe('InProgress');
  });

  it('rejects when a required property is missing', async () => {
    await expect(
      graph.createShapeInstance('Task', 'task:bad', { title: 'Without status' }),
    ).rejects.toThrow(/Required property "status"/);
  });

  it('getShapeInstances finds instances by type discriminator', async () => {
    await graph.createShapeInstance('Task', 'task:1', { title: 'A', status: 'X' });
    await graph.createShapeInstance('Task', 'task:2', { title: 'B', status: 'Y' });
    const instances = await graph.getShapeInstances('Task');
    expect(instances.sort()).toEqual(['task:1', 'task:2']);
  });

  it('getShapeInstanceData returns scalar + collection properties', async () => {
    await graph.createShapeInstance('Task', 'task:1', { title: 'A', status: 'X' });
    await graph.addToShapeCollection('Task', 'task:1', 'assignees', 'did:key:z6MkAlice');
    await graph.addToShapeCollection('Task', 'task:1', 'assignees', 'did:key:z6MkBob');
    const data = await graph.getShapeInstanceData('Task', 'task:1');
    expect(data.title).toBe('A');
    expect(data.status).toBe('X');
    expect(data.assignees).toEqual(expect.arrayContaining(['did:key:z6MkAlice', 'did:key:z6MkBob']));
  });

  it('setShapeProperty replaces a scalar value', async () => {
    await graph.createShapeInstance('Task', 'task:1', { title: 'A', status: 'X' });
    await graph.setShapeProperty('Task', 'task:1', 'status', 'Done');
    const data = await graph.getShapeInstanceData('Task', 'task:1');
    expect(data.status).toBe('Done');
  });

  it('addToShapeCollection rejects when called on a scalar property', async () => {
    await graph.createShapeInstance('Task', 'task:1', { title: 'A', status: 'X' });
    await expect(
      graph.addToShapeCollection('Task', 'task:1', 'title', 'B'),
    ).rejects.toThrow(/scalar/);
  });

  it('removeFromShapeCollection removes the value', async () => {
    await graph.createShapeInstance('Task', 'task:1', { title: 'A', status: 'X' });
    await graph.addToShapeCollection('Task', 'task:1', 'assignees', 'did:key:z6MkAlice');
    await graph.addToShapeCollection('Task', 'task:1', 'assignees', 'did:key:z6MkBob');
    await graph.removeFromShapeCollection('Task', 'task:1', 'assignees', 'did:key:z6MkBob');
    const data = await graph.getShapeInstanceData('Task', 'task:1');
    expect(data.assignees).toEqual(['did:key:z6MkAlice']);
  });
});

describe('Shape validation', () => {
  it('rejects malformed JSON', async () => {
    await expect(graph.addShape('Bad', '{ invalid }')).rejects.toThrow(/Invalid JSON/);
  });

  it('rejects shape without targetClass', async () => {
    await expect(graph.addShape('Bad', JSON.stringify({ properties: [], constructor: [] }))).rejects.toThrow(/targetClass/);
  });

  it('rejects legacy short action name like "addLink"', async () => {
    const badShape = {
      ...TASK_SHAPE,
      constructor: [{ action: 'addLink', subject: 'this', predicate: 'x', object: 'y' }],
    };
    await expect(graph.addShape('Legacy', JSON.stringify(badShape))).rejects.toThrow(/shape:\/\/actions/);
  });
});
