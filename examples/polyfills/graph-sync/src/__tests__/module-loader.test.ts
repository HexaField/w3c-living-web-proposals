import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultModuleLoader, contentHash } from '../module-loader.js';

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

  it('load() verifies content hash and loads valid module', async () => {
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
});
