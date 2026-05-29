/**
 * Default sync module — BroadcastChannel-based polyfill.
 *
 * Exposes the module in two complementary shapes:
 *
 *   - {@link defaultSyncModule} — `ContextSyncRuntime` (the runtime view).
 *     Installed via `installSyncModule(defaultSyncModule)`; the Graph API
 *     delegates publish/peers/diff/signal calls to it.
 *
 *   - {@link createDefaultGraphSyncModule} — `GraphSyncModule` (Spec 06 §5,
 *     the WASM-callable view). Returns an instance whose `validateDiff`
 *     and `validateReadAccess` are real implementations delegating to
 *     `@living-web/capability-framework` — the in-module validation
 *     contract (Spec 06 §5.5).
 *
 * The {@link defaultModuleManifest} declares the module's supported
 * constraint kinds and required capabilities per Spec 06 §7.2; production
 * hosts consult it for consent and for fork-time constraint-kind
 * compatibility (Spec 03 §4.8.1 step 2).
 *
 * Suitable as a development/demo sync transport; production deployments
 * should swap in a relay-backed module.
 */

export { defaultSyncModule } from './broadcast-module.js';
export { defaultModuleManifest } from './manifest.js';
export {
  createDefaultGraphSyncModule,
  type GraphResolver,
} from './graph-sync-module.js';
export {
  defaultValidateDiff,
  defaultValidateReadAccess,
} from './validate.js';
