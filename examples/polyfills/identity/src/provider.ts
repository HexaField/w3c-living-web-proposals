/**
 * IdentityProvider — integration with @living-web/personal-graph
 * Matches the IdentityProvider interface from personal-graph's signing.ts
 */

import type { DIDCredential } from './credential.js';

export class DIDIdentityProvider {
  private credential: DIDCredential;

  constructor(credential: DIDCredential) {
    this.credential = credential;
  }

  getDID(): string {
    return this.credential.did;
  }

  getKeyURI(): string {
    const multibaseKey = this.credential.did.slice('did:key:'.length);
    return `${this.credential.did}#${multibaseKey}`;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.credential.signRaw(data);
  }

  getPublicKey(): Uint8Array {
    return this.credential.publicKey;
  }
}
