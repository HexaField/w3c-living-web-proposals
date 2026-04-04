// Content-addressing for shape definitions — §6.3

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import canonicalize from 'canonicalize';

export function contentAddress(shapeJson: string): string {
  const parsed = JSON.parse(shapeJson);
  const canonical = canonicalize(parsed)!;
  const hash = sha256(new TextEncoder().encode(canonical));
  return `shacl://shape/${bytesToHex(hash)}`;
}
