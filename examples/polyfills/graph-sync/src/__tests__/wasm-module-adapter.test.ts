import { describe, it, expect, vi } from 'vitest';
import { WasmSyncModuleAdapter } from '../wasm-module-adapter.js';
import type { WasmSyncModuleInstance } from '../wasm-module-adapter.js';
import type { ModuleConfig, GraphReader, GraphWriter } from '../default-sync-module.js';

function createMockWasm(): WasmSyncModuleInstance {
  return {
    init: vi.fn(),
    shutdown: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    commit: vi.fn().mockReturnValue('"rev123"'),
    request_sync: vi.fn(),
    peers: vi.fn().mockReturnValue('[]'),
    online_peers: vi.fn().mockReturnValue('[]'),
    send_signal: vi.fn(),
    set_on_signal: vi.fn(),
    validate: vi.fn().mockReturnValue('{"accepted":true}'),
  };
}

function createMockConfig(): ModuleConfig {
  return {
    graphUri: 'web+graph://relay/graphid?module=abc',
    localDid: 'did:key:z123',
    graphWriter: { applyDiff: vi.fn(), rejectDiff: vi.fn() } as unknown as GraphWriter,
    graphReader: { query: vi.fn().mockReturnValue([]), tripleCount: vi.fn().mockReturnValue(0), currentRevision: vi.fn().mockReturnValue(null) } as unknown as GraphReader,
  };
}

describe('WasmSyncModuleAdapter', () => {
  it('init() serializes config to JSON and passes to WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);
    const config = createMockConfig();

    adapter.init(config);

    expect(wasm.init).toHaveBeenCalledWith(JSON.stringify({
      graphUri: config.graphUri,
      localDid: config.localDid,
    }));
  });

  it('connect() delegates to WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);

    adapter.connect('web+graph://relay/g1', 'did:key:z1');
    expect(wasm.connect).toHaveBeenCalledWith('web+graph://relay/g1', 'did:key:z1');
  });

  it('shutdown() delegates to WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);

    adapter.shutdown();
    expect(wasm.shutdown).toHaveBeenCalled();
  });

  it('disconnect() delegates to WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);

    adapter.disconnect();
    expect(wasm.disconnect).toHaveBeenCalled();
  });

  it('peers() parses JSON from WASM', () => {
    const wasm = createMockWasm();
    wasm.peers = vi.fn().mockReturnValue('[{"did":"did:key:z1","sessionId":"s1","online":true}]');
    const adapter = new WasmSyncModuleAdapter(wasm);

    const peers = adapter.peers();
    expect(peers).toEqual([{ did: 'did:key:z1', sessionId: 's1', online: true }]);
  });

  it('onlinePeers() parses JSON from WASM', () => {
    const wasm = createMockWasm();
    wasm.online_peers = vi.fn().mockReturnValue('[]');
    const adapter = new WasmSyncModuleAdapter(wasm);

    expect(adapter.onlinePeers()).toEqual([]);
  });

  it('validate() serializes diff and parses result', () => {
    const wasm = createMockWasm();
    wasm.validate = vi.fn().mockReturnValue('{"accepted":true}');
    const adapter = new WasmSyncModuleAdapter(wasm);

    const diff = {
      revision: 'rev1',
      author: 'did:key:z1',
      timestamp: 1000,
      additions: [],
      removals: [],
      dependencies: [],
    } as any;

    const result = adapter.validate(diff, 'did:key:z1', {} as GraphReader);
    expect(result).toEqual({ accepted: true });
  });

  it('commit() returns revision string for non-JSON result', () => {
    const wasm = createMockWasm();
    wasm.commit = vi.fn().mockReturnValue('abc123');
    const adapter = new WasmSyncModuleAdapter(wasm);

    const diff = {
      revision: 'rev1',
      author: 'did:key:z1',
      timestamp: 1000,
      additions: [],
      removals: [],
      dependencies: [],
    } as any;

    const result = adapter.commit(diff);
    expect(result).toBe('abc123');
  });

  it('commit() returns ValidationResult when WASM rejects', () => {
    const wasm = createMockWasm();
    wasm.commit = vi.fn().mockReturnValue('{"accepted":false,"reason":"invalid"}');
    const adapter = new WasmSyncModuleAdapter(wasm);

    const diff = {
      revision: 'rev1',
      author: 'did:key:z1',
      timestamp: 1000,
      additions: [],
      removals: [],
      dependencies: [],
    } as any;

    const result = adapter.commit(diff);
    expect(result).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('sendSignal() delegates to WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);
    const payload = new Uint8Array([1, 2, 3]);

    adapter.sendSignal('did:key:z2', payload);
    expect(wasm.send_signal).toHaveBeenCalledWith('did:key:z2', payload);
  });

  it('onSignal() registers callback via WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);
    const callback = vi.fn();

    adapter.onSignal(callback);
    expect(wasm.set_on_signal).toHaveBeenCalled();
  });

  it('requestSync() delegates to WASM', () => {
    const wasm = createMockWasm();
    const adapter = new WasmSyncModuleAdapter(wasm);

    adapter.requestSync('genesis');
    expect(wasm.request_sync).toHaveBeenCalledWith('genesis');
  });
});
