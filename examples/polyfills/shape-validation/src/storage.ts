// Content-addressing for shape definitions.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';

/** Compute the content-address URI for a shape definition (canonicalised JSON). */
export function contentAddress(shapeJson: string): string {
  const parsed = JSON.parse(shapeJson);
  const canonical = canonicalize(parsed)!;
  const hash = sha256(new TextEncoder().encode(canonical));
  return `shape://content/${bytesToHex(hash)}`;
}
