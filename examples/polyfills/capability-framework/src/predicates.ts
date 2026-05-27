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

  // Root capability (replaces "root authority")
  ROOT_CAPABILITY: 'governance://root_capability',

  // Enforcement mode
  ENFORCEMENT_MODE: 'governance://enforcement_mode',

  // Capability
  CAPABILITY_ENFORCEMENT: 'governance://capability_enforcement',
  CAPABILITY_PREDICATES: 'governance://capability_predicates',
  HAS_ZCAP: 'governance://has_zcap',
  REVOKES_CAPABILITY: 'governance://revokes_capability',

  // Credential
  REQUIRES_CREDENTIAL_TYPE: 'governance://requires_credential_type',
  CREDENTIAL_ISSUER_PATTERN: 'governance://credential_issuer_pattern',
  CREDENTIAL_MIN_AGE_HOURS: 'governance://credential_min_age_hours',
  HAS_CREDENTIAL: 'governance://has_credential',

  // Temporal
  TEMPORAL_MIN_INTERVAL_SECONDS: 'governance://temporal_min_interval_seconds',
  TEMPORAL_MAX_COUNT_PER_WINDOW: 'governance://temporal_max_count_per_window',
  TEMPORAL_WINDOW_SECONDS: 'governance://temporal_window_seconds',
  TEMPORAL_APPLIES_TO_PREDICATES: 'governance://temporal_applies_to_predicates',

  // Content
  CONTENT_APPLIES_TO_PREDICATES: 'governance://content_applies_to_predicates',
  CONTENT_BLOCKED_PATTERNS: 'governance://content_blocked_patterns',
  CONTENT_ALLOW_URLS: 'governance://content_allow_urls',
  CONTENT_ALLOWED_DOMAINS: 'governance://content_allowed_domains',
  CONTENT_ALLOW_MEDIA_TYPES: 'governance://content_allow_media_types',
  CONTENT_MAX_LENGTH: 'governance://content_max_length',

  // Default capability
  DEFAULT_CAPABILITY: 'governance://default_capability',
  DEFAULT_CAPABILITY_ACTIONS: 'governance://default_capability_actions',
  DEFAULT_CAPABILITY_CAVEATS: 'governance://default_capability_caveats',
} as const;

/** Graph-nesting predicates (defined by Personal Linked-Data Graphs). */
export const CONTEXT = {
  PARTICIPATES_IN: 'context://participates_in',
  ACCEPTS_PARTICIPATION: 'context://accepts_participation',
  CAPABILITY_TRANSITIVE: 'context://capability_transitive',
} as const;

/** DID-document delegate management predicates — governed via ZCAPs. */
export const DID_DOC = {
  ADD_METHOD: 'did-document://add-method',
  REMOVE_METHOD: 'did-document://remove-method',
  GRANT_SECTION: 'did-document://grant-section',
  REVOKE_SECTION: 'did-document://revoke-section',
} as const;
