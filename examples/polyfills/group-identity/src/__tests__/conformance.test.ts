/**
 * Group Identity (Spec 10) — conformance tests.
 *
 * A Group IS a Context (a did:graph context); the group surface adds:
 *   – Participation (context://accepts_participation)
 *   – Signers (DID-document delegates)
 *   – Nested groups (parent/child via participates_in)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  GraphStorage,
  GraphStoreManager,
  EphemeralIdentity,
  type GraphStore,
} from '@living-web/personal-graph';

import { Group } from '../group.js';
import { installGroupExtension, DefaultGroupRegistry } from '../extension.js';
import { GROUP, CONTEXT, RDF } from '../types.js';

beforeAll(() => {
  installGroupExtension();
});

async function newGraphStore(): Promise<GraphStore> {
  const eph = new EphemeralIdentity();
  await eph.ensureReady();
  const storage = new GraphStorage(`gi-${crypto.randomUUID()}`);
  const manager = new GraphStoreManager(storage, async () => eph);
  return manager.create('ws');
}

describe('§4 Group creation', () => {
  it('mints a did:graph for the group', async () => {
    const gs = await newGraphStore();
    const g = await gs.createGroup({ name: 'Test' });
    expect(g.did).toMatch(/^did:graph:/);
  });

  it('exposes the underlying Context', async () => {
    const gs = await newGraphStore();
    const g = await gs.createGroup({ name: 'Test' });
    expect(g.context.did).toBe(g.did);
  });

  it('writes group identity triples (rdf:type, group://created, group://creator)', async () => {
    const gs = await newGraphStore();
    const g = await gs.createGroup({ name: 'Test' });

    const typeT = await g.context.queryTriples({
      subject: g.did,
      predicate: RDF.TYPE,
      object: GROUP.TYPE,
    });
    expect(typeT.length).toBeGreaterThanOrEqual(1);

    const createdT = await g.context.queryTriples({ subject: g.did, predicate: GROUP.CREATED });
    expect(createdT.length).toBeGreaterThanOrEqual(1);

    const creatorT = await g.context.queryTriples({ subject: g.did, predicate: GROUP.CREATOR });
    expect(creatorT.length).toBeGreaterThanOrEqual(1);
    expect(creatorT[0].data.object).toBe(gs.agentDid);
  });

  it('stores optional name and description', async () => {
    const gs = await newGraphStore();
    const g = await gs.createGroup({ name: 'My Group', description: 'A test group' });
    expect(g.name).toBe('My Group');
    expect(g.description).toBe('A test group');

    const nameT = await g.context.queryTriples({ subject: g.did, predicate: RDF.NAME });
    expect(nameT.length).toBeGreaterThanOrEqual(1);
    expect(nameT[0].data.object.replace(/^"|"$/g, '')).toBe('My Group');
  });

  it('two groups have different DIDs', async () => {
    const gs = await newGraphStore();
    const g1 = await gs.createGroup({ name: 'G1' });
    const g2 = await gs.createGroup({ name: 'G2' });
    expect(g1.did).not.toBe(g2.did);
  });
});

describe('§5 Participation', () => {
  let gs: GraphStore;
  let group: Group;

  beforeEach(async () => {
    gs = await newGraphStore();
    group = await gs.createGroup({ name: 'Team' });
  });

  it('invite() writes accepts_participation', async () => {
    await group.invite('did:key:zMember1');
    const t = await group.context.queryTriples({
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
    const gs = await newGraphStore();
    const parent = await gs.createGroup({ name: 'Parent' });
    const child = await gs.createGroup({ name: 'Child', participatesIn: parent.did });

    // child.createContext should have written participates_in.
    const t = await child.context.queryTriples({
      subject: child.did,
      predicate: CONTEXT.PARTICIPATES_IN,
      object: parent.did,
    });
    expect(t.length).toBe(1);
  });

  it('transitiveParticipants flattens nested groups', async () => {
    const gs = await newGraphStore();
    const parent = await gs.createGroup({ name: 'Parent' });
    const child = await gs.createGroup({ name: 'Child' });

    await parent.invite(child.did);
    await child.invite('did:key:zLeaf');

    const flat = await parent.transitiveParticipants();
    expect(flat.map(p => p.did)).toContain('did:key:zLeaf');
  });
});

describe('GraphStore extension', () => {
  it('listGroups() reflects createGroup()', async () => {
    const gs = await newGraphStore();
    const g1 = await gs.createGroup({ name: 'A' });
    const g2 = await gs.createGroup({ name: 'B' });
    const list = await gs.listGroups();
    expect(list.map(g => g.did).sort()).toEqual([g1.did, g2.did].sort());
  });

  it('openGroup() returns the registered instance', async () => {
    const gs = await newGraphStore();
    const g = await gs.createGroup({ name: 'A' });
    const opened = await gs.openGroup(g.did);
    expect(opened.did).toBe(g.did);
  });
});

describe('DefaultGroupRegistry', () => {
  it('register + resolve round-trip a group', async () => {
    const gs = await newGraphStore();
    const g = await gs.createGroup({ name: 'X' });
    const r = new DefaultGroupRegistry();
    r.register(g);
    expect(r.resolve(g.did)).toBe(g);
    expect(await r.isGroupDid(g.did)).toBe(true);
    expect(r.list().length).toBe(1);
  });
});
