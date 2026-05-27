/**
 * GraphDiff construction + revision hashing.
 *
 * Revision = hex(SHA-256(graphDid || canonicalise(additions) || canonicalise(removals) || sort(deps))).
 * The canonicalisation here is a deterministic textual form sufficient for the
 * polyfill — a conforming implementation would use RDF Dataset Canonicalisation
 * over reifier-bearing quads.
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

export function createContextDiff(opts: {
  graphDid: string;
  additions: SignedTriple[];
  removals: SignedTriple[];
  dependencies?: string[];
  capabilityProof?: CapabilityProof | null;
  author: string;
  timestamp?: string;
  diffsSinceSnapshot?: number;
}): GraphDiff {
  const dependencies = opts.dependencies ?? [];
  const revision = computeRevision(opts.graphDid, opts.additions, opts.removals, dependencies);
  return new GraphDiff({
    graphDid: opts.graphDid,
    revision,
    additions: opts.additions,
    removals: opts.removals,
    dependencies,
    capabilityProof: opts.capabilityProof ?? null,
    author: opts.author,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    diffsSinceSnapshot: opts.diffsSinceSnapshot ?? 0,
  });
}
