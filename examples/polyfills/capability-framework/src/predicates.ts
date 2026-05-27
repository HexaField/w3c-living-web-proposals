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
