/**
 * Canonical predicates used by the governance polyfill.
 *
 * `governance://` is the topical namespace.
 * `context://participates_in` / `context://accepts_participation` express the
 * mutual nesting of graphs (defined by Personal Linked-Data Graphs).
 * `did-document://*` predicates govern delegate management on did:graph DIDs.
 */

export const GOV = {
  // Base
  ENTRY_TYPE: 'governance://entry_type',
  CONSTRAINT: 'governance://constraint',
  CONSTRAINT_KIND: 'governance://constraint_kind',
  CONSTRAINT_SCOPE: 'governance://constraint_scope',
  HAS_CONSTRAINT: 'governance://has_constraint',

  // Root capability
  ROOT_CAPABILITY: 'governance://root_capability',

  // Enforcement mode
  ENFORCEMENT_MODE: 'governance://enforcement_mode',

  // Capability
  CAPABILITY_PREDICATES: 'governance://capability_predicates',
  HAS_ZCAP: 'governance://has_zcap',
  REVOKES_CAPABILITY: 'governance://revokes_capability',
} as const;

/** Graph-nesting predicates (defined by Personal Linked-Data Graphs). */
export const CONTEXT = {
  PARTICIPATES_IN: 'context://participates_in',
  ACCEPTS_PARTICIPATION: 'context://accepts_participation',
} as const;

/** DID-document delegate management predicates — governed via ZCAPs. */
export const DID_DOC = {
  ADD_METHOD: 'did-document://add-method',
  REMOVE_METHOD: 'did-document://remove-method',
  GRANT_SECTION: 'did-document://grant-section',
  REVOKE_SECTION: 'did-document://revoke-section',
} as const;

/**
 * Group identity seed predicates (Spec 03 §4.5).
 *
 * `SYNC_MODULE`, `FORKED_FROM`, and `FORKED_AT_REVISION` are **immutable
 * seed predicates** when the subject is the graph's DID. The engine MUST
 * reject any write that mutates them after the bootstrap atomic; module
 * evolution proceeds by forking ([[GROUP-IDENTITY]] §4.8) to a new DID.
 * `FORKED_TO` is mutable in the parent and gated by `announceFork`.
 */
export const GROUP = {
  DID_IDENTITY: 'group://didIdentity',
  SYNC_MODULE: 'group://syncModule',
  FORKED_FROM: 'group://forkedFrom',
  FORKED_AT_REVISION: 'group://forkedAtRevision',
  FORKED_TO: 'group://forkedTo',
} as const;

/**
 * Immutable seed predicates when the subject is the graph DID (Spec 03 §4.5).
 * Any write that adds, removes, or replaces a triple matching
 * `<graphDid> <predicate> ?o` outside the bootstrap atomic MUST be rejected.
 */
export const IMMUTABLE_SEED_PREDICATES: ReadonlySet<string> = new Set([
  GROUP.SYNC_MODULE,
  GROUP.FORKED_FROM,
  GROUP.FORKED_AT_REVISION,
]);
