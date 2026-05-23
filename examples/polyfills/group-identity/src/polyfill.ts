/**
 * Auto-install the group-identity extension on GraphStore. Re-exports the
 * package surface so that side-effect importers pick up the GraphStore
 * prototype augmentation.
 */
export * from './index.js';
import { installGroupExtension } from './extension.js';

installGroupExtension();
