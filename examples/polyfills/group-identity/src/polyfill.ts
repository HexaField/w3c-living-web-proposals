/**
 * Polyfill — extends navigator.graph with group management (§5.3)
 *
 * Adds createGroup(), joinGroup(), listGroups() to the PersonalGraphManager.
 */

import { SemanticTriple } from '@living-web/personal-graph';
import { SharedGraphManager, SharedGraph } from '@living-web/graph-sync';
import type { IdentityProvider } from '@living-web/personal-graph';
import { Group } from './group.js';
import { GROUP, RDF, type GroupOptions, type GroupRegistry } from './types.js';

/**
 * In-memory group registry — tracks all groups known to this agent.
 */
export class DefaultGroupRegistry implements GroupRegistry {
  private _groups = new Map<string, Group>();

  register(group: Group): void {
    this._groups.set(group.did, group);
  }

  resolve(did: string): Group | undefined {
    return this._groups.get(did);
  }

  list(): Group[] {
    return Array.from(this._groups.values());
  }

  async isGroupDid(did: string): Promise<boolean> {
    return this._groups.has(did);
  }
}

/**
 * GroupManager — wraps SharedGraphManager with group lifecycle methods.
 */
export class GroupManager {
  private _identity: IdentityProvider;
  private _sharedGraphManager: SharedGraphManager;
  private _registry: DefaultGroupRegistry;

  constructor(identity: IdentityProvider, registry?: DefaultGroupRegistry) {
    this._identity = identity;
    this._sharedGraphManager = new SharedGraphManager(identity);
    this._registry = registry ?? new DefaultGroupRegistry();
  }

  get registry(): DefaultGroupRegistry {
    return this._registry;
  }

  /**
   * §5.3.1 — createGroup(options)
   *
   * 1. Generate a new keypair and derive a DID for the group.
   * 2. Create a shared graph.
   * 3. Add group identity triples.
   * 4. Add the caller as the first member.
   * 5. Grant the caller root authority.
   * 6. Return a Group object.
   */
  async createGroup(options?: GroupOptions): Promise<Group> {
    // Create a shared graph for this group
    const graph = await this._sharedGraphManager.share(
      options?.name || 'Unnamed Group',
    );

    // Generate a group DID (use the graph URI as basis for deterministic DID)
    const groupDid = `did:group:${crypto.randomUUID()}`;
    const callerDid = this._identity.getDID();

    // Create the Group object
    const group = new Group(groupDid, graph, this._registry, options);

    // Add group identity triples (§4.1)
    await graph.addTriple(
      new SemanticTriple(groupDid, GROUP.TYPE, RDF.TYPE),
    );
    await graph.addTriple(
      new SemanticTriple(groupDid, new Date().toISOString(), GROUP.CREATED),
    );
    await graph.addTriple(
      new SemanticTriple(groupDid, callerDid, GROUP.CREATOR),
    );

    // Add optional metadata
    if (options?.name) {
      await graph.addTriple(
        new SemanticTriple(groupDid, options.name, RDF.NAME),
      );
    }
    if (options?.description) {
      await graph.addTriple(
        new SemanticTriple(groupDid, options.description, RDF.DESCRIPTION),
      );
    }

    // Add creator as first member (§4.2, §6.1 step 5)
    await group.addMember(callerDid);

    // Register in local registry
    this._registry.register(group);

    return group;
  }

  /**
   * §5.3.2 — joinGroup(groupDid)
   * Join an existing group's shared graph.
   */
  async joinGroup(graphUri: string): Promise<Group> {
    const graph = await this._sharedGraphManager.join(graphUri);

    // Discover the group DID from the graph
    const typeTriples = await graph.queryTriples({
      predicate: RDF.TYPE,
      target: GROUP.TYPE,
    });

    let groupDid: string;
    let name = '';
    if (typeTriples.length > 0) {
      groupDid = typeTriples[0].data.source;
      const nameTriples = await graph.queryTriples({
        source: groupDid,
        predicate: RDF.NAME,
      });
      if (nameTriples.length > 0) name = nameTriples[0].data.target;
    } else {
      groupDid = `did:group:${crypto.randomUUID()}`;
    }

    const group = new Group(groupDid, graph, this._registry, { name });
    this._registry.register(group);

    // Submit membership request
    const callerDid = this._identity.getDID();
    await graph.addTriple(
      new SemanticTriple(callerDid, groupDid, GROUP.MEMBERSHIP_REQUEST),
    );

    return group;
  }

  /**
   * §5.3.3 — listGroups()
   * Returns all groups the caller is a member of.
   */
  async listGroups(): Promise<Group[]> {
    const callerDid = this._identity.getDID();
    const groups: Group[] = [];

    for (const group of this._registry.list()) {
      if (await group.isMember(callerDid)) {
        groups.push(group);
      }
    }

    return groups;
  }
}
