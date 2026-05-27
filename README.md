# The Living Web

**Ten browser primitives for a decentralised, self-describing semantic web — identity, personal graphs, group identity, a capability framework, sync protocol, sync modules, shape validation, a constraint vocabulary, a default sync module, and flows.**

[View the Demos](examples/) · [Chromium Fork](https://github.com/HexaField/living-web-chromium)

---

## The Problem

The web has no native primitives for user-owned semantic data, no native identity for collectives, and no way for a unit of structured data — a community's messages, a personal calendar, a shared document — to carry its own governance and process with it. You can store blobs (IndexedDB), make HTTP requests (`fetch`), and stream media peer-to-peer (WebRTC). But there is no way to:

- Maintain a personal knowledge graph that an application can address by name.
- Give a *graph* an identity (a DID) so it can sign as itself and be referenced canonically.
- Share that graph with peers without picking a custodian or surrendering control.
- Enforce membership, rate limits, and content rules at the protocol layer rather than the application layer.
- Compose graphs — each a coherent whole, each participating in something larger — without any single party at the centre.

These specifications define the missing primitives.

## The Specifications

Ten W3C-format draft specifications, arranged so each spec depends only on the ones above it:

| # | Spec | Status | Description |
|---|------|--------|-------------|
| 01 | [Decentralised Identity](drafts/01_decentralised-identity-web-platform.md) | DRAFT | Extends `navigator.credentials` with `did:key` (individuals); resolver-registry extension point that later specs (e.g. spec 03's `did:graph`) plug into; one `DIDCredential` interface — no separate code paths for "individual" vs "collective" identity |
| 02 | [Personal Linked Data Graphs](drafts/02_personal-linked-data-graphs.md) | DRAFT | `navigator.graph` — content-addressed `graph://<hash>` IRIs + optional `did` slot; RDF 1.2 reifiers carrying per-triple provenance; lossless RDF 1.2 snapshots (`nquads-canonical` / `nquads` / `turtle` / `jsonld` all round-trip); holonic SPARQL across mounted graphs |
| 03 | [Decentralised Group Identity](drafts/03_decentralised-group-identity.md) | DRAFT | The `did:graph` method + DID-document-as-triples model. **Groupification** attaches a content-independent DID to an existing graph (in place, one-way); the resulting graph is a **group**. Two concerns kept structurally distinct: *participation* (who is part of it, `context://participates_in`) vs *signing authority* (who can sign as it, DID-document `capabilityInvocation` delegates). |
| 04 | [Graph Capability Framework](drafts/04_graph-capability-framework.md) | DRAFT | Root Capability + ZCAP delegation algebra. ZCAPs target a graph's DID; Open / Announced / Enforced enforcement modes; **immutable-caveats** attenuation; **deny-wins** scope-set accumulation; hierarchical AND holonic governance via the same `participates_in`/`accepts_participation` mechanism; BootstrapRoot chain-cut at constitutional boundaries; `mountContext` action gates read access. |
| 05 | [Context Sync Protocol](drafts/05_context-sync-protocol.md) | PRE-DRAFT | `GraphDiff` (graph-DID-keyed); mount-and-subscribe lifecycle; sync spaces decoupled from logical graphs; **read-side `mountContext` gate** + **write-side scope-set validation** — sync-blocking propagates rejection at every honest peer; discovery deliberately out of scope (non-normative patterns documented). |
| 06 | [Sync Module Architecture](drafts/06_sync-module-architecture.md) | PRE-DRAFT | Pluggable WASM module interface, capability sandbox, lifecycle, user consent. |
| 07 | [Dynamic Graph Shape Validation](drafts/07_dynamic-graph-shape-validation.md) | PRE-DRAFT | SHACL extension with action semantics under stable `shape://actions/`; cross-graph shape inheritance via `context://participates_in`. |
| 08 | [Governance Constraint Vocabulary](drafts/08_governance-constraint-vocabulary.md) | PRE-DRAFT | Standard constraint kinds that plug into the capability framework: temporal, content, credential, shape. |
| 09 | [Default Sync Module](drafts/09_default-sync-module.md) | PRE-DRAFT | The built-in module: OR-Set CRDT, WebTransport relay protocol, NAT traversal, snapshot promotion, `PULL` gated by `validateReadAccess`. |
| 10 | [Graph Flows](drafts/10_graph-flows.md) | PRE-DRAFT | Declarative state machines: SPARQL ASK guards, temporal constraints, role requirements, composite flows. |

### Considered but Not Yet Scoped

The following capabilities are anticipated extensions of this substrate. They are not (yet) drafted as numbered specs but are explicitly held in mind so the foundational specs above stay compatible with them.

- **Multi-device sync.** A single user agent's state (graphs, mounted DIDs, identity credentials, sync subscriptions) replicated across the user's own devices — the experience of logging into a browser profile or joining a Brave-style sync chain — implemented end-to-end peer-to-peer via the [Sync Module Architecture](drafts/06_sync-module-architecture.md), with no operator in the trust path. Conceptually a graph the user participates in with themselves; the open question is the bootstrap (pairing) UX and the per-device key model.
- **Peer-to-peer relationship VC proofs (contacts).** A contacts list built from mutually-signed Verifiable Credentials — each contact entry is co-attested by both parties rather than one-sidedly asserted. References the First Person Project's [Verifiable Relational Proofs](https://www.firstperson.network/white-paper) approach. What's missing is the standardised credential format and the UX patterns for connection establishment, proof exchange, and lifecycle management of relationships.
- **Agent DID sub-keys across identity schemes.** A user's `did:key` acting as the **anchoring sovereign identity** with sub-keys (verification methods in its DID document) that are themselves DIDs from other methods — `did:matrix`, `did:nostr`, `did:web`, `did:plc`, etc. — letting a single identity participate natively on multiple existing networks without those networks needing to know about each other. The DID document model in Spec 03 already permits this structurally (a `verificationMethod` is just a key reference); what's missing is the method-resolver plumbing and the cross-network credential-exchange patterns.

### Key Design Decisions

| Aspect | Decision |
|---|---|
| **Two layers of graph identity** | Every graph has a `graph://<content-hash>` **IRI** (snapshot address; changes on every mutation). A graph that has been **groupified** (Spec 03) additionally has a `did:graph:...` **DID** (content-independent identity; survives mutations). A graph with a DID is a **group**; "group" is a usage term, not a separate data type. |
| **Triple provenance** | RDF 1.2 reifiers carry author, timestamp, and signature inline on each triple — SPARQL-visible, no bespoke wrapper. Reifiers are part of the graph and round-trip through every snapshot serialisation. |
| **Identity for collectives** | A `did:graph`. Multiple verification methods in the DID document; any current `capabilityInvocation` delegate signs as the DID. **No multisig, no threshold cryptography** — shared authority is the delegate set, not the identifier. A `did:graph` with one delegate is structurally identical to one with one hundred. |
| **Participation vs signing authority** | Kept structurally distinct (Spec 03 §7). *Participation* (`context://participates_in` + reciprocal `accepts_participation`) governs what rules apply to your writes; *signing authority* (DID-document `capabilityInvocation` delegates) governs whose signature counts as the group's. The CEO can sign; every employee participates — they are different sections of the data model. |
| **Authorisation** | ZCAPs target a graph's **DID** for long-lived authority (IRIs are reserved for snapshot-scoped capabilities). Capability chains trace to each graph's own root capability; the chain is **cut** at `BootstrapRoot` (parent governance cannot reach into a constitutionalised child). |
| **Governance composition** | Constraints **accumulate** across the scope set with **deny-wins** semantics — children cannot escape ancestor rules by re-declaring loosely. Caveats are **immutable** under delegation: children may add, but never modify or remove parent caveats. |
| **Hierarchical vs holonic** | Single mechanism (`participates_in` + `accepts_participation`) covers both. Asymmetric declaration → conventional parent→child inheritance. Bidirectional declaration → each graph's rules bind writes in the other. |
| **Snapshot transfer** | A graph is serialisable as a signed `GraphSnapshot`. All four RDF 1.2 serialisations (`nquads-canonical` / `nquads` / `turtle` / `jsonld`) round-trip losslessly — content-addressed, self-verifying, and bring the graph's governance, shapes, and flows along. |
| **Sync model** | `GraphDiff`s propagate through configurable sync spaces. Three standard topologies: Unified, Privacy-Tiered, Fully Partitioned. The receiving peer enforces governance — both write-side (per-diff capability validation) and read-side (`mountContext` gate on snapshot pulls). Sync-blocking propagates rejection at every honest peer. |
| **Discovery** | Deliberately out of scope. Resolution accepts DID-URL `?relay=` and `?snapshot=` hints; how applications *get* those hints (invitation links, DHT, mDNS, shared discovery graphs, friend-of-friend) is the application layer's call. The substrate is robust to the discovery channel because snapshots are self-verifying and DIDs are key-bound. |

### Quick Examples

<details>
<summary>01 — Decentralised Identity (did:key)</summary>

```javascript
// Individual identity. The DID identifier is immutable (it IS the public key);
// users who anticipate ever wanting more delegates should create a did:graph
// from the start (see spec 03).
const me = await navigator.credentials.create({
  did: { method: "key", displayName: "Alice" }
});
console.log(me.did);   // "did:key:z6Mk..."

// Sign arbitrary content.
const claim = await me.sign({ type: "Greeting", body: "hello world" });
console.log(claim.author);   // me.did
```
</details>

<details>
<summary>02 — Personal Linked Data Graphs (navigator.graph)</summary>

```javascript
// `navigator.graph` is the GraphManager. Create a graph (no DID yet —
// it's a snapshot-only artefact until groupified).
const calendar = await navigator.graph.create({ displayName: "My Calendar" });

await calendar.addTriple(new Triple(
  "urn:event:1",
  "https://schema.org/name",
  new LiteralValue("Coffee with Alice")
));

// The IRI is a content hash and advances on every mutation.
console.log(calendar.iri);   // "graph://e3b0c4..."

// Holonic SPARQL across the default graph + any named graphs passed in.
const r = await calendar.querySparql(`
  SELECT ?name WHERE { <urn:event:1> <https://schema.org/name> ?name }
`);

// Export a lossless signed snapshot (any RDF 1.2 format round-trips).
const snap = await calendar.getAsSnapshot({ format: "nquads-canonical", signBy: "agent" });
const restored = await navigator.graph.fromSnapshot(snap);
console.log(restored.iri === calendar.iri);   // true — bit-for-bit
```
</details>

<details>
<summary>03 — Decentralised Group Identity (groupify a graph)</summary>

```javascript
// Option A: create-and-groupify in one call.
const team = await navigator.graph.createGroup({
  displayName: "Engineering",
  initialDelegates: ["did:key:z6MkAlice...", "did:key:z6MkBob..."]
});
console.log(team.did);   // "did:graph:z6Mk..."

// Option B: promote an existing graph in place. The graph's IRI advances
// (binding + seed DID-document triples are added) but the DID is durable.
const notes = await navigator.graph.create({ displayName: "Notes" });
await notes.addTriple(new Triple("urn:note:1", "schema://text", "first note"));
await navigator.graph.groupify(notes.iri);
console.log(notes.did);   // now "did:graph:z6Mk..." — survives all future mutations

// Any current capabilityInvocation delegate signs as the team.
const teamCred = await navigator.credentials.get({
  did: { method: "graph", filter: { did: team.did } }
});
const announcement = await teamCred.sign({ type: "Release", version: "1.0" });
console.log(announcement.author);   // team.did
```
</details>

<details>
<summary>04 — Graph Capability Framework (Root Capability + enforcement modes + holonic governance)</summary>

```javascript
// Groups have governance from creation. Default mode is "open".
const community = await navigator.graph.createGroup({ displayName: "Community" });
await community.setEnforcementMode("announced");   // observe capability chains
await community.setEnforcementMode("enforced");    // require valid chains

// Delegate a scoped capability to a contractor.
const contractorCap = await community.delegateCapability({
  invoker: "did:key:z6MkContractor...",
  actions: ["createLink"],
  resource: community.did,            // DIDs are the canonical resource
  caveats: [
    { type: "expiry",    value: { expiresAt: "2026-06-22T00:00:00Z" }},
    { type: "predicate", value: { allowed: ["msg://body", "msg://reaction"] }},
    { type: "rateLimit", value: { maxPerWindow: 50, windowSeconds: 3600 }}
  ]
});

// Holonic link: A↔B participation makes the two share a governance surface.
// Each graph's constraints apply to writes in the other. Same predicates as
// hierarchical, just declared in both directions.
await community.graph.addTriple(new Triple(community.did, "context://participates_in", peer.did));
await community.graph.addTriple(new Triple(community.did, "context://accepts_participation", peer.did));
await peer.graph.addTriple(new Triple(peer.did, "context://participates_in", community.did));
await peer.graph.addTriple(new Triple(peer.did, "context://accepts_participation", community.did));
```
</details>

<details>
<summary>05 — Context Sync Protocol (mount + read-side capability gate)</summary>

```javascript
// Publish a group's host graph to a sync space.
const planning = await navigator.graph.createGroup({ displayName: "Q3 Planning" });
const published = await planning.publish({
  spaceTopology: "privacy-tiered",
  relays: ["wss://relay.example.com"]
});

// Another agent mounts it with WRITE capability.
const mounted = await otherManager.mount(published.graphDid, {
  mode: "write",
  capabilityProof: { chain: invitedZcapIds, presentations: [] },
  spaceUri:   published.spaceUri,
  moduleHash: published.moduleHash,
  relays:     published.relays
});
// Now subscribed — diffs flow both ways; each peer re-validates incoming
// diffs against the graph's scope-set governance.

// Read-only mounts of a graph with a `mountContext` constraint require a
// proof too — the receiving peer's `validateReadAccess` gates the snapshot.
const readOnly = await otherManager.mount(published.graphDid, {
  mode: "read",
  capabilityProof: { chain: [readZcap], presentations: [vcPresentation] }
});
```
</details>

<details>
<summary>07 — Dynamic Graph Shape Validation</summary>

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
<summary>10 — Graph Flows (declarative state machines)</summary>

```javascript
await community.graph.addFlow("Proposal", JSON.stringify({
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

const result = await community.graph.executeFlowTransition("Proposal", "proposal:42", "ratify");
// → { success: true, newState: "ratified" } or
//   { success: false, reason: "Quorum not reached", guardDescription: "..." }
```
</details>

<details>
<summary>Participation vs signing authority (spec 03 §7) — the structural distinction</summary>

```javascript
const team = await navigator.graph.createGroup({
  displayName: "Project Alpha",
  initialDelegates: ["did:key:z6MkAlice..."]
});

// Invite participation — Alice will be "part of" the team.
await team.invite("did:key:z6MkAlice...");
// Alice completes by adding context://participates_in in her own graph.

// Add Charlie as a SIGNER — does NOT make him a participant.
// He can sign as the team but isn't recorded as "part of" it.
await team.addSigner(
  { id: `${team.did}#key-charlie`, type: "Ed25519VerificationKey2020",
    controller: team.did, publicKeyMultibase: "z6MkCharlie..." },
  ["capabilityInvocation", "assertionMethod"]
);

console.log((await team.participants()).map(p => p.did));
console.log((await team.signers("capabilityInvocation")).map(s => s.id));
```
</details>

## How It Composes

The specs form a strict DAG — each level builds only on the levels below it. Spec 03 (Group Identity) is the substrate dependency for Spec 04 (Capability Framework): governance targets DIDs, which Spec 03 provides.

```
                          ┌─────────────────────────┐
                          │      Applications       │
                          └────────────┬────────────┘
                                       │
   ┌─────────────────┬─────────────────┼─────────────────┐
   │       10        │       09        │       08        │
   │  Graph Flows    │  Default Sync   │   Constraint    │
   │   (process)     │  (CRDT + wire)  │   Vocabulary    │
   └────────┬────────┴────────┬────────┴────────┬────────┘
            │                 │                 │
            │       ┌─────────┴────────┐  ┌─────┴──────┐
            │       │        07        │  │     06     │
            │       │  Shape Validation│  │  Sync Mod. │
            │       │   (structure)    │  │   Arch.    │
            │       └─────────┬────────┘  └─────┬──────┘
            │                 │                 │
            │                 │       ┌─────────┴──────────┐
            │                 │       │         05         │
            │                 │       │   Context Sync     │
            │                 │       │     Protocol       │
            │                 │       └─────────┬──────────┘
            │                 │                 │
            └─────────────────┴─────────────────┤
                                                │
                                  ┌─────────────┴──────────────┐
                                  │             04             │
                                  │   Graph Capability Framework│
                                  │  (scope-set, deny-wins,    │
                                  │   immutable caveats,       │
                                  │   mountContext gate)       │
                                  └─────────────┬──────────────┘
                                                │
                                  ┌─────────────┴──────────────┐
                                  │             03             │
                                  │  Decentralised Group       │
                                  │     Identity (did:graph)   │
                                  │  — substrate dependency    │
                                  └─────────────┬──────────────┘
                                                │
                                  ┌─────────────┴──────────────┐
                                  │             02             │
                                  │  Personal Linked Data      │
                                  │  Graphs (navigator.graph)  │
                                  └─────────────┬──────────────┘
                                                │
                                       ┌────────┴────────┐
                                       │       01        │
                                       │   Identity      │
                                       │   (did:key +    │
                                       │    resolver     │
                                       │    registry)    │
                                       └─────────────────┘
```

## Implementations

### Polyfills (works in any browser)

npm packages implementing the API surface.

```bash
cd examples && pnpm install && pnpm dev:chat
```

One package per spec, strict dependency order:

| Spec | Package | Description |
|-----:|---------|-------------|
| 01 | `@living-web/identity` | `did:key` + resolver registry + DID-document delegate management surface |
| 02 | `@living-web/personal-graph` | `navigator.graph`, content-addressed graphs, RDF 1.2 reifiers, lossless RDF 1.2 snapshots, holonic SPARQL |
| 03 | `@living-web/group-identity` | `did:graph` method, DID-document-as-triples model, `groupify()` upgrade, `Group` convenience layer, participation-vs-signing separation |
| 04 | `@living-web/capability-framework` | Scope-set governance (hierarchical + holonic), accumulate + deny-wins, `BootstrapRoot` chain-cut, immutable-caveats attenuation, Open/Announced/Enforced, plug-in constraint-kind registry, `validateAction("mountContext", ...)` read-side gate |
| 05 | `@living-web/context-sync` | `GraphDiff` + sync spaces + per-graph subscription; `validateDiff` (writes) + `validateReadAccess` (reads) |
| 06 | `@living-web/sync-module` | `SyncModule` contract + `installSyncModule()` (production hosts add WASM sandbox + lifecycle) |
| 07 | `@living-web/shape-validation` | SHACL action semantics, graph-scoped, cross-graph inheritance via `context://participates_in` |
| 08 | `@living-web/constraint-vocabulary` | Plug-in `ConstraintHandler`s for temporal / content / credential constraint kinds |
| 09 | `@living-web/default-sync-module` | Reference BroadcastChannel sync module — `/polyfill` auto-installs |
| 10 | `@living-web/flows` | Declarative state machines, SPARQL ASK guards, temporal constraints, role requirements |

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
