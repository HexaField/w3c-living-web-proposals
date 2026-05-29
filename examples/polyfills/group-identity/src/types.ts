import type { Group } from './group.js';

/**
 * Participant — a DID that has written `context://participates_in` against the
 * group's DID, and that the group has reciprocally written
 * `context://accepts_participation` for.
 *
 * Distinct from a *signer* (a DID-document delegate on the group's did:graph):
 * participation indicates "is part of the membership"; signing indicates "may
 * commit on behalf of the group". The two MAY overlap by convention.
 */
export interface Participant {
  /** Participant's DID (did:key or did:graph). */
  did: string;
  /** true if the participant is itself a group (a did:graph). */
  isGroup: boolean;
  name?: string;
  /** RFC 3339; derived from the accepts_participation reifier. */
  joinedAt?: string;
}

export interface GroupOptions {
  name?: string;
  displayName?: string;
  description?: string;
  /** Initial DIDs to add as `capabilityInvocation` delegates on the group's DID. */
  initialDelegates?: string[];
  /** did:graph to participate_in (creates a nested group). */
  participatesIn?: string;
  /** Initial enforcement mode for the group's governance. */
  enforcementMode?: 'open' | 'announced' | 'enforced';
  /**
   * Sync-module content hash (Spec 03 §4.5 immutable seed). When absent,
   * the polyfill defaults to {@link POLYFILL_DEFAULT_SYNC_MODULE}; production
   * hosts treat the field as REQUIRED.
   */
  syncModule?: string;
}

/**
 * Polyfill fallback for the immutable seed `group://syncModule` predicate.
 * Mirrors `defaultModuleManifest.wasmContentHash` in `@living-web/default-sync-module`
 * — the polyfill ships exactly one transport, so this sentinel suffices as
 * a placeholder for "the agent's default module".
 */
export const POLYFILL_DEFAULT_SYNC_MODULE = 'sha256-polyfill-broadcast-channel';

/** Graph-nesting predicates (defined by Personal Linked-Data Graphs). */
export const CONTEXT = {
  PARTICIPATES_IN: 'context://participates_in',
  ACCEPTS_PARTICIPATION: 'context://accepts_participation',
} as const;

/** Group metadata predicates. */
export const GROUP = {
  TYPE: 'group://Group',
  NAME: 'group://name',
  DESCRIPTION: 'group://description',
  AVATAR: 'group://avatar',
  CREATED: 'group://created',
  CREATOR: 'group://creator',
  PARTICIPATION_OPEN: 'group://participation_open',
  PARTICIPATION_REQUIRES_CREDENTIAL: 'group://participation_requires_credential',
  PARTICIPATION_MAX_COUNT: 'group://participation_max_count',

  // Spec 03 §4.5 immutable seed predicates.
  DID_IDENTITY: 'group://didIdentity',
  SYNC_MODULE: 'group://syncModule',
  FORKED_FROM: 'group://forkedFrom',
  FORKED_AT_REVISION: 'group://forkedAtRevision',
  // Spec 03 §4.8.2 — mutable announcement triple on the parent.
  FORKED_TO: 'group://forkedTo',
} as const;

/** RDF predicates reused from other specs. */
export const RDF = {
  TYPE: 'rdf://type',
  NAME: 'rdf://name',
  DESCRIPTION: 'rdf://description',
} as const;

/** Vote delegation predicates (liquid democracy — Spec 10 §10). */
export const VOTE = {
  DELEGATES_TO: 'vote://delegates_to',
  DELEGATES_TOPIC: 'vote://delegates_topic',
  VALID_UNTIL: 'vote://valid_until',
  REVOCABLE: 'vote://revocable',
} as const;

export interface GroupRegistry {
  register(group: Group): void;
  resolve(did: string): Group | undefined;
  list(): Group[];
  isGroupDid(did: string): Promise<boolean>;
}
