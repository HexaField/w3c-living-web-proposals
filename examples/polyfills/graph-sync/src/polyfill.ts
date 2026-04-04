import { SharedGraphManager } from './manager.js';

/**
 * Install graph-sync polyfill onto navigator.graph.
 * Extends existing personal-graph polyfill with join/share/listShared.
 */
export function install(manager: SharedGraphManager): void {
  if (typeof globalThis.navigator === 'undefined') return;
  const nav = globalThis.navigator as any;
  if (!nav.graph) {
    nav.graph = {};
  }
  nav.graph.join = (uri: string) => manager.join(uri);
  nav.graph.share = (name?: string, opts?: any) => manager.share(name, opts);
  nav.graph.listShared = () => manager.listShared();
}
