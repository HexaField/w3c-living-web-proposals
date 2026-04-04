import { PersonalGraphManager } from './manager.js';

declare global {
  interface Navigator {
    graph: PersonalGraphManager;
  }
}

export function installPolyfill(): void {
  if (typeof navigator !== 'undefined' && !navigator.graph) {
    (navigator as any).graph = new PersonalGraphManager();
  }
}

// Auto-install
installPolyfill();
