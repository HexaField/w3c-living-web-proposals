/**
 * Group Identity (Spec 06) — Conformance Tests
 *
 * Tests every MUST/SHOULD assertion from the spec.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SharedGraph } from '@living-web/graph-sync';
import { SemanticTriple, EphemeralIdentity } from '@living-web/personal-graph';
import { Group } from '../group.js';
import { GroupManager, DefaultGroupRegistry } from '../polyfill.js';
import { GROUP, RDF } from '../types.js';
import type { Member } from '../types.js';

async function makeIdentity(): Promise<EphemeralIdentity> {
  const id = new EphemeralIdentity();
  await id.ensureReady();
  return id;
}

describe('Spec 06 — Decentralised Group Identity', () => {
  let aliceId: EphemeralIdentity;
  let bobId: EphemeralIdentity;
  let charlieId: EphemeralIdentity;

  beforeEach(async () => {
    aliceId = await makeIdentity();
    bobId = await makeIdentity();
    charlieId = await makeIdentity();
  });

  // ─── §4 / §5.3.1 / §6.1 Group Creation ─────────────────────────

  describe('Group creation (§4.1, §5.3.1, §6.1)', () => {
    it('MUST generate a new DID for the group', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      expect(group.did).toMatch(/^did:group:/);
    });

    it('MUST create an associated shared graph', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      expect(group.graph).toBeDefined();
      expect(group.graph).toBeInstanceOf(SharedGraph);
    });

    it('MUST add the creator as the first member', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const members = await group.members();
      expect(members).toHaveLength(1);
      expect(members[0].did).toBe(aliceId.getDID());
    });

    it('MUST add group identity triples (rdf:type, group://created, group://creator)', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });

      const typeTriples = await group.graph.queryTriples({
        source: group.did,
        predicate: RDF.TYPE,
        target: GROUP.TYPE,
      });
      expect(typeTriples.length).toBeGreaterThanOrEqual(1);

      const createdTriples = await group.graph.queryTriples({
        source: group.did,
        predicate: GROUP.CREATED,
      });
      expect(createdTriples.length).toBeGreaterThanOrEqual(1);

      const creatorTriples = await group.graph.queryTriples({
        source: group.did,
        predicate: GROUP.CREATOR,
      });
      expect(creatorTriples.length).toBeGreaterThanOrEqual(1);
      expect(creatorTriples[0].data.target).toBe(aliceId.getDID());
    });

    it('MUST store optional name and description', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'My Group', description: 'A test group' });
      expect(group.name).toBe('My Group');
      expect(group.description).toBe('A test group');

      const nameTriples = await group.graph.queryTriples({
        source: group.did,
        predicate: RDF.NAME,
      });
      expect(nameTriples.length).toBeGreaterThanOrEqual(1);
      expect(nameTriples[0].data.target).toBe('My Group');
    });

    it('two groups MUST have different DIDs', async () => {
      const mgr = new GroupManager(aliceId);
      const g1 = await mgr.createGroup({ name: 'G1' });
      const g2 = await mgr.createGroup({ name: 'G2' });
      expect(g1.did).not.toBe(g2.did);
    });

    it('MUST set created timestamp', async () => {
      const before = Date.now();
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const after = Date.now();
      expect(group.created).toBeGreaterThanOrEqual(before);
      expect(group.created).toBeLessThanOrEqual(after);
    });
  });

  // ─── §5.1.2–5.1.5 Membership CRUD ───────────────────────────────

  describe('Membership CRUD (§5.1.2–5.1.5)', () => {
    it('addMember() MUST add a group://has_member triple', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await group.addMember(bobId.getDID());

      const triples = await group.graph.queryTriples({
        source: group.did,
        predicate: GROUP.HAS_MEMBER,
        target: bobId.getDID(),
      });
      expect(triples.length).toBe(1);
    });

    it('removeMember() MUST remove the membership triple', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await group.addMember(bobId.getDID());
      await group.removeMember(bobId.getDID());

      const isMember = await group.isMember(bobId.getDID());
      expect(isMember).toBe(false);
    });

    it('members() MUST return all current members', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await group.addMember(bobId.getDID());
      await group.addMember(charlieId.getDID());

      const members = await group.members();
      const dids = members.map(m => m.did);
      expect(dids).toContain(aliceId.getDID());
      expect(dids).toContain(bobId.getDID());
      expect(dids).toContain(charlieId.getDID());
      expect(members).toHaveLength(3);
    });

    it('isMember() MUST return true for members', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      expect(await group.isMember(aliceId.getDID())).toBe(true);
    });

    it('isMember() MUST return false for non-members', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      expect(await group.isMember(bobId.getDID())).toBe(false);
    });

    it('members MUST be identifiable as individual or group (isGroup field)', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const members = await group.members();
      expect(members[0]).toHaveProperty('isGroup');
      expect(typeof members[0].isGroup).toBe('boolean');
    });

    it('addMember() SHOULD be idempotent', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await group.addMember(bobId.getDID());
      await group.addMember(bobId.getDID()); // second add

      const members = await group.members();
      const bobMembers = members.filter(m => m.did === bobId.getDID());
      expect(bobMembers).toHaveLength(1);
    });

    it('removeMember() on non-member SHOULD not throw', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await expect(group.removeMember(bobId.getDID())).resolves.toBeUndefined();
    });

    it('removing all members leaves group with zero members (valid state)', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await group.removeMember(aliceId.getDID());

      const members = await group.members();
      expect(members).toHaveLength(0);
    });

    it('members() MUST return only direct members, not transitive', async () => {
      const mgr = new GroupManager(aliceId);
      const parent = await mgr.createGroup({ name: 'Parent' });
      const child = await mgr.createGroup({ name: 'Child' });
      await child.addMember(bobId.getDID());
      await parent.addMember(child.did);

      const directMembers = await parent.members();
      const dids = directMembers.map(m => m.did);
      expect(dids).not.toContain(bobId.getDID());
    });
  });

  // ─── §8 Isomorphism ─────────────────────────────────────────────

  describe('Isomorphism (§8)', () => {
    it('a group of one MUST be structurally identical to a group of many', async () => {
      const mgr = new GroupManager(aliceId);
      const solo = await mgr.createGroup({ name: 'Solo' });
      const multi = await mgr.createGroup({ name: 'Multi' });
      await multi.addMember(bobId.getDID());

      // Both have same API
      expect(typeof solo.members).toBe('function');
      expect(typeof multi.members).toBe('function');
      expect(typeof solo.addMember).toBe('function');
      expect(typeof multi.addMember).toBe('function');
      expect(typeof solo.isMember).toBe('function');
      expect(typeof multi.isMember).toBe('function');
      expect(typeof solo.transitiveMembers).toBe('function');
      expect(typeof multi.transitiveMembers).toBe('function');
    });

    it('all operations MUST work identically regardless of membership count', async () => {
      const mgr = new GroupManager(aliceId);
      const solo = await mgr.createGroup({ name: 'Solo' });
      const multi = await mgr.createGroup({ name: 'Multi' });
      await multi.addMember(bobId.getDID());
      await multi.addMember(charlieId.getDID());

      // isMember works for both
      expect(await solo.isMember(aliceId.getDID())).toBe(true);
      expect(await multi.isMember(aliceId.getDID())).toBe(true);

      // members() returns Member[] for both
      const soloMembers = await solo.members();
      const multiMembers = await multi.members();
      expect(soloMembers[0]).toHaveProperty('did');
      expect(soloMembers[0]).toHaveProperty('isGroup');
      expect(multiMembers[0]).toHaveProperty('did');
      expect(multiMembers[0]).toHaveProperty('isGroup');
    });

    it('the API MUST NOT distinguish between groups of one and groups of many', async () => {
      const mgr = new GroupManager(aliceId);
      const solo = await mgr.createGroup({ name: 'Solo' });
      const multi = await mgr.createGroup({ name: 'Multi' });

      // Same constructor, same class
      expect(solo.constructor).toBe(multi.constructor);
      expect(solo).toBeInstanceOf(Group);
      expect(multi).toBeInstanceOf(Group);
    });
  });

  // ─── §4.5 / §5.1.6–5.1.8 Holonic Nesting ───────────────────────

  describe('Holonic nesting (§4.5, §5.1.6–5.1.8)', () => {
    it('addMember() MUST accept group DIDs as members', async () => {
      const mgr = new GroupManager(aliceId);
      const org = await mgr.createGroup({ name: 'Org' });
      const team = await mgr.createGroup({ name: 'Team' });

      await org.addMember(team.did);
      expect(await org.isMember(team.did)).toBe(true);
    });

    it('group members MUST have isGroup=true', async () => {
      const mgr = new GroupManager(aliceId);
      const org = await mgr.createGroup({ name: 'Org' });
      const team = await mgr.createGroup({ name: 'Team' });

      await org.addMember(team.did);
      const members = await org.members();
      const teamMember = members.find(m => m.did === team.did);
      expect(teamMember?.isGroup).toBe(true);
    });

    it('parentGroups() MUST return groups this group belongs to', async () => {
      const mgr = new GroupManager(aliceId);
      const org = await mgr.createGroup({ name: 'Org' });
      const team = await mgr.createGroup({ name: 'Team' });
      await org.addMember(team.did);

      const parents = await team.parentGroups();
      expect(parents.map(p => p.did)).toContain(org.did);
    });

    it('childGroups() MUST return groups that are members of this group', async () => {
      const mgr = new GroupManager(aliceId);
      const org = await mgr.createGroup({ name: 'Org' });
      const teamA = await mgr.createGroup({ name: 'Team A' });
      const teamB = await mgr.createGroup({ name: 'Team B' });
      await org.addMember(teamA.did);
      await org.addMember(teamB.did);

      const children = await org.childGroups();
      const childDids = children.map(c => c.did);
      expect(childDids).toContain(teamA.did);
      expect(childDids).toContain(teamB.did);
    });

    it('transitiveMembers() MUST recursively resolve through child groups', async () => {
      const mgr = new GroupManager(aliceId);
      const org = await mgr.createGroup({ name: 'Org' });
      const team = await mgr.createGroup({ name: 'Team' });
      await team.addMember(bobId.getDID());
      await org.addMember(team.did);

      const transitive = await org.transitiveMembers();
      const dids = transitive.map(m => m.did);
      // Should include alice (member of org and team) and bob (member of team)
      expect(dids).toContain(aliceId.getDID());
      expect(dids).toContain(bobId.getDID());
    });

    it('transitiveMembers() MUST not include group DIDs, only individuals', async () => {
      const mgr = new GroupManager(aliceId);
      const org = await mgr.createGroup({ name: 'Org' });
      const team = await mgr.createGroup({ name: 'Team' });
      await org.addMember(team.did);

      const transitive = await org.transitiveMembers();
      const dids = transitive.map(m => m.did);
      expect(dids).not.toContain(team.did);
    });

    it('transitiveMembers() MUST detect cycles and terminate', async () => {
      const registry = new DefaultGroupRegistry();
      const mgr = new GroupManager(aliceId, registry);
      const groupA = await mgr.createGroup({ name: 'A' });
      const groupB = await mgr.createGroup({ name: 'B' });

      // Create cycle: A contains B, B contains A
      await groupA.addMember(groupB.did);
      await groupB.addMember(groupA.did);

      // Should not hang — cycle detection
      const transitive = await groupA.transitiveMembers();
      expect(Array.isArray(transitive)).toBe(true);
    });

    it('nesting depth SHOULD be limited to prevent resource exhaustion', async () => {
      const registry = new DefaultGroupRegistry();
      const mgr = new GroupManager(aliceId, registry);

      // Create chain of 20 nested groups (beyond default max of 16)
      let current = await mgr.createGroup({ name: 'Level-0' });
      for (let i = 1; i <= 20; i++) {
        const next = await mgr.createGroup({ name: `Level-${i}` });
        await current.addMember(next.did);
        current = next;
      }
      // Add a real member at the deepest level
      await current.addMember(bobId.getDID());

      // Should complete without hanging (depth limit kicks in)
      const groups = registry.list();
      const root = groups.find(g => g.name === 'Level-0')!;
      const transitive = await root.transitiveMembers();
      expect(Array.isArray(transitive)).toBe(true);
    });

    it('multi-level nesting resolves transitive members correctly', async () => {
      const registry = new DefaultGroupRegistry();
      const mgr = new GroupManager(aliceId, registry);

      const company = await mgr.createGroup({ name: 'Company' });
      const dept = await mgr.createGroup({ name: 'Department' });
      const team = await mgr.createGroup({ name: 'Team' });

      await team.addMember(bobId.getDID());
      await team.addMember(charlieId.getDID());
      await dept.addMember(team.did);
      await company.addMember(dept.did);

      const transitive = await company.transitiveMembers();
      const dids = transitive.map(m => m.did);
      expect(dids).toContain(aliceId.getDID()); // creator of all groups, member of company
      expect(dids).toContain(bobId.getDID());
      expect(dids).toContain(charlieId.getDID());
    });
  });

  // ─── §4.3 Identity Persistence ──────────────────────────────────

  describe('Identity persistence (§4.3)', () => {
    it('group DID MUST persist across membership changes', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const originalDid = group.did;

      await group.addMember(bobId.getDID());
      expect(group.did).toBe(originalDid);

      await group.removeMember(bobId.getDID());
      expect(group.did).toBe(originalDid);
    });

    it('removing all members except one MUST NOT change the group DID', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const originalDid = group.did;

      await group.addMember(bobId.getDID());
      await group.addMember(charlieId.getDID());
      await group.removeMember(bobId.getDID());
      await group.removeMember(charlieId.getDID());

      expect(group.did).toBe(originalDid);
    });

    it('adding/removing members MUST NOT change the group DID', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const originalDid = group.did;

      for (let i = 0; i < 5; i++) {
        const id = await makeIdentity();
        await group.addMember(id.getDID());
      }
      const members = await group.members();
      for (const m of members) {
        if (m.did !== aliceId.getDID()) {
          await group.removeMember(m.did);
        }
      }

      expect(group.did).toBe(originalDid);
    });

    it('group with zero members retains its DID', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const originalDid = group.did;

      await group.removeMember(aliceId.getDID());
      expect(group.did).toBe(originalDid);
      expect((await group.members())).toHaveLength(0);
    });
  });

  // ─── §7 Governance Delegation ───────────────────────────────────

  describe('Governance delegation (§7, §5.1.9)', () => {
    it('delegateCapability() MUST create a ZCAP in the graph', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      await group.addMember(bobId.getDID());

      await group.delegateCapability(bobId.getDID(), 'manage_members', group.did);

      const zcapTriples = await group.graph.queryTriples({
        predicate: 'gov://zcap_document',
      });
      expect(zcapTriples.length).toBeGreaterThanOrEqual(1);

      // Parse the stored ZCAP
      const zcap = JSON.parse(zcapTriples[0].data.target);
      expect(zcap.invoker).toBe(bobId.getDID());
      expect(zcap.capability.predicates).toContain('manage_members');
    });

    it('delegateCapability() to a group DID MUST be stored', async () => {
      const registry = new DefaultGroupRegistry();
      const mgr = new GroupManager(aliceId, registry);
      const parent = await mgr.createGroup({ name: 'Parent' });
      const child = await mgr.createGroup({ name: 'Child' });
      await parent.addMember(child.did);

      await parent.delegateCapability(child.did, 'manage_members', parent.did);

      const zcapTriples = await parent.graph.queryTriples({
        predicate: 'gov://zcap_document',
      });
      expect(zcapTriples.length).toBeGreaterThanOrEqual(1);
      const zcap = JSON.parse(zcapTriples[0].data.target);
      expect(zcap.invoker).toBe(child.did);
    });
  });

  // ─── §5.1.10 resolve() ──────────────────────────────────────────

  describe('resolve() (§5.1.10)', () => {
    it('MUST return a DID document with the group DID', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });

      const doc = await group.resolve();
      expect(doc.id).toBe(group.did);
      expect(doc['@context']).toBe('https://www.w3.org/ns/did/v1');
    });
  });

  // ─── §5.3 GroupManager / listGroups ──────────────────────────────

  describe('GroupManager (§5.3)', () => {
    it('listGroups() MUST return groups the caller is a member of', async () => {
      const mgr = new GroupManager(aliceId);
      await mgr.createGroup({ name: 'G1' });
      await mgr.createGroup({ name: 'G2' });

      const groups = await mgr.listGroups();
      expect(groups).toHaveLength(2);
    });

    it('listGroups() MUST not return groups the caller is not a member of', async () => {
      const registry = new DefaultGroupRegistry();
      const aliceMgr = new GroupManager(aliceId, registry);
      const bobMgr = new GroupManager(bobId, registry);

      await aliceMgr.createGroup({ name: 'Alice Only' });
      await bobMgr.createGroup({ name: 'Bob Only' });

      const aliceGroups = await aliceMgr.listGroups();
      expect(aliceGroups).toHaveLength(1);
      expect(aliceGroups[0].name).toBe('Alice Only');
    });
  });

  // ─── §5.2 Member dictionary ─────────────────────────────────────

  describe('Member dictionary (§5.2)', () => {
    it('MUST contain did and isGroup fields', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const members = await group.members();
      expect(members[0]).toHaveProperty('did');
      expect(members[0]).toHaveProperty('isGroup');
    });

    it('joinedAt SHOULD be present', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const members = await group.members();
      expect(members[0].joinedAt).toBeDefined();
      expect(typeof members[0].joinedAt).toBe('number');
    });

    it('isGroup MUST be false for individual members', async () => {
      const mgr = new GroupManager(aliceId);
      const group = await mgr.createGroup({ name: 'Test' });
      const members = await group.members();
      expect(members[0].isGroup).toBe(false);
    });
  });
});
