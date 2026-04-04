import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import type { SignedTriple } from '@living-web/personal-graph';
import { GraphDiff } from './types.js';

/**
 * Compute a revision hash for a GraphDiff per §4.3:
 * revision = SHA-256(canonicalize(additions) || canonicalize(removals) || sort(dependencies))
 */
export function computeRevision(
  additions: SignedTriple[],
  removals: SignedTriple[],
  dependencies: string[]
): string {
  const addCanon = canonicalize(additions.map(t => canonicalize(tripleToCanonical(t))!).sort()) ?? '';
  const remCanon = canonicalize(removals.map(t => canonicalize(tripleToCanonical(t))!).sort()) ?? '';
  const depsSorted = [...dependencies].sort().join(',');
  const input = addCanon + remCanon + depsSorted;
  const hash = sha256(new TextEncoder().encode(input));
  return bytesToHex(hash);
}

function tripleToCanonical(t: SignedTriple): any {
  return {
    s: t.data.source,
    p: t.data.predicate,
    t: t.data.target,
    a: t.author,
    ts: t.timestamp,
    sig: t.proof.signature,
  };
}

/**
 * Create a GraphDiff from additions and removals.
 */
export function createGraphDiff(
  additions: SignedTriple[],
  removals: SignedTriple[],
  dependencies: string[],
  author: string
): GraphDiff {
  const revision = computeRevision(additions, removals, dependencies);
  return new GraphDiff({
    revision,
    additions,
    removals,
    dependencies,
    author,
    timestamp: Date.now(),
  });
}
