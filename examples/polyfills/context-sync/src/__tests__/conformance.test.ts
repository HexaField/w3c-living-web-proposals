/**
 * Conformance tests for @living-web/context-sync.
 *
 * Covers GraphDiff construction + immutability, revision determinism, and
 * sync space derivation. Integration tests for the Graph.prototype extension
 * live in the package that supplies the active sync module (e.g.,
 * @living-web/default-sync-module).
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import {
  Triple,
  Graph,
  GraphStorage,
  EphemeralIdentity,
} from '@living-web/personal-graph';

import {
  GraphDiff,
  createContextDiff,
  computeRevision,
  computeCommitId,
  verifyBundleSignature,
  deriveSpaceUri,
} from '../index.js';

describe('§5.1 GraphDiff', () => {
  it('is immutable after construction', () => {
    const diff = new GraphDiff({
      graphDid: 'did:graph:z6Mkhabc',
      revision: 'deadbeef',
      commitId: 'cafebabe',
      additions: [],
      removals: [],
      dependencies: [],
      author: 'did:key:author',
      timestamp: '2023-11-15T22:13:20.000Z',
      signature: 'sig-stub',
    });
    expect(Object.isFrozen(diff)).toBe(true);
    expect(Object.isFrozen(diff.additions)).toBe(true);
    expect(Object.isFrozen(diff.removals)).toBe(true);
    expect(Object.isFrozen(diff.dependencies)).toBe(true);
  });

  it('carries the originating graph DID', async () => {
    const diff = await createContextDiff({
      graphDid: 'did:graph:z6Mkhabc',
      additions: [],
      removals: [],
      author: 'did:key:author',
      sign: async () => 'sig-stub',
    });
    expect(diff.graphDid).toBe('did:graph:z6Mkhabc');
  });

  it('records the commit identity binding author/timestamp/leafCap', async () => {
    const d1 = await createContextDiff({
      graphDid: 'did:graph:z6Mkhabc',
      additions: [],
      removals: [],
      author: 'did:key:authorA',
      timestamp: '2023-11-15T22:13:20.000Z',
      sign: async () => 'sig-A',
    });
    const d2 = await createContextDiff({
      graphDid: 'did:graph:z6Mkhabc',
      additions: [],
      removals: [],
      author: 'did:key:authorB',
      timestamp: '2023-11-15T22:13:20.000Z',
      sign: async () => 'sig-B',
    });
    // Same triple-set → same revision.
    expect(d1.revision).toBe(d2.revision);
    // Different authors → different commitId (Spec 05 §5.2.2).
    expect(d1.commitId).not.toBe(d2.commitId);
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
    const ctx = new Graph('did:graph:z6Mkhrevdet', null, id, storage);
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

describe('§5.2.2 commitId + signature', () => {
  it('commitId is deterministic for the same inputs', () => {
    const c1 = computeCommitId('rev-abc', 'did:key:alice', '2026-01-01T00:00:00.000Z', 'leaf:cap-1');
    const c2 = computeCommitId('rev-abc', 'did:key:alice', '2026-01-01T00:00:00.000Z', 'leaf:cap-1');
    expect(c1).toBe(c2);
  });

  it('commitId changes when leaf cap id changes', () => {
    const a = computeCommitId('rev-abc', 'did:key:alice', '2026-01-01T00:00:00.000Z', 'leaf:cap-1');
    const b = computeCommitId('rev-abc', 'did:key:alice', '2026-01-01T00:00:00.000Z', 'leaf:cap-2');
    expect(a).not.toBe(b);
  });

  it('verifyBundleSignature rejects when revision was tampered', async () => {
    const diff = await createContextDiff({
      graphDid: 'did:graph:victim',
      additions: [],
      removals: [],
      author: 'did:key:alice',
      sign: async () => 'sig-stub',
    });
    // Mutate the bundle: pretend revision is something else.
    const tampered = new GraphDiff({ ...diff, revision: '0'.repeat(64) });
    const r = await verifyBundleSignature(tampered, async () => true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('revision_mismatch');
  });

  it('verifyBundleSignature rejects when signature does not verify', async () => {
    const diff = await createContextDiff({
      graphDid: 'did:graph:victim',
      additions: [],
      removals: [],
      author: 'did:key:alice',
      sign: async () => 'sig-stub',
    });
    const r = await verifyBundleSignature(diff, async () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_invalid');
  });

  it('verifyBundleSignature passes when the verifier accepts the recomputed commitId', async () => {
    const diff = await createContextDiff({
      graphDid: 'did:graph:victim',
      additions: [],
      removals: [],
      author: 'did:key:alice',
      sign: async () => 'sig-stub',
    });
    const r = await verifyBundleSignature(diff, async (commitId, sig) => {
      expect(commitId).toBe(diff.commitId);
      expect(sig).toBe('sig-stub');
      return true;
    });
    expect(r.ok).toBe(true);
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

  it('differs across topologies for the same graph', () => {
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
