/**
 * Custom constraint kind registry
 */

import type { ConstraintHandler } from './types.js';

export class ConstraintKindRegistry {
  private _handlers = new Map<string, ConstraintHandler>();

  register(handler: ConstraintHandler): void {
    this._handlers.set(handler.kind, handler);
  }

  get(kind: string): ConstraintHandler | undefined {
    return this._handlers.get(kind);
  }

  has(kind: string): boolean {
    return this._handlers.has(kind);
  }

  all(): ConstraintHandler[] {
    return Array.from(this._handlers.values());
  }
}
