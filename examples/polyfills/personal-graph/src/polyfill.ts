/**
 * navigator.graph polyfill entry.
 *
 * Wires up:
 *   - navigator.graph → GraphStoreManager
 *   - did:graph resolution bridge into @living-web/identity
 */

import { manager as identityManager } from '@living-web/identity/polyfill';
import { GraphStorage } from './storage.js';
import { GraphStoreManager } from './manager.js';
import { installDIDBridge } from './did-bridge.js';
import type { IdentityProvider } from './signing.js';

declare global {
  interface Navigator {
    graph: GraphStoreManager;
  }
}

const POLYFILL_PASSPHRASE = '__living-web-polyfill__';

let installed = false;
let manager: GraphStoreManager | null = null;

export async function install(dbName?: string): Promise<GraphStoreManager> {
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

  manager = new GraphStoreManager(storage, agentIdentityProvider);
  (globalThis.navigator as Navigator).graph = manager;

  installDIDBridge(manager);

  installed = true;
  return manager;
}

export function getManager(): GraphStoreManager | null {
  return manager;
}
