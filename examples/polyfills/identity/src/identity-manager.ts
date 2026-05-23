/**
 * IdentityManager — tracks DIDCredentials in this user agent session.
 *
 * Holds both individual (did:key) credentials AND graph-DID delegate credentials
 * (the local keys that allow this agent to sign on behalf of various did:graph DIDs).
 */

import { DIDCredential, type DIDCredentialKind } from './credential.js';
import { loadAllCredentials } from './keystore.js';

export interface CredentialFilter {
  kind?: DIDCredentialKind;
  method?: string;
  did?: string;
}

export class IdentityManager {
  private credentials = new Map<string, DIDCredential>();
  private activeDID: string | null = null;

  get active(): DIDCredential | null {
    if (!this.activeDID) return null;
    return this.all.find(c => c.did === this.activeDID) ?? null;
  }

  get all(): DIDCredential[] {
    return [...this.credentials.values()];
  }

  async loadAll(): Promise<void> {
    const stored = await loadAllCredentials();
    for (const record of stored) {
      const cred = DIDCredential.fromStored(record);
      const key = this.indexKey(cred);
      if (!this.credentials.has(key)) {
        this.credentials.set(key, cred);
      }
    }
    if (!this.activeDID) {
      const firstIndividual = this.all.find(c => c.kind === 'individual');
      if (firstIndividual) this.activeDID = firstIndividual.did;
    }
  }

  async createIndividual(
    displayName: string,
    passphrase: string,
    algorithm?: string,
  ): Promise<DIDCredential> {
    const cred = await DIDCredential.createIndividual(displayName, passphrase, algorithm);
    this.credentials.set(this.indexKey(cred), cred);
    if (!this.activeDID) this.activeDID = cred.did;
    return cred;
  }

  async createGraph(
    displayName: string,
    passphrase: string,
    algorithm?: string,
  ): Promise<{ credential: DIDCredential; publicKey: Uint8Array; privateKey: Uint8Array }> {
    const result = await DIDCredential.createGraph(displayName, passphrase, algorithm);
    this.credentials.set(this.indexKey(result.credential), result.credential);
    return result;
  }

  setActive(did: string): void {
    const found = this.all.find(c => c.did === did);
    if (!found) throw new Error(`Unknown credential: ${did}`);
    this.activeDID = did;
  }

  get(did: string): DIDCredential | undefined {
    return this.all.find(c => c.did === did);
  }

  getByMethodId(methodId: string): DIDCredential | undefined {
    return this.all.find(c => c.methodId === methodId);
  }

  find(filter: CredentialFilter): DIDCredential[] {
    return this.all.filter(c => {
      if (filter.kind && c.kind !== filter.kind) return false;
      if (filter.method && c.method !== filter.method) return false;
      if (filter.did && c.did !== filter.did) return false;
      return true;
    });
  }

  async delete(didOrMethodId: string): Promise<void> {
    const cred = this.getByMethodId(didOrMethodId) ?? this.get(didOrMethodId);
    if (!cred) return;
    await cred.delete();
    this.credentials.delete(this.indexKey(cred));
    if (this.activeDID === cred.did) {
      const next = this.all.find(c => c.kind === 'individual');
      this.activeDID = next?.did ?? null;
    }
  }

  private indexKey(cred: DIDCredential): string {
    return cred.methodId;
  }
}
