import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

/**
 * Living Web Relay Server.
 *
 * A minimal "dumb pipe" that groups WebSocket connections by sync-space hash
 * and forwards messages between peers in the same space. The relay has no
 * authority over data — it relays bytes between participants and never
 * inspects message contents.
 *
 * Path:  ws://<host>:<port>/space/<spaceId>
 *
 * In a Privacy-Tiered or Fully-Partitioned topology, each space carries diffs
 * for a single context (or a set of public contexts). Authorisation is per
 * graph-DID and enforced by the sync module on each peer.
 */

export interface RelayOptions {
  port?: number;
  host?: string;
}

export function createRelay(opts: RelayOptions = {}) {
  const port = opts.port ?? 4000;
  const host = opts.host ?? '0.0.0.0';

  const rooms = new Map<string, Set<WebSocket>>();

  const wss = new WebSocketServer({ port, host });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url ?? '';
    const match = url.match(/^\/space\/(.+)$/);
    if (!match) {
      ws.close(4000, 'Invalid path — expected /space/<spaceId>');
      return;
    }
    const spaceId = decodeURIComponent(match[1]);
    const roomKey = `space:${spaceId}`;
    const roomLabel = `space "${spaceId}"`;

    if (!rooms.has(roomKey)) rooms.set(roomKey, new Set());
    const room = rooms.get(roomKey)!;
    room.add(ws);

    console.log(`[relay] peer joined ${roomLabel} (${room.size} peers)`);

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      for (const peer of room) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) {
          peer.send(data, { binary: isBinary });
        }
      }
    });

    ws.on('close', () => {
      room.delete(ws);
      console.log(`[relay] peer left ${roomLabel} (${room.size} peers)`);
      if (room.size === 0) rooms.delete(roomKey);
    });

    ws.on('error', (err) => {
      console.error(`[relay] WebSocket error in ${roomLabel}:`, err.message);
    });
  });

  wss.on('listening', () => {
    console.log(`[relay] Living Web Relay listening on ${host}:${port}`);
    console.log(`[relay] Route: /space/<spaceId>`);
  });

  return {
    wss,
    rooms,
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}
