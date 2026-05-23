/**
 * DIDIdentityProvider — adapter that exposes a DIDCredential as the
 * IdentityProvider shape consumed by @living-web/personal-graph.
 */

import type { DIDCredential } from './credential.js';

export class DIDIdentityProvider {
  constructor(private readonly credential: DIDCredential) {}

  getDID(): string {
    return this.credential.did;
  }

  /** The specific verification method id producing signatures. */
  getKeyURI(): string {
    return this.credential.methodId;
  }

  getPublicKey(): Uint8Array {
    return this.credential.publicKey;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.credential.signRaw(data);
  }
}
