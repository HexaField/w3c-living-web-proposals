/**
 * GraphDiff construction, revision/commitId hashing, and bundle signature.
 *
 * Spec 05 §5.2.2:
 *   revision  = SHA-256(graphDid || canon(additions) || canon(removals) || sort(deps))
 *   commitId  = SHA-256(revision || author || timestamp || chain[0])
 *   signature = sign(authorKey, commitId)
 *
 * The polyfill takes a `sign` callback supplied by the caller (typically
 * routed through the agent's IdentityProvider). A producer that already has
 * the signature MAY pass it as `signature` to `createContextDiff` directly.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { SignedTriple } from '@living-web/personal-graph';
import { GraphDiff, type CapabilityProof } from './types.js';

function canonicalise(triples: readonly SignedTriple[]): string {
  return triples.map(t => {
    const object = /^[a-zA-Z][\w+\-.]*:.+/.test(t.data.object)
      ? `<${t.data.object}>`
      : `"${t.data.object.replace(/"/g, '\\"')}"`;
    return `<${t.data.subject}> <${t.data.predicate}> ${object} . ${t.author} ${t.timestamp} ${t.proof.signature}`;
  }).sort().join('\n');
}

/** Spec 05 §5.2.2 — triple-set identity. */
export function computeRevision(
  graphDid: string,
  additions: readonly SignedTriple[],
  removals: readonly SignedTriple[],
  dependencies: readonly string[],
): string {
  const input =
    `graph:${graphDid}\n+\n${canonicalise(additions)}\n-\n${canonicalise(removals)}\ndeps:${[...dependencies].sort().join(',')}`;
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

/** Spec 05 §5.2.2 — commit identity. Binds author, timestamp, and leaf cap. */
export function computeCommitId(
  revision: string,
  author: string,
  timestamp: string,
  leafCapId: string,
): string {
  const input = `rev:${revision}\nauthor:${author}\nts:${timestamp}\nleaf:${leafCapId}`;
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

export type SignCommitFn = (commitId: string) => Promise<string> | string;

/**
 * Build a signed GraphDiff. The `sign` callback receives the computed
 * `commitId` and returns the multibase-encoded signature by the author's
 * key (or, for graph-DID authors, by a current `capabilityDelegation`
 * delegate's key per Spec 05 §5.2.2).
 *
 * If `signature` is supplied directly (e.g., on the receiving side when
 * reconstructing a diff from the wire), the `sign` callback is ignored.
 */
export async function createContextDiff(opts: {
  graphDid: string;
  additions: SignedTriple[];
  removals: SignedTriple[];
  dependencies?: string[];
  capabilityProof?: CapabilityProof | null;
  author: string;
  timestamp?: string;
  diffsSinceSnapshot?: number;
  /** Either provide a signer (commit-time path) … */
  sign?: SignCommitFn;
  /** … or pass the pre-computed signature (wire-reconstruction path). */
  signature?: string;
}): Promise<GraphDiff> {
  const dependencies = opts.dependencies ?? [];
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const leafCapId = opts.capabilityProof?.chain?.[0] ?? '';
  const revision = computeRevision(opts.graphDid, opts.additions, opts.removals, dependencies);
  const commitId = computeCommitId(revision, opts.author, timestamp, leafCapId);

  let signature: string;
  if (opts.signature !== undefined) {
    signature = opts.signature;
  } else if (opts.sign) {
    signature = await opts.sign(commitId);
  } else {
    throw new Error('createContextDiff requires either `sign` or `signature`');
  }

  return new GraphDiff({
    graphDid: opts.graphDid,
    revision,
    commitId,
    additions: opts.additions,
    removals: opts.removals,
    dependencies,
    capabilityProof: opts.capabilityProof ?? null,
    author: opts.author,
    timestamp,
    diffsSinceSnapshot: opts.diffsSinceSnapshot ?? 0,
    signature,
  });
}

/**
 * Verify a received diff's bundle signature (Spec 05 §9.2.1 step 0).
 *
 * Recomputes `commitId` from the received fields and calls back to
 * `verify(commitId, signature, author)` — a callback because key resolution
 * for non-`did:key` authors needs the full identity stack. Returns
 * `{ ok: true }` on success, `{ ok: false, reason }` on any mismatch.
 *
 * The supplied `verify` is typically the IdentityProvider's
 * `verifySignature` bound to the resolved author key.
 */
export async function verifyBundleSignature(
  diff: GraphDiff,
  verify: (commitId: string, signature: string, author: string) => Promise<boolean> | boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const leafCapId = diff.capabilityProof?.chain?.[0] ?? '';
  const recomputedRevision = computeRevision(diff.graphDid, diff.additions, diff.removals, diff.dependencies);
  if (recomputedRevision !== diff.revision) {
    return { ok: false, reason: 'revision_mismatch' };
  }
  const recomputedCommitId = computeCommitId(diff.revision, diff.author, diff.timestamp, leafCapId);
  if (recomputedCommitId !== diff.commitId) {
    return { ok: false, reason: 'commitId_mismatch' };
  }
  const ok = await verify(diff.commitId, diff.signature, diff.author);
  return ok ? { ok: true } : { ok: false, reason: 'signature_invalid' };
}
