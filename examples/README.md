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
pnpm install

# Build all polyfills
for pkg in polyfills/personal-graph polyfills/identity polyfills/graph-sync polyfills/shape-validation polyfills/governance; do
  cd $pkg && pnpm build && cd ../..
done

# Run all tests
for pkg in polyfills/personal-graph polyfills/identity polyfills/graph-sync polyfills/shape-validation polyfills/governance; do
  cd $pkg && pnpm test && cd ../..
done

# Build a demo
cd demos/community-chat && pnpm build
```

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
│   ├── community-chat/     # Chat app demo
│   ├── p2p-vcs/            # Version control demo
│   ├── collaborative-doc/  # Document editing demo
│   ├── collaborative-canvas/ # Drawing canvas demo
│   └── multiplayer-game/   # Game state demo
└── index.html              # Landing page for GitHub Pages
```
