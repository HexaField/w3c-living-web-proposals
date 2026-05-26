/**
 * navigator.credentials extension for DID-based identity.
 *
 * Adds, per [[DECENTRALISED-IDENTITY]] §3:
 *   - navigator.credentials.create({ did: { method, displayName, ... } })
 *   - navigator.credentials.get({ did: { method, filter, challenge } })
 *   - navigator.credentials.resolve(did)
 *   - navigator.credentials.supportedMethods()
 *
 * `method: "key"` is built in. Other methods (e.g. `"graph"`) are dispatched
 * via the credential method registry — see `registerCredentialMethod()`.
 * `@living-web/group-identity` registers the `"graph"` method.
 */

import { DIDCredential } from './credential.js';
import { IdentityManager, type CredentialFilter } from './identity-manager.js';
import { resolve, supportedMethods } from './resolver.js';
import type { DIDDocument } from './did-key.js';

interface DIDCredentialCreationOptions {
  displayName: string;
  method?: string;
  algorithm?: string;
  [k: string]: unknown;
}

interface DIDCredentialRequestOptions {
  challenge?: BufferSource;
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

/**
 * Creator for a method-specific credential. Other specifications (e.g.
 * `@living-web/group-identity`) register one of these so that
 * `navigator.credentials.create({ did: { method: "<their-method>", ... } })`
 * dispatches into their implementation.
 */
export type CredentialCreator = (
  options: DIDCredentialCreationOptions,
  passphrase: string,
  identityManager: IdentityManager,
) => Promise<DIDCredential>;

const creators = new Map<string, CredentialCreator>();

export function registerCredentialMethod(method: string, creator: CredentialCreator): void {
  if (method === 'key') {
    throw new Error('did:key is built in and cannot be overridden');
  }
  creators.set(method, creator);
}

export function install(): void {
  if (typeof globalThis.navigator === 'undefined') return;
  if (!globalThis.navigator.credentials) return;

  const creds = globalThis.navigator.credentials;
  const originalCreate = creds.create?.bind(creds);
  const originalGet = creds.get?.bind(creds);

  creds.create = async function (options?: CredentialCreationOptions & { did?: DIDCredentialCreationOptions }) {
    if (options?.did) {
      const opts = options.did;
      const method = opts.method ?? 'key';
      if (method === 'key') {
        return manager.createIndividual(opts.displayName || 'Unnamed', POLYFILL_PASSPHRASE, opts.algorithm);
      }
      const creator = creators.get(method);
      if (!creator) {
        throw new DOMException(
          `No creator registered for did:${method}. Install the polyfill that defines it (e.g. "@living-web/group-identity/polyfill" for did:graph).`,
          'NotSupportedError',
        );
      }
      return creator(opts, POLYFILL_PASSPHRASE, manager);
    }
    return originalCreate?.(options) ?? null;
  };

  creds.get = async function (options?: CredentialRequestOptions & { did?: DIDCredentialRequestOptions }) {
    if (options?.did !== undefined) {
      await manager.loadAll();
      const filter: CredentialFilter = {
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

export { manager };
