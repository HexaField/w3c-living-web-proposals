/**
 * DID resolver dispatcher ([[DECENTRALISED-IDENTITY]] §7.1).
 *
 * `did:key` resolves algorithmically. All other methods are dispatched via
 * `registerResolver(method, fn)` — for example `did:graph` is registered by
 * `@living-web/group-identity`. If no resolver is registered for a method,
 * resolution fails with `"NotSupportedError"`.
 */

import { resolveDIDKey, type DIDDocument } from './did-key.js';

export type AsyncResolver = (did: string) => Promise<DIDDocument | null>;

const customResolvers = new Map<string, AsyncResolver>();

/** Register a resolver for a DID method. The "key" method is built in. */
export function registerResolver(method: string, resolver: AsyncResolver): void {
  if (method === 'key') {
    throw new Error('did:key is built in and cannot be overridden');
  }
  customResolvers.set(method, resolver);
}

export function supportedMethods(): string[] {
  return ['key', ...customResolvers.keys()];
}

export async function resolve(did: string): Promise<DIDDocument> {
  if (did.startsWith('did:key:')) {
    return resolveDIDKey(did);
  }
  const method = did.match(/^did:([^:]+):/)?.[1];
  if (method && customResolvers.has(method)) {
    const doc = await customResolvers.get(method)!(did);
    if (!doc) throw new DOMException(`Failed to resolve ${did}`, 'NotFoundError');
    return doc;
  }
  throw new DOMException(`Unsupported DID method: ${did}`, 'NotSupportedError');
}
