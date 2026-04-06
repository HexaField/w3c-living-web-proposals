/**
 * Auto-install shape validation polyfill.
 * Only installs if PersonalGraph doesn't already have native shape support.
 */
import { PersonalGraph } from '@living-web/personal-graph';
import { installShapeExtension } from './extension.js';

// Feature detect: check if addShape already exists on the prototype
if (typeof (PersonalGraph.prototype as any).addShape !== 'function') {
  installShapeExtension(PersonalGraph);
  console.info('[living-web] Shape validation polyfill installed (no native support detected)');
} else {
  console.info('[living-web] Native shape validation detected — polyfill skipped');
}
