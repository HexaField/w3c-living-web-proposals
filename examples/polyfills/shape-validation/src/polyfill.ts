/**
 * Auto-install the shape extension on Context. Re-exports the package surface
 * so that side-effect importers pick up the Context prototype augmentation.
 */
export * from './index.js';
import { installShapeExtension } from './extension.js';

installShapeExtension();
