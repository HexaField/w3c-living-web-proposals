/**
 * Group-identity extension — adds group convenience methods to GraphManager.
 *
 *   GraphManager.createGroup(options) → mints a fresh graph + groupifies it.
 *   GraphManager.groupify(graphIri, options) → groupifies an existing graph.
 *   GraphManager.openGroup(iriOrDid) → reopens an existing group.
 *   GraphManager.listGroups() → groups registered in this session.
 */

import { GraphManager, type Graph } from '@living-web/personal-graph';
import { Group } from './group.js';
import { GROUP, POLYFILL_DEFAULT_SYNC_MODULE, RDF, type GroupOptions, type GroupRegistry } from './types.js';
import { groupifyContext } from './binding.js';

export class DefaultGroupRegistry implements GroupRegistry {
  private readonly groups = new Map<string, Group>();
  /** Register by internal graph id (stable) AND by did:graph. The IRI is
   *  volatile (snapshot hash), so it cannot serve as a registry key. */
  register(group: Group): void {
    this.groups.set(group.graph.id, group);
    this.groups.set(group.did, group);
  }
  resolve(idOrDid: string): Group | undefined { return this.groups.get(idOrDid); }
  list(): Group[] { return [...new Set(this.groups.values())]; }
  async isGroupDid(did: string): Promise<boolean> { return this.groups.has(did); }
}

const registries = new WeakMap<GraphManager, DefaultGroupRegistry>();

function getRegistry(manager: GraphManager): DefaultGroupRegistry {
  let r = registries.get(manager);
  if (!r) {
    r = new DefaultGroupRegistry();
    registries.set(manager, r);
  }
  return r;
}

async function writeGroupMetadata(graph: Graph, options: GroupOptions, creatorDid: string): Promise<void> {
  // group:// predicates describe the *group identity*, so the subject is the
  // graph's did:graph (which exists at this point — groupify ran already).
  if (!graph.did) {
    throw new DOMException(`writeGroupMetadata requires a group (graph with a did:graph) (${graph.id})`, 'InvalidStateError');
  }
  const subject = graph.did;
  await graph.addTriple({ subject, predicate: RDF.TYPE, object: GROUP.TYPE });
  const label = options.displayName ?? options.name;
  if (label) {
    const safe = label.replace(/"/g, '\\"');
    await graph.addTriple({ subject, predicate: GROUP.NAME, object: `"${safe}"` });
    await graph.addTriple({ subject, predicate: RDF.NAME, object: `"${safe}"` });
  }
  if (options.description) {
    await graph.addTriple({
      subject,
      predicate: GROUP.DESCRIPTION,
      object: `"${options.description.replace(/"/g, '\\"')}"`,
    });
  }
  await graph.addTriple({
    subject,
    predicate: GROUP.CREATED,
    object: `"${new Date().toISOString()}"`,
  });
  await graph.addTriple({
    subject,
    predicate: GROUP.CREATOR,
    object: creatorDid,
  });
}

async function createGroup(this: GraphManager, options: GroupOptions = {}): Promise<Group> {
  // 1. Mint a fresh graph (no DID yet) (NO participatesIn here — we want
  //    the link's subject to be the did:graph, which doesn't exist yet).
  const graph = await this.create({
    displayName: options.displayName ?? options.name ?? 'Untitled Group',
  });
  // 2. Groupify it.
  await groupifyContext(graph, {
    syncModule: options.syncModule ?? POLYFILL_DEFAULT_SYNC_MODULE,
    displayName: options.displayName ?? options.name,
    initialDelegates: options.initialDelegates,
  });
  // 3. Write the participation link with the (now-stable) did:graph as subject.
  if (options.participatesIn) {
    await graph.addTriple({
      subject: graph.did!,
      predicate: 'context://participates_in',
      object: options.participatesIn,
    });
  }
  // 4. Write group metadata.
  const agentIdentity = await this.getAgentIdentity();
  await writeGroupMetadata(graph, options, agentIdentity.getDID());

  const registry = getRegistry(this);
  const group = new Group(graph, registry, options);
  registry.register(group);
  return group;
}

async function groupify(this: GraphManager, graphIri: string, options: GroupOptions = {}): Promise<Group> {
  const graph = this.getGraph(graphIri);
  if (!graph) {
    throw new DOMException(`Graph not known: ${graphIri}`, 'NotFoundError');
  }
  if (!graph.did) {
    await groupifyContext(graph, {
      syncModule: options.syncModule ?? POLYFILL_DEFAULT_SYNC_MODULE,
      displayName: options.displayName ?? options.name,
      initialDelegates: options.initialDelegates,
    });
    const agentIdentity = await this.getAgentIdentity();
    await writeGroupMetadata(graph, options, agentIdentity.getDID());
  }

  const registry = getRegistry(this);
  let group = registry.resolve(graph.id);
  if (!group) {
    group = new Group(graph, registry, options);
    registry.register(group);
  }
  return group;
}

async function openGroup(this: GraphManager, iriOrDid: string): Promise<Group> {
  const registry = getRegistry(this);

  // Look up by IRI / did:graph among known graphs.
  await this.ensureInit();
  const graph = this.getGraph(iriOrDid);
  if (!graph) {
    throw new DOMException(
      `openGroup requires the host graph to already be known locally: ${iriOrDid}. Use a sync mount mechanism first.`,
      'NotFoundError',
    );
  }

  let group = registry.resolve(graph.id);
  if (group) return group;

  const lookupSubject = graph.did ?? graph.id;
  const nameT = await graph.queryTriples({ subject: lookupSubject, predicate: GROUP.NAME });
  const descT = await graph.queryTriples({ subject: lookupSubject, predicate: GROUP.DESCRIPTION });
  const name = nameT[0]?.data.object.replace(/^"|"$/g, '') ?? '';
  const description = descT[0]?.data.object.replace(/^"|"$/g, '') ?? '';
  group = new Group(graph, registry, { displayName: name, description });
  registry.register(group);
  return group;
}

async function listGroups(this: GraphManager): Promise<Group[]> {
  return getRegistry(this).list();
}

declare module '@living-web/personal-graph' {
  interface GraphManager {
    createGroup(options?: GroupOptions): Promise<Group>;
    groupify(graphIri: string, options?: GroupOptions): Promise<Group>;
    openGroup(iriOrDid: string): Promise<Group>;
    listGroups(): Promise<Group[]>;
  }
}

export function installGroupExtension(): void {
  const proto = GraphManager.prototype as GraphManager;
  if (typeof proto.createGroup === 'function') return;
  Object.assign(GraphManager.prototype, {
    createGroup,
    groupify,
    openGroup,
    listGroups,
  });
}
