# Living Web — Examples & Polyfills

Reference implementations (polyfills) and interactive demos for the [Living Web](../README.md) W3C specification proposals.

## Polyfills

| Package | Spec | Notes |
|---------|------|-------|
| [`@living-web/identity`](./polyfills/identity/) | [02 — Decentralised Identity](../drafts/02_decentralised-identity-web-platform.md) | `did:key` + `did:graph`; DID-document delegate management; resolver router |
| [`@living-web/personal-graph`](./polyfills/personal-graph/) | [01 — Personal Linked-Data Graphs](../drafts/01_personal-linked-data-graphs.md) | GraphStore + Context + mount table; RDF 1.2 reifiers; graph snapshots; cross-context queries |
| [`@living-web/shape-validation`](./polyfills/shape-validation/) | [04 — Dynamic Graph Shape Validation](../drafts/04_dynamic-graph-shape-validation.md) | Context-registered shapes; `shape://actions/` namespace; cross-context inheritance via `context://participates_in` |
| [`@living-web/governance`](./polyfills/governance/) | [05 — Graph Governance](../drafts/05_graph-governance.md) | Root Capability; ZCAPs target `did:graph`; Open/Announced/Enforced enforcement modes; full caveat vocabulary (Expiry, Predicate, Shape, Property, Content, RateLimit, Cardinality, Source, Target, AuthorOnly) |
| [`@living-web/flows`](./polyfills/flows/) | [07 — Graph Flows](../drafts/07_graph-flows.md) | State machines, SPARQL ASK guards, temporal constraints, role requirements |
| [`@living-web/graph-sync`](./polyfills/graph-sync/) | [03 — P2P Graph Sync](../drafts/03_p2p-graph-sync.md) | ContextDiff (graph-DID-keyed) + sync spaces + per-context subscription; default BroadcastChannel transport; topologies (Unified / Privacy-Tiered / Fully-Partitioned / Custom) |
| [`@living-web/group-identity`](./polyfills/group-identity/) | [06 — Decentralised Group Identity](../drafts/06_group-identity.md) | Thin convenience layer over Context + did:graph; participation (`context://`) and signing (DID delegates) kept structurally distinct |

## Demos

| Demo | Description |
|------|-------------|
| [Community Chat](./demos/community-chat/) | Discord-like community with roles (as participating sub-groups), governance, ZCAP-based moderation |
| [P2P Version Control](./demos/p2p-vcs/) | Git-lite with commits, branches, diffs over a shared context |
| [Collaborative Document](./demos/collaborative-doc/) | Block editor with comments, role-based capabilities, cursors |
| [Collaborative Canvas](./demos/collaborative-canvas/) | SVG drawing with layers, editor capabilities |
| [Multiplayer Game](./demos/multiplayer-game/) | Three.js 3D world, player presence, chat |

All demos use the `navigator.graph` API surface with feature detection and polyfill fallback.

## API Surface

```typescript
// Feature detection
if ('graph' in navigator) {
  // GraphStore + Context — the top-level data model
  const store = await navigator.graph.create('My Workspace');
  const calendar = await store.createContext({ displayName: 'My Calendar' });

  await calendar.addTriple(new Triple(
    'urn:event:1',
    'schema://name',
    'Coffee with Nico',
  ));

  // Identity — did:key (individual) and did:graph (graph)
  const me = await navigator.credentials.create({
    did: { method: 'key', displayName: 'Alice' },
  });
  const team = await navigator.credentials.create({
    did: { method: 'graph', displayName: 'Engineering' },
  });

  // Shape validation — registered into a Context
  await calendar.addShape('Event', JSON.stringify({
    targetClass: 'schema://Event',
    properties: [
      { path: 'schema://name', name: 'name', datatype: 'xsd:string', minCount: 1, maxCount: 1 },
    ],
    constructor: [
      { action: 'shape://actions/setSingleTarget', source: 'this', predicate: 'schema://name', target: 'name' },
    ],
  }));

  // Graph sync — Context.publish() into a sync space
  const shared = await calendar.publish({ spaceTopology: 'unified' });
  console.log(shared.graphDid, shared.spaceUri);

  // Governance — Root Capability, did:graph as resource, enforcement modes
  const gov = createGovernanceLayer(calendar, { enforcementMode: 'announced' });
  const result = await gov.canAddTripleAs(s, p, t, authorDid);

  // Flows — declarative state machines
  await calendar.addFlow('Reservation', JSON.stringify({
    name: 'Reservation',
    namespace: 'flow://Reservation/',
    appliesTo: 'schema://Event',
    initialState: 'tentative',
    states: [{ name: 'tentative' }, { name: 'confirmed', isTerminal: true }],
    transitions: [
      { name: 'confirm', fromState: 'tentative', toState: 'confirmed', role: 'organise' },
    ],
  }));
}
```

## Getting Started

```bash
# Install all dependencies
cd examples
pnpm install

# Build everything (polyfills + demos)
pnpm build:all

# Run all polyfill tests
pnpm test
```

### Running Demos Locally

Each demo runs as a Vite dev server:

```bash
pnpm dev:chat       # Community Chat       → http://localhost:5173
pnpm dev:vcs        # P2P VCS              → http://localhost:5173
pnpm dev:doc        # Collaborative Doc    → http://localhost:5173
pnpm dev:canvas     # Collaborative Canvas → http://localhost:5173
pnpm dev:game       # Multiplayer Game     → http://localhost:5173
```

### Two-Tab Testing

Open two browser tabs pointing to the same dev server URL. Create/join in one tab, interact in the other. BroadcastChannel syncs ContextDiffs across tabs on the same origin — no relay required.

### Cross-Browser Testing

For cross-browser sync, run the relay server:

```bash
cd relay && pnpm install && pnpm dev
```

Then point demos at `ws://localhost:4000`. The relay routes by sync space (`/space/<spaceId>`).

### Chrome Extension

Load the extension for Living Web support on any page:

```bash
cd extension && pnpm build
```

Then in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `examples/extension/dist/`.

The extension installs identity (did:key + did:graph), personal-graph (GraphStoreManager + Context), shape-validation, graph-sync, group-identity, and flows extensions in the page's main world.

## Structure

```
examples/
├── polyfills/
│   ├── identity/             # did:key + did:graph + delegates
│   ├── personal-graph/       # GraphStore + Context + mount table
│   ├── shape-validation/     # shape:// + context-scoped + inheritance
│   ├── governance/           # Root Capability + caveats + enforcement modes
│   ├── flows/                # guards + temporal + roles
│   ├── graph-sync/           # ContextDiff + sync spaces + per-context subscription
│   └── group-identity/       # group convenience over Context + did:graph
├── demos/
│   ├── community-chat/
│   ├── p2p-vcs/
│   ├── collaborative-doc/
│   ├── collaborative-canvas/
│   └── multiplayer-game/
├── extension/                # Chrome extension (Manifest V3)
├── relay/                    # Minimal WebSocket relay (space-routed)
└── index.html                # Landing page with feature detection
```
