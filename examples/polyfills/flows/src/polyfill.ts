/**
 * Auto-install the flow extension on Context. Re-exports the package surface
 * so that side-effect importers pick up the Context prototype augmentation.
 */
export * from './index.js';
import { installFlowExtension } from './extension.js';

installFlowExtension();
