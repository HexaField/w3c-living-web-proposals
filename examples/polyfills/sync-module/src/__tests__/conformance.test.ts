/**
 * Conformance tests for @living-web/sync-module.
 *
 * The polyfill is intentionally minimal — it re-exports the
 * `ContextSyncRuntime` contract under the spec name (`SyncModule`) and wraps
 * `installSyncRuntime` as `installSyncModule`. The real sync module host is
 * out of scope for the polyfill (it would supply WASM sandbox, manifest
 * verification, capability mediation, and lifecycle).
 */

import { describe, it, expect } from 'vitest';
import { getSyncRuntime } from '@living-web/context-sync';
import { installSyncModule, type SyncModule } from '../index.js';

const noopModule: SyncModule = {
  async publish() {
    return { graphDid: 'did:graph:noop', spaceUri: 'space://noop', moduleHash: 'noop', relays: [] };
  },
  async unpublish() {},
  async syncState() { return 'idle' as const; },
  async peers() { return []; },
  async onlinePeers() { return []; },
  async currentRevision() { return '0'.repeat(64); },
  async sendSignal() {},
  async sendSignalToSession() {},
  async broadcast() {},
};

describe('installSyncModule', () => {
  it('registers the module as the active context-sync runtime', () => {
    installSyncModule(noopModule);
    expect(getSyncRuntime()).toBe(noopModule);
  });

  it('SyncModule is a structural alias of ContextSyncRuntime', () => {
    const mod: SyncModule = noopModule;
    expect(typeof mod.publish).toBe('function');
    expect(typeof mod.broadcast).toBe('function');
  });
});
