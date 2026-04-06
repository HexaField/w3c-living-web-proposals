# The Living Web

**Six browser primitives for a decentralised semantic web — personal graphs, identity, peer-to-peer sync, dynamic schemas, governance, and group identity.**

[View the Demos](examples/) · [Chromium Fork](https://github.com/HexaField/living-web-chromium)

---

## The Problem

The web has no native primitives for user-owned semantic data. You can store blobs (IndexedDB), make HTTP requests (fetch), and stream media peer-to-peer (WebRTC). But there's no way to maintain a personal knowledge graph, sign it with your own identity, share it with peers, enforce governance rules, or organise into groups — without depending on someone else's server.

## The Specifications

Six W3C-format draft specifications, totalling 5,865 lines:

| # | Spec | Lines | Description |
|---|------|-------|-------------|
| 01 | [Personal Linked Data Graphs](drafts/01_personal-linked-data-graphs.md) | 544 | `navigator.graph` — browser-native semantic triple store with SPARQL |
| 02 | [Decentralised Identity](drafts/02_decentralised-identity-web-platform.md) | 522 | Extends `navigator.credentials` with DID key generation and signing |
| 03 | [P2P Graph Synchronisation](drafts/03_p2p-graph-sync.md) | 1,952 | Pluggable WASM sync modules, relay protocol, OR-Set CRDT |
| 04 | [Dynamic Graph Shape Validation](drafts/04_dynamic-graph-shape-validation.md) | 733 | SHACL extension with constructors, setters, collections |
| 05 | [Graph Governance](drafts/05_graph-governance.md) | 1,083 | ZCAP/VC constraint enforcement at the sync layer |
| 06 | [Decentralised Group Identity](drafts/06_group-identity.md) | 1,031 | Holonic groups — individual = group of one, fractal nesting |

### Quick Examples

<details>
<summary>01 — Personal Linked Data Graphs</summary>

```javascript
const calendar = await navigator.graph.create("My Calendar");

await calendar.addTriple({
  source: "urn:event:1",
  predicate: "schema://name",
  target: "Coffee with Nico"
});

const events = await calendar.querySparql(`
  SELECT ?event ?name WHERE {
    ?event <schema://name> ?name
  }
`);
```
</details>

<details>
<summary>02 — Decentralised Identity</summary>

```javascript
const id = await navigator.credentials.create({
  did: { displayName: "Alice" }
});
console.log(id.did);  // "did:key:z6Mk..."

const signed = await id.sign({ message: "hello" });
const valid = await id.verify(signed);  // true
```
</details>

<details>
<summary>03 — P2P Graph Synchronisation</summary>

```javascript
// Share a graph — peers sync via pluggable WASM module
const shared = await calendar.share({
  relays: ["relay.example.com"]
});
console.log(shared.uri);  // "graph://relay.example.com/abc?module=default"

// Another browser joins
const joined = await navigator.graph.join(shared.uri);
joined.ontripleadded = (e) => console.log("New:", e.triple);
```
</details>

<details>
<summary>04 — Dynamic Graph Shape Validation</summary>

```javascript
await calendar.addShape("Event", JSON.stringify({
  targetClass: "schema://Event",
  properties: [
    { name: "name", path: "schema://name", datatype: "string", minCount: 1 },
    { name: "startDate", path: "schema://startDate", datatype: "dateTime" }
  ],
  constructor: [
    { action: "setSingleTarget", source: "this", predicate: "schema://name", target: "name" }
  ]
}));

await calendar.createShapeInstance("Event", "urn:event:2",
  JSON.stringify({ name: "Team Standup", startDate: "2026-04-07T09:00:00Z" })
);
```
</details>

<details>
<summary>05 — Graph Governance</summary>

```javascript
// Rate limit: max 1 message per 30 seconds
await shared.addTriple({
  source: "urn:channel:general",
  predicate: "governance://has_constraint",
  target: "urn:constraint:slow-mode"
});
await shared.addTriple({
  source: "urn:constraint:slow-mode",
  predicate: "governance://temporal_min_interval_seconds",
  target: "data:,30"
});

// Pre-validation
const can = await shared.canAddTriple(myTriple);
// { allowed: false, module: "temporal", reason: "Wait 20 more seconds" }
```
</details>

<details>
<summary>06 — Decentralised Group Identity</summary>

```javascript
const team = await navigator.graph.createGroup({ name: "Engineering" });
console.log(team.did);  // "did:key:z6Mk..." — persistent group identity

await team.addMember("did:key:z6MkAlice...");
await team.addMember("did:key:z6MkBob...");

// Nest: team joins organisation
const org = await navigator.graph.createGroup({ name: "Acme Corp" });
await org.addMember(team.did);  // group as member of group

// Transitive: who's in the org (recursively)?
const everyone = await org.transitiveMembers();
```
</details>

## Implementations

### Polyfills (works today in any browser)

6 npm packages implementing the full spec API. 364+ unit tests, 142+ E2E tests.

```bash
cd examples && pnpm install && pnpm dev:chat
```

| Package | Tests | Description |
|---------|-------|-------------|
| `@living-web/personal-graph` | 43 | Triple store, SPARQL, IndexedDB persistence |
| `@living-web/identity` | 51 | Ed25519 DID, encrypted key storage |
| `@living-web/graph-sync` | 86 | DefaultSyncModule, WebSocket relay, OR-Set CRDT |
| `@living-web/shape-validation` | 55 | SHACL shapes with action semantics |
| `@living-web/governance` | 81 | ZCAP/VC/temporal/content constraints |
| `@living-web/group-identity` | 41 | Holonic groups, transitive membership |

### Chrome Extension

Install the extension → `navigator.graph` available on every page. Feature-detects native support.

### Sync Modules (Rust → WASM)

Two pluggable sync modules proving the API works for different transports:

| Module | Transport | NAT Traversal | Details |
|--------|-----------|---------------|---------|
| [WebSocket Relay](https://github.com/HexaField/living-web-sync-websocket) | WebSocket to relay server | Relay-mediated | 142KB WASM, 14 tests |
| [Iroh P2P](https://github.com/HexaField/living-web-sync-iroh) | QUIC via WebTransport / iroh-net | Hole punching + relay fallback | WASM + native, 9 tests |

### Chromium Fork

Native implementation with Mojo IPC — `navigator.graph` works without polyfills.

| Feature | Status |
|---------|--------|
| Graph CRUD (create/list/get/remove) | ✅ Verified via CDP |
| addTriple / queryTriples / SPARQL / snapshot | ✅ Real Mojo IPC |
| Identity (createIdentity / sign / verify) | ✅ Ed25519 via BoringSSL |
| Shapes (addShape / createInstance) | ✅ |
| Events (ontripleadded) | ✅ Registered |
| SharedGraph sync / governance | ✅ Wired to backends |
| 76 standalone C++ tests | ✅ macOS + Linux |

[→ living-web-chromium](https://github.com/HexaField/living-web-chromium)

### Demos

5 integration demos exercising all specs:

| Demo | What it shows |
|------|--------------|
| 💬 Community Chat | Discord-like with roles, governance, group identity |
| 🔀 P2P Version Control | Git-lite with commits, branches, diffs |
| 📝 Collaborative Document | Block editor with comments, cursors |
| 🎨 Collaborative Canvas | SVG drawing with layers |
| 🎮 Multiplayer Game | Three.js 3D world with collectibles |

### Relay Server

Minimal WebSocket relay for graph sync. Anyone can run one.

```bash
cd examples/relay && npx tsx src/index.ts
```

## How It Composes

```
            ┌─────────────────────┐
            │    Applications     │
            └──────────┬──────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
┌───┴───┐      ┌──────┴──────┐    ┌──────┴──────┐
│  06   │      │     03      │    │     04      │
│ Group │      │  P2P Sync   │    │   Shapes    │
│Identity│     │(WASM modules)│   │  (SHACL)    │
└───┬───┘      └──────┬──────┘    └─────────────┘
    │          ┌──────┴──────┐
    │          │     05      │
    │          │ Governance  │
    │          │  (ZCAP/VC)  │
    │          └─────────────┘
┌───┴──────────────────────────────────────┐
│           01 Personal Graph              │
│      (navigator.graph — triples)         │
└──────────────────┬───────────────────────┘
              ┌────┴────┐
              │   02    │
              │Identity │
              │(DID/keys)│
              └─────────┘
```

## Status

- **Polyfills**: 364+ unit tests, all passing
- **E2E**: 142+ Playwright tests
- **Chromium**: Built on Linux + macOS, verified via CDP
- **Sync modules**: 2 implementations (WebSocket + Iroh)

## License

Specifications: [W3C Software and Document License](https://www.w3.org/copyright/software-license-2023/)  
Implementations: MIT
