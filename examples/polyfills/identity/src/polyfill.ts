/**
 * Polyfill entry — monkey-patches navigator.credentials for DID support.
 * Only installs if the browser doesn't already support DID credentials natively.
 */

import { DIDCredential } from './credential.js';
import { IdentityManager } from './identity-manager.js';

const manager = new IdentityManager();

// Default passphrase for polyfill (in a real browser, the UA would manage key storage)
const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

export function install(): void {
  if (typeof globalThis.navigator === 'undefined') return;
  if (!globalThis.navigator.credentials) return;

  // Feature detect: if the browser natively supports DID credentials, skip polyfill.
  // We test by checking if create({did:{}}) is handled natively (no standard way to detect this yet,
  // so we check for a marker property set by native implementations).
  if ((globalThis.navigator.credentials as any).__livingWebNativeDID) {
    console.info('[living-web] Native DID credential support detected — polyfill skipped');
    return;
  }

  console.info('[living-web] DID identity polyfill installed (no native support detected)');

  const originalCreate = globalThis.navigator.credentials.create?.bind(globalThis.navigator.credentials);
  const originalGet = globalThis.navigator.credentials.get?.bind(globalThis.navigator.credentials);

  globalThis.navigator.credentials.create = async function (options?: any): Promise<any> {
    if (options?.did) {
      const { displayName, algorithm } = options.did;
      // In a real browser, this would show a permission prompt and require user gesture
      const cred = await manager.create(displayName || 'Unnamed', POLYFILL_PASSPHRASE, algorithm);
      return cred;
    }
    return originalCreate?.(options);
  };

  globalThis.navigator.credentials.get = async function (options?: any): Promise<any> {
    if (options?.did !== undefined) {
      await manager.loadAll();
      const active = manager.active;
      if (!active) return null;

      // Unlock if locked
      if (active.isLocked) {
        await active.unlock(POLYFILL_PASSPHRASE);
      }

      // If challenge provided, sign it
      if (options.did?.challenge) {
        // Sign the challenge and attach to credential
        const challenge = options.did.challenge;
        const challengeBytes = challenge instanceof Uint8Array ? challenge : new Uint8Array(challenge);
        const signed = await active.sign({ challenge: Array.from(challengeBytes) });
        (active as any)._signedChallenge = signed;
      }

      return active;
    }
    return originalGet?.(options);
  };
}

export { manager };
