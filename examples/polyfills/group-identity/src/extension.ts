/**
 * Group-identity extension — adds group convenience methods to GraphStore.
 *
 *   GraphStore.createGroup(options) → mints a did:graph context + Group wrapper.
 *   GraphStore.openGroup(graphDid) → mounts an existing did:graph as a Group.
 *   GraphStore.listGroups() → groups registered in this session.
 */

import { GraphStore } from '@living-web/personal-graph';
import { Group } from './group.js';
import { GROUP, RDF, type GroupOptions, type GroupRegistry } from './types.js';

export class DefaultGroupRegistry implements GroupRegistry {
  private readonly groups = new Map<string, Group>();
  register(group: Group): void { this.groups.set(group.did, group); }
  resolve(did: string): Group | undefined { return this.groups.get(did); }
  list(): Group[] { return [...this.groups.values()]; }
  async isGroupDid(did: string): Promise<boolean> { return this.groups.has(did); }
}

const registries = new WeakMap<GraphStore, DefaultGroupRegistry>();

function getRegistry(store: GraphStore): DefaultGroupRegistry {
  let r = registries.get(store);
  if (!r) {
    r = new DefaultGroupRegistry();
    registries.set(store, r);
  }
  return r;
}

async function createGroup(this: GraphStore, options: GroupOptions = {}): Promise<Group> {
  const context = await this.createContext({
    displayName: options.displayName ?? options.name ?? 'Untitled Group',
    participatesIn: options.participatesIn,
    initialDelegates: options.initialDelegates,
  });
  const registry = getRegistry(this);

  await context.addTriple({ source: context.did, predicate: RDF.TYPE, target: GROUP.TYPE });
  const label = options.displayName ?? options.name;
  if (label) {
    await context.addTriple({
      source: context.did,
      predicate: GROUP.NAME,
      target: `"${label.replace(/"/g, '\\"')}"`,
    });
    await context.addTriple({
      source: context.did,
      predicate: RDF.NAME,
      target: `"${label.replace(/"/g, '\\"')}"`,
    });
  }
  if (options.description) {
    await context.addTriple({
      source: context.did,
      predicate: GROUP.DESCRIPTION,
      target: `"${options.description.replace(/"/g, '\\"')}"`,
    });
  }
  await context.addTriple({
    source: context.did,
    predicate: GROUP.CREATED,
    target: `"${new Date().toISOString()}"`,
  });
  await context.addTriple({
    source: context.did,
    predicate: GROUP.CREATOR,
    target: this.agentDid,
  });

  const group = new Group(context, registry, options);
  registry.register(group);
  return group;
}

async function openGroup(this: GraphStore, groupDid: string): Promise<Group> {
  const registry = getRegistry(this);
  let context = this.getContext(groupDid);
  if (!context) {
    context = await this.mount(groupDid);
  }
  let group = registry.resolve(groupDid);
  if (group) return group;

  const nameT = await context.queryTriples({ source: groupDid, predicate: GROUP.NAME });
  const descT = await context.queryTriples({ source: groupDid, predicate: GROUP.DESCRIPTION });
  const name = nameT[0]?.data.target.replace(/^"|"$/g, '') ?? '';
  const description = descT[0]?.data.target.replace(/^"|"$/g, '') ?? '';
  group = new Group(context, registry, { displayName: name, description });
  registry.register(group);
  return group;
}

async function listGroups(this: GraphStore): Promise<Group[]> {
  return getRegistry(this).list();
}

declare module '@living-web/personal-graph' {
  interface GraphStore {
    createGroup(options?: GroupOptions): Promise<Group>;
    openGroup(groupDid: string): Promise<Group>;
    listGroups(): Promise<Group[]>;
  }
}

export function installGroupExtension(): void {
  const proto = GraphStore.prototype as GraphStore;
  if (typeof proto.createGroup === 'function') return;
  Object.assign(GraphStore.prototype, {
    createGroup,
    openGroup,
    listGroups,
  });
}
