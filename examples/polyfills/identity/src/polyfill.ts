/**
 * navigator.credentials extension for DID-based identity.
 *
 * Adds:
 *   - navigator.credentials.create({ did: { method: "key" | "graph", ... } })
 *   - navigator.credentials.get({ did: { kind, method, filter, challenge } })
 *   - navigator.credentials.resolve(did)
 *   - navigator.credentials.supportedMethods()
 */

import { DIDCredential } from './credential.js';
import { IdentityManager, type CredentialFilter } from './identity-manager.js';
import { resolve, supportedMethods } from './resolver.js';
import type { DIDDocument } from './did-key.js';
import { didToPublicKey } from './did-key.js';
import { graphDIDToPublicKey } from './did-graph.js';

interface DIDCredentialCreationOptions {
  displayName: string;
  method?: 'key' | 'graph';
  algorithm?: string;
  graphOptions?: {
    initialDelegates?: string[];
  };
}

interface DIDCredentialRequestOptions {
  challenge?: BufferSource;
  kind?: 'individual' | 'graph';
  method?: string;
  filter?: { did?: string };
}

interface CredentialsContainerWithDID {
  create?(options?: CredentialCreationOptions & { did?: DIDCredentialCreationOptions }): Promise<DIDCredential | null>;
  get?(options?: CredentialRequestOptions & { did?: DIDCredentialRequestOptions }): Promise<DIDCredential | null>;
  resolve?(did: string): Promise<DIDDocument>;
  supportedMethods?(): Promise<string[]>;
}

declare global {
  interface CredentialsContainer extends CredentialsContainerWithDID {}
}

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';
const manager = new IdentityManager();

export function install(): void {
  if (typeof globalThis.navigator === 'undefined') return;
  if (!globalThis.navigator.credentials) return;

  const creds = globalThis.navigator.credentials;
  const originalCreate = creds.create?.bind(creds);
  const originalGet = creds.get?.bind(creds);

  creds.create = async function (options?: CredentialCreationOptions & { did?: DIDCredentialCreationOptions }) {
    if (options?.did) {
      const { displayName, algorithm, method = 'key', graphOptions } = options.did;
      if (method === 'graph') {
        const { credential } = await manager.createGraph(
          displayName || 'Unnamed Graph',
          POLYFILL_PASSPHRASE,
          algorithm,
        );
        if (graphOptions?.initialDelegates && graphOptions.initialDelegates.length > 0) {
          for (const delegateDid of graphOptions.initialDelegates) {
            await credential.addDelegate({
              id: `${credential.did}#${delegateDid.split(':').pop() ?? 'method'}`,
              publicKey: derivePublicKey(delegateDid),
              sections: ['capabilityInvocation', 'assertionMethod'],
            });
          }
        }
        return credential;
      }
      return manager.createIndividual(
        displayName || 'Unnamed',
        POLYFILL_PASSPHRASE,
        algorithm,
      );
    }
    return originalCreate?.(options) ?? null;
  };

  creds.get = async function (options?: CredentialRequestOptions & { did?: DIDCredentialRequestOptions }) {
    if (options?.did !== undefined) {
      await manager.loadAll();
      const filter: CredentialFilter = {
        kind: options.did.kind,
        method: options.did.method,
        did: options.did.filter?.did,
      };
      const matches = manager.find(filter);
      const target = matches[0] ?? manager.active;
      if (!target) return null;
      if (target.isLocked) {
        await target.unlock(POLYFILL_PASSPHRASE);
      }
      if (options.did.challenge) {
        const challenge = toUint8Array(options.did.challenge);
        await target.sign({ challenge: Array.from(challenge) });
      }
      return target;
    }
    return originalGet?.(options) ?? null;
  };

  creds.resolve = async function (did: string) {
    return resolve(did);
  };
  creds.supportedMethods = async function () {
    return supportedMethods();
  };
}

function toUint8Array(buf: BufferSource): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new Uint8Array(buf);
}

function derivePublicKey(did: string): Uint8Array {
  if (did.startsWith('did:key:')) return didToPublicKey(did);
  if (did.startsWith('did:graph:')) return graphDIDToPublicKey(did);
  throw new Error(`Cannot derive public key from ${did}`);
}

export { manager };
