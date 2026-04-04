/**
 * Identity manager — manages multiple DIDCredentials
 */

import { DIDCredential } from './credential.js';
import { loadAllCredentials } from './keystore.js';

export class IdentityManager {
  private _credentials: Map<string, DIDCredential> = new Map();
  private _activeDID: string | null = null;

  get active(): DIDCredential | null {
    if (!this._activeDID) return null;
    return this._credentials.get(this._activeDID) ?? null;
  }

  get credentials(): DIDCredential[] {
    return Array.from(this._credentials.values());
  }

  async loadAll(): Promise<void> {
    const stored = await loadAllCredentials();
    for (const record of stored) {
      if (!this._credentials.has(record.did)) {
        this._credentials.set(record.did, DIDCredential.fromStored(record));
      }
    }
  }

  async create(displayName: string, passphrase: string, algorithm?: string): Promise<DIDCredential> {
    const cred = await DIDCredential.create(displayName, passphrase, algorithm);
    this._credentials.set(cred.did, cred);
    if (!this._activeDID) this._activeDID = cred.did;
    return cred;
  }

  setActive(did: string): void {
    if (!this._credentials.has(did)) throw new Error(`Unknown credential: ${did}`);
    this._activeDID = did;
  }

  get(did: string): DIDCredential | undefined {
    return this._credentials.get(did);
  }

  async delete(did: string): Promise<void> {
    const cred = this._credentials.get(did);
    if (cred) {
      await cred.delete();
      this._credentials.delete(did);
      if (this._activeDID === did) {
        const remaining = this._credentials.keys().next();
        this._activeDID = remaining.done ? null : remaining.value;
      }
    }
  }
}
