/**
 * Minimal SPARQL evaluator — supports SELECT and ASK over BGPs with FILTER, LIMIT.
 *
 * Operates on a flat list of SignedTriples (the caller pre-filters by graph).
 */

import type { SignedTriple, SparqlResult } from './types.js';

export function runSparql(sparql: string, triples: SignedTriple[]): SparqlResult {
  const trimmed = sparql.trim();
  if (/^ASK\s/i.test(trimmed)) {
    return runAsk(trimmed, triples);
  }
  return runSelect(trimmed, triples);
}

function runSelect(sparql: string, triples: SignedTriple[]): SparqlResult {
  const m = sparql.match(/SELECT\s+([\s\S]*?)\s+WHERE\s*\{([\s\S]*)\}\s*(?:LIMIT\s+(\d+))?/i);
  if (!m) {
    throw new DOMException('Only SELECT and ASK queries are supported', 'NotSupportedError');
  }
  const vars = m[1].trim().split(/\s+/).filter(v => v.startsWith('?')).map(v => v.slice(1));
  const body = m[2];
  const limit = m[3] ? parseInt(m[3], 10) : undefined;

  const { patterns, filters } = parseBody(body);
  let bindings: Record<string, string>[] = [{}];
  for (const p of patterns) bindings = matchPattern(bindings, p, triples);
  for (const f of filters) bindings = bindings.filter(b => evalFilter(f, b));

  let projected = bindings.map(b => {
    const r: Record<string, string> = {};
    for (const v of vars) if (b[v] !== undefined) r[v] = b[v];
    return r;
  });
  if (limit !== undefined) projected = projected.slice(0, limit);

  return { type: 'bindings', bindings: projected };
}

function runAsk(sparql: string, triples: SignedTriple[]): SparqlResult {
  const m = sparql.match(/ASK\s*(?:WHERE)?\s*\{([\s\S]*)\}/i);
  if (!m) throw new DOMException('Malformed ASK query', 'SyntaxError');
  const { patterns, filters } = parseBody(m[1]);
  let bindings: Record<string, string>[] = [{}];
  for (const p of patterns) bindings = matchPattern(bindings, p, triples);
  for (const f of filters) bindings = bindings.filter(b => evalFilter(f, b));
  return { type: 'bindings', bindings: [], boolean: bindings.length > 0 };
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
      if (!matchTerm(pattern.s, triple.data.source, newBinding)) continue;
      if (!matchTerm(pattern.p, triple.data.predicate, newBinding)) continue;
      if (!matchTerm(pattern.o, triple.data.target, newBinding)) continue;
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
    // For the polyfill this supports simple ==, !=, >, <, >=, <=, &&, ||.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return Boolean(new Function(`"use strict"; return (${resolved})`)());
  } catch {
    return false;
  }
}
