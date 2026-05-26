/**
 * Graph snapshots — serialise a context's triples as an addressable, signed
 * payload that can be mounted by another GraphStore.
 *
 * A snapshot's `graphIri` IS its content hash — the IRI is computed from
 * the triples themselves, not assigned. Verification is a single rehash.
 * For evolving graphs that mutate over time, see Spec 10's `did:graph`:
 * a snapshot carries its source context's `graphDid` (when present) so
 * that the recipient can subscribe to the *graph* via sync, rather than
 * being limited to this one frozen state.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Triple, type SignedTriple } from './types.js';
import { type IdentityProvider } from './signing.js';
import { computeGraphIri } from './context.js';

export type GraphSignBy = 'agent' | 'graph' | 'both';
export type SnapshotFormat = 'nquads' | 'jsonld';

export interface GraphSnapshot {
  /** The context's content-hash IRI at the time the snapshot was taken. */
  readonly graphIri: string;
  /** Optional did:graph:... of the underlying context, if groupified. */
  readonly graphDid: string | null;
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

/** Recompute a context's IRI from its signed triples. */
export function computeContentHash(triples: readonly SignedTriple[]): string {
  return computeGraphIri(triples);
}

export interface GetAsSnapshotOptions {
  format?: SnapshotFormat;
  signBy?: GraphSignBy;
}

export async function getAsSnapshot(
  graphIri: string,
  graphDid: string | null,
  triples: readonly SignedTriple[],
  agentIdentity: IdentityProvider | null,
  graphIdentity: IdentityProvider | null,
  options: GetAsSnapshotOptions = {},
): Promise<GraphSnapshot> {
  const format = options.format ?? 'nquads';
  const signBy = options.signBy ?? 'agent';
  const timestamp = new Date().toISOString();
  const data = serialise(triples, format);

  const proofs: SnapshotProof[] = [];
  const payload = sha256(new TextEncoder().encode(graphIri + timestamp));

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

  return { graphIri, graphDid, format, timestamp, data, proofs };
}

function serialise(triples: readonly SignedTriple[], format: SnapshotFormat): string {
  if (format === 'nquads') {
    return triples.map(t => {
      const isUri = /^[a-zA-Z][\w+\-.]*:.+/.test(t.data.object);
      const obj = isUri ? `<${t.data.object}>` : `"${t.data.object.replace(/"/g, '\\"')}"`;
      return `<${t.data.subject}> <${t.data.predicate}> ${obj} .`;
    }).sort().join('\n');
  }
  return JSON.stringify(triples.map(t => ({
    '@id': t.data.subject,
    predicate: t.data.predicate,
    object: t.data.object,
  })));
}

export interface ParsedSnapshot {
  graphIri: string;
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
  return { graphIri: snapshot.graphIri, triples };
}

/** Construct a Triple from a parsed triple record. */
export function tripleFrom(parsed: { subject: string; predicate: string; object: string }): Triple {
  return new Triple(parsed.subject, parsed.predicate, parsed.object);
}
