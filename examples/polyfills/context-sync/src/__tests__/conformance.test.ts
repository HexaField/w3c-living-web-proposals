/**
 * Conformance tests for @living-web/context-sync.
 *
 * Covers ContextDiff construction + immutability, revision determinism, and
 * sync space derivation. Integration tests for the Context.prototype extension
 * live in the package that supplies the active sync module (e.g.,
 * @living-web/default-sync-module).
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Triple,
  Context,
  GraphStorage,
  EphemeralIdentity,
} from '@living-web/personal-graph';

import {
  ContextDiff,
  createContextDiff,
  computeRevision,
  deriveSpaceUri,
} from '../index.js';

describe('§5.1 ContextDiff', () => {
  it('is immutable after construction', () => {
    const diff = new ContextDiff({
      graphDid: 'did:graph:z6Mkhabc',
      revision: 'deadbeef',
      additions: [],
      removals: [],
      dependencies: [],
      author: 'did:key:author',
      timestamp: '2023-11-15T22:13:20.000Z',
    });
    expect(Object.isFrozen(diff)).toBe(true);
    expect(Object.isFrozen(diff.additions)).toBe(true);
    expect(Object.isFrozen(diff.removals)).toBe(true);
    expect(Object.isFrozen(diff.dependencies)).toBe(true);
  });

  it('carries the originating graph DID', () => {
    const diff = createContextDiff({
      graphDid: 'did:graph:z6Mkhabc',
      additions: [],
      removals: [],
      author: 'did:key:author',
    });
    expect(diff.graphDid).toBe('did:graph:z6Mkhabc');
  });
});

describe('§5.2 Revision', () => {
  it('is a 64-char hex SHA-256 string', () => {
    const rev = computeRevision('did:graph:z6Mkhabc', [], [], []);
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic regardless of insertion order', async () => {
    const id = new EphemeralIdentity();
    await id.ensureReady();
    const storage = new GraphStorage(`revdet-${crypto.randomUUID()}`);
    const ctx = new Context('did:graph:z6Mkhrevdet', null, id, storage);
    const a = await ctx.addTriple(new Triple('urn:a', 'pred://p', 'x'));
    const b = await ctx.addTriple(new Triple('urn:b', 'pred://p', 'y'));
    const r1 = computeRevision('did:graph:z6Mkhrevdet', [a, b], [], []);
    const r2 = computeRevision('did:graph:z6Mkhrevdet', [b, a], [], []);
    expect(r1).toBe(r2);
  });

  it('differs when graphDid differs', () => {
    expect(computeRevision('did:graph:z6Mkha', [], [], [])).not.toBe(
      computeRevision('did:graph:z6Mkhb', [], [], []),
    );
  });
});

describe('§7.3 Space derivation', () => {
  it('produces a space:// URI', () => {
    const uri = deriveSpaceUri('unified', 'did:graph:z6Mkhabc');
    expect(uri).toMatch(/^space:\/\/[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = deriveSpaceUri('fully-partitioned', 'did:graph:z6Mkhabc');
    const b = deriveSpaceUri('fully-partitioned', 'did:graph:z6Mkhabc');
    expect(a).toBe(b);
  });

  it('differs across topologies for the same context', () => {
    const u = deriveSpaceUri('unified', 'did:graph:z6Mkhabc');
    const p = deriveSpaceUri('fully-partitioned', 'did:graph:z6Mkhabc');
    expect(u).not.toBe(p);
  });

  it('fully-partitioned bakes the graphDid into the space', () => {
    const a = deriveSpaceUri('fully-partitioned', 'did:graph:z6Mkha');
    const b = deriveSpaceUri('fully-partitioned', 'did:graph:z6Mkhb');
    expect(a).not.toBe(b);
  });
});
