/**
 * Context method binding — runtime hook by which personal-graph delegates
 * `did:graph` semantics to whatever package implements the DID method.
 *
 * personal-graph contexts are identified by `did:graph:...` DIDs (per
 * [[GROUP-IDENTITY]] §4), but personal-graph does NOT itself know how to mint
 * a `did:graph`, seed its DID document, or transform between key bytes and
 * DID URIs. Those concerns belong to the DID method specification.
 *
 * At install time `@living-web/group-identity` registers a binding here. If
 * no binding is installed, attempts to create a context fail with
 * `"NotSupportedError"`.
 */

import type { DIDCredential } from '@living-web/identity';

export interface GraphSeedTriple {
  subject: string;
  predicate: string;
  object: string;
}

export type DIDCapabilitySection =
  | 'capabilityInvocation'
  | 'capabilityDelegation'
  | 'assertionMethod'
  | 'authentication';

export interface ContextMethodBinding {
  /**
   * Mint a fresh credential whose DID will identify a new context. The DID
   * MUST be of a method whose document can be projected from triples in the
   * context the DID identifies (currently: `did:graph`).
   */
  mintContextCredential(
    displayName: string,
    passphrase: string,
  ): Promise<{ credential: DIDCredential; publicKey: Uint8Array; privateKey: Uint8Array }>;

  /**
   * Produce the seed triples for a freshly created context — the initial
   * DID-document triples (a single verification method, all sections granted
   * to the creator).
   */
  seedTriples(graphDid: string): Iterable<GraphSeedTriple>;

  /**
   * Produce the triples that add a new delegate verification method to a
   * context's DID document, granting it the named capability sections.
   */
  addDelegateTriples(
    graphDid: string,
    delegateDid: string,
    sections: DIDCapabilitySection[],
  ): Iterable<GraphSeedTriple>;

  /** Decode a DID into its public-key bytes (for delegate addition). */
  publicKeyFromDid(did: string): Uint8Array;
}

let activeBinding: ContextMethodBinding | null = null;

/** Install the binding. Called by `@living-web/group-identity` at install time. */
export function registerContextMethodBinding(binding: ContextMethodBinding): void {
  activeBinding = binding;
}

/** Return the active binding, or `null` if none is installed. */
export function getContextMethodBinding(): ContextMethodBinding | null {
  return activeBinding;
}

/** Return the active binding, or throw `"NotSupportedError"` if none is installed. */
export function requireContextMethodBinding(): ContextMethodBinding {
  if (!activeBinding) {
    throw new DOMException(
      'No context method binding installed. Import "@living-web/group-identity/polyfill" before using navigator.graph.',
      'NotSupportedError',
    );
  }
  return activeBinding;
}
