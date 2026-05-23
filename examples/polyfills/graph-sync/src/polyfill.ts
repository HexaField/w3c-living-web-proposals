/**
 * Auto-install the sync extension on Context.
 *
 * Re-exports the package surface so that side-effect importers
 * (`import '@living-web/graph-sync/polyfill'`) pick up the
 * `declare module '@living-web/personal-graph'` augmentation that
 * adds publish/peers/etc. to Context.
 */
export * from './index.js';
import { installSyncExtension } from './sync-extension.js';

installSyncExtension();
