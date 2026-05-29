/**
 * Default sync module manifest (Spec 06 §7.2).
 *
 * `wasmContentHash` is a placeholder in the polyfill — production builds
 * compile the module to WebAssembly and bind the manifest to the SHA-256
 * of that binary. The fields below are otherwise normative: a host MUST
 * surface them in the consent prompt (Spec 06 §6.2) and consult
 * `supportedConstraintKinds` at fork time (Spec 03 §4.8.1 step 2) — the
 * point at which a new graph's module-hash is committed to a new DID.
 */

import type { ModuleManifest } from '@living-web/sync-module';

export const defaultModuleManifest: ModuleManifest = {
  name: 'Living Web Default Sync Module',
  version: '0.1.0',
  // Placeholder; a production build replaces this with the WASM binary hash.
  wasmContentHash: 'sha256-polyfill-broadcast-channel',
  supportedConstraintKinds: [
    // Framework-core: every conforming module supports these.
    'capability',
    'temporal',
    'content',
    'credential',
  ],
  capabilitiesRequired: [
    'graph.read',
    'graph.write',
    'crypto.commit-sign',
    'crypto.verify',
    // BroadcastChannel is ambient in the polyfill — production builds add
    // an explicit network.relay or network.peer entry here.
    'storage.module.1048576',
    'signal.send',
    'signal.receive',
    'time.monotonic',
    'random.csprng',
  ],
  description:
    'BroadcastChannel-based reference module for browser-origin development. ' +
    'Production deployments swap in a relay-backed module.',
};
