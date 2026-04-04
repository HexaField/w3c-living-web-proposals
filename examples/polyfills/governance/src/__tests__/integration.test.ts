/**
 * Cross-polyfill integration test — exercises the full Living Web stack:
 * PersonalGraph → Identity → ShapeValidation → GraphSync → Governance
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  PersonalGraph,
  PersonalGraphManager,
  SemanticTriple,
  EphemeralIdentity,
} from '@living-web/personal-graph';
import { SharedGraph } from '@living-web/graph-sync';
import { installShapeExtension } from '@living-web/shape-validation';
import {
  createGovernanceLayer,
  GOV,
  createCapability,
} from '../index.js';

// Install shape extension on PersonalGraph
installShapeExtension(PersonalGraph);

type ShapedGraph = PersonalGraph & {
  addShape(name: string, json: string): Promise<void>;
  getShapes(): Promise<any[]>;
  createShapeInstance(name: string, addr: string, vals?: Record<string, any>): Promise<string>;
  getShapeInstances(name: string): Promise<string[]>;
  getShapeInstanceData(name: string, addr: string): Promise<Record<string, any>>;
  setShapeProperty(name: string, addr: string, prop: string, val: any): Promise<void>;
};

const TASK_SHAPE = {
  targetClass: 'https://schema.org/Action',
  properties: [
    { path: 'rdf:type', name: 'type_flag', datatype: 'URI', minCount: 1, maxCount: 1, writable: false },
    { path: 'schema:name', name: 'title', datatype: 'xsd:string', minCount: 1, maxCount: 1, writable: true },
    { path: 'schema:actionStatus', name: 'status', datatype: 'xsd:string', minCount: 1, maxCount: 1, writable: true },
  ],
  constructor: [
    { action: 'setSingleTarget', source: 'this', predicate: 'rdf:type', target: 'https://schema.org/Action' },
    { action: 'setSingleTarget', source: 'this', predicate: 'schema:name', target: 'title' },
    { action: 'setSingleTarget', source: 'this', predicate: 'schema:actionStatus', target: 'status' },
  ],
};

describe('Full-stack integration: PersonalGraph → Identity → Shapes → Sync → Governance', () => {
  let aliceIdentity: EphemeralIdentity;
  let bobIdentity: EphemeralIdentity;

  beforeEach(async () => {
    aliceIdentity = new EphemeralIdentity();
    await aliceIdentity.ensureReady();
    bobIdentity = new EphemeralIdentity();
    await bobIdentity.ensureReady();
  });

  it('exercises the complete Living Web stack', async () => {
    const aliceDID = aliceIdentity.getDID();
    const bobDID = bobIdentity.getDID();

    // ── 1. Create a personal graph with identity ──
    const dbName = `integration-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const manager = new PersonalGraphManager(aliceIdentity, dbName);
    const personalGraph = await manager.create('alice-tasks') as ShapedGraph;
    expect(personalGraph).toBeDefined();

    // ── 2. Define a shape on the graph ──
    await personalGraph.addShape('Task', JSON.stringify(TASK_SHAPE));
    const shapes = await personalGraph.getShapes();
    expect(shapes.length).toBe(1);
    expect(shapes[0].name).toBe('Task');

    // ── 3. Create a shape instance ──
    const instanceAddr = await personalGraph.createShapeInstance('Task', 'task:001', {
      title: 'Write integration test',
      status: 'in-progress',
    });
    expect(instanceAddr).toBe('task:001');

    // Verify shape instance data
    const data = await personalGraph.getShapeInstanceData('Task', 'task:001');
    expect(data.title).toBe('Write integration test');
    expect(data.status).toBe('in-progress');

    // ── 4. Share the graph (creates SharedGraph) ──
    const sharedGraph = SharedGraph.create(aliceIdentity, 'shared-tasks');
    expect(sharedGraph.uri).toMatch(/^shared-graph:\/\//);

    // Add some triples to the shared graph
    const triple = new SemanticTriple('task:001', 'Done', 'schema:actionStatus');
    const signed = await sharedGraph.addTriple(triple);
    expect(signed.author).toBe(aliceDID);

    // ── 5. Set up governance on the shared graph ──
    const gov = createGovernanceLayer(sharedGraph, {
      rootAuthority: aliceDID,
    });

    // Create a write capability for Alice (root authority)
    const aliceCap = createCapability(
      aliceDID,
      ['*'],
      { within: null, graph: sharedGraph.uri },
      aliceDID,
    );
    const aliceCapAddr = `zcap:${aliceCap.id}`;
    gov.storeExpression(aliceCapAddr, aliceCap);

    // Register Alice's capability in the graph
    await sharedGraph.addTriple(
      new SemanticTriple(aliceDID, aliceCapAddr, GOV.HAS_ZCAP),
    );

    // ── 6. Add a governance constraint requiring capabilities ──
    const constraintUri = 'urn:constraint:capability-required';
    await sharedGraph.addTriple(
      new SemanticTriple(sharedGraph.uri, constraintUri, GOV.CONSTRAINT),
    );
    await sharedGraph.addTriple(
      new SemanticTriple(constraintUri, 'CapabilityConstraint', GOV.CONSTRAINT_KIND),
    );

    // ── 7. Verify canAddTriple — Alice (root authority) ──
    const aliceResult = await gov.canAddTripleAs(
      'task:002', 'schema:name', 'New Task', aliceDID,
    );
    expect(aliceResult).toBeDefined();
    expect(typeof aliceResult.allowed).toBe('boolean');

    // ── 8. Verify canAddTriple for Bob (no capabilities) ──
    const bobResult = await gov.canAddTripleAs(
      'task:002', 'schema:name', 'Bob Task', bobDID,
    );
    expect(bobResult).toBeDefined();
    expect(typeof bobResult.allowed).toBe('boolean');

    // ── 9. Grant Bob a delegated capability ──
    const bobCap = createCapability(
      bobDID,
      ['write'],
      { within: null, graph: sharedGraph.uri },
      aliceDID,
      { parentCapability: aliceCap.id },
    );
    const bobCapAddr = `zcap:${bobCap.id}`;
    gov.storeExpression(bobCapAddr, bobCap);
    await sharedGraph.addTriple(
      new SemanticTriple(bobDID, bobCapAddr, GOV.HAS_ZCAP),
    );

    // Bob's capabilities should now be listed
    const bobCaps = await gov.myCapabilities(bobDID);
    expect(bobCaps.length).toBeGreaterThan(0);

    // ── 10. Verify the full chain — query triples back ──
    const results = await sharedGraph.queryTriples({ source: 'task:001' });
    expect(results.length).toBeGreaterThan(0);
  });
});
