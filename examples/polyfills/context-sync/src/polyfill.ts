/**
 * Auto-install the Context sync extension. Re-exports the package surface so
 * that side-effect importers pick up the Context prototype augmentation.
 */
export * from './index.js';
import { installContextSyncExtension } from './extension.js';

installContextSyncExtension();
