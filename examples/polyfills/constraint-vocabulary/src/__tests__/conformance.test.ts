/**
 * Conformance smoke tests for @living-web/constraint-vocabulary.
 *
 * Verifies that the three constraint handlers expose the
 * `ConstraintHandler` shape (kind + validate) and that the standard set
 * groups them correctly. Deeper behavioural coverage lives in the
 * capability-framework conformance suite, where handlers are registered
 * against a live `GraphGovernanceEngine`.
 */

import { describe, it, expect } from 'vitest';
import {
  temporalConstraintHandler,
  contentConstraintHandler,
  credentialConstraintHandler,
  standardConstraintKinds,
  VOCAB,
} from '../index.js';

describe('Constraint handler shape', () => {
  it('temporalConstraintHandler advertises kind="temporal"', () => {
    expect(temporalConstraintHandler.kind).toBe('temporal');
    expect(typeof temporalConstraintHandler.validate).toBe('function');
  });

  it('contentConstraintHandler advertises kind="content"', () => {
    expect(contentConstraintHandler.kind).toBe('content');
    expect(typeof contentConstraintHandler.validate).toBe('function');
  });

  it('credentialConstraintHandler advertises kind="credential"', () => {
    expect(credentialConstraintHandler.kind).toBe('credential');
    expect(typeof credentialConstraintHandler.validate).toBe('function');
  });
});

describe('standardConstraintKinds', () => {
  it('bundles the three vocabulary handlers', () => {
    const kinds = new Set(standardConstraintKinds.map(h => h.kind));
    expect(kinds).toEqual(new Set(['temporal', 'content', 'credential']));
  });
});

describe('VOCAB predicates', () => {
  it('exposes temporal, content, and credential predicate constants', () => {
    expect(typeof VOCAB.TEMPORAL_MIN_INTERVAL_SECONDS).toBe('string');
    expect(typeof VOCAB.CONTENT_MAX_LENGTH).toBe('string');
    expect(typeof VOCAB.REQUIRES_CREDENTIAL_TYPE).toBe('string');
  });
});
