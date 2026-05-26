/**
 * Group-identity extension — adds group convenience methods to GraphStore.
 *
 *   GraphStore.createGroup(options) → mints a fresh context + groupifies it.
 *   GraphStore.groupify(graphIri, options) → groupifies an existing context.
 *   GraphStore.openGroup(iriOrDid) → mounts an existing groupified context.
 *   GraphStore.listGroups() → groups registered in this session.
 */

import { GraphStore, type Context } from '@living-web/personal-graph';
import { Group } from './group.js';
import { GROUP, RDF, type GroupOptions, type GroupRegistry } from './types.js';
import { groupifyContext } from './binding.js';

export class DefaultGroupRegistry implements GroupRegistry {
  private readonly groups = new Map<string, Group>();
  /** Register by internal context id (stable) AND by did:graph. The IRI is
   *  volatile (snapshot hash), so it cannot serve as a registry key. */
  register(group: Group): void {
    this.groups.set(group.context.id, group);
    this.groups.set(group.did, group);
  }
  resolve(idOrDid: string): Group | undefined { return this.groups.get(idOrDid); }
  list(): Group[] { return [...new Set(this.groups.values())]; }
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

async function writeGroupMetadata(context: Context, options: GroupOptions, creatorDid: string): Promise<void> {
  // group:// predicates describe the *group identity*, so the subject is the
  // context's did:graph (which exists at this point — groupify ran already).
  if (!context.did) {
    throw new DOMException(`writeGroupMetadata requires a groupified context (${context.id})`, 'InvalidStateError');
  }
  const subject = context.did;
  await context.addTriple({ subject, predicate: RDF.TYPE, object: GROUP.TYPE });
  const label = options.displayName ?? options.name;
  if (label) {
    const safe = label.replace(/"/g, '\\"');
    await context.addTriple({ subject, predicate: GROUP.NAME, object: `"${safe}"` });
    await context.addTriple({ subject, predicate: RDF.NAME, object: `"${safe}"` });
  }
  if (options.description) {
    await context.addTriple({
      subject,
      predicate: GROUP.DESCRIPTION,
      object: `"${options.description.replace(/"/g, '\\"')}"`,
    });
  }
  await context.addTriple({
    subject,
    predicate: GROUP.CREATED,
    object: `"${new Date().toISOString()}"`,
  });
  await context.addTriple({
    subject,
    predicate: GROUP.CREATOR,
    object: creatorDid,
  });
}

async function createGroup(this: GraphStore, options: GroupOptions = {}): Promise<Group> {
  // 1. Mint a fresh ungroupified context (NO participatesIn here — we want
  //    the link's subject to be the did:graph, which doesn't exist yet).
  const context = await this.createContext({
    displayName: options.displayName ?? options.name ?? 'Untitled Group',
  });
  // 2. Groupify it.
  await groupifyContext(context, {
    displayName: options.displayName ?? options.name,
    initialDelegates: options.initialDelegates,
  });
  // 3. Write the participation link with the (now-stable) did:graph as subject.
  if (options.participatesIn) {
    await context.addTriple({
      subject: context.did!,
      predicate: 'context://participates_in',
      object: options.participatesIn,
    });
  }
  // 4. Write group metadata.
  await writeGroupMetadata(context, options, this.agentDid);

  const registry = getRegistry(this);
  const group = new Group(context, registry, options);
  registry.register(group);
  return group;
}

async function groupify(this: GraphStore, graphIri: string, options: GroupOptions = {}): Promise<Group> {
  const context = this.getContext(graphIri);
  if (!context) {
    throw new DOMException(`Context not mounted: ${graphIri}`, 'NotFoundError');
  }
  if (!context.did) {
    await groupifyContext(context, {
      displayName: options.displayName ?? options.name,
      initialDelegates: options.initialDelegates,
    });
    await writeGroupMetadata(context, options, this.agentDid);
  }

  const registry = getRegistry(this);
  let group = registry.resolve(context.id);
  if (!group) {
    group = new Group(context, registry, options);
    registry.register(group);
  }
  return group;
}

async function openGroup(this: GraphStore, iriOrDid: string): Promise<Group> {
  const registry = getRegistry(this);

  // Try by IRI first; if not mounted, try mounting it.
  let context = this.getContext(iriOrDid);
  if (!context) {
    // Try as a did:graph — find a mounted context whose did matches.
    for (const c of this.mounts.values()) {
      if (c.did === iriOrDid) { context = c; break; }
    }
  }
  if (!context) {
    // Not yet mounted: assume iriOrDid is an IRI and attempt to mount.
    if (!iriOrDid.startsWith('graph://')) {
      throw new DOMException(`Cannot open a did:graph alias that is not currently mounted: ${iriOrDid}`, 'NotFoundError');
    }
    context = await this.mount(iriOrDid);
  }

  let group = registry.resolve(context.id);
  if (group) return group;

  const lookupSubject = context.did ?? context.id;
  const nameT = await context.queryTriples({ subject: lookupSubject, predicate: GROUP.NAME });
  const descT = await context.queryTriples({ subject: lookupSubject, predicate: GROUP.DESCRIPTION });
  const name = nameT[0]?.data.object.replace(/^"|"$/g, '') ?? '';
  const description = descT[0]?.data.object.replace(/^"|"$/g, '') ?? '';
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
    groupify(graphIri: string, options?: GroupOptions): Promise<Group>;
    openGroup(iriOrDid: string): Promise<Group>;
    listGroups(): Promise<Group[]>;
  }
}

export function installGroupExtension(): void {
  const proto = GraphStore.prototype as GraphStore;
  if (typeof proto.createGroup === 'function') return;
  Object.assign(GraphStore.prototype, {
    createGroup,
    groupify,
    openGroup,
    listGroups,
  });
}
