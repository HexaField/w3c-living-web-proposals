/**
 * Auto-install the flow extension on Graph. Re-exports the package surface
 * so that side-effect importers pick up the Graph prototype augmentation.
 */
export * from './index.js';
import { installFlowExtension } from './extension.js';

installFlowExtension();
