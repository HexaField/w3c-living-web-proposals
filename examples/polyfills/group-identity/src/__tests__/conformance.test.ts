/**
 * Group Identity (Spec 10) — conformance tests.
 *
 * A Group IS a Graph (a did:graph graph); the group surface adds:
 *   – Participation (context://accepts_participation)
 *   – Signers (DID-document delegates)
 *   – Nested groups (parent/child via participates_in)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  GraphStorage,
  GraphManager,
  EphemeralIdentity,
  type IdentityProvider,
} from '@living-web/personal-graph';

import { Group } from '../group.js';
import { installGroupExtension, DefaultGroupRegistry } from '../extension.js';
import { GROUP, CONTEXT, RDF } from '../types.js';
import { installCredentialAugmentation } from '../credential.js';
import { installDIDGraphBinding } from '../binding.js';

// The binding's resolver/writer hooks read graphs via a closure. Each test
// installs a fresh manager and points the binding at it.
let currentManager: GraphManager | null = null;
let currentAgent: IdentityProvider | null = null;

beforeAll(() => {
  installGroupExtension();
  installCredentialAugmentation();
  installDIDGraphBinding({
    *knownGraphs() {
      if (!currentManager) return;
      yield* currentManager.knownGraphs();
    },
    fullManager: () => currentManager,
  });
});

async function newManager(): Promise<GraphManager> {
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  const storage = new GraphStorage(`gi-${crypto.randomUUID()}`);
  const manager = new GraphManager(storage, async () => eph);
  currentManager = manager;
  currentAgent = eph;
  return manager;
}

describe('§4 Group creation', () => {
  it('mints a did:graph for the group', async () => {
    const m = await newManager();
    const g = await m.createGroup({ name: 'Test' });
    expect(g.did).toMatch(/^did:graph:/);
  });

  it('exposes the underlying Graph', async () => {
    const m = await newManager();
    const g = await m.createGroup({ name: 'Test' });
    expect(g.graph.did).toBe(g.did);
  });

  it('writes group identity triples (rdf:type, group://created, group://creator)', async () => {
    const m = await newManager();
    const g = await m.createGroup({ name: 'Test' });

    const typeT = await g.graph.queryTriples({
      subject: g.did,
      predicate: RDF.TYPE,
      object: GROUP.TYPE,
    });
    expect(typeT.length).toBeGreaterThanOrEqual(1);

    const createdT = await g.graph.queryTriples({ subject: g.did, predicate: GROUP.CREATED });
    expect(createdT.length).toBeGreaterThanOrEqual(1);

    const creatorT = await g.graph.queryTriples({ subject: g.did, predicate: GROUP.CREATOR });
    expect(creatorT.length).toBeGreaterThanOrEqual(1);
    expect(creatorT[0].data.object).toBe(currentAgent!.getDID());
  });

  it('stores optional name and description', async () => {
    const m = await newManager();
    const g = await m.createGroup({ name: 'My Group', description: 'A test group' });
    expect(g.name).toBe('My Group');
    expect(g.description).toBe('A test group');

    const nameT = await g.graph.queryTriples({ subject: g.did, predicate: RDF.NAME });
    expect(nameT.length).toBeGreaterThanOrEqual(1);
    expect(nameT[0].data.object.replace(/^"|"$/g, '')).toBe('My Group');
  });

  it('two groups have different DIDs', async () => {
    const m = await newManager();
    const g1 = await m.createGroup({ name: 'G1' });
    const g2 = await m.createGroup({ name: 'G2' });
    expect(g1.did).not.toBe(g2.did);
  });
});

describe('§5 Participation', () => {
  let manager: GraphManager;
  let group: Group;

  beforeEach(async () => {
    manager = await newManager();
    group = await manager.createGroup({ name: 'Team' });
  });

  it('invite() writes accepts_participation', async () => {
    await group.invite('did:key:zMember1');
    const t = await group.graph.queryTriples({
      subject: group.did,
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
      object: 'did:key:zMember1',
    });
    expect(t.length).toBe(1);
  });

  it('participants() reflects invitations', async () => {
    await group.invite('did:key:zA');
    await group.invite('did:key:zB');
    const parts = await group.participants();
    expect(parts.map(p => p.did).sort()).toEqual(['did:key:zA', 'did:key:zB']);
  });

  it('revokeParticipation() removes the triple', async () => {
    await group.invite('did:key:zA');
    await group.revokeParticipation('did:key:zA');
    expect(await group.hasParticipant('did:key:zA')).toBe(false);
  });

  it('hasParticipant() returns true after invitation', async () => {
    await group.invite('did:key:zA');
    expect(await group.hasParticipant('did:key:zA')).toBe(true);
    expect(await group.hasParticipant('did:key:zMissing')).toBe(false);
  });
});

describe('§5.5 Nested groups (participation chains)', () => {
  it('a group can participate_in another group', async () => {
    const m = await newManager();
    const parent = await m.createGroup({ name: 'Parent' });
    const child = await m.createGroup({ name: 'Child', participatesIn: parent.did });

    // The child writes participates_in with the child's STABLE
    // identifier (its did:graph, since groupified) as subject — the link
    // must outlive snapshots, so the volatile IRI can't be the subject.
    const t = await child.graph.queryTriples({
      subject: child.did,
      predicate: CONTEXT.PARTICIPATES_IN,
      object: parent.did,
    });
    expect(t.length).toBe(1);
  });

  it('transitiveParticipants flattens nested groups', async () => {
    const m = await newManager();
    const parent = await m.createGroup({ name: 'Parent' });
    const child = await m.createGroup({ name: 'Child' });

    await parent.invite(child.did);
    await child.invite('did:key:zLeaf');

    const flat = await parent.transitiveParticipants();
    expect(flat.map(p => p.did)).toContain('did:key:zLeaf');
  });
});

describe('GraphManager extension', () => {
  it('listGroups() reflects createGroup()', async () => {
    const m = await newManager();
    const g1 = await m.createGroup({ name: 'A' });
    const g2 = await m.createGroup({ name: 'B' });
    const list = await m.listGroups();
    expect(list.map(g => g.did).sort()).toEqual([g1.did, g2.did].sort());
  });

  it('openGroup() returns the registered instance', async () => {
    const m = await newManager();
    const g = await m.createGroup({ name: 'A' });
    const opened = await m.openGroup(g.did);
    expect(opened.did).toBe(g.did);
  });
});

describe('DefaultGroupRegistry', () => {
  it('register + resolve round-trip a group', async () => {
    const m = await newManager();
    const g = await m.createGroup({ name: 'X' });
    const r = new DefaultGroupRegistry();
    r.register(g);
    expect(r.resolve(g.did)).toBe(g);
    expect(await r.isGroupDid(g.did)).toBe(true);
    expect(r.list().length).toBe(1);
  });
});
