# Living Web — Examples & Polyfills

Reference implementations (polyfills) and interactive demos for the [Living Web](../README.md) W3C specification proposals.

## Polyfills

One polyfill package per spec. Strict dependency order matches the spec DAG: each row depends only on packages above it.

| Package | Spec | Notes |
|---------|------|-------|
| [`@living-web/identity`](./polyfills/identity/) | [01 — Decentralised Identity](../drafts/01_decentralised-identity-web-platform.md) | `did:key`; DID-document delegate management; resolver router |
| [`@living-web/personal-graph`](./polyfills/personal-graph/) | [02 — Personal Linked-Data Graphs](../drafts/02_personal-linked-data-graphs.md) | Content-addressed graphs; RDF 1.2 reifiers; lossless RDF 1.2 snapshots; holonic SPARQL |
| [`@living-web/group-identity`](./polyfills/group-identity/) | [03 — Decentralised Group Identity](../drafts/03_decentralised-group-identity.md) | `did:graph` method; DID-document-as-triples model; groupification; participation vs signing-authority separation |
| [`@living-web/capability-framework`](./polyfills/capability-framework/) | [04 — Graph Capability Framework](../drafts/04_graph-capability-framework.md) | Per-graph governance — purely local validation; same-kind deny-wins; BootstrapRoot chain-cut; immutable-caveats attenuation; Open/Announced/Enforced; plug-in constraint-kind + caveat registries; holonic patterns via DID-document delegation |
| [`@living-web/context-sync`](./polyfills/context-sync/) | [05 — Context Sync Protocol](../drafts/05_context-sync-protocol.md) | GraphDiff (graph-DID-keyed) + sync spaces + per-graph subscription; sync-blocking via per-graph validation |
| [`@living-web/sync-module`](./polyfills/sync-module/) | [06 — Sync Module Architecture](../drafts/06_sync-module-architecture.md) | `SyncModule` contract + `installSyncModule()` wrapper; manifest type stubs (production hosts add WASM sandbox, capability mediation, lifecycle) |
| [`@living-web/shape-validation`](./polyfills/shape-validation/) | [07 — Dynamic Graph Shape Validation](../drafts/07_dynamic-graph-shape-validation.md) | Graph-registered shapes; `shape://actions/` namespace; cross-graph inheritance via `context://participates_in` |
| [`@living-web/constraint-vocabulary`](./polyfills/constraint-vocabulary/) | [08 — Governance Constraint Vocabulary](../drafts/08_governance-constraint-vocabulary.md) | Plug-in `ConstraintHandler`s for temporal, content, and credential constraint kinds |
| [`@living-web/default-sync-module`](./polyfills/default-sync-module/) | [09 — Default Sync Module](../drafts/09_default-sync-module.md) | BroadcastChannel-backed reference sync module; importing `/polyfill` installs the extension and registers itself |
| [`@living-web/flows`](./polyfills/flows/) | [10 — Graph Flows](../drafts/10_graph-flows.md) | State machines, SPARQL ASK guards, temporal constraints, role requirements |

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
    'Coffee with Alice',
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
      { action: 'shape://actions/setSingleTarget', subject: 'this', predicate: 'schema://name', object: 'name' },
    ],
  }));

  // Context sync — Context.publish() into a sync space. A sync module
  // (e.g. @living-web/default-sync-module) must be installed first.
  const shared = await calendar.publish({ spaceTopology: 'unified' });
  console.log(shared.graphDid, shared.spaceUri);

  // Capability framework — Root Capability, did:graph as resource, enforcement modes.
  // Pass standardConstraintKinds (from @living-web/constraint-vocabulary) to enable
  // temporal/content/credential caveats.
  const gov = createGovernanceLayer(calendar, {
    enforcementMode: 'announced',
    constraintKinds: standardConstraintKinds,
  });
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

The extension installs identity (did:key + did:graph), personal-graph (GraphStoreManager + Context), shape-validation, context-sync + default-sync-module, group-identity, and flows extensions in the page's main world.

## Structure

```
examples/
├── polyfills/                       # one package per spec (10 total)
│   ├── identity/                    # 01 — did:key + did:graph + delegates
│   ├── personal-graph/              # 02 — GraphStore + Context + mount table
│   ├── capability-framework/        # 03 — Root Capability + caveats + enforcement modes + handler registry
│   ├── context-sync/                # 04 — ContextDiff + sync spaces + Context.publish() + runtime slot
│   ├── sync-module/                 # 05 — SyncModule contract + install wrapper
│   ├── shape-validation/            # 06 — shape:// + context-scoped + inheritance
│   ├── constraint-vocabulary/       # 07 — temporal/content/credential constraint handlers
│   ├── default-sync-module/         # 08 — BroadcastChannel reference sync module
│   ├── flows/                       # 09 — guards + temporal + roles
│   └── group-identity/              # 10 — group convenience over Context + did:graph
├── demos/
│   ├── community-chat/
│   ├── p2p-vcs/
│   ├── collaborative-doc/
│   ├── collaborative-canvas/
│   └── multiplayer-game/
├── extension/                       # Chrome extension (Manifest V3)
├── relay/                           # Minimal WebSocket relay (space-routed)
└── index.html                       # Landing page with feature detection
```
