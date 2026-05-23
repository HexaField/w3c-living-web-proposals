/**
 * Graph snapshots — serialise a context's triples as an addressable, signed
 * payload that can be mounted by another GraphStore.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Triple, type SignedTriple } from './types.js';
import { canonicalNQuad, type IdentityProvider } from './signing.js';

export type GraphSignBy = 'agent' | 'graph' | 'both';
export type SnapshotFormat = 'nquads' | 'jsonld';

export interface GraphSnapshot {
  readonly graphDid: string;
  readonly contentHash: string;
  readonly format: SnapshotFormat;
  readonly timestamp: string;
  readonly data: string;
  readonly proofs: SnapshotProof[];
}

export interface SnapshotProof {
  readonly role: 'agent' | 'graph';
  readonly author: string;
  readonly method: string;
  readonly signature: string;
}

export function computeContentHash(triples: readonly SignedTriple[], graphDid: string): string {
  const lines = triples.map(t => canonicalNQuad(t.data, graphDid)).sort();
  return bytesToHex(sha256(new TextEncoder().encode(lines.join('\n'))));
}

export interface GetAsSnapshotOptions {
  format?: SnapshotFormat;
  signBy?: GraphSignBy;
}

export async function getAsSnapshot(
  graphDid: string,
  triples: readonly SignedTriple[],
  agentIdentity: IdentityProvider | null,
  graphIdentity: IdentityProvider | null,
  options: GetAsSnapshotOptions = {},
): Promise<GraphSnapshot> {
  const format = options.format ?? 'nquads';
  const signBy = options.signBy ?? 'agent';
  const contentHash = computeContentHash(triples, graphDid);
  const timestamp = new Date().toISOString();
  const data = serialise(triples, graphDid, format);

  const proofs: SnapshotProof[] = [];
  const payload = sha256(new TextEncoder().encode(contentHash + timestamp));

  if ((signBy === 'agent' || signBy === 'both') && agentIdentity) {
    const sig = await agentIdentity.sign(payload);
    proofs.push({
      role: 'agent',
      author: agentIdentity.getDID(),
      method: agentIdentity.getKeyURI(),
      signature: bytesToHex(sig),
    });
  }
  if ((signBy === 'graph' || signBy === 'both') && graphIdentity) {
    const sig = await graphIdentity.sign(payload);
    proofs.push({
      role: 'graph',
      author: graphIdentity.getDID(),
      method: graphIdentity.getKeyURI(),
      signature: bytesToHex(sig),
    });
  }

  if (proofs.length === 0) {
    throw new Error(`No identity available for signBy="${signBy}"`);
  }

  return { graphDid, contentHash, format, timestamp, data, proofs };
}

function serialise(triples: readonly SignedTriple[], graphDid: string, format: SnapshotFormat): string {
  if (format === 'nquads') {
    return triples.map(t => canonicalNQuad(t.data, graphDid)).sort().join('\n');
  }
  return JSON.stringify(triples.map(t => ({
    '@id': t.data.subject,
    predicate: t.data.predicate,
    object: t.data.object,
  })));
}

export interface ParsedSnapshot {
  graphDid: string;
  triples: Array<{ subject: string; predicate: string; object: string }>;
}

/** Parse a snapshot back into triples for mounting. */
export function parseSnapshot(snapshot: GraphSnapshot): ParsedSnapshot {
  const triples: ParsedSnapshot['triples'] = [];
  if (snapshot.format === 'nquads') {
    for (const raw of snapshot.data.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^<([^>]+)>\s+<([^>]+)>\s+(<[^>]+>|"[^"]*")(?:\s+<[^>]+>)?\s*\.$/);
      if (!m) continue;
      const object = m[3].startsWith('<') ? m[3].slice(1, -1) : m[3].slice(1, -1);
      triples.push({ subject: m[1], predicate: m[2], object });
    }
  } else if (snapshot.format === 'jsonld') {
    const parsed = JSON.parse(snapshot.data) as Array<{ '@id': string; predicate: string; object: string }>;
    for (const t of parsed) triples.push({ subject: t['@id'], predicate: t.predicate, object: t.object });
  }
  return { graphDid: snapshot.graphDid, triples };
}

/** Re-export for convenience: parseTripleFromNquad just instantiates Triple. */
export function tripleFrom(parsed: { subject: string; predicate: string; object: string }): Triple {
  return new Triple(parsed.subject, parsed.predicate, parsed.object);
}
