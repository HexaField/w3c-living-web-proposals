# Living Web — Examples & Polyfills

Reference implementations (polyfills) and interactive demos for the [Living Web](../README.md) W3C specification proposals.

## Polyfills

| Package | Spec | Tests |
|---------|------|-------|
| [`@living-web/personal-graph`](./polyfills/personal-graph/) | [Personal Linked Data Graphs](../drafts/01_personal-linked-data-graphs.md) | 36 |
| [`@living-web/identity`](./polyfills/identity/) | [Decentralised Identity](../drafts/02_decentralised-identity-web-platform.md) | 47 |
| [`@living-web/graph-sync`](./polyfills/graph-sync/) | [Graph Synchronisation](../drafts/03_shared-graph-synchronisation.md) | 53 |
| [`@living-web/shape-validation`](./polyfills/shape-validation/) | [Shape Validation](../drafts/04_shape-based-graph-validation.md) | 53 |
| [`@living-web/governance`](./polyfills/governance/) | [Governance & Trust](../drafts/05_graph-governance-trust.md) | 81 |

**Total: 270 tests** across 5 polyfills (including 1 cross-polyfill integration test).

## Demos

| Demo | Description |
|------|-------------|
| [Community Chat](./demos/community-chat/) | Real-time chat over shared graphs with governance |
| [P2P Version Control](./demos/p2p-vcs/) | Git-like version control using graph diffs |
| [Collaborative Document](./demos/collaborative-doc/) | Multi-user document editing with CRDT sync |
| [Collaborative Canvas](./demos/collaborative-canvas/) | Shared drawing canvas with shape validation |
| [Multiplayer Game](./demos/multiplayer-game/) | Real-time multiplayer game state via graph sync |

All demos use the `navigator.graph` API surface with feature detection and polyfill fallback.

## API Surface

The polyfills implement the `navigator.graph` API proposed in the Living Web specs:

```typescript
// Feature detection
if ('graph' in navigator) {
  // Personal graph — local RDF triple store with signing
  const graph = await navigator.graph.create('my-graph');
  await graph.addTriple(new SemanticTriple(source, target, predicate));
  const results = await graph.queryTriples({ source });

  // Identity — DID-based identity management
  const identity = await navigator.identity.create();
  const credential = await identity.createCredential();

  // Shape validation — SHACL-like shape definitions
  graph.addShape('Task', shapeDefinitionJSON);
  const instance = await graph.createShapeInstance('Task', 'task:1', { title: 'Hello' });

  // Graph sync — P2P shared graphs
  const shared = SharedGraph.create(identity, 'shared-space');
  await shared.addTriple(triple);

  // Governance — capability-based access control
  const gov = createGovernanceLayer(shared, { rootAuthority: myDID });
  const result = await gov.canAddTripleAs(source, predicate, target, authorDID);
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

Each demo runs as a Vite dev server. Use the convenience scripts from the `examples/` root:

```bash
pnpm dev:chat       # Community Chat    → http://localhost:5173
pnpm dev:vcs        # P2P VCS           → http://localhost:5173
pnpm dev:doc        # Collaborative Doc → http://localhost:5173
pnpm dev:canvas     # Collaborative Canvas → http://localhost:5173
pnpm dev:game       # Multiplayer Game  → http://localhost:5173
```

Or run any demo directly:

```bash
cd demos/community-chat && pnpm dev
```

### Two-Tab Testing

Open two browser tabs pointing to the same dev server URL. Create/join in one tab, interact in the other. BroadcastChannel syncs triples across tabs on the same origin.

### Serving Built Demos

After building, each demo's `dist/` folder contains static files. Serve with any HTTP server:

```bash
# Serve a specific demo
cd demos/community-chat && pnpm preview

# Or serve everything from examples root
npx serve . -l 3000
```

> **Note:** Built demos use ES modules (`type="module"`) and won't work when opened as `file://` URLs. You must use an HTTP server.

### Chrome Extension

Load the extension for Living Web support on any page:

```bash
cd extension && pnpm build
```

Then in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `examples/extension/dist/`

## Structure

```
examples/
├── polyfills/
│   ├── personal-graph/     # @living-web/personal-graph — RDF triple store
│   ├── identity/           # @living-web/identity — DID key management
│   ├── graph-sync/         # @living-web/graph-sync — P2P shared graphs
│   ├── shape-validation/   # @living-web/shape-validation — SHACL-like shapes
│   └── governance/         # @living-web/governance — capability-based access
├── demos/
│   ├── community-chat/     # Discord-like chat with governance
│   ├── p2p-vcs/            # Git-lite version control
│   ├── collaborative-doc/  # Block editor with comments
│   ├── collaborative-canvas/ # SVG drawing with layers
│   └── multiplayer-game/   # Three.js 3D game
├── extension/              # Chrome extension (Manifest V3)
└── index.html              # Landing page with feature detection
```
