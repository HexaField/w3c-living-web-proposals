import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

/**
 * Living Web Graph Relay Server
 *
 * A minimal "dumb pipe" relay that groups WebSocket connections by graph ID
 * and forwards messages between peers in the same group. The relay has NO
 * authority over data — it simply relays bytes between participants.
 *
 * Peers connect to: ws://<host>:<port>/graph/<graphId>
 */

export interface RelayOptions {
  port?: number;
  host?: string;
}

export function createRelay(opts: RelayOptions = {}) {
  const port = opts.port ?? 4000;
  const host = opts.host ?? '0.0.0.0';

  // Map of graphId → Set<WebSocket>
  const rooms = new Map<string, Set<WebSocket>>();

  const wss = new WebSocketServer({ port, host });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Extract graphId from URL path: /graph/<graphId>
    const match = req.url?.match(/^\/graph\/(.+)$/);
    if (!match) {
      ws.close(4000, 'Invalid path — expected /graph/<graphId>');
      return;
    }

    const graphId = decodeURIComponent(match[1]);

    // Join room
    if (!rooms.has(graphId)) rooms.set(graphId, new Set());
    const room = rooms.get(graphId)!;
    room.add(ws);

    console.log(`[relay] peer joined graph "${graphId}" (${room.size} peers)`);

    // Forward messages to all other peers in the room
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      for (const peer of room) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) {
          peer.send(data, { binary: isBinary });
        }
      }
    });

    // Leave room on disconnect
    ws.on('close', () => {
      room.delete(ws);
      console.log(`[relay] peer left graph "${graphId}" (${room.size} peers)`);
      if (room.size === 0) rooms.delete(graphId);
    });

    ws.on('error', (err) => {
      console.error(`[relay] WebSocket error in graph "${graphId}":`, err.message);
    });
  });

  wss.on('listening', () => {
    console.log(`[relay] Living Web Graph Relay listening on ${host}:${port}`);
  });

  return {
    wss,
    rooms,
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}
