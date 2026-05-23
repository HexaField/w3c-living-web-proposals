/**
 * Pluggable DID resolver. Routes by method.
 *
 * - `did:key` resolves algorithmically (no I/O).
 * - `did:graph` resolves via a registered GraphTripleSource (provided by
 *   @living-web/personal-graph at install time).
 * - Other methods may be registered via `registerResolver()`.
 */

import { resolveDIDKey, type DIDDocument } from './did-key.js';
import {
  isGraphDID,
  isKeyDID,
  resolveDIDGraph,
  type GraphTripleSource,
} from './did-graph.js';

export type AsyncResolver = (did: string) => Promise<DIDDocument | null>;

let graphSource: GraphTripleSource | null = null;
const customResolvers = new Map<string, AsyncResolver>();

/**
 * The personal-graph polyfill registers itself as the source for did:graph
 * resolution. If no source is registered, did:graph resolution fails.
 */
export function registerGraphSource(source: GraphTripleSource): void {
  graphSource = source;
}

/** Register a resolver for an additional DID method (e.g., "web", "peer"). */
export function registerResolver(method: string, resolver: AsyncResolver): void {
  customResolvers.set(method, resolver);
}

export function supportedMethods(): string[] {
  return ['key', 'graph', ...customResolvers.keys()];
}

export async function resolve(did: string): Promise<DIDDocument> {
  if (isKeyDID(did)) {
    return resolveDIDKey(did);
  }
  if (isGraphDID(did)) {
    if (!graphSource) {
      throw new DOMException(
        'did:graph resolution requires @living-web/personal-graph to be installed',
        'NotFoundError',
      );
    }
    return resolveDIDGraph(did, graphSource);
  }
  const method = did.match(/^did:([^:]+):/)?.[1];
  if (method && customResolvers.has(method)) {
    const doc = await customResolvers.get(method)!(did);
    if (!doc) throw new DOMException(`Failed to resolve ${did}`, 'NotFoundError');
    return doc;
  }
  throw new DOMException(`Unsupported DID method: ${did}`, 'NotSupportedError');
}
