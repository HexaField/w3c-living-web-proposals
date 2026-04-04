# Living Web — Examples & Polyfills

Reference implementations (polyfills) and interactive demos for the [Living Web](../README.md) W3C specification proposals.

## Polyfills

| Package | Spec | Status |
|---------|------|--------|
| [`@living-web/personal-graph`](./polyfills/personal-graph/) | [Personal Linked Data Graphs](../drafts/01_personal-linked-data-graphs.md) | ✅ Core API |
| `@living-web/identity` | [Decentralised Identity](../drafts/02_decentralised-identity-web-platform.md) | 🔜 Planned |
| `@living-web/graph-sync` | [Graph Synchronisation](../drafts/03_shared-graph-synchronisation.md) | 🔜 Planned |
| `@living-web/shape-validation` | [Shape Validation](../drafts/04_shape-based-graph-validation.md) | 🔜 Planned |
| `@living-web/governance` | [Governance](../drafts/05_graph-governance-trust.md) | 🔜 Planned |

## Getting Started

```bash
pnpm install
pnpm build
pnpm test
```

## Structure

```
examples/
├── polyfills/          # Library packages implementing the specs
│   └── personal-graph/ # @living-web/personal-graph
└── demos/              # Interactive demo apps (coming soon)
```
