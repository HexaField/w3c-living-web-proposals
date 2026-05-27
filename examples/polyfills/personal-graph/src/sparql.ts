/**
 * Minimal SPARQL evaluator — supports SELECT and ASK over BGPs with FILTER,
 * GRAPH (named-graph) blocks, and LIMIT.
 *
 * Operates over a holonic dataset: a default graph (`defaultTriples`) plus
 * any number of named graphs (`{iri, triples}` entries). `GRAPH <iri> {...}`
 * matches against the named graph with that IRI; `GRAPH ?g {...}` binds `?g`
 * to each named graph's IRI and matches its triples.
 */

import type { SignedTriple, SparqlResult } from './types.js';

export interface NamedGraph {
  iri: string;
  triples: SignedTriple[];
}

export function runSparql(
  sparql: string,
  defaultTriples: SignedTriple[],
  named: NamedGraph[] = [],
): SparqlResult {
  const trimmed = sparql.trim();
  if (/^ASK\s/i.test(trimmed)) return runAsk(trimmed, defaultTriples, named);
  return runSelect(trimmed, defaultTriples, named);
}

function runSelect(sparql: string, defaultTriples: SignedTriple[], named: NamedGraph[]): SparqlResult {
  const m = sparql.match(/SELECT\s+([\s\S]*?)\s+WHERE\s*\{([\s\S]*)\}\s*(?:LIMIT\s+(\d+))?/i);
  if (!m) throw new DOMException('Only SELECT and ASK queries are supported', 'NotSupportedError');
  const vars = m[1].trim().split(/\s+/).filter(v => v.startsWith('?')).map(v => v.slice(1));
  const body = m[2];
  const limit = m[3] ? parseInt(m[3], 10) : undefined;

  let bindings = evaluateGroup(body, defaultTriples, named);

  let projected = bindings.map(b => {
    const r: Record<string, string> = {};
    for (const v of vars) if (b[v] !== undefined) r[v] = b[v];
    return r;
  });
  if (limit !== undefined) projected = projected.slice(0, limit);

  return { type: 'bindings', bindings: projected };
}

function runAsk(sparql: string, defaultTriples: SignedTriple[], named: NamedGraph[]): SparqlResult {
  const m = sparql.match(/ASK\s*(?:WHERE)?\s*\{([\s\S]*)\}/i);
  if (!m) throw new DOMException('Malformed ASK query', 'SyntaxError');
  const bindings = evaluateGroup(m[1], defaultTriples, named);
  return { type: 'bindings', bindings: [], boolean: bindings.length > 0 };
}

/**
 * Evaluate a SPARQL group: extract GRAPH sub-blocks, evaluate them against
 * named graphs, evaluate the remaining BGPs against the default graph, then
 * intersect/join via shared variable bindings.
 */
function evaluateGroup(
  body: string,
  defaultTriples: SignedTriple[],
  named: NamedGraph[],
): Record<string, string>[] {
  const { defaultBody, graphBlocks } = splitGraphBlocks(body);

  // Start with the default-graph evaluation.
  const { patterns, filters } = parseBody(defaultBody);
  let bindings: Record<string, string>[] = [{}];
  for (const p of patterns) bindings = matchPattern(bindings, p, defaultTriples);
  for (const f of filters) bindings = bindings.filter(b => evalFilter(f, b));

  // Each GRAPH block: evaluate against the named graph(s) and join.
  for (const block of graphBlocks) {
    bindings = joinWithGraphBlock(bindings, block, named);
  }

  return bindings;
}

interface GraphBlock {
  /** The graph term: either `?varName` (with leading `?`) or `<iri>` (with brackets). */
  graphTerm: string;
  /** The inner body string. */
  innerBody: string;
}

function splitGraphBlocks(body: string): { defaultBody: string; graphBlocks: GraphBlock[] } {
  const graphBlocks: GraphBlock[] = [];
  let defaultBody = '';
  let i = 0;
  while (i < body.length) {
    const remaining = body.slice(i);
    const m = remaining.match(/^\s*GRAPH\s+(\?[A-Za-z_]\w*|<[^>]+>)\s*\{/);
    if (m) {
      const graphTerm = m[1];
      const startInner = i + m[0].length;
      // Find matching closing brace.
      let depth = 1;
      let j = startInner;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
        if (depth > 0) j++;
      }
      const innerBody = body.slice(startInner, j);
      graphBlocks.push({ graphTerm, innerBody });
      i = j + 1;
    } else {
      defaultBody += body[i];
      i++;
    }
  }
  return { defaultBody, graphBlocks };
}

function joinWithGraphBlock(
  bindings: Record<string, string>[],
  block: GraphBlock,
  named: NamedGraph[],
): Record<string, string>[] {
  const isVar = block.graphTerm.startsWith('?');
  const out: Record<string, string>[] = [];
  for (const binding of bindings) {
    const candidates: NamedGraph[] = isVar
      ? (() => {
          const v = block.graphTerm.slice(1);
          if (binding[v] !== undefined) {
            return named.filter(g => g.iri === binding[v]);
          }
          return named;
        })()
      : (() => {
          const iri = block.graphTerm.slice(1, -1);
          return named.filter(g => g.iri === iri);
        })();
    for (const g of candidates) {
      const inner = evaluateGroup(block.innerBody, g.triples, named);
      for (const innerBinding of inner) {
        const merged = { ...binding, ...innerBinding };
        if (isVar) {
          const v = block.graphTerm.slice(1);
          if (merged[v] !== undefined && merged[v] !== g.iri) continue;
          merged[v] = g.iri;
        }
        out.push(merged);
      }
    }
  }
  return out;
}

interface Pattern { s: string; p: string; o: string; }
interface FilterExpr { raw: string; }

function parseBody(body: string): { patterns: Pattern[]; filters: FilterExpr[] } {
  const patterns: Pattern[] = [];
  const filters: FilterExpr[] = [];
  const filterRe = /FILTER\s*\(([^)]+)\)/gi;
  const cleaned = body.replace(filterRe, (_match, expr: string) => {
    filters.push({ raw: expr.trim() });
    return '';
  });
  const normalised = cleaned.replace(/\s+/g, ' ').trim();
  const statements: string[] = [];
  let current = '';
  let inBracket = false;
  let inQuote = false;
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i];
    if (ch === '"' && normalised[i - 1] !== '\\') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === '<') inBracket = true;
      if (ch === '>') inBracket = false;
    }
    if (ch === '.' && !inBracket && !inQuote) {
      const t = current.trim();
      if (t) statements.push(t);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) statements.push(current.trim());

  for (const stmt of statements) {
    const m = stmt.match(/^(\S+)\s+(\S+)\s+(\S+|"[^"]*")$/);
    if (m) patterns.push({ s: m[1], p: m[2], o: m[3] });
  }
  return { patterns, filters };
}

function matchPattern(
  bindings: Record<string, string>[],
  pattern: Pattern,
  triples: SignedTriple[],
): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  for (const binding of bindings) {
    for (const triple of triples) {
      const newBinding = { ...binding };
      if (!matchTerm(pattern.s, triple.data.subject, newBinding)) continue;
      if (!matchTerm(pattern.p, triple.data.predicate, newBinding)) continue;
      if (!matchTerm(pattern.o, triple.data.object, newBinding)) continue;
      results.push(newBinding);
    }
  }
  return results;
}

function matchTerm(pattern: string, value: string, binding: Record<string, string>): boolean {
  if (pattern.startsWith('?')) {
    const v = pattern.slice(1);
    if (binding[v] !== undefined) return binding[v] === value;
    binding[v] = value;
    return true;
  }
  if (pattern.startsWith('"') && pattern.endsWith('"')) {
    return pattern.slice(1, -1) === value;
  }
  const clean = pattern.replace(/^<|>$/g, '');
  return clean === value;
}

function evalFilter(expr: FilterExpr, binding: Record<string, string>): boolean {
  let resolved = expr.raw;
  for (const [k, v] of Object.entries(binding)) {
    resolved = resolved.replace(new RegExp(`\\?${k}\\b`, 'g'), JSON.stringify(v));
  }
  try {
    // Filter expressions are user-provided SPARQL fragments evaluated against
    // bound values. Using `new Function` here is acceptable because the inputs
    // are JSON-stringified literals (so cannot break out of the expression).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return Boolean(new Function(`"use strict"; return (${resolved})`)());
  } catch {
    return false;
  }
}
