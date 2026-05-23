# The Living Web

**Seven browser primitives for a decentralised, self-describing semantic web — graph identity, decentralised identity, peer-to-peer synchronisation, shape validation, governance, group identity, and flows.**

[View the Demos](examples/) · [Chromium Fork](https://github.com/HexaField/living-web-chromium)

---

## The Problem

The web has no native primitives for user-owned semantic data, no native identity for collectives, and no way for a unit of structured data — a community's messages, a personal calendar, a shared document — to carry its own governance and process with it. You can store blobs (IndexedDB), make HTTP requests (`fetch`), and stream media peer-to-peer (WebRTC). But there is no way to:

- Maintain a personal knowledge graph that an application can address by name.
- Give a *graph* an identity (a DID) so it can sign as itself and be referenced canonically.
- Share that graph with peers without picking a custodian or surrendering control.
- Enforce membership, rate limits, and content rules at the protocol layer rather than the application layer.
- Compose contexts — each a coherent whole, each participating in something larger — without any single party at the centre.

These specifications define the missing primitives.

## The Specifications

Seven W3C-format draft specifications.

| # | Spec | Description |
|---|------|-------------|
| 01 | [Personal Linked Data Graphs](drafts/01_personal-linked-data-graphs.md) | `navigator.graph` — **GraphStore** = mount table; **Context** = named graph with `did:graph:...` identity; graph snapshots for portable, signed serialisation |
| 02 | [Decentralised Identity](drafts/02_decentralised-identity-web-platform.md) | Extends `navigator.credentials` with `did:key` (individuals) AND `did:graph` (graphs); DID-document delegates for shared signing — **no multisig, no threshold cryptography** |
| 03 | [P2P Context Sync](drafts/03_p2p-graph-sync.md) | Pluggable WASM sync modules; ContextDiff (graph-DID-keyed); sync spaces decoupled from logical contexts; subscription replaces boolean join |
| 04 | [Dynamic Graph Shape Validation](drafts/04_dynamic-graph-shape-validation.md) | SHACL extension with action semantics under stable `shape://actions/`; cross-context shape inheritance via `context://participates_in` |
| 05 | [Graph Governance](drafts/05_graph-governance.md) | Root Capability; ZCAPs target `did:graph:...`; Open/Announced/Enforced enforcement modes; full caveat vocabulary; governance of DID delegates |
| 06 | [Decentralised Group Identity](drafts/06_group-identity.md) | A group **is** a `did:graph` context; participation (`context://participates_in`) and signing authority (DID-document delegates) kept structurally distinct |
| 07 | [Graph Flows](drafts/07_graph-flows.md) | Declarative state machines: SPARQL ASK guards, temporal constraints, role requirements, composite flows |

### Key Design Decisions

| Aspect | Decision |
|---|---|
| **Unit of coherence** | A **context** — a named graph identified by a `did:graph:...` DID. Its identity, governance, shapes, and flows all live as triples inside it. |
| **Top-level data structure** | A **GraphStore** (consistent with [SPARQL 1.2 Graph Store Protocol](https://www.w3.org/TR/sparql12-graph-store-protocol/)) — a mount table of contexts the agent has open, plus a private graph for agent-local state. |
| **Triple provenance** | RDF 1.2 reifiers carrying author, timestamp, and signature inline on each triple — SPARQL-visible, no bespoke wrapper. |
| **Identity for collectives** | A `did:graph` DID. Multiple verification methods in the DID document; any current `capabilityInvocation` delegate signs as the DID. No multisig. |
| **Authorisation** | ZCAPs targeting `did:graph:...` as the canonical resource. Capability chains trace to each context's own root capability. |
| **Snapshot transfer** | A context is serialisable as a signed graph snapshot. Snapshots are addressable (content-hashed) and can be mounted by other agents — bringing the context's governance, shapes, and flows along. |
| **Sync model** | ContextDiffs propagate through configurable sync spaces. Three standard topologies: Unified, Privacy-Tiered, Fully Partitioned. |

### Quick Examples

<details>
<summary>01 — Personal Linked Data Graphs (GraphStore + Context)</summary>

```javascript
const me = await navigator.graph.create("My Workspace");
const calendar = await me.createContext({ displayName: "My Calendar" });

await calendar.addTriple(new Triple(
  "urn:event:1",
  "schema://name",
  "Coffee with Alice"
));

const events = await calendar.querySparql(`
  SELECT ?event ?name WHERE {
    ?event <schema://name> ?name
  }
`);
```
</details>

<details>
<summary>02 — Decentralised Identity (did:key + did:graph)</summary>

```javascript
// Individual identity
const me = await navigator.credentials.create({
  did: { method: "key", displayName: "Alice" }
});
console.log(me.did);  // "did:key:z6Mk..."

// Graph identity for a team
const team = await navigator.credentials.create({
  did: {
    method: "graph",
    displayName: "Engineering",
    graphOptions: { initialDelegates: ["did:key:z6MkBob...", "did:key:z6MkCarol..."] }
  }
});
console.log(team.did);  // "did:graph:z6Mk..."

// Any current capabilityInvocation delegate can sign as the team
const announcement = await team.sign({ type: "Release", version: "1.0" });
console.log(announcement.author);  // team.did
```
</details>

<details>
<summary>03 — P2P Context Sync (Publish + Mount)</summary>

```javascript
// Publish a context to a sync space
const planning = await me.createContext({ displayName: "Q3 Planning" });
const published = await planning.publish({
  spaceTopology: "privacy-tiered",
  relays: ["relay.example.com"]
});

// Another browser mounts it
const mounted = await otherStore.mount(published.graphDid, {
  mode: "write",
  capabilityProof: invitedCapabilityChain,
  spaceUri: published.spaceUri,
  moduleHash: published.moduleHash,
  relays: published.relays
});
// Now subscribed — diffs flow both ways
```
</details>

<details>
<summary>04 — Dynamic Graph Shape Validation</summary>

```javascript
await calendar.addShape("Event", JSON.stringify({
  targetClass: "schema://Event",
  properties: [
    { path: "schema://name",      name: "name",      datatype: "xsd:string",   minCount: 1, maxCount: 1 },
    { path: "schema://startDate", name: "startDate", datatype: "xsd:dateTime", minCount: 1, maxCount: 1 }
  ],
  constructor: [
    { action: "shape://actions/setSingleTarget", subject: "this", predicate: "rdf://type",         object: "schema://Event" },
    { action: "shape://actions/setSingleTarget", subject: "this", predicate: "schema://name",      object: "name" },
    { action: "shape://actions/setSingleTarget", subject: "this", predicate: "schema://startDate", object: "startDate" }
  ]
}));

await calendar.createShapeInstance("Event", "urn:event:2", {
  name: "Team Standup", startDate: "2026-06-01T09:00:00Z"
});
```
</details>

<details>
<summary>05 — Graph Governance (ZCAP target = did:graph; enforcement modes)</summary>

```javascript
// A context begins in "open" mode by default
const community = await me.createContext({ displayName: "Community" });
await community.setEnforcementMode("announced");  // start observing capability chains
// ...later
await community.setEnforcementMode("enforced");   // require valid chains

// Delegate a scoped capability to a contractor
const myCred = await navigator.credentials.get({ did: { kind: "individual" } });
const contractorCap = await myCred.signCapability({
  parentCapability: rootCap.id,
  invoker: "did:key:z6MkContractor...",
  actions: ["createLink"],
  resource: community.did,
  caveats: [
    { type: "expiry",    value: { expiresAt: "2026-06-22T00:00:00Z" }},
    { type: "shape",     value: { shapeIri: "msg://MessageShape" }},
    { type: "rateLimit", value: { maxPerWindow: 50, windowSeconds: 3600 }}
  ]
});
```
</details>

<details>
<summary>06 — Decentralised Group Identity (a Group IS a did:graph)</summary>

```javascript
const team = await navigator.graph.createGroup({
  displayName: "Project Alpha",
  initialDelegates: ["did:key:z6MkAlice...", "did:key:z6MkBob..."]
});

// Invite participation (separate from signing authority)
await team.invite("did:graph:carol-personal");
// Carol completes by adding context://participates_in in her own context

// Add Charlie as a signer (does NOT make him a participant)
await team.addSigner(
  { id: `${team.did}#key-charlie`, type: "Ed25519VerificationKey2020",
    controller: team.did, publicKeyMultibase: "z6MkCharlie..." },
  ["capabilityInvocation", "assertionMethod"]
);

console.log((await team.participants()).map(p => p.did));
console.log((await team.signers("capabilityInvocation")).map(s => s.id));
```
</details>

<details>
<summary>07 — Graph Flows (declarative state machines)</summary>

```javascript
await community.addFlow("Proposal", JSON.stringify({
  name: "Proposal",
  namespace: "flow://Proposal/",
  appliesTo: "gov://Proposal",
  initialState: "draft",
  states: [
    { name: "draft" }, { name: "comment" }, { name: "voting" },
    { name: "ratified", isTerminal: true }, { name: "rejected", isTerminal: true }
  ],
  transitions: [
    {
      name: "ratify",
      fromState: "voting",
      toState: "ratified",
      guard: "ASK WHERE { $this <gov://vote_count> ?v . $this <gov://quorum> ?q . FILTER(?v >= ?q) }",
      guardDescription: "Quorum must be reached",
      temporal: { minDelay: "PT48H" },
      role: "ratify"
    }
  ]
}));

const result = await community.executeFlowTransition("Proposal", "proposal:42", "ratify");
// → { success: true, newState: "ratified" } or
//   { success: false, reason: "Quorum not reached", guardDescription: "..." }
```
</details>

## How It Composes

```
                       ┌─────────────────────────┐
                       │      Applications        │
                       └────────────┬─────────────┘
                                    │
       ┌──────────────┬─────────────┼────────────────┬─────────────┐
       │              │             │                │             │
   ┌───┴────┐    ┌───┴───┐    ┌────┴────┐      ┌───┴───┐    ┌────┴────┐
   │   06   │    │  03   │    │   04    │      │  07   │    │   05    │
   │ Groups │    │ Sync  │    │ Shapes  │      │ Flows │    │  Gov.   │
   │did:graph│   │spaces │    │shape:// │      │guards │    │did:graph│
   └───┬────┘    └───┬───┘    └─────────┘      └───────┘    │ resource│
       │             │                                       └─────────┘
       │             │       ┌───────────────────────────────────────┐
       └─────────────┴───────┤  01  Personal Linked Data Graphs       │
                             │     (GraphStore = mount table)         │
                             │     (Context = named graph)            │
                             └───────────────┬───────────────────────┘
                                             │
                                       ┌─────┴─────┐
                                       │    02     │
                                       │  did:key  │
                                       │ did:graph │
                                       │+delegates │
                                       └───────────┘
```

## Implementations

### Polyfills (works in any browser)

npm packages implementing the API surface.

```bash
cd examples && pnpm install && pnpm dev:chat
```

| Package | Description |
|---------|-------------|
| `@living-web/identity` | `did:key` + `did:graph` + DID-document delegate management |
| `@living-web/personal-graph` | GraphStore, Context, mount table, graph snapshots, holonic queries |
| `@living-web/shape-validation` | SHACL action semantics, context-scoped, cross-context inheritance |
| `@living-web/governance` | ZCAP runtime, enforcement modes, full caveat vocabulary |
| `@living-web/flows` | Guards, temporal constraints, role requirements |
| `@living-web/graph-sync` | ContextDiff sync, default OR-Set module, sync space topologies |
| `@living-web/group-identity` | Group convenience layer over Context + did:graph + governance |

### Chrome Extension

Install the extension → `navigator.graph` and `navigator.credentials.create({ did })` available on every page. Feature-detects native support.

### Sync Modules (Rust → WASM)

| Module | Transport | NAT Traversal |
|--------|-----------|---------------|
| [WebSocket Relay](https://github.com/HexaField/living-web-sync-websocket) | WebSocket to relay server | Relay-mediated |
| [Iroh P2P](https://github.com/HexaField/living-web-sync-iroh) | QUIC via WebTransport / iroh-net | Hole punching + relay fallback |

### Chromium Fork

Native implementation with Mojo IPC — `navigator.graph` works without polyfills.

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

Minimal WebSocket relay for sync. Anyone can run one.

```bash
cd examples/relay && npx tsx src/index.ts
```

## License

Specifications: [W3C Software and Document License](https://www.w3.org/copyright/software-license-2023/)
Implementations: MIT
