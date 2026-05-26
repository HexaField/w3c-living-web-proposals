/**
 * Auto-install entry for `@living-web/group-identity`.
 *
 * Re-exports the package surface AND, as side effects:
 *   - patches DIDCredential.prototype with `addDelegate` / `removeDelegate` /
 *     `grantSection` / `revokeSection` / `signGraph` ([§5.4](https://w3.org/TR/group-identity/#54)).
 *   - registers the `did:graph` credential creator on identity's polyfill.
 *   - registers the `did:graph` resolver on identity.
 *   - registers a `ContextMethodBinding` on personal-graph so `createContext`
 *     can mint did:graph contexts.
 *   - registers a `GraphDIDWriter` so addDelegate / removeDelegate write
 *     through to the underlying graph store.
 *   - installs the Group convenience methods on `GraphStore`.
 *
 * Import order MUST be:
 *   1. `@living-web/identity/polyfill`
 *   2. `@living-web/group-identity/polyfill`
 *   3. `@living-web/personal-graph/polyfill`
 */

export * from './index.js';

import { getManager as getPersonalGraphManager } from '@living-web/personal-graph';
import { installCredentialAugmentation } from './credential.js';
import { installDIDGraphBinding } from './binding.js';
import { installGroupExtension } from './extension.js';

installCredentialAugmentation();
installGroupExtension();

// The personal-graph polyfill creates its GraphStoreManager lazily on first
// `install()` call. We need a manager reference for the resolver + writer
// hooks. Use a thin shim that proxies to whatever manager is current.
installDIDGraphBinding({
  *knownStores() {
    const m = getPersonalGraphManager();
    if (!m) return;
    yield* m.knownStores();
  },
  async resolveContext(did: string) {
    const m = getPersonalGraphManager();
    if (!m) return null;
    return m.resolveContext(did);
  },
});
