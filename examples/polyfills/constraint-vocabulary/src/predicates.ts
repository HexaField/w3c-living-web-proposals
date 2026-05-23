/**
 * Predicates declared by the constraint vocabulary.
 */

export const VOCAB = {
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
} as const;
