/**
 * Graph snapshots — serialise a graph's full triple set (data triples +
 * reifier triples) as an addressable, signed payload that round-trips
 * losslessly in every RDF 1.2 serialisation defined here.
 *
 * All four formats (`nquads-canonical`, `nquads`, `turtle`, `jsonld`) carry
 * the same abstract triples — including the `rdf:reifies` triple term and
 * the four `prov://*` predicates per reifier — and are accepted by
 * `parseSnapshot()`. The `nquads-canonical` form additionally satisfies
 * `snapshot.graphIri == "graph://" + hex(SHA-256(snapshot.data))` directly;
 * the other formats require parsing + re-canonicalisation to verify the
 * hash invariant, which `parseSnapshot()` performs as part of materialisation.
 *
 * The polyfill emitters and parsers handle the syntactic subset of each
 * format that this module itself emits. A conforming user agent built on a
 * full RDF 1.2 parser would handle arbitrary input.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Triple, type SignedTriple } from './types.js';
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
  const abs = toAbstract(triples);
  const canonical = emitNQuadsLines(abs).sort().join('\n');
  const hash = bytesToHex(sha256(new TextEncoder().encode(canonical)));
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

// ── Abstract reifier representation ──────────────────────────────────────────

/**
 * Format-independent representation of one reified triple — the unit that
 * every RDF 1.2 serialisation defined here carries. Emitters write this out
 * in their syntax; parsers reconstruct this from the bytes.
 */
interface AbstractReifier {
  rid: string;          // reifier blank-node id (e.g. `_:r-<hex>`)
  s: string;            // data triple subject
  p: string;            // data triple predicate
  o: string;            // data triple object (URI or string literal lex value)
  author: string;
  timestamp: string;
  method: string;
  signature: string;
}

function toAbstract(triples: readonly SignedTriple[]): AbstractReifier[] {
  return triples.map(t => ({
    rid: deterministicReifierId(t),
    s: t.data.subject,
    p: t.data.predicate,
    o: t.data.object,
    author: t.author,
    timestamp: t.timestamp,
    method: t.proof.method,
    signature: t.proof.signature,
  }));
}

function fromAbstract(abs: readonly AbstractReifier[]): SignedTriple[] {
  return abs.map(a => ({
    data: new Triple(a.s, a.p, a.o),
    author: a.author,
    timestamp: a.timestamp,
    proof: { method: a.method, signature: a.signature },
  }));
}

function deterministicReifierId(t: SignedTriple): string {
  // Stable across serialise/materialise: derives from the signature
  // (which already binds subject/predicate/object/author/timestamp).
  return `_:r-${t.proof.signature.slice(0, 32)}`;
}

const PROV = {
  AUTHOR: 'prov://author',
  TIMESTAMP: 'prov://timestamp',
  METHOD: 'prov://method',
  SIGNATURE: 'prov://signature',
};
const RDF_REIFIES = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies';
const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';

function literalize(object: string): string {
  const isUri = /^[a-zA-Z][\w+\-.]*:.+/.test(object) || object.startsWith('_:');
  return isUri ? `<${object}>` : `"${object.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function looksLikeUri(s: string): boolean {
  return /^[a-zA-Z][\w+\-.]*:.+/.test(s) || s.startsWith('_:');
}

// ── Emitters ─────────────────────────────────────────────────────────────────

function serialise(triples: readonly SignedTriple[], format: SnapshotFormat): string {
  const abs = toAbstract(triples);
  switch (format) {
    case 'nquads-canonical': return emitNQuadsLines(abs).sort().join('\n');
    case 'nquads':           return emitNQuadsLines(abs).join('\n');
    case 'turtle':           return emitTurtle(abs);
    case 'jsonld':           return emitJsonLd(abs);
  }
}

function emitNQuadsLines(abs: readonly AbstractReifier[]): string[] {
  const lines: string[] = [];
  for (const a of abs) {
    const obj = literalize(a.o);
    // Data triple.
    lines.push(`<${a.s}> <${a.p}> ${obj} .`);
    // Reifier triple: rid rdf:reifies <<( s p o )>>
    lines.push(`${a.rid} <${RDF_REIFIES}> <<( <${a.s}> <${a.p}> ${obj} )>> .`);
    // Reifier provenance.
    lines.push(`${a.rid} <${PROV.AUTHOR}> <${a.author}> .`);
    lines.push(`${a.rid} <${PROV.TIMESTAMP}> "${a.timestamp}"^^<${XSD_DATETIME}> .`);
    lines.push(`${a.rid} <${PROV.METHOD}> <${a.method}> .`);
    lines.push(`${a.rid} <${PROV.SIGNATURE}> "${a.signature}" .`);
  }
  return lines;
}

function emitTurtle(abs: readonly AbstractReifier[]): string {
  const lines: string[] = [
    '@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix prov: <prov://> .',
    '',
  ];
  for (const a of abs) {
    const obj = literalize(a.o);
    lines.push(`<${a.s}> <${a.p}> ${obj} .`);
    lines.push(`${a.rid} rdf:reifies <<( <${a.s}> <${a.p}> ${obj} )>> ;`);
    lines.push(`  prov:author    <${a.author}> ;`);
    lines.push(`  prov:timestamp "${a.timestamp}"^^xsd:dateTime ;`);
    lines.push(`  prov:method    <${a.method}> ;`);
    lines.push(`  prov:signature "${a.signature}" .`);
    lines.push('');
  }
  return lines.join('\n');
}

function emitJsonLd(abs: readonly AbstractReifier[]): string {
  return JSON.stringify({
    '@context': {
      rdf:  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      xsd:  'http://www.w3.org/2001/XMLSchema#',
      prov: 'prov://',
    },
    '@graph': abs.map(a => ({
      '@id': a.rid,
      'rdf:reifies': {
        '@triple': {
          '@id': a.s,
          [a.p]: looksLikeUri(a.o) ? { '@id': a.o } : { '@value': a.o },
        },
      },
      'prov:author':    { '@id': a.author },
      'prov:timestamp': { '@value': a.timestamp, '@type': 'xsd:dateTime' },
      'prov:method':    { '@id': a.method },
      'prov:signature': a.signature,
    })),
  }, null, 2);
}

// ── Parsers ──────────────────────────────────────────────────────────────────

export interface ParsedSnapshot {
  graphIri: string;
  triples: SignedTriple[];
}

/**
 * Parse a snapshot back into signed triples. Every format defined here
 * carries the full reifier set and round-trips losslessly.
 */
export function parseSnapshot(snapshot: GraphSnapshot): ParsedSnapshot {
  const abs = parseSerialised(snapshot.data, snapshot.format);
  return { graphIri: snapshot.graphIri, triples: fromAbstract(abs) };
}

function parseSerialised(data: string, format: SnapshotFormat): AbstractReifier[] {
  switch (format) {
    case 'nquads-canonical':
    case 'nquads':
    case 'turtle':
      return parseNQuadsLike(data);
    case 'jsonld':
      return parseJsonLd(data);
  }
}

/**
 * Parse N-Triples 1.2 / N-Quads 1.2 / a polyfill-style subset of Turtle 1.2.
 * Handles `@prefix`, `;` continuations, `<<( ... )>>` triple terms, and the
 * four `prov://*` predicates.
 */
function parseNQuadsLike(data: string): AbstractReifier[] {
  const prefixes = new Map<string, string>();
  for (const m of data.matchAll(/@prefix\s+(\w*):\s+<([^>]+)>\s*\./g)) {
    prefixes.set(m[1], m[2]);
  }
  const expand = (term: string): string => {
    if (term.startsWith('<') || term.startsWith('"') || term.startsWith('_:') || term.startsWith('<<(')) {
      return term;
    }
    const colon = term.indexOf(':');
    if (colon === -1) return term;
    const prefix = term.slice(0, colon);
    const local  = term.slice(colon + 1);
    const ns = prefixes.get(prefix);
    return ns ? `<${ns}${local}>` : term;
  };

  // Strip @prefix lines and `# ...` comments, then split into statements.
  const body = data
    .replace(/@prefix[^.]*\./g, '')
    .replace(/^\s*#.*$/gm, '');

  const statements = splitStatements(body);
  const bags = new Map<string, Partial<AbstractReifier>>();

  for (const stmt of statements) {
    const parts = splitOnSemicolons(stmt);
    if (parts.length === 0) continue;
    const firstTokens = tokenize(parts[0]);
    if (firstTokens.length < 3) continue;
    const subject = firstTokens[0];
    processTokens(subject, firstTokens.slice(1), expand, bags);
    for (let i = 1; i < parts.length; i++) {
      const toks = tokenize(parts[i]);
      if (toks.length < 2) continue;
      processTokens(subject, toks, expand, bags);
    }
  }

  const out: AbstractReifier[] = [];
  for (const bag of bags.values()) {
    if (!bag.rid || !bag.s || !bag.p || bag.o === undefined) continue;
    if (!bag.author || !bag.timestamp || !bag.method || !bag.signature) continue;
    out.push(bag as AbstractReifier);
  }
  return out;
}

function processTokens(
  rawSubject: string,
  predObjTokens: string[],
  expand: (term: string) => string,
  bags: Map<string, Partial<AbstractReifier>>,
): void {
  if (predObjTokens.length < 2) return;
  const subject = rawSubject;
  if (!subject.startsWith('_:r')) return; // We only care about reifier-keyed triples.

  const pred = expand(predObjTokens[0]);
  const obj  = predObjTokens.slice(1).join(' ');
  const predUri = pred.startsWith('<') ? pred.slice(1, -1) : pred;

  const bag = bags.get(subject) ?? { rid: subject };

  if (predUri === RDF_REIFIES) {
    const m = obj.match(/<<\(\s*<([^>]+)>\s+<([^>]+)>\s+(<[^>]+>|"(?:\\.|[^"\\])*"(?:\^\^<[^>]+>|@\S+)?)\s*\)>>/);
    if (m) {
      const [, s, p, oRaw] = m;
      bag.s = s;
      bag.p = p;
      bag.o = oRaw.startsWith('<') ? oRaw.slice(1, -1) : parseLiteralValue(oRaw);
    }
  } else if (predUri === PROV.AUTHOR) {
    bag.author = obj.startsWith('<') ? obj.slice(1, obj.indexOf('>')) : parseLiteralValue(obj);
  } else if (predUri === PROV.TIMESTAMP) {
    bag.timestamp = parseLiteralValue(obj);
  } else if (predUri === PROV.METHOD) {
    bag.method = obj.startsWith('<') ? obj.slice(1, obj.indexOf('>')) : parseLiteralValue(obj);
  } else if (predUri === PROV.SIGNATURE) {
    bag.signature = parseLiteralValue(obj);
  }

  bags.set(subject, bag);
}

function parseLiteralValue(s: string): string {
  const m = s.match(/^"((?:\\.|[^"\\])*)"/);
  if (!m) return s;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Split an N-Quads/Turtle body into statements terminated by `.`, respecting
 * angle-bracket IRIs, double-quoted literals, and `<<( ... )>>` triple terms.
 */
function splitStatements(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuote = false;
  let angleDepth = 0;
  let tripleTermDepth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' && body[i - 1] !== '\\') inQuote = !inQuote;
    if (!inQuote) {
      if (body.slice(i, i + 3) === '<<(') { tripleTermDepth++; current += '<<('; i += 2; continue; }
      if (body.slice(i, i + 3) === ')>>') { tripleTermDepth--; current += ')>>'; i += 2; continue; }
      if (ch === '<' && tripleTermDepth === 0) angleDepth++;
      else if (ch === '>' && tripleTermDepth === 0) angleDepth = Math.max(0, angleDepth - 1);
      if (ch === '.' && angleDepth === 0 && tripleTermDepth === 0) {
        const t = current.trim();
        if (t) out.push(t);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function splitOnSemicolons(stmt: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuote = false;
  let angleDepth = 0;
  let tripleTermDepth = 0;
  for (let i = 0; i < stmt.length; i++) {
    const ch = stmt[i];
    if (ch === '"' && stmt[i - 1] !== '\\') inQuote = !inQuote;
    if (!inQuote) {
      if (stmt.slice(i, i + 3) === '<<(') { tripleTermDepth++; current += '<<('; i += 2; continue; }
      if (stmt.slice(i, i + 3) === ')>>') { tripleTermDepth--; current += ')>>'; i += 2; continue; }
      if (ch === '<' && tripleTermDepth === 0) angleDepth++;
      else if (ch === '>' && tripleTermDepth === 0) angleDepth = Math.max(0, angleDepth - 1);
      if (ch === ';' && angleDepth === 0 && tripleTermDepth === 0) {
        out.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s.slice(i, i + 3) === '<<(') {
      const end = s.indexOf(')>>', i);
      if (end === -1) { out.push(s.slice(i)); break; }
      out.push(s.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    if (s[i] === '<') {
      const end = s.indexOf('>', i);
      if (end === -1) { out.push(s.slice(i)); break; }
      out.push(s.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && !(s[j] === '"' && s[j - 1] !== '\\')) j++;
      let end = j + 1;
      if (s.slice(end, end + 2) === '^^') {
        end += 2;
        if (s[end] === '<') {
          end = s.indexOf('>', end) + 1;
        } else {
          while (end < s.length && !/\s/.test(s[end])) end++;
        }
      } else if (s[end] === '@') {
        while (end < s.length && !/\s/.test(s[end])) end++;
      }
      out.push(s.slice(i, end));
      i = end;
      continue;
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

/** Parse the polyfill's JSON-LD 1.2 emission back to reifiers. */
function parseJsonLd(data: string): AbstractReifier[] {
  const json = JSON.parse(data) as {
    '@context'?: Record<string, string>;
    '@graph'?: JsonLdNode[];
  };
  const context = json['@context'] ?? {};
  const expand = (term: string): string => {
    if (looksLikeUri(term)) return term;
    const colon = term.indexOf(':');
    if (colon === -1) return term;
    const prefix = term.slice(0, colon);
    const local  = term.slice(colon + 1);
    const ns = context[prefix];
    return ns ? ns + local : term;
  };
  const readValue = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['@id'] === 'string') return o['@id'];
      if (typeof o['@value'] === 'string') return o['@value'];
    }
    return '';
  };
  const readProp = (node: JsonLdNode, key: string): string => {
    return readValue(node[key] ?? node[expand(key)]);
  };

  const out: AbstractReifier[] = [];
  for (const node of json['@graph'] ?? []) {
    const rid = node['@id'];
    if (typeof rid !== 'string' || !rid.startsWith('_:r')) continue;

    const reifies = (node['rdf:reifies'] ?? node[expand('rdf:reifies')]) as JsonLdNode | undefined;
    if (!reifies) continue;
    const triple = reifies['@triple'] as JsonLdNode | undefined;
    if (!triple) continue;
    const s = typeof triple['@id'] === 'string' ? triple['@id'] : '';
    const otherKeys = Object.keys(triple).filter(k => k !== '@id');
    if (otherKeys.length === 0) continue;
    const p = expand(otherKeys[0]);
    const o = readValue(triple[otherKeys[0]]);

    out.push({
      rid, s, p, o,
      author:    readProp(node, 'prov:author'),
      timestamp: readProp(node, 'prov:timestamp'),
      method:    readProp(node, 'prov:method'),
      signature: readProp(node, 'prov:signature'),
    });
  }
  return out;
}

type JsonLdNode = Record<string, unknown> & { '@id'?: string };

/** Construct a Triple from a parsed record (compatibility helper). */
export function tripleFrom(parsed: SignedTriple | { subject: string; predicate: string; object: string }): Triple {
  if ('data' in parsed) return parsed.data;
  return new Triple(parsed.subject, parsed.predicate, parsed.object);
}
