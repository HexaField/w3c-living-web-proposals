# Living Web Proposals

**Draft specifications for a decentralised semantic web — personal data graphs, identity, peer-to-peer sync, dynamic schemas, and governance.**

---

## Motivation

The web lacks native primitives for user-owned semantic data. Users can store blobs (IndexedDB), make HTTP requests (fetch), and establish P2P media connections (WebRTC) — but there is no browser-native way to:

- Maintain a **personal knowledge graph** of semantic triples
- **Sign and verify** data with a decentralised identity
- **Synchronise** that graph with peers without a central server
- Apply **dynamic schemas** over graph data
- **Enforce governance rules** (permissions, rate limits, content policies) at the sync layer

These five draft specifications define the atomic primitives needed to fill these gaps. Each spec is self-contained and independently useful, but they compose into a complete platform for user-sovereign, decentralised, semantic applications.

## Use Cases

- **Personal knowledge management** — local-first semantic graphs that persist across apps and sessions
- **Collaborative workspaces** — shared graphs with role-based permissions and real-time sync
- **P2P social networks** — communities with consensus-enforced moderation, no central server
- **Multi-agent systems** — AI agents operating under governance constraints defined as graph data
- **Cross-app data sharing** — the same contacts, calendar, or notes graph accessible to multiple applications
- **Offline-first applications** — graphs that work without connectivity and sync when online

## Drafts

| # | Specification | Description |
|---|--------------|-------------|
| 01 | [Personal Linked Data Graphs](drafts/01_personal-linked-data-graphs.md) | Client-side API for local-first semantic triple stores with SPARQL queries and SHACL shape validation |
| 02 | [Decentralised Identity Integration](drafts/02_decentralised-identity-web-platform.md) | Extends the Credential Management API with DID key generation, secure storage, and signing |
| 03 | [P2P Graph Synchronisation Protocol](drafts/03_p2p-graph-sync.md) | Protocol for synchronising graphs between peers — transport-agnostic, eventually consistent, with background sync |
| 04 | [Dynamic Graph Shape Validation](drafts/04_dynamic-graph-shape-validation.md) | SHACL extension adding action semantics — constructors, setters, and collections for declarative CRUD over graphs |
| 05 | [Graph Governance](drafts/05_graph-governance.md) | Constraint enforcement for shared graphs — capabilities (ZCAP), credentials (VC), rate limits, and content policies, enforced at the sync layer |

## How They Compose

```
Applications (any framework)
        │
        ▼
┌──────────────────────────────────────────────────┐
│  05 Graph Governance                              │
│  Constraints enforced at sync layer               │
├──────────────────────────────────────────────────┤
│  03 P2P Graph Sync        04 Dynamic Shapes       │
│  SharedGraph protocol      SHACL + action semantics│
├──────────────────────────────────────────────────┤
│  01 Personal Linked Data Graphs                   │
│  Local-first semantic triple store + SPARQL       │
├──────────────────────────────────────────────────┤
│  02 Decentralised Identity                        │
│  DID keys, signing, verification                  │
└──────────────────────────────────────────────────┘
```

Each layer builds on the ones below it. Spec 01 has standalone value. Spec 03 extends 01 with sync. Spec 05 extends 03 with governance. Spec 02 provides the identity primitives used by all others. Spec 04 provides the schema system used by 01 and 05.

## Status

These are early drafts for discussion. They are not affiliated with any W3C Working Group or Community Group.

Feedback, issues, and contributions are welcome.

## License

These specifications are provided under the [W3C Software and Document License](https://www.w3.org/copyright/software-license-2023/).
