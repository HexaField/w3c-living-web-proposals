/**
 * Living Web Extension — Content Script.
 *
 * Injected into every page's MAIN world via Manifest V3. Feature-detects native
 * support and only installs polyfills if needed.
 *
 * Installs identity (did:key + did:graph), personal-graph
 * (GraphStoreManager on navigator.graph), shape-validation, context-sync +
 * default-sync-module, group-identity, and flows extensions.
 */

import { install as installIdentity } from '@living-web/identity';
import { install as installPersonalGraph } from '@living-web/personal-graph';
import '@living-web/shape-validation/polyfill';
import '@living-web/default-sync-module/polyfill';
import '@living-web/group-identity/polyfill';
import '@living-web/flows/polyfill';

if (typeof navigator !== 'undefined' && 'graph' in navigator && (navigator as any).graph?.__native) {
  console.info('[Living Web Extension] Native support detected — skipped');
} else {
  installIdentity();
  installPersonalGraph()
    .then(() => console.info('[Living Web Extension] Polyfill installed'))
    .catch(err => console.error('[Living Web Extension] install failed', err));
}
