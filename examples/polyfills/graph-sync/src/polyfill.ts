import { SharedGraphManager } from './manager.js';

/**
 * Install graph-sync polyfill onto navigator.graph.
 * Extends existing personal-graph polyfill with join/share/listShared.
 * Only installs if the browser doesn't already provide these methods natively.
 */
export function install(manager: SharedGraphManager): void {
  if (typeof globalThis.navigator === 'undefined') return;
  const nav = globalThis.navigator as any;
  if (!nav.graph) {
    nav.graph = {};
  }

  // Feature detect: skip if native implementations exist
  if (typeof nav.graph.join === 'function' && typeof nav.graph.share === 'function') {
    console.info('[living-web] Native graph sync detected — polyfill skipped');
    return;
  }

  console.info('[living-web] Graph sync polyfill installed (no native support detected)');
  nav.graph.join = (uri: string) => manager.join(uri);
  nav.graph.share = (name?: string, opts?: any) => manager.share(name, opts);
  nav.graph.listShared = () => manager.listShared();
}
