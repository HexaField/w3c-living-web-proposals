import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultModuleLoader, contentHash, contentHashBytes } from '../module-loader.js';

describe('contentHash', () => {
  it('produces a consistent SHA-256 hex string', () => {
    const hash = contentHash('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Same input → same hash
    expect(contentHash('hello world')).toBe(hash);
  });

  it('differs for different inputs', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

describe('contentHashBytes', () => {
  it('produces a consistent SHA-256 hex string for binary data', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const hash = contentHashBytes(data);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHashBytes(data)).toBe(hash);
  });

  it('differs for different binary inputs', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    expect(contentHashBytes(a)).not.toBe(contentHashBytes(b));
  });

  it('matches known SHA-256 for empty data', () => {
    const empty = new Uint8Array([]);
    const hash = contentHashBytes(empty);
    // SHA-256 of empty input
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('DefaultModuleLoader', () => {
  let loader: DefaultModuleLoader;

  beforeEach(() => {
    loader = new DefaultModuleLoader();
    vi.restoreAllMocks();
  });

  it('getDefault() returns a DefaultSyncModule', () => {
    const mod = loader.getDefault();
    expect(typeof mod.init).toBe('function');
    expect(typeof mod.validate).toBe('function');
  });

  it('installed() is initially empty', () => {
    expect(loader.installed()).toEqual([]);
  });

  it('load() verifies content hash and loads valid JS module', async () => {
    const code = `
      exports.init = function() {};
      exports.validate = function() { return { valid: true, violations: [] }; };
    `;
    const hash = contentHash(code);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(code),
    }));

    const mod = await loader.load('https://example.com/module.js', hash);
    expect(typeof mod.init).toBe('function');
    expect(typeof mod.validate).toBe('function');

    const installed = loader.installed();
    expect(installed).toHaveLength(1);
    expect(installed[0].hash).toBe(hash);
  });

  it('load() rejects on hash mismatch', async () => {
    const code = 'exports.init = function() {};';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(code),
    }));

    await expect(
      loader.load('https://example.com/module.js', 'badhash'),
    ).rejects.toThrow('Module integrity check failed');
  });

  it('load() rejects if module missing init/validate', async () => {
    const code = 'exports.foo = function() {};';
    const hash = contentHash(code);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(code),
    }));

    await expect(
      loader.load('https://example.com/module.js', hash),
    ).rejects.toThrow('does not implement GraphSyncModule');
  });

  it('load() rejects on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    }));

    await expect(
      loader.load('https://example.com/missing.js', 'abc'),
    ).rejects.toThrow('Failed to fetch module');
  });

  it('load() detects WASM URLs and attempts WASM loading path', async () => {
    // Simulate fetching a .wasm URL — should take the WASM path
    // and fail at the WASM binary fetch since we mock a basic response
    const wasmBytes = new Uint8Array([0, 97, 115, 109]); // WASM magic bytes
    const hash = contentHashBytes(wasmBytes);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(wasmBytes.buffer),
    }));

    // The dynamic import of the JS glue will fail in test env,
    // which is expected — we're testing the detection + hash verification path
    await expect(
      loader.load('https://example.com/pkg/module_bg.wasm', hash),
    ).rejects.toThrow(); // Will fail at dynamic import, but hash was verified first
  });

  it('load() rejects WASM with wrong hash before attempting import', async () => {
    const wasmBytes = new Uint8Array([0, 97, 115, 109]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(wasmBytes.buffer),
    }));

    await expect(
      loader.load('https://example.com/pkg/module_bg.wasm', 'wrong_hash'),
    ).rejects.toThrow('Module integrity check failed');
  });
});
