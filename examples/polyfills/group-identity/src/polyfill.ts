/**
 * Auto-install entry for `@living-web/group-identity`.
 *
 * Re-exports the package surface AND, as side effects:
 *   - patches DIDCredential.prototype with `addDelegate` / `removeDelegate` /
 *     `grantSection` / `revokeSection` / `signGraph` ([§5.4]).
 *   - registers the `did:graph` credential creator on identity's polyfill.
 *   - registers the `did:graph` resolver on identity.
 *   - registers a `GraphDIDWriter` so addDelegate / removeDelegate write
 *     through to the underlying graph store.
 *   - installs the Group convenience methods on `GraphManager`.
 *
 * Import order MUST be:
 *   1. `@living-web/identity/polyfill`
 *   2. `@living-web/personal-graph/polyfill` (creates navigator.graph)
 *   3. `@living-web/group-identity/polyfill`
 *
 * (group-identity needs personal-graph's manager to exist before binding.)
 */

export * from './index.js';

import { getManager as getPersonalGraphManager } from '@living-web/personal-graph';
import { installCredentialAugmentation } from './credential.js';
import { installDIDGraphBinding } from './binding.js';
import { installGroupExtension } from './extension.js';

installCredentialAugmentation();
installGroupExtension();

// Wire the did:graph binding. The full GraphManager may not exist yet
// (personal-graph's install() is what creates it); we use a thin shim that
// proxies to whatever the manager is *now*.
installDIDGraphBinding({
  *knownGraphs() {
    const m = getPersonalGraphManager();
    if (!m) return;
    yield* m.knownGraphs();
  },
  fullManager: () => getPersonalGraphManager(),
});
