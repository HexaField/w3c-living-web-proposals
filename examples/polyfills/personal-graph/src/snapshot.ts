/**
 * Graph snapshots — serialise a graph's triples + reifier triples as an
 * addressable, signed payload that round-trips losslessly.
 *
 * The default ("nquads-canonical") serialisation includes both data triples
 * and their reifier triples, so `fromSnapshot` reconstructs an identical
 * graph (same IRI) bit-for-bit. Lossy export formats ("nquads", "turtle",
 * "jsonld") emit data triples only, for interop with RDF tooling that
 * doesn't understand RDF 1.2 reifiers — these cannot be passed back to
 * `fromSnapshot`.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Triple, type Reifier, type SignedTriple } from './types.js';
import { type IdentityProvider } from './signing.js';

export type GraphSignBy = 'agent' | 'graph' | 'both';
export type SnapshotFormat = 'nquads-canonical' | 'nquads' | 'turtle' | 'jsonld';

export interface GraphSnapshot {
  readonly graphIri: string;
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

/** Recompute a graph's IRI from its data triples + reifier metadata. */
export function computeContentHash(triples: readonly SignedTriple[]): string {
  const lines = canonicalDatasetLines(triples);
  const hash = bytesToHex(sha256(new TextEncoder().encode(lines.join('\n'))));
  return `graph://${hash}`;
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
  const format = options.format ?? 'nquads-canonical';
  const signBy = options.signBy ?? 'agent';
  const timestamp = new Date().toISOString();
  const data = serialise(triples, format);

  const proofs: SnapshotProof[] = [];
  const payload = sha256(new TextEncoder().encode(graphIri + '|' + timestamp));

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

const PROV = {
  AUTHOR: 'prov://author',
  TIMESTAMP: 'prov://timestamp',
  METHOD: 'prov://method',
  SIGNATURE: 'prov://signature',
};
const RDF_REIFIES = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies';

function literalize(object: string): string {
  const isUri = /^[a-zA-Z][\w+\-.]*:.+/.test(object) || object.startsWith('_:');
  return isUri ? `<${object}>` : `"${object.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Canonical lines for a graph's full triple set (data triples + reifier
 * triples), sorted lexicographically. This is what `computeContentHash` and
 * the `nquads-canonical` format both hash/emit. A simplified stand-in for
 * the full [[RDF-CANON]] algorithm (the polyfill emits deterministic
 * reifier labels so re-canonicalisation isn't required to reproduce the
 * IRI).
 */
function canonicalDatasetLines(triples: readonly SignedTriple[]): string[] {
  const lines: string[] = [];
  for (const t of triples) {
    const obj = literalize(t.data.object);
    const reifierId = deterministicReifierId(t);
    // Data triple (in default graph; no graph-IRI suffix).
    lines.push(`<${t.data.subject}> <${t.data.predicate}> ${obj} .`);
    // Reifier triple: <_:r-...> rdf:reifies <<( s p o )>>
    lines.push(`${reifierId} <${RDF_REIFIES}> <<( <${t.data.subject}> <${t.data.predicate}> ${obj} )>> .`);
    // Reifier provenance.
    lines.push(`${reifierId} <${PROV.AUTHOR}> <${t.author}> .`);
    lines.push(`${reifierId} <${PROV.TIMESTAMP}> "${t.timestamp}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`);
    lines.push(`${reifierId} <${PROV.METHOD}> <${t.proof.method}> .`);
    lines.push(`${reifierId} <${PROV.SIGNATURE}> "${t.proof.signature}" .`);
  }
  return lines.sort();
}

function deterministicReifierId(t: SignedTriple): string {
  // Stable across serialise/materialise: derives from the signature
  // (which already binds subject/predicate/object/author/timestamp).
  return `_:r-${t.proof.signature.slice(0, 32)}`;
}

function serialise(triples: readonly SignedTriple[], format: SnapshotFormat): string {
  if (format === 'nquads-canonical') {
    return canonicalDatasetLines(triples).join('\n');
  }
  if (format === 'nquads') {
    // Data triples only — lossy.
    return [...triples].map(t =>
      `<${t.data.subject}> <${t.data.predicate}> ${literalize(t.data.object)} .`,
    ).sort().join('\n');
  }
  if (format === 'turtle') {
    return [...triples].map(t =>
      `<${t.data.subject}> <${t.data.predicate}> ${literalize(t.data.object)} .`,
    ).sort().join('\n');
  }
  // jsonld
  return JSON.stringify(triples.map(t => ({
    '@id': t.data.subject,
    predicate: t.data.predicate,
    object: t.data.object,
  })));
}

export interface ParsedSnapshot {
  graphIri: string;
  triples: SignedTriple[];
}

/**
 * Parse a snapshot back into signed triples. Only the lossless
 * `"nquads-canonical"` format yields full provenance and a reproducible
 * IRI; other formats throw.
 */
export function parseSnapshot(snapshot: GraphSnapshot): ParsedSnapshot {
  if (snapshot.format !== 'nquads-canonical') {
    throw new DOMException(
      `Snapshot format "${snapshot.format}" is lossy and cannot be materialised`,
      'NotSupportedError',
    );
  }
  const lines = snapshot.data.split('\n').map(l => l.trim()).filter(Boolean);

  // Group lines by reifier id.
  type Bag = {
    data?: { subject: string; predicate: string; object: string };
    author?: string;
    timestamp?: string;
    method?: string;
    signature?: string;
  };
  const bags = new Map<string, Bag>();

  // Patterns:
  //   <_:r-...> rdf:reifies <<( s p o )>>
  //   <_:r-...> <prov://author> <did:...>
  //   <_:r-...> <prov://timestamp> "<ts>"^^<...>
  //   <_:r-...> <prov://method> <...>
  //   <_:r-...> <prov://signature> "<sig>"
  // (Data triples appear too but are recoverable from the reifies term.)

  for (const line of lines) {
    const reifyMatch = line.match(/^(_:r-\S+)\s+<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#reifies>\s+<<\(\s+<([^>]+)>\s+<([^>]+)>\s+(<[^>]+>|"(?:\\.|[^"\\])*")\s+\)>>\s*\.$/);
    if (reifyMatch) {
      const [, rid, s, p, oRaw] = reifyMatch;
      const o = oRaw.startsWith('<')
        ? oRaw.slice(1, -1)
        : oRaw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const bag = bags.get(rid) ?? {};
      bag.data = { subject: s, predicate: p, object: o };
      bags.set(rid, bag);
      continue;
    }
    const provMatch = line.match(/^(_:r-\S+)\s+<(prov:\/\/(?:author|timestamp|method|signature))>\s+(<[^>]+>|"(?:\\.|[^"\\])*"(?:\^\^<[^>]+>)?)\s*\.$/);
    if (provMatch) {
      const [, rid, pred, valRaw] = provMatch;
      let value: string;
      if (valRaw.startsWith('<')) value = valRaw.slice(1, -1);
      else {
        const closingQuote = valRaw.indexOf('"', 1);
        value = valRaw.slice(1, closingQuote).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      const bag = bags.get(rid) ?? {};
      if (pred === 'prov://author') bag.author = value;
      else if (pred === 'prov://timestamp') bag.timestamp = value;
      else if (pred === 'prov://method') bag.method = value;
      else if (pred === 'prov://signature') bag.signature = value;
      bags.set(rid, bag);
    }
  }

  const triples: SignedTriple[] = [];
  for (const bag of bags.values()) {
    if (!bag.data || !bag.author || !bag.timestamp || !bag.method || !bag.signature) continue;
    triples.push({
      data: new Triple(bag.data.subject, bag.data.predicate, bag.data.object),
      author: bag.author,
      timestamp: bag.timestamp,
      proof: { method: bag.method, signature: bag.signature },
    });
  }

  return { graphIri: snapshot.graphIri, triples };
}

/** Construct a Triple from a parsed record (compatibility helper). */
export function tripleFrom(parsed: SignedTriple | { subject: string; predicate: string; object: string }): Triple {
  if ('data' in parsed) return parsed.data;
  return new Triple(parsed.subject, parsed.predicate, parsed.object);
}
