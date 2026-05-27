# Living Web Graph Relay

A minimal WebSocket relay server for P2P graph sync. Peers connect via WebSocket, are grouped by sync-space id, and messages are forwarded to every other peer in the same space.

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

| Variable | Default   | Description |
|----------|-----------|-------------|
| `PORT`   | `4000`    | Listen port |
| `HOST`   | `0.0.0.0` | Bind address |

## Protocol

Peers connect to:

```
ws://<host>:<port>/space/<spaceId>
```

- `spaceId` is the sync-space identifier derived from the chosen topology (see [Context Sync Protocol §7](../../drafts/05_context-sync-protocol.md)).
- All messages from a peer are forwarded to every other peer in the same `spaceId` room.
- Binary and text messages are both supported.
- The relay does not inspect or validate message contents — authorisation is per graph DID and enforced by the sync module on each peer.
