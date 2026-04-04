import { PersonalGraphManager } from './manager.js';

declare global {
  interface Navigator {
    graph: PersonalGraphManager;
  }
}

/**
 * Install polyfill only if the browser doesn't already provide navigator.graph.
 * When running in a Living Web-capable browser (e.g., Chromium fork),
 * the native implementation takes precedence.
 */
export function installPolyfill(): void {
  if (typeof navigator !== 'undefined' && !('graph' in navigator)) {
    (navigator as any).graph = new PersonalGraphManager();
    console.info('[living-web] Personal graph polyfill installed (no native support detected)');
  } else if (typeof navigator !== 'undefined' && 'graph' in navigator) {
    console.info('[living-web] Native navigator.graph detected — polyfill skipped');
  }
}

// Auto-install
installPolyfill();
