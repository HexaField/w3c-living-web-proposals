import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DefaultSyncModule } from './default-sync-module.js';
import type { GraphSyncModule } from './default-sync-module.js';
import { WasmSyncModuleAdapter } from './wasm-module-adapter.js';
import type { WasmSyncModuleInstance } from './wasm-module-adapter.js';

/**
 * SyncModuleLoader — content-hash-verified module loading (§7).
 *
 * Supports both JavaScript modules (evaluated in a restricted scope)
 * and WebAssembly modules (loaded via wasm-bindgen JS glue).
 */
export interface SyncModuleLoader {
  /** Load and verify a sync module by content hash. */
  load(url: string, expectedHash: string): Promise<GraphSyncModule>;
  /** Get the default built-in sync module. */
  getDefault(): GraphSyncModule;
  /** List installed (loaded) modules. */
  installed(): { hash: string; url: string }[];
}

/**
 * Compute the SHA-256 content hash of arbitrary text.
 */
export function contentHash(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

/**
 * Compute the SHA-256 content hash of binary data.
 */
export function contentHashBytes(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/**
 * Detect whether a URL points to a WASM module bundle.
 *
 * Heuristic: ends with .wasm, or the URL path contains a wasm-bindgen
 * JS glue file (ending in .js with a sibling _bg.wasm).
 */
function isWasmUrl(url: string): boolean {
  const path = new URL(url, 'https://localhost').pathname;
  return path.endsWith('.wasm') || path.endsWith('_bg.js');
}

/**
 * Resolve a wasm-bindgen JS glue URL from a bundle URL.
 * If the URL points to a .wasm file, derive the JS glue path.
 * If it already points to the JS glue, return as-is.
 */
function resolveWasmBindgenUrls(url: string): { jsGlueUrl: string; wasmUrl: string } {
  const parsed = new URL(url, 'https://localhost');
  const path = parsed.pathname;

  if (path.endsWith('_bg.wasm')) {
    // e.g., /pkg/living_web_sync_websocket_bg.wasm
    const jsPath = path.replace(/_bg\.wasm$/, '.js');
    const jsUrl = new URL(jsPath, url).href;
    return { jsGlueUrl: jsUrl, wasmUrl: url };
  } else if (path.endsWith('.js')) {
    // e.g., /pkg/living_web_sync_websocket.js
    const wasmPath = path.replace(/\.js$/, '_bg.wasm');
    const wasmUrl = new URL(wasmPath, url).href;
    return { jsGlueUrl: url, wasmUrl };
  } else if (path.endsWith('.wasm')) {
    // Generic .wasm — assume wasm-bindgen naming convention
    const jsPath = path.replace(/\.wasm$/, '.js');
    const jsUrl = new URL(jsPath, url).href;
    return { jsGlueUrl: jsUrl, wasmUrl: url };
  }

  // Default: treat URL itself as JS glue
  return { jsGlueUrl: url, wasmUrl: url.replace(/\.js$/, '_bg.wasm') };
}

export class DefaultModuleLoader implements SyncModuleLoader {
  private modules = new Map<string, { module: GraphSyncModule; url: string }>();

  async load(url: string, expectedHash: string): Promise<GraphSyncModule> {
    // Fetch the module code
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch module from ${url}: ${response.status}`);
    }

    if (isWasmUrl(url)) {
      return this._loadWasmModule(url, expectedHash, response);
    } else {
      return this._loadJsModule(url, expectedHash, response);
    }
  }

  /**
   * Load a wasm-bindgen WASM module bundle.
   *
   * The hash is verified against the .wasm binary. The JS glue file
   * is loaded to handle instantiation (wasm-bindgen generates it).
   *
   * For the polyfill, we fetch both the JS glue and .wasm file,
   * verify the .wasm hash, then use dynamic import or eval to
   * bootstrap the module.
   */
  private async _loadWasmModule(
    url: string,
    expectedHash: string,
    initialResponse: Response,
  ): Promise<GraphSyncModule> {
    const { jsGlueUrl, wasmUrl } = resolveWasmBindgenUrls(url);

    // Fetch the .wasm binary (may be the initial response or a separate fetch)
    let wasmBytes: Uint8Array;
    if (url === wasmUrl) {
      wasmBytes = new Uint8Array(await initialResponse.arrayBuffer());
    } else {
      const wasmResponse = await fetch(wasmUrl);
      if (!wasmResponse.ok) {
        throw new Error(`Failed to fetch WASM binary from ${wasmUrl}: ${wasmResponse.status}`);
      }
      wasmBytes = new Uint8Array(await wasmResponse.arrayBuffer());
    }

    // Verify content hash of the .wasm binary
    const actualHash = contentHashBytes(wasmBytes);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Module integrity check failed: expected ${expectedHash}, got ${actualHash}`,
      );
    }

    // Load the JS glue module via dynamic import
    // The glue exports `default` (async init) and the WebSocketSyncModule class
    const glueModule = await import(/* @vite-ignore */ jsGlueUrl);

    // Initialize the WASM module — pass the binary bytes so it doesn't re-fetch
    await glueModule.default({ module_or_path: wasmBytes });

    // Instantiate the sync module class from the WASM glue
    const wasmInstance: WasmSyncModuleInstance = new glueModule.WebSocketSyncModule();

    // Verify it has the expected interface
    if (typeof wasmInstance.init !== 'function' || typeof wasmInstance.validate !== 'function') {
      throw new Error('WASM module does not implement GraphSyncModule interface (missing init/validate)');
    }

    const mod = new WasmSyncModuleAdapter(wasmInstance);
    this.modules.set(expectedHash, { module: mod, url });
    return mod;
  }

  /**
   * Load a JavaScript sync module (legacy/polyfill path).
   */
  private async _loadJsModule(
    url: string,
    expectedHash: string,
    response: Response,
  ): Promise<GraphSyncModule> {
    const code = await response.text();

    // Verify content hash
    const actualHash = contentHash(code);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Module integrity check failed: expected ${expectedHash}, got ${actualHash}`,
      );
    }

    // Evaluate in a restricted scope (polyfill — real impl uses WASM sandbox)
    const moduleExports: Record<string, unknown> = {};
    const moduleFactory = new Function('exports', code);
    moduleFactory(moduleExports);

    // Verify it implements GraphSyncModule interface
    const mod = moduleExports as unknown as GraphSyncModule;
    if (typeof mod.init !== 'function' || typeof mod.validate !== 'function') {
      throw new Error('Module does not implement GraphSyncModule interface (missing init/validate)');
    }

    this.modules.set(expectedHash, { module: mod, url });
    return mod;
  }

  getDefault(): GraphSyncModule {
    return new DefaultSyncModule();
  }

  installed(): { hash: string; url: string }[] {
    return [...this.modules.entries()].map(([hash, entry]) => ({
      hash,
      url: entry.url,
    }));
  }
}
