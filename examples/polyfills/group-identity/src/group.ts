/**
 * Group — Decentralised Group Identity (Spec 06)
 *
 * A persistent, DID-identified entity with mutable membership,
 * composable via recursive nesting, governed by its own shared graph.
 */

import { SemanticTriple, type SignedTriple } from '@living-web/personal-graph';
import type { SharedGraph } from '@living-web/graph-sync';
import { createCapability } from '@living-web/governance';
import { GROUP, RDF, type Member, type GroupOptions, type GroupRegistry } from './types.js';

/** Default max nesting depth for transitive resolution */
const DEFAULT_MAX_DEPTH = 16;

export class Group {
  readonly did: string;
  readonly name: string;
  readonly description: string;
  readonly created: number;
  readonly graph: SharedGraph;

  private _registry: GroupRegistry;

  constructor(
    did: string,
    graph: SharedGraph,
    registry: GroupRegistry,
    options?: GroupOptions,
  ) {
    this.did = did;
    this.name = options?.name || '';
    this.description = options?.description || '';
    this.created = Date.now();
    this.graph = graph;
    this._registry = registry;
  }

  /**
   * §5.1.2 — members()
   * Returns direct members only. Does not recurse.
   */
  async members(): Promise<Member[]> {
    const triples = await this.graph.queryTriples({
      source: this.did,
      predicate: GROUP.HAS_MEMBER,
    });

    const members: Member[] = [];
    for (const t of triples) {
      const memberDid = t.data.target;
      const isGroup = await this._isGroupDid(memberDid);

      // Try to get joinedAt from metadata
      let joinedAt: number | undefined;
      const joinedTriples = await this.graph.queryTriples({
        source: memberDid,
        predicate: GROUP.JOINED_AT,
      });
      if (joinedTriples.length > 0) {
        joinedAt = new Date(joinedTriples[0].data.target).getTime();
      } else {
        // Fall back to the triple's own timestamp
        joinedAt = new Date(t.timestamp).getTime();
      }

      // Try to get name
      let name: string | undefined;
      const nameTriples = await this.graph.queryTriples({
        source: memberDid,
        predicate: RDF.NAME,
      });
      if (nameTriples.length > 0) {
        name = nameTriples[0].data.target;
      }

      members.push({ did: memberDid, isGroup, name, joinedAt });
    }

    return members;
  }

  /**
   * §5.1.3 — addMember(memberDid)
   * Adds a group://has_member triple. Idempotent.
   */
  async addMember(memberDid: string): Promise<void> {
    // Check if already a member (idempotent per spec SHOULD)
    const existing = await this.graph.queryTriples({
      source: this.did,
      predicate: GROUP.HAS_MEMBER,
      target: memberDid,
    });
    if (existing.length > 0) return;

    await this.graph.addTriple(
      new SemanticTriple(this.did, memberDid, GROUP.HAS_MEMBER),
    );

    // Add joined_at metadata
    const now = new Date().toISOString();
    await this.graph.addTriple(
      new SemanticTriple(memberDid, now, GROUP.JOINED_AT),
    );
  }

  /**
   * §5.1.4 — removeMember(memberDid)
   * Removes the membership triple and metadata.
   */
  async removeMember(memberDid: string): Promise<void> {
    const triples = await this.graph.queryTriples({
      source: this.did,
      predicate: GROUP.HAS_MEMBER,
      target: memberDid,
    });
    for (const t of triples) {
      await this.graph.removeTriple(t);
    }

    // Remove joined_at metadata
    const metaTriples = await this.graph.queryTriples({
      source: memberDid,
      predicate: GROUP.JOINED_AT,
    });
    for (const t of metaTriples) {
      await this.graph.removeTriple(t);
    }
  }

  /**
   * §5.1.5 — isMember(did)
   * Direct membership check only.
   */
  async isMember(did: string): Promise<boolean> {
    const triples = await this.graph.queryTriples({
      source: this.did,
      predicate: GROUP.HAS_MEMBER,
      target: did,
    });
    return triples.length > 0;
  }

  /**
   * §5.1.6 — parentGroups()
   * Returns groups that contain this group as a member.
   */
  async parentGroups(): Promise<Group[]> {
    const groups: Group[] = [];
    for (const g of this._registry.list()) {
      if (g.did === this.did) continue;
      const isMember = await g.isMember(this.did);
      if (isMember) groups.push(g);
    }
    return groups;
  }

  /**
   * §5.1.7 — childGroups()
   * Returns members that are themselves groups.
   */
  async childGroups(): Promise<Group[]> {
    const members = await this.members();
    const children: Group[] = [];
    for (const m of members) {
      if (m.isGroup) {
        const child = this._registry.resolve(m.did);
        if (child) children.push(child);
      }
    }
    return children;
  }

  /**
   * §5.1.8 — transitiveMembers()
   * BFS through child groups, cycle-safe, depth-limited.
   */
  async transitiveMembers(maxDepth = DEFAULT_MAX_DEPTH): Promise<Member[]> {
    const result: Member[] = [];
    const visited = new Set<string>();
    const seenIndividuals = new Set<string>();

    const resolve = async (group: Group, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      if (visited.has(group.did)) return;
      visited.add(group.did);

      const members = await group.members();
      for (const m of members) {
        if (m.isGroup) {
          const childGroup = this._registry.resolve(m.did);
          if (childGroup) {
            await resolve(childGroup, depth + 1);
          }
        } else {
          if (!seenIndividuals.has(m.did)) {
            seenIndividuals.add(m.did);
            result.push(m);
          }
        }
      }
    };

    await resolve(this, 0);
    return result;
  }

  /**
   * §5.1.9 — delegateCapability(memberDid, predicate, scope)
   * Creates a ZCAP and stores it in the group's shared graph.
   */
  async delegateCapability(
    memberDid: string,
    predicate: string,
    scope: string,
  ): Promise<void> {
    const zcap = createCapability(
      memberDid,
      [predicate],
      { within: scope, graph: this.graph.uri },
      this.did,
    );

    // Store ZCAP as triples in the shared graph
    await this.graph.addTriple(
      new SemanticTriple(zcap.id, JSON.stringify(zcap), 'gov://zcap_document'),
    );
  }

  /**
   * §5.1.10 — resolve()
   * Returns a DID document for this group.
   */
  async resolve(): Promise<Record<string, unknown>> {
    return {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: this.did,
      type: 'Group',
      name: this.name,
      description: this.description,
      created: new Date(this.created).toISOString(),
      graph: this.graph.uri,
    };
  }

  /** Check if a DID is a known group DID */
  private async _isGroupDid(did: string): Promise<boolean> {
    // Check local registry first
    if (this._registry.resolve(did)) return true;

    // Check if the DID has a group type triple in this graph
    const typeTriples = await this.graph.queryTriples({
      source: did,
      predicate: RDF.TYPE,
      target: GROUP.TYPE,
    });
    return typeTriples.length > 0;
  }
}
