/**
 * Graph URI parser (§4.5)
 * 
 * Format: graph://<relay-endpoints>/<graph-id>?module=<content-hash>
 * 
 * - relay-endpoints: comma-separated hostnames
 * - graph-id: UUID or random identifier
 * - module: optional content hash of sync module WASM binary
 */

export interface ParsedGraphURI {
  relays: string[];
  graphId: string;
  moduleHash: string | null;
  raw: string;
}

const GRAPH_URI_REGEX = /^graph:\/\/([^/]+)\/([^?]+)(?:\?(.+))?$/;

/**
 * Parse a graph:// URI into its components.
 * Throws SyntaxError (DOMException) if the URI is invalid.
 */
export function parseGraphURI(uri: string): ParsedGraphURI {
  const match = uri.match(GRAPH_URI_REGEX);
  if (!match) {
    throw new DOMException(
      `Invalid Graph URI: ${uri}. Expected format: graph://<relay>/<id>?module=<hash>`,
      'SyntaxError'
    );
  }

  const [, relayStr, graphId, queryStr] = match;
  const relays = relayStr.split(',').map(r => r.trim()).filter(Boolean);

  if (relays.length === 0) {
    throw new DOMException(
      `Invalid Graph URI: no relay endpoints specified`,
      'SyntaxError'
    );
  }

  if (!graphId) {
    throw new DOMException(
      `Invalid Graph URI: no graph ID specified`,
      'SyntaxError'
    );
  }

  let moduleHash: string | null = null;
  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    moduleHash = params.get('module');
  }

  return { relays, graphId, moduleHash, raw: uri };
}

/**
 * Construct a graph:// URI from components.
 */
export function buildGraphURI(
  relays: string[],
  graphId: string,
  moduleHash?: string | null
): string {
  const relayStr = relays.join(',');
  let uri = `graph://${relayStr}/${graphId}`;
  if (moduleHash) {
    uri += `?module=${moduleHash}`;
  }
  return uri;
}

/**
 * Check if a string is a valid graph:// URI.
 */
export function isGraphURI(uri: string): boolean {
  return GRAPH_URI_REGEX.test(uri);
}
