/**
 * Sync space derivation — deterministic from topology + context identity.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { SpaceTopology } from './types.js';

export function deriveSpaceUri(
  topology: SpaceTopology,
  graphDid: string,
  options: { neighbourhoodId?: string; customName?: string } = {},
): string {
  let input: string;
  switch (topology) {
    case 'unified':
      input = `lwsync:unified:${options.neighbourhoodId ?? 'default'}`;
      break;
    case 'privacy-tiered':
      // Polyfill simplification: treat all as public unless customSpace is provided.
      input = `lwsync:public:${options.neighbourhoodId ?? 'default'}`;
      break;
    case 'fully-partitioned':
      input = `lwsync:dedicated:${graphDid}`;
      break;
    case 'custom':
      input = `lwsync:named:${options.customName ?? 'default'}`;
      break;
  }
  const hash = bytesToHex(sha256(new TextEncoder().encode(input)));
  return `space://${hash}`;
}
