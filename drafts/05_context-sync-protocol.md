# Graph Synchronisation Protocol

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a protocol for synchronising **graphs** (named graphs, per [[PERSONAL-LINKED-DATA-GRAPHS]]) between multiple agents in a peer-to-peer manner. Synchronisation is keyed by a graph's DID (the `Graph.did` attribute defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3). A DID is REQUIRED for sync: a graph's `graph://<content-hash>` IRI changes whenever its triples change, so it cannot serve as the durable subscription handle that sync needs. Graphs without a DID can still be transported between agents as immutable snapshots ([[PERSONAL-LINKED-DATA-GRAPHS]] §5), but they cannot be *synced* — sync presupposes an evolving graph with a stable, content-independent identity. How a DID is attached to a graph is out of scope for this specification. This specification defines:

- The **GraphDiff** format — additions and removals scoped to a specific DID, accompanied by a capability proof per [[CAPABILITY-FRAMEWORK]].
- The **mount-and-subscribe** lifecycle — a graduated, per-graph subscription model.
- The separation of **logical graphs** (with self-contained governance) from **sync spaces** (gossip topologies that may carry one or many graphs).
- The Graph-API additions that user agents expose for publish, subscribe, and signal.

The protocol is *transport-neutral* and *module-neutral*: it is realised over a pluggable module mechanism in which each module supplies transport, merge logic, peer discovery, and governance validation. The interface, sandbox, and built-in default module are out of scope for this specification.

---

## Status of This Document

This is a draft Community Group Report. It has no official W3C standing and is subject to change.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Architecture: Logical Graphs vs Sync Spaces](#4-architecture-logical-graphs-vs-sync-spaces)
5. [Data Model](#5-data-model)
6. [API](#6-api)
7. [Sync Spaces](#7-sync-spaces)
8. [Subscription Lifecycle](#8-subscription-lifecycle)
9. [Governance Integration](#9-governance-integration)
10. [Background Operation](#10-background-operation)
11. [Signalling](#11-signalling)
12. [Security Considerations](#12-security-considerations)
13. [Privacy Considerations](#13-privacy-considerations)
14. [Examples](#14-examples)
15. [References](#15-references)

---

## 1. Introduction

### 1.1 Motivation

The web's data model is fundamentally client–server. Local-first software addresses this, but the web platform provides no native primitives for peer-to-peer data synchronisation beyond raw transport (WebRTC, WebTransport).

This specification defines a **synchronisation protocol for linked data graphs** — a standard interface and diff format that enables multiple agents to maintain a shared, eventually-consistent named graph without a central server.

This specification *does not* prescribe a specific transport, merge algorithm, or peer-discovery mechanism. Those choices are encapsulated in **sync modules** — pluggable components referenced by content-hash but whose interface, sandboxing, and built-in default are out of scope for this specification.

### 1.2 Use Cases

- **Collaborative editing.** Multiple users co-author graphs, with changes propagating in real time.
- **Peer-to-peer social.** Per-graph feeds, profiles, interactions; no platform intermediary.
- **Distributed knowledge bases.** Research groups maintain shared graphs across institutional boundaries.
- **Offline-first.** Users on intermittent connections make local edits that reconcile when connectivity resumes.
- **Governance-enforced collaboration.** Graphs enforce membership, rate limits, and content rules at the sync layer via [[CAPABILITY-FRAMEWORK]].

### 1.3 Scope

This specification defines:

- The **Graph** API additions for sync (publish, unpublish, mount, subscription lifecycle).
- The **GraphDiff** format.
- The **sync space** abstraction and three standard topologies (Unified / Privacy-Tiered / Fully Partitioned).
- The **subscription** state model.
- **Governance integration** — how the protocol invokes [[CAPABILITY-FRAMEWORK]] validation on every incoming diff.
- **Signalling** for ephemeral peer communication outside the graph.

### 1.4 Relationship to Other Specifications

- [[DECENTRALISED-IDENTITY]] defines `did:key` and the `DIDCredential` signing surface.
- [[PERSONAL-LINKED-DATA-GRAPHS]] defines the `Graph` interface, the `GraphManager` (`navigator.graph`), and the optional DID (`Graph.did`) on which sync subscriptions are keyed. Subscribing to a graph with no DID is not possible; the immutable-snapshot transport path ([[PERSONAL-LINKED-DATA-GRAPHS]] §5) applies instead.
- [[CAPABILITY-FRAMEWORK]] defines the ZCAP rules that the protocol's governance integration enforces.

The pluggable sync-module interface, sandboxing model, and built-in default module are defined by extension specifications and are out of scope here.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A **conforming user agent** MUST implement:

1. The Graph sync API additions ([§6](#6-api)).
2. The sync space abstraction ([§7](#7-sync-spaces)).
3. The subscription lifecycle ([§8](#8-subscription-lifecycle)).
4. Governance integration ([§9](#9-governance-integration)).
5. Background operation ([§10](#10-background-operation)).
6. The pluggable module mechanism by which transport, merge logic, peer discovery, and validation are supplied; the module interface, sandbox, and any built-in default module are out of scope here and are defined by extension specifications.

---

## 3. Terminology

<dl>
<dt><dfn>Graph</dfn></dt>
<dd>A named graph identified by a <code>graph://&lt;content-hash&gt;</code> IRI (optionally also by a DID). See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt><dfn>GraphDiff</dfn></dt>
<dd>A unit of change to a specific graph: additions, removals, a revision identifier, causal dependencies, and a CapabilityProof. The unit of gossip.</dd>

<dt><dfn>CapabilityProof</dfn></dt>
<dd>The ZCAP delegation chain that authorises the committing agent's writes for this graph. See [§5.3](#53-capabilityproof) and [[CAPABILITY-FRAMEWORK]].</dd>

<dt><dfn>Mount</dfn></dt>
<dd>The act of opening a graph in the local `GraphManager`, with a specified mount mode (<code>read</code>, <code>write</code>, or <code>governance</code>). See [§6.2](#62-mounting-a-remote-graph).</dd>

<dt><dfn>Subscription</dfn></dt>
<dd>An agent is subscribed to a graph when they (a) hold a valid capability chain for it, (b) have it mounted, and (c) are subscribed to the appropriate sync space that gossips its diffs.</dd>

<dt><dfn>Sync Space</dfn></dt>
<dd>A lightweight gossip network identified by a hash. One sync space MAY carry diffs for one graph (Fully Partitioned topology) or many graphs (Unified / Privacy-Tiered topologies). The unit of physical message propagation.</dd>

<dt><dfn>Topology</dfn></dt>
<dd>A policy that maps graphs to sync spaces. See [§7.2](#72-topology-policy).</dd>

<dt><dfn>Sync Module</dfn></dt>
<dd>A content-addressed pluggable component that handles transport, merge, peer discovery, and validation for a sync space. Its interface, sandbox, and any built-in default module are out of scope for this specification.</dd>

<dt><dfn>Peer</dfn></dt>
<dd>An agent participating in synchronisation of a graph. Identified by (DID, sessionId).</dd>

<dt><dfn>Revision</dfn></dt>
<dd>A content-addressed identifier for a GraphDiff, computed as a cryptographic hash of additions, removals, and dependencies.</dd>

<dt><dfn>Snapshot</dfn></dt>
<dd>An addressable serialised form of a graph, produced when diff chains exceed a configured length. Maps to the GraphSnapshot in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.</dd>
</dl>

---

## 4. Architecture: Logical Graphs vs Sync Spaces

This section is normative.

### 4.1 The Two Layers

Graph identity, sync topology, and module choice are kept separate:

```
┌─────────────────────────────────────────────────────┐
│  Logical Layer (per-graph)                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐   │
│  │#general │ │#random  │ │#private │ │Thread-42 │   │
│  │ graph:// │ │ graph:// │ │ graph:// │ │ graph:// │   │
│  │governance│ │governance│ │governance│ │governance│  │
│  │shapes   │ │shapes   │ │shapes   │ │shapes    │   │
│  │flows    │ │flows    │ │flows    │ │flows     │   │
│  │data     │ │data     │ │data     │ │data      │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘   │
│       │           │           │            │         │
│  ─────┼───────────┼───────────┼────────────┼──────── │
│       │           │           │            │         │
│  Sync Layer (per-space, configurable topology)       │
│  ┌────▼───────────▼───────────┴────────────▼──────┐  │
│  │  Community Space (shared)  │  Private Space    │  │
│  │  #general, #random,        │  #private          │  │
│  │  Thread-42                 │  (isolated)        │  │
│  └────────────────────────────┴───────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Logical layer**: Each graph is identified by its DID (required for sync) and has its own governance, shapes, flows, and data. Its current state has a `graph://<content-hash>` IRI which changes with every diff. **Authorization** lives here, per-graph.

**Sync layer**: Sync spaces determine what gossips with what. **Membership in a space** carries diffs to your peer; **a valid capability** lets you process them. The two are orthogonal.

A receiving peer in a shared space:

1. Receives a diff carrying its `graphDid`.
2. Checks "am I subscribed to this graph?" — if no, discard.
3. If yes, verify the `CapabilityProof` against the graph's governance ([[CAPABILITY-FRAMEWORK]]).
4. If valid, apply to the local per-graph store.
5. If invalid, reject.

### 4.2 Why Decouple?

- **Overhead.** A 1000-graph community could mean 1000 separate gossip networks per agent. Decoupling lets multiple graphs share a network.
- **Lifecycle churn.** Ephemeral threads with three messages and two participants gain nothing from a dedicated DHT.
- **Flexibility.** Some communities want privacy isolation. Others want simplicity. The right tradeoff is per-community.
- **Migration.** A graph's privacy can crystallise over time. Decoupled topology can migrate the graph to a more-isolated space as governance tightens.

---

## 5. Data Model

### 5.1 GraphDiff

```webidl
[Exposed=Window,Worker]
interface GraphDiff {
  readonly attribute USVString graphDid;          // the graph's DID
  readonly attribute USVString revision;           // sha256 hex
  readonly attribute FrozenArray<Triple> additions;
  readonly attribute FrozenArray<Triple> removals;
  readonly attribute FrozenArray<USVString> dependencies;  // prior revisions in this graph's chain
  readonly attribute CapabilityProof? capabilityProof;
  readonly attribute USVString author;             // did:key:... (the committing agent)
  readonly attribute DOMString timestamp;          // RFC 3339; authoritative commit time
  readonly attribute unsigned long diffsSinceSnapshot;
};
```

Triples carry reifier-based provenance per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.2.

A GraphDiff MUST be immutable once `revision` has been computed.

### 5.2 Revision

```
revision = hex(SHA-256(
  graphDid
  || canonicalize(additions)
  || canonicalize(removals)
  || sort(dependencies)
))
```

Canonicalisation MUST use the RDF Dataset Canonicalization algorithm [[RDF-CANON]] over the triples-with-reifiers.

### 5.3 CapabilityProof

```webidl
[Exposed=Window,Worker]
interface CapabilityProof {
  readonly attribute FrozenArray<USVString> chain;             // ordered: leaf → root
                                                                // each element is a content-addressed ZCAP id
  readonly attribute FrozenArray<USVString> caveatsSatisfied;  // caveat ids evaluated at commit time
  readonly attribute boolean hasContentCaveats;                 // optimisation hint
  /** Verifiable-credential presentations consumed by `credential` caveats
   *  on the chain. Empty when no credential caveats apply. Each presentation
   *  is a [[VC-DATA-MODEL-2.0]] VerifiablePresentation object. */
  readonly attribute FrozenArray<object> presentations;
};
```

The chain is the ordered list of ZCAPs from the committing agent's leaf capability up to the graph's root capability ([[CAPABILITY-FRAMEWORK]] §4.3). Each entry is a content-addressed reference; resolving them requires the graph's local store (so the receiving peer must already be mounted to verify).

`caveatsSatisfied` records which caveats the committing agent's executor evaluated and accepted before commit. The receiving peer re-evaluates independently; this field is an audit trail, not a trust shortcut.

`hasContentCaveats` is `true` if any delegation in the chain has caveats whose evaluation depends on the link's content (Predicate, Shape, Property, Content, Subject, Object — see [[CAPABILITY-FRAMEWORK]] §9). When `false`, the receiving peer MAY skip per-link caveat re-evaluation as an optimisation.

`presentations` carries VerifiablePresentation objects per [[VC-DATA-MODEL-2.0]] when the chain contains `credential` caveats ([[CONSTRAINT-VOCABULARY]] §6). The receiving peer's governance engine consults this field when evaluating credential caveats; if a required credential is absent or its issuer fails verification, the caveat fails and the proof is rejected. Presentations are scoped to a single proof exchange — they are not retained beyond validation.

### 5.4 Peer

```webidl
dictionary Peer {
  USVString did;             // did:key:... of the agent
  USVString sessionId;       // 128+ bits of randomness; ephemeral per session
  USVString? publicKey;
  USVString? deviceLabel;
  DOMTimeStamp? lastSeen;
  boolean online;
};
```

A single agent MAY have multiple concurrent peer sessions (tabs, devices). Peers are equal iff (DID, sessionId) match.

When a user opens a graph in a new tab or on a new device, the user agent MUST generate a new sessionId. The sessionId is ephemeral — it does not persist across user agent restarts.

### 5.5 Graph Sync State

```webidl
enum GraphSyncState {
  "idle",
  "resolving",   // resolving graph IRI + space + module
  "connecting",  // establishing connections in the space
  "syncing",     // active diff exchange
  "synced",      // converged with all known peers
  "error"
};
```

### 5.6 SyncValidationResult

```webidl
dictionary SyncValidationResult {
  required boolean accepted;
  USVString? module;        // "capability" | "temporal" | "content" | "credential" | <plug-in kind>
  USVString? constraintId;
  USVString? reason;
};
```

---

## 6. API

The sync API extends the `Graph` interface and the `GraphManager` (`navigator.graph`) defined in [[PERSONAL-LINKED-DATA-GRAPHS]].

### 6.1 Publishing a Graph

A locally-created graph becomes shareable by calling `publish()`:

```webidl
partial interface Graph {
  [NewObject] Promise<PublishedGraph> publish(optional PublishOptions options);
  [NewObject] Promise<undefined> unpublish();
  [NewObject] Promise<GraphSyncState> syncState();
};

dictionary PublishOptions {
  USVString moduleHash;           // sync module content hash; defaults to UA default module
  sequence<USVString> relays;     // initial relay endpoints (default-module-specific)
  USVString spaceTopology;        // "unified" | "privacy-tiered" | "fully-partitioned" | "custom"
  USVString customSpace;          // when topology = "custom": the specific space:// URI
};

[Exposed=Window]
interface PublishedGraph {
  readonly attribute USVString graphDid;
  readonly attribute USVString spaceUri;
  readonly attribute USVString moduleHash;
  readonly attribute FrozenArray<USVString> relays;
};
```

The `publish()` method MUST:

1. If `options.moduleHash` is specified and not installed, initiate module installation per the module mechanism in use. If the user denies, reject with `"NotAllowedError"`.
2. If `options.moduleHash` is not specified, use the user agent's default sync module (the default module itself is out of scope here).
3. Determine the space URI ([§7](#7-sync-spaces)).
4. Initialise the sync module if not already running for this space.
5. Subscribe to the space.
6. Return a `PublishedGraph` carrying the addressing.

### 6.2 Mounting a Remote Graph

Mounting opens a remote graph (identified by its DID) into the local user agent so that diffs can be exchanged with peers. This specification defines `mount()` on `GraphManager`:

```webidl
partial interface GraphManager {
  [NewObject] Promise<Graph> mount(USVString graphDid, optional MountOptions options);
  [NewObject] Promise<undefined> unmount(USVString graphDid);
};

dictionary MountOptions {
  MountMode mode = "read";
  /** ZCAP chain + optional VC presentations. REQUIRED for "write" and
   *  "governance"; REQUIRED for "read" if the graph's governance binds a
   *  capability constraint covering the `mountContext` action (per §6.2 step 2). */
  CapabilityProofInput capabilityProof;
  USVString snapshotUri;         // optional initial snapshot to materialise from
  USVString spaceUri;            // hint: the space carrying this graph's diffs
  USVString moduleHash;          // hint: the sync module the space uses
  sequence<USVString> relays;    // hint: relay endpoints
};

enum MountMode { "read", "write", "governance" };
```

The `mount()` method MUST:

1. Reject with `"InvalidStateError"` if the graph is already mounted.
2. **Authorise the mount** against the graph's governance ([[CAPABILITY-FRAMEWORK]]):
   - If `options.mode` is `"write"` or `"governance"`, perform [[CAPABILITY-FRAMEWORK]] §7 with `action = "createLink"` (or the specific action implied by the intended operations) and the supplied `capabilityProof`. Reject with `"NotAllowedError"` on failure.
   - If `options.mode` is `"read"`, perform [[CAPABILITY-FRAMEWORK]] §7 with `action = "mountContext"`. If the scope set contains no capability constraint covering `mountContext` (per [§4.5](#45-document-updates) of that spec), the graph's read access is unrestricted and the mount proceeds without a proof. Otherwise the caller MUST supply a `capabilityProof` valid for `mountContext`; reject with `"NotAllowedError"` if it is missing or invalid.
3. If the graph's per-graph store does not exist locally and `options.snapshotUri` is provided, fetch and materialise the snapshot per [[PERSONAL-LINKED-DATA-GRAPHS]] §5.5. (The peer that serves the snapshot MUST itself have authorised the request per [§9](#9-governance-integration); see [§9.2](#92-the-validate-contract) for the receiver's side.)
4. Subscribe to `spaceUri` using `moduleHash` (downloading the module if needed, with user consent — module installation semantics are out of scope here).
5. Begin emitting and accepting `GraphDiff`s scoped to the mounted graph's DID.
6. Return the live `Graph`.

The `unmount()` method releases the local mount entry and stops gossiping diffs for the graph. It does not delete the per-graph store; calling `mount()` again reopens it.

### 6.3 Sync Operations

```webidl
partial interface Graph {
  [NewObject] Promise<sequence<Peer>> peers();
  [NewObject] Promise<sequence<Peer>> onlinePeers();
  [NewObject] Promise<USVString> currentRevision();
  [NewObject] Promise<sequence<GraphDiff>> pendingDiffs();

  Promise<undefined> sendSignal(USVString remoteDid, BufferSource payload);
  Promise<undefined> sendSignalToSession(USVString remoteDid, USVString sessionId, BufferSource payload);
  Promise<undefined> broadcast(BufferSource payload);

  attribute EventHandler onpeerjoined;
  attribute EventHandler onpeerleft;
  attribute EventHandler onsyncstatechange;
  attribute EventHandler onsignal;
  attribute EventHandler ondiff;
};
```

### 6.4 GraphManager-Level Sync Management

```webidl
partial interface GraphManager {
  [NewObject] Promise<sequence<MountedGraphInfo>> listMounted();
  [NewObject] Promise<sequence<SyncModuleInfo>> listModules();
  [NewObject] Promise<sequence<SyncSpaceInfo>> listSpaces();

  attribute EventHandler onsubscriptiongained;
  attribute EventHandler onsubscriptionlost;
};

dictionary MountedGraphInfo {
  USVString graphDid;
  MountMode mode;
  GraphSyncState syncState;
  USVString spaceUri;
  USVString moduleHash;
  unsigned long peerCount;
};

dictionary SyncSpaceInfo {
  USVString spaceUri;
  USVString moduleHash;
  unsigned long graphCount;
  unsigned long peerCount;
};

dictionary SyncModuleInfo {
  USVString contentHash;
  USVString? name;
  unsigned long spaceCount;
  ModuleState state;
  unsigned long long storageBytes;
};

enum ModuleState { "running", "suspended", "error" };

[Exposed=Window]
interface SubscriptionEvent : Event {
  readonly attribute USVString graphDid;
  readonly attribute MountMode previousMode;
  readonly attribute USVString? reason;
};
```

---

## 7. Sync Spaces

### 7.1 What a Sync Space Is

A **sync space** is a lightweight gossip network identified by a hash. Members of a space gossip diffs with each other; non-members never receive those bytes. A space is the **physical boundary** of message propagation; a graph is the **logical boundary** of authorisation.

A space carries `GraphDiff`s for one or more graphs. The receiving peer's runtime dispatches each diff to the corresponding mounted graph (and discards diffs for graphs it does not have mounted).

### 7.2 Topology Policy

A topology is a policy that maps graphs to spaces. The three standard topologies:

| Topology | Behaviour | Use For |
|---|---|---|
| **Unified** | All published graphs share one space. Simplest. No network-layer privacy. Authorisation per-graph still applies. | Small teams (< 20). Low overhead. Privacy not needed. |
| **Privacy-Tiered** | Public graphs (no restrictive ZCAP caveats) share a "community" space. Restricted graphs (credential requirements, limited delegations) get dedicated spaces. Auto-adapts as governance crystallises. | Most communities (20–500). |
| **Fully Partitioned** | Every graph gets its own dedicated space. Maximum isolation. | High-security orgs, compliance needs. |
| **Custom** | Explicit per-graph rules. | Federations, special access patterns. |

The topology engine inspects each graph's governance:

- A graph with `governance://enforcement_mode = "open"` and no restrictive caveats → public.
- A graph with credential requirements or narrow delegate lists → restricted.

When a graph's governance changes, the topology engine MAY migrate the graph to a different space. Migration republishes the graph's current snapshot into the new space and notifies peers.

### 7.3 Space Derivation

Space URIs are deterministic so any agent who knows the topology and namespace can compute them:

```
space://<sha256-hex-of-derivation-input>
```

The derivation input depends on the topology:

```
unified:      "lwsync:unified:" + <namespace-id>
privacy:      "lwsync:public:" + <namespace-id>     (public)
              "lwsync:dedicated:" + <graph-did>      (restricted)
partitioned:  "lwsync:dedicated:" + <graph-did>
custom:       "lwsync:named:" + <custom-name>
```

The namespace-id is typically the DID of a root graph that other graphs participate in.

### 7.4 Space Memberships

An agent's set of subscribed spaces is the union of spaces required by their mounted graphs:

```
spaces_to_join = unique(
  for each mounted graph c:
    derive_space(c.graphDid, this.topology)
)
```

If the topology is **Unified**, this is always one space. If **Fully Partitioned**, one space per mounted graph. If **Privacy-Tiered**, a community space plus one per restricted mount.

When an agent unmounts the last graph that required a particular space, the runtime SHOULD leave the space.

### 7.5 What Syncs Within a Space

Every diff committed to a space is a `GraphDiff` ([§5.1](#51-contextdiff)) tagged with its `graphDid`. In a shared space, diffs for multiple graphs coexist; each carries its own `CapabilityProof`.

A receiving peer:

1. Read `graphDid` — am I subscribed to this graph?
2. If no, discard (do not store, do not process, do not forward to non-space peers).
3. If yes, verify `capabilityProof` against the graph's governance.
4. If valid, apply to the per-graph store.
5. If invalid, reject and (optionally) log.

In a dedicated space, the graphDid filter always passes. The flow is the same.

### 7.6 Per-Graph Diff Chains

Even in a shared space, each graph maintains its own diff chain. The `dependencies` field of `GraphDiff` references previous diffs *for the same graph*, not the previous diff in the space.

```
Shared Community Space:
  #general chain:  G1 → G2 → G3 → G4
  #random chain:   R1 → R2
  Thread-42 chain: T1 → T2 → T3
```

Pulls target a specific graph within a space, identified by `graphDid` + last-known-revision.

---

## 8. Subscription Lifecycle

This section is normative.

### 8.1 Becoming Subscribed

The full handshake for an agent to subscribe to a graph they have not previously mounted:

1. **Discover.** The agent obtains the graph's DID plus addressing hints (space URI, module hash, relay endpoints, snapshot URI). This step is **out of scope** for this specification; see [§8.6](#86-discovery-non-normative) for the non-normative discussion of how applications typically wire it up.
2. **Resolve.** The runtime resolves the DID per [[DID-CORE]]. If no snapshot is locally available, the runtime issues a *snapshot pull* against the discovered relay/peer carrying the agent's `capabilityProof` for `mountContext` (per [§8.5](#85-read-access-and-mountcontext)). The responding peer authorises the request per [§9.2](#92-the-validate-contract) before sending bytes; on success the local runtime fetches and verifies the snapshot (the snapshot's `graphIri` is its content hash; the snapshot's binding to the DID is verified per [[GROUP-IDENTITY]] §4.6).
3. **Verify snapshot.** Verify the snapshot's signatures per [[PERSONAL-LINKED-DATA-GRAPHS]] §5.5.
4. **Verify mount authority locally.** Re-run the mount-mode authorisation per [§6.2](#62-mounting-a-remote-graph) step 2 against the freshly-materialised local view of the graph's governance. (Two checks: the responding peer's gate at step 2, and the local gate here. They are deliberately redundant — the local gate is the authoritative one for the resulting `Graph` instance's mount mode; the remote gate prevents data exfiltration before bytes leave the responder.)
5. **Mount.** Open the per-graph store and materialise the snapshot via `GraphManager.fromSnapshot()` ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.5). Any serialisation format defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.3 is acceptable; the materialised graph's IRI equals the snapshot's `graphIri`.
6. **Join space.** Subscribe to the space identified by the topology + module.
7. **Sync.** Pull diffs from the space since the snapshot's `currentRevision`. Apply each (re-verifying CapabilityProofs per [§9.2](#92-the-validate-contract)).

The agent is now subscribed. Subsequent diffs propagate via gossip; subsequent writes by the agent are authored to the graph, packaged into GraphDiffs, signed with their capability chain, and committed to the space.

### 8.2 Maintaining the Subscription

The runtime keeps the per-graph store in sync via the module's connection and remote-diff handling. Heartbeats, peer discovery, and retry are module-defined.

### 8.3 Losing the Subscription

| Trigger | Effect |
|---|---|
| **Agent unmounts the graph** | The runtime leaves the space (if no other mounted graph requires it), drops the local store reference, fires `contextunmounted`. The per-graph store stays on disk; remounting reopens it. |
| **Capability is revoked** | A revocation triple arrives. The runtime detects it, fires `subscriptionlost`, and either downgrades mount mode (if a partial chain remains valid) or fully unmounts. |
| **Snapshot promotion makes prior diffs unreachable** | If the agent has been offline long enough that the chain has been promoted past their last-known revision, the runtime pulls a fresh snapshot to catch up. |

### 8.4 Subscription Events

`subscriptiongained` and `subscriptionlost` events are dispatched on the `GraphManager` (see [§6.4](#64-graphmanager-level-sync-management)).

### 8.5 Read Access and `mountContext`

Read access is governed by the same capability framework as writes ([[CAPABILITY-FRAMEWORK]] §7.1 — Non-Triple Operations), via the `mountContext` action.

**Default (no constraint):** When a graph's scope set contains no capability constraint covering `mountContext`, read access is unrestricted. Any peer may pull a snapshot or mount in `"read"` mode without presenting a proof. This is the default for newly-created graphs and the typical pattern for open communities and public artefacts.

**Restricted (constraint present):** A graph that binds a capability constraint covering `mountContext` requires the requesting agent to hold (and present) a valid `mountContext` capability. Both the responding peer that serves the snapshot ([§9.2](#92-the-validate-contract)) and the local runtime at mount time ([§6.2](#62-mounting-a-remote-graph) step 2) MUST authorise the request. Common patterns:

- **Membership-credential gating.** A `mountContext` capability with a `credential` caveat ([[CONSTRAINT-VOCABULARY]] §6) requiring the agent to present a VerifiablePresentation of a specific credential type before access is granted.
- **Pre-issued read tokens.** A `mountContext` capability delegated directly to a specific `did:key` invoker — the holder presents the ZCAP chain and signs the request.
- **Group-DID-bound read access.** A `mountContext` capability delegated to a group DID; any current `capabilityInvocation` delegate of that group may invoke it.

A read-only mount receives diffs but cannot author them. Applications MAY upgrade later by calling `mount()` again with a `write` or `governance` proof.

**Forward-looking diffs vs initial snapshot.** The `mountContext` check authorises *receipt of the graph's current state and ongoing diffs*. Per-diff capability checks (the existing [§9.2](#92-the-validate-contract) machinery) continue to gate which diffs are *applied* — but those checks happen on data the mounted agent already has. Restricting `mountContext` is the only point at which a peer can prevent another agent from seeing the graph at all.

### 8.6 Discovery (Non-Normative)

The "Discover" step in [§8.1](#81-becoming-subscribed) — locating *which peer or relay* holds a graph given only its DID — is **deliberately out of scope** for this specification.

**Why.** Discovery is a substrate-level concern with multiple reasonable answers (out-of-band invitation links, DHT, gossip, mDNS, friend-of-friend traversal, blockchain registries, DNS), each with different trust, scale, and privacy trade-offs. Picking one normatively would couple this specification to a particular topology and exclude others. Two substrate properties make this defensible:

1. **Content-addressed snapshots are self-verifying** ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.5). Trust does not depend on which peer delivered the bytes — only on the IRI/proof checks against the bytes themselves. Discovery's job is reduced to "get the bytes from anyone".
2. **DIDs are key-bound** ([[GROUP-IDENTITY]] §4.1). The DID identifier embeds the initial public key, and the DID-document delegate model is gated by `did-document://*` writes auditable in the graph. A malicious discovery channel cannot impersonate a graph; the worst it can do is fail to deliver.

**Anticipated application-layer patterns.** Applications are expected to wire discovery in one or more of the following ways:

| Pattern | When to use |
|---|---|
| **Invitation links** | Human onboarding — share a URL carrying the DID + a `?relay=` and/or `?snapshot=` hint per [[GROUP-IDENTITY]] §4.6. The dominant pattern for inviting people to a community, sharing a document, joining a team. |
| **Transitive discovery via mounted graphs** | Once you have mounted one graph G, references to other graphs (in triples, via `context://participates_in`, `group://wrapsGraph`-style metadata, or application-specific predicates carrying `did:graph` objects) become discoverable: query G for hint predicates, or ask peers in G's sync space whether they also host the referenced graph. |
| **Shared discovery graphs** | A community publishes a "directory" graph mapping `did:graph` → routing hints as triples; members participate in this graph and consult it before resolving unknown DIDs. Graph-native phonebook. |
| **DHT bridge** | A third-party DHT keyed by DID, with peers self-publishing `(did, relay-url, last-snapshot-uri)` records. Useful for public global namespaces. |
| **mDNS / Bluetooth / NFC** | Local-network discovery for same-LAN, same-room, or proximity scenarios. |
| **Sync-space membership** | Already a member of a sync space carrying the target graph? Its diffs gossip past you — discover the graph by seeing them. |

This specification's normative surface (`?relay=` and `?snapshot=` DID-URL parameters from [[GROUP-IDENTITY]] §4.6, plus the explicit `MountOptions.snapshotUri` / `spaceUri` / `relays` hints in [§6.2](#62-mounting-a-remote-graph)) is the *interface* applications hand information to. Where the application *got* that information — invitation link, DHT lookup, directory graph, mDNS broadcast — is layered above.

---

## 9. Governance Integration

This specification integrates with [[CAPABILITY-FRAMEWORK]] at four normative points.

### 9.1 Four Verification Points

Read access AND every `GraphDiff` are governance-verified:

| Point | Who | What is checked |
|---|---|---|
| **Read-mount request** | Each peer that *serves* a snapshot or accepts a read mount | `mountContext` capability for the requesting agent, per [§8.5](#85-read-access-and-mountcontext) and [§9.2](#92-the-validate-contract) |
| **Commit time** | Committing agent's runtime | Full SHACL + ZCAP + caveats against the agent's local state, batch-scoped |
| **Gossip time** | Each receiving peer | Re-verify capability chain, re-verify caveats with link content, re-verify SHACL conformance |
| **Transport integrity** | Underlying transport (e.g., relay's validation) | Cryptographic signatures only — chain valid, link signatures valid, graph IRI consistent |

### 9.2 The validate() Contract

A conforming sync module exposes two `validate*` operations:

#### 9.2.1 `validateDiff(graphDid, diff, author, graphState)`

For every incoming `GraphDiff`, the receiving peer MUST:

1. Resolve the target graph's **scope set** per [[CAPABILITY-FRAMEWORK]] §6.1 using the locally-observable participation declarations. The scope set is the target graph plus every graph reachable via mutually-accepted `context://participates_in` edges (in either direction, per [[CAPABILITY-FRAMEWORK]] §6.2).
2. Verify the diff's `CapabilityProof.chain` against the union of constraints across the scope set ([[CAPABILITY-FRAMEWORK]] §7). The chain walk MUST query `has_zcap` across the scope set, not just the target graph, and MUST terminate at `urn:living-web:zcap:BootstrapRoot` (the chain is *cut* at constitutional boundaries — [[CAPABILITY-FRAMEWORK]] §4.3).
3. Re-evaluate any content-dependent caveats against the actual triples in `additions` and `removals` (per [[CAPABILITY-FRAMEWORK]] §9). The deny-wins rule applies ([[CAPABILITY-FRAMEWORK]] §6.3): if any in-scope constraint rejects, the diff is rejected.
4. Verify each triple's reifier signature against the resolved author.
5. Return `{ accepted: true }` or `{ accepted: false, constraintKind: ..., reason: ... }`.

#### 9.2.2 `validateReadAccess(graphDid, authorDid, capabilityProof?)`

When a peer receives a **snapshot pull** (per the module's wire protocol — e.g., [[DEFAULT-SYNC-MODULE]] §9.4) or a **read-mode mount request**, it MUST:

1. Resolve the target graph's scope set per [[CAPABILITY-FRAMEWORK]] §6.1.
2. Invoke [[CAPABILITY-FRAMEWORK]] §7 with `action = "mountContext"` (the explicit override path; the request has no triple to derive an action from — per [[CAPABILITY-FRAMEWORK]] §7.1). Caveats that depend on triple content are skipped; `credential` and other context-only caveats are evaluated against the supplied `capabilityProof.presentations`.
3. Return `{ accepted: true }` if either:
   - the scope set contains no capability constraint covering `mountContext` (unrestricted read), OR
   - the supplied `capabilityProof` chain authorises the operation.

   Otherwise return `{ accepted: false, constraintKind: "capability", reason: ... }`.

A peer that returns `accepted: false` MUST NOT serve the snapshot, MUST NOT forward subsequent diffs for the graph to the requesting peer, and MAY drop the requester's session.

### 9.3 Rejection Behaviour (Sync-Blocking)

A diff that fails validation MUST NOT be:

- Stored in the local per-graph store.
- Forwarded to other peers (the receiving peer MUST NOT re-broadcast).

This is **sync-blocking based on governance rules**: an invalid diff stops propagating at every peer that rejects it. Combined with deterministic, scope-set-aware validation, the network converges on a state where rejected writes do not reach any honest peer.

Implementations SHOULD log rejected diffs for audit but MUST NOT retain rejected triple content beyond what is needed for the audit.

**Holonic implication.** Because the scope set is computed from mutually-accepted participation declarations in either direction, a write to graph A that violates a constraint on holonically-linked graph B is rejected and not propagated. Holonic governance is enforceable at the sync layer without any additional protocol — the scope-set computation already covers it.

### 9.4 Enforcement Mode Awareness

The runtime SHALL inspect the target graph's `governance://enforcement_mode` ([[CAPABILITY-FRAMEWORK]] §5) before applying capability checks:

- **Open**: Skip ZCAP checks for the target graph. Non-capability constraints (temporal, content, credential, …) from any graph in the scope set still apply per their own rules. A diff that fails a non-capability constraint is still rejected, even when the target graph is in Open mode.
- **Announced**: Verify but do not reject on capability failure; log.
- **Enforced**: Verify and reject.

Each graph in the scope set is evaluated under **its own** enforcement mode for capability constraints it bound. A diff to graph A may be capability-accepted under A's Open mode while being capability-rejected under a participating graph B's Enforced mode that has a constraint reaching A via the scope set. Deny-wins applies across the scope set; a diff is accepted only if every applicable constraint accepts.

---

## 10. Background Operation

Sync activity executes in the user-agent-managed environment and persists across:

- Tab navigation
- Window closing (with active mounted graphs in other windows)
- Background tabs
- User agent restart (sessions reconnect)

The user agent MAY pause sync activity under battery / network / resource pressure, surfacing pause/resume controls via the module management UI (out of scope here).

When all top-level browsing graphs are closed, the user agent MAY continue running modules briefly (e.g., to flush pending diffs) before fully suspending.

---

## 11. Signalling

Signalling carries opaque ephemeral messages between peers (e.g., WebRTC ICE candidates, presence, typing indicators) without entering the graph's diff stream.

### 11.1 sendSignal

```javascript
await graph.sendSignal("did:key:z6MkBob...", encoder.encode("hello"));
```

Targets all sessions of the named DID. `sendSignalToSession(did, sessionId, payload)` targets one specific session.

### 11.2 onsignal

```javascript
graph.onsignal = (event) => {
  console.log(`signal from ${event.from.did}:`, event.payload);
};
```

### 11.3 Signal Properties

- Signals are NOT diffed, NOT signed (beyond transport authentication), NOT stored.
- Signals are best-effort: if the recipient is offline, the signal is dropped.
- Signals are subject to rate limits at the transport layer.

### 11.4 broadcast

```javascript
await graph.broadcast(encoder.encode("typing..."));
```

Sends to all currently-online peers in the graph's space who are subscribed to the same graph.

---

## 12. Security Considerations

### 12.1 Capability Proof Verification

Receiving peers MUST independently verify `CapabilityProof.chain` against the graph's governance ([[CAPABILITY-FRAMEWORK]]) before applying a diff.

### 12.2 DID Resolution Trust

Resolving a DID from snapshots is subject to the trust level of the snapshot source ([[DECENTRALISED-IDENTITY]] §7.2). Security-sensitive operations SHOULD require `"local"` or `"mounted-read"` trust. Verifying a snapshot's `graphIri` is intrinsically a single hash check (the IRI is the SHA-256 of the snapshot's triples; either it matches or it does not); the snapshot's signature establishes the trust level for the surrounding data.

### 12.3 Sync Space Membership Privacy

A peer's presence in a sync space is visible to other space members. In a shared space, this reveals which graphs the peer is plausibly interested in (without revealing exact mounts). Communities that need membership privacy SHOULD use Fully Partitioned topology.

### 12.4 Replay Attacks

`GraphDiff.revision` is content-addressed, so replaying a previously-applied diff is a no-op (already in the per-graph store).

### 12.5 Authoritative Timestamps

Constraint kinds and downstream specifications that rely on time-of-write (e.g., temporal caveats, state-entry timestamps) depend on the diff's timestamp. The runtime MUST treat each GraphDiff's `timestamp` as the authoritative time for triples in that diff.

### 12.6 Module Sandbox

Sync modules MUST run in a sandboxed environment with only the capabilities they requested and the user granted. The sandbox model itself is out of scope here and defined by an extension specification.

---

## 13. Privacy Considerations

### 13.1 Topology Choice Affects Privacy

| Topology | Network Privacy | Notes |
|---|---|---|
| Unified | None — all members see all diffs | Authorization still per-graph; non-authorised diffs are discarded after receipt. |
| Privacy-Tiered | Isolated for restricted graphs; shared for public | Auto-adapts. |
| Fully Partitioned | Full — agents only receive their subscribed graphs' diffs | Maximum overhead. |

"Discarded after receipt" means the agent receives bytes but does not store or process them. A compromised agent could log discarded bytes.

### 13.2 Peer Identity Disclosure

Diffs are signed by the committing agent's DID. In encrypted spaces this is visible only to other space members; in open spaces it is visible to relays as well.

### 13.3 Mount-Table Disclosure

A peer's mount table is a sensitive artefact. The runtime MUST NOT disclose the full mount table without explicit user gesture (see [[PERSONAL-LINKED-DATA-GRAPHS]] §10.5).

### 13.4 DID Resolution Side Effects

Resolving a DID can reveal interest in a graph. Implementations SHOULD batch resolution requests and SHOULD avoid resolving identifiers based on untrusted input.

### 13.5 Per-Graph Identity

Per [[PERSONAL-LINKED-DATA-GRAPHS]] §10.2, the recommended privacy posture is per-graph identity.

---

## 14. Examples

### 14.1 Publishing a Graph

```javascript
const planning = await navigator.graph.create({ displayName: "Q3 Planning" });

const published = await planning.publish({
  spaceTopology: "privacy-tiered",
  relays: ["relay.example.com"]
});

console.log("Share these:");
console.log("  did:", published.graphDid);
console.log("  space:", published.spaceUri);
console.log("  module:", published.moduleHash);
```

### 14.2 Mounting from an Invitation

```javascript
const invite = JSON.parse(invitationLink);

const planning = await navigator.graph.mount(invite.graphDid, {
  mode: "write",
  capabilityProof: invite.capabilityProof,
  spaceUri: invite.spaceUri,
  moduleHash: invite.moduleHash,
  relays: invite.relays
});
```

### 14.3 Observing Sync State

```javascript
planning.onsyncstatechange = async (e) => {
  console.log("sync state:", await planning.syncState());
};

planning.onpeerjoined = (e) => {
  console.log("peer joined:", e.peer.did, "device:", e.peer.deviceLabel);
};

planning.ondiff = (e) => {
  console.log(`diff from ${e.diff.author}: +${e.diff.additions.length}/-${e.diff.removals.length}`);
};
```

### 14.4 Signalling for WebRTC Negotiation

```javascript
planning.onsignal = async (e) => {
  if (e.payload[0] === 0x01) {
    const offer = JSON.parse(decoder.decode(e.payload.slice(1)));
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await planning.sendSignalToSession(e.from.did, e.from.sessionId,
      new Uint8Array([0x02, ...encoder.encode(JSON.stringify(answer))]));
  }
};
```

### 14.5 Multiple Graphs in One Sync Space

```javascript
const community = await navigator.graph.create({ displayName: "Acme" });
const general   = await navigator.graph.create({ displayName: "#general" });
const random    = await navigator.graph.create({ displayName: "#random"  });
await general.addTriple(new Triple(general.iri, "context://participates_in", community.did));
await random.addTriple(new Triple(random.iri, "context://participates_in", community.did));

const c1 = await community.publish({ spaceTopology: "unified" });
const c2 = await general.publish({ spaceTopology: "unified" });
const c3 = await random.publish({ spaceTopology: "unified" });

console.log(c1.spaceUri === c2.spaceUri);   // true — same root graph
console.log(c1.spaceUri === c3.spaceUri);   // true
```

### 14.6 Listing Mounted Graphs and Spaces

```javascript
const mounted = await navigator.graph.listMounted();
for (const m of mounted) {
  console.log(`${m.graphDid} (${m.mode}, ${m.peerCount} peers) on ${m.spaceUri}`);
}

const spaces = await navigator.graph.listSpaces();
for (const s of spaces) {
  console.log(`${s.spaceUri}: ${s.contextCount} graphs, ${s.peerCount} peers`);
}
```

---

## 15. References

### 15.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002.
- **[RDF-CANON]** "RDF Dataset Canonicalization", W3C Recommendation, March 2025. https://www.w3.org/TR/rdf-canon/
- **[DID-CORE]** Sporny, M., et al., "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. https://www.w3.org/TR/did-core/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./01_decentralised-identity-web-platform.md).
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./04_graph-capability-framework.md).

### 15.2 Informative References

None.
