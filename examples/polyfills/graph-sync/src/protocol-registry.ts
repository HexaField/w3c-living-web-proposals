import type { SyncProtocolFactory } from './types.js';

/**
 * Registry for pluggable sync protocols.
 * Default: 'yjs-direct' (for in-process Y.js sync, used in tests and simple setups).
 */
export class SyncProtocolRegistry {
  private static protocols = new Map<string, SyncProtocolFactory>();

  static register(name: string, factory: SyncProtocolFactory): void {
    this.protocols.set(name, factory);
  }

  static get(name: string): SyncProtocolFactory | undefined {
    return this.protocols.get(name);
  }

  static has(name: string): boolean {
    return this.protocols.has(name);
  }

  static list(): string[] {
    return Array.from(this.protocols.keys());
  }
}
