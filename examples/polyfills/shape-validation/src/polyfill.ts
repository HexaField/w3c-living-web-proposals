/**
 * Auto-install the shape extension on Graph. Re-exports the package surface
 * so that side-effect importers pick up the Graph prototype augmentation.
 */
export * from './index.js';
import { installShapeExtension } from './extension.js';

installShapeExtension();
