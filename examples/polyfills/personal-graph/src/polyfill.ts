/**
 * navigator.graph polyfill entry.
 *
 * Wires up `navigator.graph` → GraphManager. Per Spec 02, the only public
 * methods are `create()` and `fromSnapshot()`. Sovereign-DID attachment
 * (e.g. `did:graph`), remote-mount and sync, governance, shape validation,
 * and process flows are layered on by extension polyfills that augment
 * the GraphManager prototype at runtime.
 */

import { manager as identityManager } from '@living-web/identity/polyfill';
import { GraphStorage } from './storage.js';
import { GraphManager } from './manager.js';
import type { IdentityProvider } from './signing.js';

declare global {
  interface Navigator {
    graph: GraphManager;
  }
}

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

let installed = false;
let manager: GraphManager | null = null;

export async function install(dbName?: string): Promise<GraphManager> {
  if (typeof globalThis.navigator === 'undefined') {
    throw new Error('navigator is not available');
  }
  if (installed && manager) return manager;

  const storage = new GraphStorage(dbName);

  const agentIdentityProvider = async (): Promise<IdentityProvider> => {
    await identityManager.loadAll();
    const active = identityManager.active;
    if (!active) {
      throw new Error('No active DID credential — call navigator.credentials.create({ did: { method: "key" } }) first');
    }
    if (active.isLocked) await active.unlock(POLYFILL_PASSPHRASE);
    return {
      getDID: () => active.did,
      getKeyURI: () => active.methodId,
      getPublicKey: () => active.publicKey,
      sign: data => active.signRaw(data),
    };
  };

  manager = new GraphManager(storage, agentIdentityProvider);
  (globalThis.navigator as Navigator).graph = manager;

  installed = true;
  return manager;
}

export function getManager(): GraphManager | null {
  return manager;
}
