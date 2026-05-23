/**
 * Group — a thin convenience layer over Context + did:graph + governance.
 *
 * A Group IS a Context. The "group identity" surface is a usage pattern over
 * the underlying primitives, not a separate data type.
 */

import { Context } from '@living-web/personal-graph';
import {
  decodeEd25519Multibase,
  addMethodTriples,
  removeMethodTriples,
  type DIDDocument,
} from '@living-web/identity';
import { createCapability } from '@living-web/governance';
import {
  GROUP,
  CONTEXT,
  RDF,
  VOTE,
  type Participant,
  type GroupOptions,
  type GroupRegistry,
} from './types.js';

const DEFAULT_MAX_DEPTH = 16;

type DelegateSection = 'capabilityInvocation' | 'capabilityDelegation' | 'assertionMethod' | 'authentication';

interface CredentialsWithResolver {
  resolve?(did: string): Promise<DIDDocument | null>;
}

export class Group {
  readonly did: string;
  readonly context: Context;
  readonly name: string;
  readonly description: string;
  readonly created: number;

  private readonly registry: GroupRegistry;

  constructor(context: Context, registry: GroupRegistry, options: GroupOptions = {}) {
    this.context = context;
    this.did = context.did;
    this.name = options.displayName || options.name || context.displayName || '';
    this.description = options.description || '';
    this.created = Date.now();
    this.registry = registry;
  }

  // ── Participation (NOT signing authority) ─────────────────────────────────

  /** Direct participants — those for whom the group has written `accepts_participation`. */
  async participants(): Promise<Participant[]> {
    const accepts = await this.context.queryTriples({
      subject: this.did,
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
    });
    const result: Participant[] = [];
    for (const t of accepts) {
      const did = t.data.object;
      const isGroup = await this.isGroupDid(did);
      let name: string | undefined;
      const nameTriples = await this.context.queryTriples({ subject: did, predicate: RDF.NAME });
      if (nameTriples.length > 0) name = stripLit(nameTriples[0].data.object);
      result.push({
        did,
        isGroup,
        name,
        joinedAt: new Date(t.timestamp).getTime(),
      });
    }
    return result;
  }

  /** Accept a participant — writes the `accepts_participation` triple. */
  async invite(participantDid: string): Promise<void> {
    await this.context.addTriple({
      subject: this.did,
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
      object: participantDid,
    });
  }

  /** Revoke participation acceptance. */
  async revokeParticipation(participantDid: string): Promise<void> {
    const triples = await this.context.queryTriples({
      subject: this.did,
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
      object: participantDid,
    });
    for (const t of triples) await this.context.removeTriple(t);
  }

  async hasParticipant(did: string): Promise<boolean> {
    const triples = await this.context.queryTriples({
      subject: this.did,
      predicate: CONTEXT.ACCEPTS_PARTICIPATION,
      object: did,
    });
    return triples.length > 0;
  }

  // ── Signing authority (DID-document delegates) ────────────────────────────

  /** Current verification methods in the requested section. */
  async signers(section: DelegateSection = 'capabilityInvocation'): Promise<Array<{ id: string; publicKeyMultibase: string }>> {
    const doc = await this.resolveDIDDocument();
    if (!doc) return [];
    const ids = sectionRefs(doc, section);
    return doc.verificationMethod
      .filter(m => ids.includes(m.id))
      .map(m => ({ id: m.id, publicKeyMultibase: m.publicKeyMultibase }));
  }

  /**
   * Add a signer (DID-document delegate). Requires the caller to currently hold
   * a `capabilityDelegation` delegate on this group's DID.
   */
  async addSigner(
    method: { id?: string; publicKeyMultibase: string },
    sections: DelegateSection[],
  ): Promise<void> {
    const id = method.id ?? `${this.did}#${method.publicKeyMultibase.slice(0, 16)}`;
    const publicKey = decodeEd25519Multibase(method.publicKeyMultibase);
    const triples = addMethodTriples(this.did, id, publicKey, sections);
    for (const t of triples) await this.context.addTriple(t);
  }

  async removeSigner(methodId: string): Promise<void> {
    const removals = removeMethodTriples(this.did, methodId);
    for (const removal of removals) {
      const matches = await this.context.queryTriples({
        subject: removal.subject,
        predicate: removal.predicate,
        object: removal.object,
      });
      for (const m of matches) await this.context.removeTriple(m);
    }
  }

  async isSigner(did: string, section: DelegateSection = 'capabilityInvocation'): Promise<boolean> {
    const sigs = await this.signers(section);
    return sigs.some(s => s.id.startsWith(did) || s.id.includes(did));
  }

  // ── Nested groups ─────────────────────────────────────────────────────────

  /** Groups this group participates in. */
  async parentGroups(): Promise<Group[]> {
    const participations = await this.context.queryTriples({
      subject: this.did,
      predicate: CONTEXT.PARTICIPATES_IN,
    });
    const parents: Group[] = [];
    for (const p of participations) {
      const did = p.data.object;
      const known = this.registry.resolve(did);
      if (known) parents.push(known);
    }
    return parents;
  }

  /** Participants that are themselves groups. */
  async childGroups(): Promise<Group[]> {
    const parts = await this.participants();
    const children: Group[] = [];
    for (const p of parts) {
      if (!p.isGroup) continue;
      const g = this.registry.resolve(p.did);
      if (g) children.push(g);
    }
    return children;
  }

  /** Recursively resolve all individual (non-group) participants. */
  async transitiveParticipants(maxDepth: number = DEFAULT_MAX_DEPTH): Promise<Participant[]> {
    const result = new Map<string, Participant>();
    const visited = new Set<string>();

    const walk = async (group: Group, depth: number): Promise<void> => {
      if (depth > maxDepth || visited.has(group.did)) return;
      visited.add(group.did);
      const parts = await group.participants();
      for (const p of parts) {
        if (p.isGroup) {
          const sub = this.registry.resolve(p.did);
          if (sub) await walk(sub, depth + 1);
        } else if (!result.has(p.did)) {
          result.set(p.did, p);
        }
      }
    };
    await walk(this, 0);
    return [...result.values()];
  }

  // ── Capability delegation ─────────────────────────────────────────────────

  async delegateCapability(opts: {
    invoker: string;
    actions: string[];
    resource?: string;
    caveats?: Parameters<typeof createCapability>[4] extends { caveats?: infer C } ? C : never;
    expires?: string;
    transitiveToParticipants?: boolean;
  }): Promise<ReturnType<typeof createCapability> & { transitiveToParticipants?: boolean }> {
    const zcap = createCapability(
      opts.invoker,
      opts.actions,
      opts.resource ?? this.did,
      this.context.getIdentity().getDID(),
      { caveats: opts.caveats, expires: opts.expires ?? null },
    );
    if (opts.transitiveToParticipants) {
      return { ...zcap, transitiveToParticipants: true };
    }
    return zcap;
  }

  resolve(): Promise<DIDDocument | null> {
    return this.resolveDIDDocument();
  }

  // ── Liquid democracy (Spec 06 §10) ────────────────────────────────────────

  async delegateVote(opts: {
    topic: string;
    delegateTo: string;
    validUntil?: string;
    revocable?: boolean;
  }): Promise<void> {
    await this.context.addTriple({ subject: this.did, predicate: VOTE.DELEGATES_TO, object: opts.delegateTo });
    await this.context.addTriple({ subject: this.did, predicate: VOTE.DELEGATES_TOPIC, object: opts.topic });
    if (opts.validUntil) {
      await this.context.addTriple({ subject: this.did, predicate: VOTE.VALID_UNTIL, object: `"${opts.validUntil}"` });
    }
    if (opts.revocable !== undefined) {
      await this.context.addTriple({ subject: this.did, predicate: VOTE.REVOCABLE, object: `"${opts.revocable}"` });
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async isGroupDid(did: string): Promise<boolean> {
    if (did.startsWith('did:graph:')) return true;
    return this.registry.isGroupDid(did);
  }

  private async resolveDIDDocument(): Promise<DIDDocument | null> {
    const nav = globalThis.navigator;
    const credentials = nav.credentials as unknown as CredentialsWithResolver | undefined;
    if (!credentials?.resolve) return null;
    return credentials.resolve(this.did);
  }
}

function sectionRefs(doc: DIDDocument, section: DelegateSection): string[] {
  switch (section) {
    case 'capabilityInvocation':
      return doc.capabilityInvocation ?? [];
    case 'capabilityDelegation':
      return doc.capabilityDelegation ?? [];
    case 'assertionMethod':
      return doc.assertionMethod ?? [];
    case 'authentication':
      return doc.authentication ?? [];
  }
}

function stripLit(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}
