# Living Web Graph Relay

A minimal WebSocket relay server for P2P graph sync. Peers connect via WebSocket, are grouped by graph ID, and messages are forwarded to all other peers in the same group.

The relay is intentionally a "dumb pipe" — it has **no authority** over data and simply relays bytes between participants.

## Usage

```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `4000`  | Listen port |
| `HOST`   | `0.0.0.0` | Bind address |

## Protocol

Peers connect to:

```
ws://<host>:<port>/graph/<graphId>
```

- All messages from a peer are forwarded to every other peer in the same `graphId` room.
- Binary and text messages are both supported.
- The relay does not inspect or validate message contents.

## Graph URI Integration

The relay endpoint maps to the `graph://` URI scheme:

```
graph://localhost:4000/<graphId>?module=default
       ^^^^^^^^^^^^^^^
       relay endpoint
```

The polyfill parses this and connects `ws://localhost:4000/graph/<graphId>`.
