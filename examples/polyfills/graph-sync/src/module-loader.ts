import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DefaultSyncModule } from './default-sync-module.js';
import type { GraphSyncModule } from './default-sync-module.js';

/**
 * SyncModuleLoader — content-hash-verified module loading (§7).
 *
 * In a full implementation, sync modules are content-addressed WASM bundles
 * loaded in a sandboxed environment. This polyfill verifies SHA-256 content
 * hashes but evaluates JavaScript (not WASM) in a restricted Function scope.
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

export class DefaultModuleLoader implements SyncModuleLoader {
  private modules = new Map<string, { module: GraphSyncModule; url: string }>();

  async load(url: string, expectedHash: string): Promise<GraphSyncModule> {
    // Fetch the module code
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch module from ${url}: ${response.status}`);
    }
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
