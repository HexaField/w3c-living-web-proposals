import type { GraphSyncModule, ModuleConfig, GraphReader, GraphWriter } from './default-sync-module.js';
import type { GraphDiff, ValidationResult, Peer } from './types.js';

/**
 * WasmSyncModuleAdapter — adapts a wasm-bindgen WebSocketSyncModule
 * to the polyfill's GraphSyncModule interface.
 *
 * The WASM module communicates via JSON strings; this adapter handles
 * serialization/deserialization at the boundary.
 */
export interface WasmSyncModuleInstance {
  init(config_json: string): void;
  shutdown(): void;
  connect(graph_uri: string, local_did: string): void;
  disconnect(): void;
  commit(diff_json: string): string;
  request_sync(from_revision: string): void;
  peers(): string;
  online_peers(): string;
  send_signal(remote_did: string, payload: Uint8Array): void;
  set_on_signal(callback: Function): void;
  validate(diff_json: string, author: string): string;
  free?(): void;
}

export class WasmSyncModuleAdapter implements GraphSyncModule {
  private _wasm: WasmSyncModuleInstance;
  private _signalCallback: ((remoteDid: string, payload: Uint8Array) => void) | null = null;

  constructor(wasmInstance: WasmSyncModuleInstance) {
    this._wasm = wasmInstance;
  }

  init(config: ModuleConfig): void {
    // The WASM module accepts a JSON config; we serialize the parts it can use.
    // graphReader/graphWriter are host-side objects — not passed to WASM.
    this._wasm.init(JSON.stringify({
      graphUri: config.graphUri,
      localDid: config.localDid,
    }));
  }

  shutdown(): void {
    this._wasm.shutdown();
  }

  connect(graphUri: string, localDid: string): void {
    this._wasm.connect(graphUri, localDid);
  }

  disconnect(): void {
    this._wasm.disconnect();
  }

  commit(diff: GraphDiff): string | ValidationResult {
    const resultJson = this._wasm.commit(JSON.stringify({
      revision: diff.revision,
      author: diff.author,
      timestamp: diff.timestamp,
      additions: diff.additions,
      removals: diff.removals,
      dependencies: diff.dependencies,
    }));
    // The WASM module returns either a revision string or a JSON validation result
    try {
      const parsed = JSON.parse(resultJson);
      if (parsed && typeof parsed === 'object' && 'accepted' in parsed) {
        return parsed as ValidationResult;
      }
    } catch {
      // Not JSON — it's a revision string
    }
    return resultJson;
  }

  requestSync(fromRevision: string): void {
    this._wasm.request_sync(fromRevision);
  }

  peers(): Peer[] {
    return JSON.parse(this._wasm.peers());
  }

  onlinePeers(): Peer[] {
    return JSON.parse(this._wasm.online_peers());
  }

  sendSignal(remoteDid: string, payload: Uint8Array): void {
    this._wasm.send_signal(remoteDid, payload);
  }

  onSignal(callback: (remoteDid: string, payload: Uint8Array) => void): void {
    this._signalCallback = callback;
    this._wasm.set_on_signal((remoteDid: string, payload: Uint8Array) => {
      this._signalCallback?.(remoteDid, payload);
    });
  }

  validate(diff: GraphDiff, author: string, _graphState: GraphReader): ValidationResult {
    const resultJson = this._wasm.validate(JSON.stringify({
      revision: diff.revision,
      author: diff.author,
      timestamp: diff.timestamp,
      additions: diff.additions,
      removals: diff.removals,
      dependencies: diff.dependencies,
    }), author);
    return JSON.parse(resultJson);
  }
}
