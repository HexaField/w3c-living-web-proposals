/**
 * Default sync module — BroadcastChannel-based polyfill.
 *
 * Implements the {@link ContextSyncRuntime} interface from
 * `@living-web/context-sync`. Suitable as a development/demo sync transport;
 * production deployments should swap in a relay-backed module.
 */

export { defaultSyncModule } from './broadcast-module.js';
