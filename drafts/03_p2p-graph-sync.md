# Peer-to-Peer Context Synchronisation Protocol

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a protocol for synchronising **contexts** (named graphs identified by `did:graph:...` DIDs, as defined in [[PERSONAL-LINKED-DATA-GRAPHS]]) between multiple agents in a peer-to-peer manner. It defines:

- The **ContextDiff** format — additions and removals scoped to a specific graph DID, accompanied by a capability proof.
- The **mount-and-subscribe** lifecycle — a graduated, per-context subscription model.
- The separation of **logical contexts** (with self-contained governance) from **sync spaces** (gossip topologies that may carry one or many contexts).
- A pluggable **sync module** architecture — content-addressed WebAssembly modules that handle transport, merge logic, peer discovery, and validation against [[GRAPH-GOVERNANCE]].

By standardising the synchronisation layer around context DIDs and sync spaces, this specification enables interoperable collaborative applications without central servers while preserving sovereignty over both governance (per-context) and sync semantics (per-module).

---

## Status of This Document

This is a draft Community Group Report. It has no official W3C standing and is subject to change.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Architecture: Logical Contexts vs Sync Spaces](#4-architecture-logical-contexts-vs-sync-spaces)
5. [Data Model](#5-data-model)
6. [API](#6-api)
7. [Sync Spaces](#7-sync-spaces)
8. [Subscription Lifecycle](#8-subscription-lifecycle)
9. [Sync Modules](#9-sync-modules)
10. [GraphSyncModule Interface](#10-graphsyncmodule-interface)
11. [Module Capabilities](#11-module-capabilities)
12. [Module Lifecycle](#12-module-lifecycle)
13. [Default Sync Module](#13-default-sync-module)
14. [Wire Protocol (Default Module)](#14-wire-protocol-default-module)
15. [Relay Protocol](#15-relay-protocol)
16. [Peer Discovery & NAT Traversal](#16-peer-discovery--nat-traversal)
17. [Merge Semantics (Default Module)](#17-merge-semantics-default-module)
18. [Snapshot Promotion](#18-snapshot-promotion)
19. [Governance Integration](#19-governance-integration)
20. [Background Operation](#20-background-operation)
21. [Signalling](#21-signalling)
22. [Security Considerations](#22-security-considerations)
23. [Privacy Considerations](#23-privacy-considerations)
24. [Examples](#24-examples)
25. [References](#25-references)

---

## 1. Introduction

### 1.1 Motivation

The web's data model is fundamentally client–server. Local-first software addresses this, but the web platform provides no native primitives for peer-to-peer data synchronisation beyond raw transport (WebRTC, WebTransport).

This specification defines a **synchronisation protocol for linked data contexts** — a standard interface and diff format that enables multiple agents to maintain a shared, eventually-consistent named graph without a central server.

No single sync strategy is optimal for all use cases. A collaborative editor needs different merge semantics than a social feed. Rather than prescribing one approach, this specification defines a **pluggable sync module architecture** — each sync space specifies a WebAssembly module that implements the strategy. The user agent downloads, verifies, sandboxes, and executes the module.

### 1.3 Use Cases

- **Collaborative editing.** Multiple users co-author contexts, with changes propagating in real time.
- **Peer-to-peer social.** Per-context feeds, profiles, interactions; no platform intermediary.
- **Distributed knowledge bases.** Research groups maintain shared contexts across institutional boundaries.
- **Offline-first.** Users on intermittent connections make local edits that reconcile when connectivity resumes.
- **Custom consensus.** Voting systems, multi-party computation, domain-specific merge implemented as sync modules.
- **Governance-enforced collaboration.** Contexts enforce membership, rate limits, and content rules at the sync layer via [[GRAPH-GOVERNANCE]].

### 1.4 Scope

This specification defines:

- The **Context** API additions for sync (publish, unpublish, mount, subscription lifecycle).
- The **ContextDiff** format.
- The **GraphSyncModule** WebAssembly interface.
- The **capability-scoped sandbox** in which sync modules execute.
- The **module lifecycle**.
- The **default sync module** that conforming user agents MUST ship.
- The **wire protocol** and **relay protocol** for the default module.
- The **merge semantics** (CRDT) for the default module.
- The **sync space** abstraction and three standard topologies (Unified / Privacy-Tiered / Fully Partitioned).
- The **snapshot promotion** contract.
- **Governance integration** via the module's `validate()` method.
- **Signalling** for ephemeral peer communication outside the context.

### 1.5 Relationship to Other Specifications

This specification depends on:

- [[PERSONAL-LINKED-DATA-GRAPHS]] — defines the Context interface and GraphStore.
- [[DECENTRALISED-IDENTITY]] — defines `did:graph` and `did:key`.
- [[GRAPH-GOVERNANCE]] — defines the ZCAP/VC rules that the default module's `validate()` enforces.
- [[WEBASSEMBLY]] — execution environment for modules.
- [[WEBTRANSPORT]] — used by the default sync module's transport.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A **conforming user agent** MUST implement:

1. The Context sync API additions ([§6](#6-api)).
2. The sync space abstraction ([§7](#7-sync-spaces)).
3. The subscription lifecycle ([§8](#8-subscription-lifecycle)).
4. The sync module sandbox ([§11](#11-module-capabilities)).
5. The module lifecycle ([§12](#12-module-lifecycle)).
6. The default sync module ([§13](#13-default-sync-module)).
7. Background operation ([§20](#20-background-operation)).

A **conforming sync module** MUST implement the `GraphSyncModule` interface ([§10](#10-graphsyncmodule-interface)).

---

## 3. Terminology

<dl>
<dt><dfn>Context</dfn></dt>
<dd>A named graph identified by a <code>did:graph:...</code> DID. See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt><dfn>ContextDiff</dfn></dt>
<dd>A unit of change to a specific context: additions, removals, a revision identifier, causal dependencies, and a CapabilityProof. The unit of gossip.</dd>

<dt><dfn>CapabilityProof</dfn></dt>
<dd>The ZCAP delegation chain that authorises the committing agent's writes for this context. See [§5.3](#53-capabilityproof) and [[GRAPH-GOVERNANCE]].</dd>

<dt><dfn>Mount</dfn></dt>
<dd>The act of opening a context's per-context store in a GraphStore, with a specified mount mode (<code>read</code>, <code>write</code>, or <code>governance</code>). See [[PERSONAL-LINKED-DATA-GRAPHS]] §4.2.</dd>

<dt><dfn>Subscription</dfn></dt>
<dd>An agent is subscribed to a context when they (a) hold a valid capability chain for it, (b) have it mounted, and (c) are subscribed to the appropriate sync space that gossips its diffs.</dd>

<dt><dfn>Sync Space</dfn></dt>
<dd>A lightweight gossip network identified by a hash. One sync space MAY carry diffs for one context (Fully Partitioned topology) or many contexts (Unified / Privacy-Tiered topologies). The unit of physical message propagation.</dd>

<dt><dfn>Topology</dfn></dt>
<dd>A policy that maps contexts to sync spaces. See [§7.2](#72-topology-policy).</dd>

<dt><dfn>Sync Module</dfn></dt>
<dd>A content-addressed WebAssembly bundle implementing the <code>GraphSyncModule</code> interface. The module handles transport, merge, peer discovery, and validation for a sync space.</dd>

<dt><dfn>Peer</dfn></dt>
<dd>An agent participating in synchronisation of a context. Identified by (DID, sessionId).</dd>

<dt><dfn>Revision</dfn></dt>
<dd>A content-addressed identifier for a ContextDiff, computed as a cryptographic hash of additions, removals, and dependencies.</dd>

<dt><dfn>Snapshot</dfn></dt>
<dd>An addressable serialised form of a context, produced when diff chains exceed a configured length. See [§18](#18-snapshot-promotion). Maps to the GraphSnapshot in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.</dd>

<dt><dfn>Relay</dfn></dt>
<dd>A server that facilitates message passing between peers in a sync space. Relays forward messages but have no authority over context data.</dd>
</dl>

---

## 4. Architecture: Logical Contexts vs Sync Spaces

This section is normative.

### 4.1 The Two Layers

Context identity, sync topology, and module choice are kept separate:

```
┌─────────────────────────────────────────────────────┐
│  Logical Layer (per-context)                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐   │
│  │#general │ │#random  │ │#private │ │Thread-42 │   │
│  │did:graph│ │did:graph│ │did:graph│ │did:graph │   │
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

**Logical layer**: Each context is identified by a `did:graph:...` and has its own governance, shapes, flows, and data. **Authorization** lives here, per-context.

**Sync layer**: Sync spaces determine what gossips with what. **Membership in a space** carries diffs to your peer; **a valid capability** lets you process them. The two are orthogonal.

A receiving peer in a shared space:

1. Receives a diff carrying its `graphDid`.
2. Checks "am I subscribed to this context?" — if no, discard.
3. If yes, verify the `CapabilityProof` against the context's governance.
4. If valid, apply to the local per-context store.
5. If invalid, reject.

### 4.2 Why Decouple?

- **Overhead.** A 1000-context community could mean 1000 separate gossip networks per agent. Decoupling lets multiple contexts share a network.
- **Lifecycle churn.** Ephemeral threads with three messages and two participants gain nothing from a dedicated DHT.
- **Flexibility.** Some communities want privacy isolation. Others want simplicity. The right tradeoff is per-community.
- **Migration.** A context's privacy can crystallise over time. Decoupled topology can migrate the context to a more-isolated space as governance tightens.

---

## 5. Data Model

### 5.1 ContextDiff

```webidl
[Exposed=Window,Worker]
interface ContextDiff {
  readonly attribute USVString graphDid;          // did:graph:...
  readonly attribute USVString revision;           // sha256 hex
  readonly attribute FrozenArray<Triple> additions;
  readonly attribute FrozenArray<Triple> removals;
  readonly attribute FrozenArray<USVString> dependencies;  // prior revisions in this context's chain
  readonly attribute CapabilityProof? capabilityProof;
  readonly attribute USVString author;             // did:key:... (the committing agent)
  readonly attribute DOMTimeStamp timestamp;       // authoritative
  readonly attribute unsigned long diffsSinceSnapshot;
};
```

Triples carry reifier-based provenance per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.2.

A ContextDiff MUST be immutable once `revision` has been computed.

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
};
```

The chain is the ordered list of ZCAPs from the committing agent's leaf capability up to the context's root capability ([[GRAPH-GOVERNANCE]] §4.3). Each entry is a content-addressed reference; resolving them requires the context's local store (so the receiving peer must already be mounted to verify).

`caveatsSatisfied` records which caveats the committing agent's executor evaluated and accepted before commit. The receiving peer re-evaluates independently; this field is an audit trail, not a trust shortcut.

`hasContentCaveats` is `true` if any delegation in the chain has caveats whose evaluation depends on the link's content (Predicate, Shape, Property, Content, Source, Target — see [[GRAPH-GOVERNANCE]] §9). When `false`, the receiving peer MAY skip per-link caveat re-evaluation as an optimisation.

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

When a user opens a context in a new tab or on a new device, the user agent MUST generate a new sessionId. The sessionId is ephemeral — it does not persist across browser restarts.

### 5.5 Context Sync State

```webidl
enum ContextSyncState {
  "idle",
  "resolving",   // resolving did:graph + space + module
  "connecting",  // establishing connections in the space
  "syncing",     // active diff exchange
  "synced",      // converged with all known peers
  "error"
};
```

### 5.6 ValidationResult

```webidl
dictionary ValidationResult {
  required boolean accepted;
  USVString? module;        // "capability" | "temporal" | "content" | "credential"
  USVString? constraintId;
  USVString? reason;
};
```

---

## 6. API

The sync API extends the `Context` and `GraphStore` interfaces defined in [[PERSONAL-LINKED-DATA-GRAPHS]].

### 6.1 Publishing a Context

A locally-created context becomes shareable by calling `publish()`:

```webidl
partial interface Context {
  [NewObject] Promise<PublishedContext> publish(optional PublishOptions options);
  [NewObject] Promise<undefined> unpublish();
  [NewObject] Promise<ContextSyncState> syncState();
};

dictionary PublishOptions {
  USVString moduleHash;           // sync module content hash; defaults to UA default module
  sequence<USVString> relays;     // initial relay endpoints (default-module-specific)
  USVString spaceTopology;        // "unified" | "privacy-tiered" | "fully-partitioned" | "custom"
  USVString customSpace;          // when topology = "custom": the specific space:// URI
};

[Exposed=Window]
interface PublishedContext {
  readonly attribute USVString graphDid;
  readonly attribute USVString spaceUri;
  readonly attribute USVString moduleHash;
  readonly attribute FrozenArray<USVString> relays;
};
```

The `publish()` method MUST:

1. If `options.moduleHash` is specified and not installed, initiate module installation ([§12.1](#121-installation)). If the user denies, reject with `"NotAllowedError"`.
2. If `options.moduleHash` is not specified, use the user agent's default sync module.
3. Determine the space URI ([§7](#7-sync-spaces)).
4. Initialise the sync module if not already running for this space.
5. Subscribe to the space.
6. Return a `PublishedContext` carrying the addressing.

### 6.2 Mounting a Remote Context

Mounting is defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §4.2. This specification adds sync-layer semantics to the mount options:

```webidl
partial interface GraphStore {
  [NewObject] Promise<Context> mount(USVString graphDid, optional MountOptions options);
};

dictionary MountOptions {
  MountMode mode = "read";
  object capabilityProof;        // ZCAP chain; required for "write" or "governance"
  USVString snapshotUri;         // optional; initial state if context not already locally known
  USVString spaceUri;            // hint: the space carrying this context's diffs
  USVString moduleHash;          // hint: the sync module the space uses
  sequence<USVString> relays;    // hint: relay endpoints
};
```

The mount handshake:

1. Resolve `did:graph:<key>` via [[DECENTRALISED-IDENTITY]] §8.2. If locally mounted, the resolution is trivial; otherwise pull a snapshot via the provided `snapshotUri` or known sync spaces.
2. Verify any `capabilityProof` against the resolved context's governance.
3. Open or create the per-context store ([[PERSONAL-LINKED-DATA-GRAPHS]] §8).
4. Subscribe to `spaceUri` using `moduleHash` (download module if needed, with user consent).
5. Fire the `contextmounted` event on the GraphStore.

### 6.3 Sync Operations

```webidl
partial interface Context {
  [NewObject] Promise<sequence<Peer>> peers();
  [NewObject] Promise<sequence<Peer>> onlinePeers();
  [NewObject] Promise<USVString> currentRevision();
  [NewObject] Promise<sequence<ContextDiff>> pendingDiffs();

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

### 6.4 GraphStore-Level Sync Management

```webidl
partial interface GraphStore {
  [NewObject] Promise<sequence<MountedContextInfo>> listMounted();
  [NewObject] Promise<sequence<SyncModuleInfo>> listModules();
  [NewObject] Promise<sequence<SyncSpaceInfo>> listSpaces();
};

dictionary MountedContextInfo {
  USVString graphDid;
  MountMode mode;
  ContextSyncState syncState;
  USVString spaceUri;
  USVString moduleHash;
  unsigned long peerCount;
};

dictionary SyncSpaceInfo {
  USVString spaceUri;
  USVString moduleHash;
  unsigned long contextCount;
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
```

---

## 7. Sync Spaces

### 7.1 What a Sync Space Is

A **sync space** is a lightweight gossip network identified by a hash. Members of a space gossip diffs with each other; non-members never receive those bytes. A space is the **physical boundary** of message propagation; a context is the **logical boundary** of authorisation.

A space carries `ContextDiff`s for one or more contexts. The receiving peer's runtime dispatches each diff to the corresponding mounted context (and discards diffs for contexts it does not have mounted).

### 7.2 Topology Policy

A topology is a policy that maps contexts to spaces. The three standard topologies:

| Topology | Behaviour | Use For |
|---|---|---|
| **Unified** | All published contexts share one space. Simplest. No network-layer privacy. Authorisation per-context still applies. | Small teams (< 20). Low overhead. Privacy not needed. |
| **Privacy-Tiered** | Public contexts (no restrictive ZCAP caveats) share a "community" space. Restricted contexts (credential requirements, limited delegations) get dedicated spaces. Auto-adapts as governance crystallises. | Most communities (20–500). |
| **Fully Partitioned** | Every context gets its own dedicated space. Maximum isolation. | High-security orgs, compliance needs. |
| **Custom** | Explicit per-context rules. | Federations, special access patterns. |

The topology engine inspects each context's governance:

- A context with `governance://enforcement_mode = "open"` and no restrictive caveats → public.
- A context with credential requirements or narrow delegate lists → restricted.

When a context's governance changes, the topology engine MAY migrate the context to a different space. Migration republishes the context's current snapshot into the new space and notifies peers.

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

The namespace-id is typically the `did:graph:...` of a root context that other contexts participate in.

### 7.4 Space Memberships

An agent's set of subscribed spaces is the union of spaces required by their mounted contexts:

```
spaces_to_join = unique(
  for each mounted context c:
    derive_space(c.graphDid, this.topology)
)
```

If the topology is **Unified**, this is always one space. If **Fully Partitioned**, one space per mounted context. If **Privacy-Tiered**, a community space plus one per restricted mount.

When an agent unmounts the last context that required a particular space, the runtime SHOULD leave the space.

### 7.5 What Syncs Within a Space

Every diff committed to a space is a `ContextDiff` ([§5.1](#51-contextdiff)) tagged with its `graphDid`. In a shared space, diffs for multiple contexts coexist; each carries its own `CapabilityProof`.

A receiving peer:

1. Read `graphDid` — am I subscribed to this context?
2. If no, discard (do not store, do not process, do not forward to non-space peers).
3. If yes, verify `capabilityProof` against the context's governance.
4. If valid, apply to the per-context store.
5. If invalid, reject and (optionally) log.

In a dedicated space, the graphDid filter always passes. The flow is the same.

### 7.6 Per-Context Diff Chains

Even in a shared space, each context maintains its own diff chain. The `dependencies` field of `ContextDiff` references previous diffs *for the same context*, not the previous diff in the space.

```
Shared Community Space:
  #general chain:  G1 → G2 → G3 → G4
  #random chain:   R1 → R2
  Thread-42 chain: T1 → T2 → T3
```

Pulls (`requestSync`) target a specific context within a space, identified by `graphDid` + last-known-revision.

---

## 8. Subscription Lifecycle

This section is normative.

### 8.1 Becoming Subscribed

The full handshake for an agent to subscribe to a context they have not previously mounted:

1. **Discover.** The agent obtains `did:graph:<key>` plus addressing hints (space URI, module hash, relay endpoints, snapshot URI) — typically out of band (invitation link, paper, side-channel).
2. **Resolve.** The runtime resolves the DID per [[DECENTRALISED-IDENTITY]] §8.2. If no snapshot is locally available, fetch one via the snapshot URI hint.
3. **Verify snapshot.** Verify the snapshot's signatures.
4. **Verify capability.** If the mount mode requires authorisation, verify the agent's `capabilityProof` against the (now-resolved) context governance.
5. **Mount.** Open the per-context store and write the snapshot triples ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.3).
6. **Join space.** Subscribe to the space identified by the topology + module.
7. **Sync.** Pull diffs from the space since the snapshot's `currentRevision`. Apply each (re-verifying CapabilityProofs).

The agent is now subscribed. Subsequent diffs propagate via gossip; subsequent writes by the agent are authored to the context, packaged into ContextDiffs, signed with their capability chain, and committed to the space.

### 8.2 Maintaining the Subscription

The runtime keeps the per-context store in sync via the module's `connect()` / `onRemoteDiff()` flow. Heartbeats, peer discovery, and retry are module-defined.

### 8.3 Losing the Subscription

| Trigger | Effect |
|---|---|
| **Agent unmounts the context** | The runtime leaves the space (if no other mounted context requires it), drops the local store reference, fires `contextunmounted`. The per-context store stays on disk; remounting reopens it. |
| **Capability is revoked** | A revocation triple arrives. The runtime detects it, fires `subscriptionlost`, and either downgrades mount mode (if a partial chain remains valid) or fully unmounts. |
| **Snapshot promotion makes prior diffs unreachable** | If the agent has been offline long enough that the chain has been promoted past their last-known revision, the runtime pulls a fresh snapshot to catch up. |

### 8.4 Subscription Events

```webidl
partial interface GraphStore {
  attribute EventHandler onsubscriptiongained;
  attribute EventHandler onsubscriptionlost;
};

[Exposed=Window]
interface SubscriptionEvent : Event {
  readonly attribute USVString graphDid;
  readonly attribute MountMode previousMode;
  readonly attribute USVString? reason;
};
```

### 8.5 Read-Only Snapshots

Mounting in `"read"` mode does not require a capability proof beyond the context's general read policy. A read-only mount receives diffs but cannot author them. Applications MAY upgrade later by calling `mount()` again with a write capability proof.

---

## 9. Sync Modules

### 9.1 Overview

A **sync module** is a content-addressed WebAssembly bundle implementing the `GraphSyncModule` interface ([§10](#10-graphsyncmodule-interface)). Each sync space specifies the module that handles its gossip:

- All peers in a space MUST run the same module (verified by content hash).
- A peer running a different module is effectively participating in a different space.

The module determines transport, merge strategy, peer discovery, and governance validation (calls into the receiver's [[GRAPH-GOVERNANCE]] engine).

### 9.2 Content Addressing

Modules are identified by SHA-256 of their WASM binary:

```
content-hash = "sha256-" + hex(SHA-256(wasm-binary))
```

The user agent MUST verify the content hash of any downloaded module before installation.

### 9.3 Module Distribution

Modules MAY be distributed via HTTPS endpoints, content-addressed networks, relays (well-known path on the relay), or out-of-band transfer.

If a module cannot be retrieved, the relevant operation MUST reject with `"NetworkError"`.

### 9.4 Module Execution Environment

Modules execute in a **user-agent-managed execution environment** outside the page realm:

- Modules persist across tab navigations and user agent restarts.
- Modules are not tied to any origin.
- Multiple pages from different origins can interact with the same context through the same module instance.

The module runs in a WebAssembly sandbox with capability-scoped permissions ([§11](#11-module-capabilities)). The module has NO access to: DOM, other contexts' data, the filesystem, arbitrary network endpoints (only those granted by capabilities), user data, cookies, local storage, or other sync modules.

### 9.5 User Consent

Installing a sync module is privileged. The user agent MUST obtain explicit user consent:

1. Display a prompt identifying the content hash, the capabilities requested ([§11](#11-module-capabilities)), the contexts/spaces that will use the module, and the relay endpoints.
2. Require explicit "Allow" or "Deny".
3. The user agent SHOULD remember the decision for subsequent encounters with the same hash.

### 9.6 Module Management UI

The user agent SHOULD provide a management interface analogous to "Manage Extensions" — see installed modules, content hashes, statuses, which contexts/spaces use them, and resource consumption. Allow pause, resume, removal.

### 9.7 Module Availability and Upgrade

The space's metadata SHOULD include multiple content-addressable locations for the module. If the primary location is unavailable, the user agent MUST attempt alternates before reporting failure.

When a space's module is updated (new content hash), existing peers MUST be notified via a `MODULE_UPDATE` wire message. Peers MUST NOT apply the update until a quorum (>50% of known peers) has acknowledged availability. Peers on different modules MUST NOT exchange diffs during transition.

---

## 10. GraphSyncModule Interface

### 10.1 Interface Definition

The `GraphSyncModule` interface defines the contract that all sync modules implement. Defined in WebAssembly Interface Types (WIT) and exposed as WASM exports.

```webidl
// Conceptual interface; actual binding is via WASM exports.

interface GraphSyncModule {
  // Lifecycle
  undefined init(ModuleConfig config);
  undefined shutdown();

  // Transport (per space)
  undefined connect(USVString spaceUri, USVString localDid);
  undefined disconnect();

  // Sync (per context)
  Revision commit(USVString graphDid, ContextDiff diff);
  undefined onRemoteDiff(RemoteDiffCallback callback);
  undefined requestSync(USVString graphDid, USVString fromRevision);

  // Peer management
  sequence<Peer> peers();
  sequence<Peer> onlinePeers();
  sequence<Peer> discoverPeers(USVString spaceUri);

  // Signalling
  undefined sendSignal(USVString remoteDid, bytes payload);
  undefined onSignal(SignalCallback callback);

  // Governance validation — graphDid is explicit so a module serving multiple
  // contexts in one space can route to the correct governance engine.
  ValidationResult validate(USVString graphDid, ContextDiff diff,
                             USVString author, GraphReader graphState);
};

callback RemoteDiffCallback = ValidationResult (USVString graphDid, ContextDiff diff);
callback SignalCallback = undefined (USVString remoteDid, bytes payload);
```

Modules MAY treat multiple contexts as a single causal stream within one space (Unified topology) but MUST keep per-context capability checks.

### 10.2 ModuleConfig

```webidl
dictionary ModuleConfig {
  USVString spaceUri;
  USVString localDid;
  GraphWriter graphWriter;
  GraphReader graphReader;
  CryptoProvider crypto;
  NetworkProvider network;
  unsigned long long maxMemoryBytes;
};
```

### 10.3 GraphReader & GraphWriter

The runtime provides capability handles giving the module scoped read/write access **per context**:

```webidl
interface GraphReader {
  Promise<sequence<Triple>> queryTriples(USVString graphDid, TripleQuery query);
  Promise<SparqlResult> querySparql(USVString graphDid, USVString sparql);
  Promise<sequence<Triple>> snapshot(USVString graphDid);
};

interface GraphWriter {
  Promise<undefined> apply(USVString graphDid, ContextDiff diff);
};
```

The module MUST pass `graphDid` on every read/write to scope the operation. The runtime rejects requests for contexts the module is not authorised for.

---

## 11. Module Capabilities

The sandbox grants modules a fixed set of capability handles. Modules may not synthesise new capabilities at runtime.

| Capability | Permits |
|---|---|
| `graph.read` | Read triples from the contexts the module serves |
| `graph.write` | Apply ContextDiffs to the contexts the module serves |
| `crypto.sign` | Sign data with the local agent's DID key (via runtime mediation; no key material exposed) |
| `crypto.verify` | Verify signatures |
| `network.relay.<endpoint>` | Open WebTransport/WebSocket to a specific relay endpoint |
| `network.peer.<protocol>` | Use WebRTC or other peer-to-peer transports |
| `network.fetch.<origin>` | HTTP fetch to a specific origin (typically for module-distribution endpoints) |
| `storage.module.<size>` | Persistent module-private storage up to a size limit |

The module's manifest declares the capabilities it requires. The user consent prompt ([§9.5](#95-user-consent)) lists them.

---

## 12. Module Lifecycle

### 12.1 Installation

1. Fetch the WASM binary from a distribution endpoint.
2. Verify the SHA-256 content hash.
3. Parse the manifest and extract requested capabilities.
4. Display the user consent prompt.
5. On approval, store the module, register it, and (if a context is waiting) initialise it.

### 12.2 Update

When a space announces a new module hash, the runtime:

1. Quorums the announcement (>50% of known peers acknowledge).
2. Downloads, verifies, and prompts for consent on the new module.
3. Transitions: old module's `shutdown()`, then new module's `init()` + `connect()`.

### 12.3 Removal

The user MAY remove a module via the management UI. Removal:

1. Disconnects all spaces using the module.
2. Unmounts contexts that depended on the module (preserving the per-context stores).
3. Removes the module binary and capability grants.

### 12.4 Suspension

The runtime MAY suspend a module under resource pressure. Suspended modules retain state but stop processing diffs until resumed.

---

## 13. Default Sync Module

Conforming user agents MUST ship a default sync module that satisfies the following:

- **Transport**: WebTransport [[WEBTRANSPORT]] to a configurable relay.
- **Merge**: OR-Set CRDT ([§17](#17-merge-semantics-default-module)).
- **Peer discovery**: Relay-mediated.
- **Snapshot promotion**: Every 1000 diffs per context (configurable).
- **Validation**: Calls the runtime's [[GRAPH-GOVERNANCE]] engine.

The default module is identifiable by a stable content hash that the user agent treats specially (no installation prompt; pre-installed).

---

## 14. Wire Protocol (Default Module)

### 14.1 Message Frame

All messages are CBOR-encoded with a common envelope:

```
{
  "type": "DIFF" | "PULL" | "SNAPSHOT" | "SIGNAL" | "MODULE_UPDATE" | "PEER_HELLO" | "PEER_BYE",
  "spaceUri": "space://...",
  "from": { "did": "did:key:...", "sessionId": "..." },
  "to":   { "did": "did:key:...", "sessionId": "..." } | null,    // null = broadcast within space
  "payload": <type-specific>
}
```

### 14.2 DIFF

`payload` is a CBOR-encoded `ContextDiff` ([§5.1](#51-contextdiff)).

### 14.3 PULL

```
{ "graphDid": "did:graph:...", "fromRevision": "..." | null }
```

The recipient responds with a `SNAPSHOT` (if `fromRevision` is `null` or unknown) or a sequence of `DIFF` messages.

### 14.4 SNAPSHOT

```
{ "graphDid": "did:graph:...", "snapshot": <GraphSnapshot CBOR> }
```

The `snapshot` is the context snapshot as defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.

### 14.5 SIGNAL

`payload` is opaque bytes for application use ([§21](#21-signalling)).

### 14.6 MODULE_UPDATE

```
{ "newHash": "sha256-...", "spaceUri": "space://...", "distributionUrls": [...] }
```

### 14.7 PEER_HELLO / PEER_BYE

```
{ "peer": Peer }
```

Announces presence/departure in the space.

---

## 15. Relay Protocol

A relay is a WebTransport server that forwards messages between peers in a space. The relay maintains per-space membership lists, forwards messages to subscribed peers, and has NO authority over context data — it cannot inspect encrypted message bodies, cannot reject or modify diffs.

### 15.1 Relay-Peer Protocol

Peers establish a WebTransport session to the relay. After session establishment:

```
peer → relay: SUBSCRIBE { spaceUri }
peer → relay: SEND { spaceUri, frame }
relay → peer: DELIVER { spaceUri, frame }
peer → relay: UNSUBSCRIBE { spaceUri }
```

The relay enforces:

- Authentication: each peer presents a signed `did:key` proof of identity on session establishment.
- Rate limiting per peer.
- Maximum message size.

The relay does NOT enforce governance — that is the receiving peer's job ([§19](#19-governance-integration)).

### 15.2 Encrypted vs Open Spaces

The default module supports two relay modes:

- **Open space**: Messages are in clear text on the relay (the relay can read them, but cannot author or reject).
- **Encrypted space**: Messages are end-to-end encrypted between peers; the relay sees only ciphertext and the (DID, sessionId) routing metadata.

Encrypted spaces require a key-distribution mechanism among space members. The default module implements a TreeKEM-style group key (out of scope here, implementation-specific).

### 15.3 Multiple Relays

A space MAY list multiple relays. Peers connect to one and the relay network gossips messages between relays. Peers MAY connect to multiple relays for redundancy.

---

## 16. Peer Discovery & NAT Traversal

### 16.1 Relay-Mediated Discovery

The default module discovers peers via the relay:

- On `SUBSCRIBE`, the relay returns the current member list.
- Subsequent `PEER_HELLO` / `PEER_BYE` messages keep peers' views current.

### 16.2 NAT Traversal

For peer-to-peer transports (WebRTC, QUIC), the default module uses standard NAT traversal:

- **STUN**: For symmetric NAT detection.
- **ICE**: For candidate gathering.
- **TURN**: For relay fallback when peer-to-peer fails.

The signalling channel for ICE candidate exchange is the relay (via SIGNAL messages, [§21](#21-signalling)).

### 16.3 Custom Discovery

Custom sync modules MAY implement DHT-based, mDNS-based, or other discovery. Custom modules' capability grants (`network.peer.*`) gate which mechanisms they may use.

---

## 17. Merge Semantics (Default Module)

### 17.1 OR-Set CRDT

The default module uses an Observed-Remove Set (OR-Set) CRDT for triples within a context.

- **Add**: A triple add carries a unique add-tag (the diff's revision).
- **Remove**: A triple remove carries the set of add-tags being removed.
- **Merge**: A triple is in the set iff at least one add-tag exists that has not yet been removed.

This is commutative, associative, and idempotent — diffs can be applied in any order and produce convergent state.

### 17.2 Causal Dependencies

Each diff lists its `dependencies` — prior revisions in the same context's chain that this diff was authored on top of. Peers MUST apply dependencies before the diff itself. If a dependency is missing, request it via `PULL`.

### 17.3 Reifier Convergence

Reifiers (the triples carrying provenance for data triples) follow the same OR-Set semantics. A reifier and its data triple are added together in a single `ContextDiff`; the runtime treats them atomically.

### 17.4 Concurrent State Transitions

Two agents firing the same flow transition concurrently produce two `flow://state` add-triples. The runtime detects this (same instance, same from-state, different reifier hashes) and applies a deterministic tie-break: lexicographically smaller reifier hash wins; the losing diff's actions are rolled back at evaluation time.

---

## 18. Snapshot Promotion

This section is normative.

### 18.1 Why Promote

Diff chains grow unboundedly. New peers subscribing would have to download all history. To bound this, the module promotes diff chains to snapshots at thresholds.

### 18.2 Threshold

The default module promotes when a context's diff chain since the last snapshot reaches a configured length (default: 1000 diffs). Custom modules MAY use different thresholds.

The threshold MUST be documented by the module — receiving peers need to know how far back they MAY need to request snapshots.

### 18.3 Promotion Algorithm

1. The committing module decides to promote (typically the agent who authored the threshold-crossing diff).
2. The module calls `getAsSnapshot()` on the context ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.2) requesting `signBy: "both"`.
3. The module commits a special `SNAPSHOT` diff into the space carrying the snapshot. The diff's `dependencies` includes all previously-unsnapshotted diffs.
4. Receiving peers apply the snapshot, mark the prior chain as superseded, and discard older diffs from local cache after a grace period.

### 18.4 Snapshot Pulls

A new peer arriving with no prior state requests the latest snapshot:

```
peer → space: PULL { graphDid, fromRevision: null }
respondent → peer: SNAPSHOT { graphDid, snapshot }
respondent → peer: DIFF, DIFF, ... (diffs after the snapshot)
```

The respondent is any peer with the snapshot locally — typically the agent who committed the snapshot, but any subscribed peer suffices.

### 18.5 Snapshot Signature

The snapshot's signature(s) are produced via [[PERSONAL-LINKED-DATA-GRAPHS]] §5.2:

- The snapshotter signs ("agent X observed graph G at hash H at time T").
- A graph-DID `assertionMethod` delegate signs ("graph G asserts H at T"), if available.

Receiving peers verify both signatures. Snapshots without at least one valid signature MUST be rejected.

---

## 19. Governance Integration

### 19.1 Three Verification Points

Every `ContextDiff` is governance-verified at three points:

| Point | Who | What is checked |
|---|---|---|
| **Commit time** | Committing agent's runtime | Full SHACL + ZCAP + caveats against the agent's local state, batch-scoped |
| **Gossip time** | Each receiving peer | Re-verify capability chain, re-verify caveats with link content, re-verify SHACL conformance |
| **Transport integrity** | Underlying transport (e.g., relay's validation) | Cryptographic signatures only — chain valid, link signatures valid, graph IRI consistent |

See [[GRAPH-GOVERNANCE]] §14.2 for algorithm details.

### 19.2 The validate() Callback

The module's `validate(graphDid, diff, author, graphState)` MUST:

1. Verify the diff's `CapabilityProof.chain` against the context's governance.
2. Re-evaluate any content-dependent caveats against the actual triples in `additions` and `removals`.
3. Verify each triple's reifier signature against the resolved author.
4. Return `{ accepted: true }` or `{ accepted: false, module: ..., reason: ... }`.

### 19.3 Rejection Behaviour

A diff that fails validation MUST NOT be:

- Stored in the local per-context store.
- Forwarded to other peers (the receiving peer should not re-broadcast).

Implementations SHOULD log rejected diffs for audit but MUST NOT retain rejected triple content beyond what is needed for the audit.

### 19.4 Enforcement Mode Awareness

The runtime SHALL inspect the context's `governance://enforcement_mode` ([[GRAPH-GOVERNANCE]] §5) before applying capability checks:

- **Open**: Skip ZCAP checks; accept diffs without capability proofs.
- **Announced**: Verify but do not reject on capability failure; log.
- **Enforced**: Verify and reject.

Content, temporal, and credential constraints are applied in all modes.

---

## 20. Background Operation

Sync modules execute in the user-agent-managed environment and persist across:

- Tab navigation
- Window closing (with active mounted contexts in other windows)
- Background tabs
- User agent restart (sessions reconnect)

The user agent MAY pause sync modules under battery / network / resource pressure, surfacing pause/resume controls via the management UI.

When all top-level browsing contexts are closed, the user agent MAY continue running modules briefly (e.g., to flush pending diffs) before fully suspending.

---

## 21. Signalling

Signalling carries opaque ephemeral messages between peers (e.g., WebRTC ICE candidates, presence, typing indicators) without entering the context's diff stream.

### 21.1 sendSignal

```javascript
await context.sendSignal("did:key:z6MkBob...", encoder.encode("hello"));
```

Targets all sessions of the named DID. `sendSignalToSession(did, sessionId, payload)` targets one specific session.

### 21.2 onsignal

```javascript
context.onsignal = (event) => {
  console.log(`signal from ${event.from.did}:`, event.payload);
};
```

### 21.3 Signal Properties

- Signals are NOT diffed, NOT signed (beyond transport authentication), NOT stored.
- Signals are best-effort: if the recipient is offline, the signal is dropped.
- Signals are subject to rate limits at the relay.

### 21.4 broadcast

```javascript
await context.broadcast(encoder.encode("typing..."));
```

Sends to all currently-online peers in the context's space who are subscribed to the same context.

---

## 22. Security Considerations

### 22.1 Module Sandbox

Sync modules MUST run in the WebAssembly sandbox with only the capabilities they requested and the user granted.

### 22.2 Content-Hash Verification

The user agent MUST verify the SHA-256 content hash of every downloaded module before installation.

### 22.3 Capability Proof Verification

Receiving peers MUST independently verify `CapabilityProof.chain` against the context's governance ([[GRAPH-GOVERNANCE]]) before applying a diff.

### 22.4 Relay Trust Model

Relays are message brokers, not authorities. They cannot author diffs, cannot reject diffs, cannot read message content (in encrypted spaces). They can observe (DID, sessionId) routing metadata, and they can rate-limit and refuse service.

### 22.5 DID Resolution Trust

Resolving `did:graph:...` from snapshots is subject to the trust level of the snapshot source ([[DECENTRALISED-IDENTITY]] §8.3). Security-sensitive operations SHOULD require `"local"` or `"mounted-read"` trust.

### 22.6 Snapshot Trust

Snapshots arriving from the network MUST be signed. Receiving peers MUST verify both the snapshot's signatures and that the recomputed content hash matches the embedded hash before mounting.

### 22.7 Sync Space Membership Privacy

A peer's presence in a sync space is visible to other space members. In a shared space, this reveals which contexts the peer is plausibly interested in (without revealing exact mounts). Communities that need membership privacy SHOULD use Fully Partitioned topology.

### 22.8 Replay Attacks

`ContextDiff.revision` is content-addressed, so replaying a previously-applied diff is a no-op (already in the OR-Set).

### 22.9 Authoritative Timestamps

Temporal constraints in [[GRAPH-GOVERNANCE]] and reifier-derived "entered state at" times in [[GRAPH-FLOWS]] depend on timestamps. The runtime MUST treat each ContextDiff's `timestamp` as the authoritative time for triples in that diff.

### 22.10 Module Update Quorum

Module updates MUST require quorum (>50% of known peers acknowledge module availability) before transition.

---

## 23. Privacy Considerations

### 23.1 Topology Choice Affects Privacy

| Topology | Network Privacy | Notes |
|---|---|---|
| Unified | None — all members see all diffs | Authorization still per-context; non-authorised diffs are discarded after receipt. |
| Privacy-Tiered | Isolated for restricted contexts; shared for public | Auto-adapts. |
| Fully Partitioned | Full — agents only receive their subscribed contexts' diffs | Maximum overhead. |

"Discarded after receipt" means the agent receives bytes but does not store or process them. A compromised agent could log discarded bytes.

### 23.2 Peer Identity Disclosure

Diffs are signed by the committing agent's DID. In encrypted spaces this is visible only to other space members; in open spaces it is visible to relays as well.

### 23.3 Mount-Table Disclosure

A peer's mount table is a sensitive artefact. The runtime MUST NOT disclose the full mount table without explicit user gesture (see [[PERSONAL-LINKED-DATA-GRAPHS]] §10.5).

### 23.4 DID Resolution Side Effects

Resolving `did:graph:...` via snapshot fetch can reveal interest in a context. Implementations SHOULD batch resolution requests and SHOULD avoid resolving DIDs based on untrusted input.

### 23.5 Per-Context Identity

Per [[PERSONAL-LINKED-DATA-GRAPHS]] §10.2, the recommended privacy posture is per-context identity.

---

## 24. Examples

### 24.1 Publishing a Context

```javascript
const me = await navigator.graph.create("My Workspace");
const planning = await me.createContext({ displayName: "Q3 Planning" });

const published = await planning.publish({
  spaceTopology: "privacy-tiered",
  relays: ["relay.example.com"]
});

console.log("Share these:");
console.log("  did:", published.graphDid);
console.log("  space:", published.spaceUri);
console.log("  module:", published.moduleHash);
```

### 24.2 Mounting from an Invitation

```javascript
const invite = JSON.parse(invitationLink);

const planning = await me.mount(invite.graphDid, {
  mode: "write",
  capabilityProof: invite.capabilityProof,
  spaceUri: invite.spaceUri,
  moduleHash: invite.moduleHash,
  relays: invite.relays
});
```

### 24.3 Observing Sync State

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

### 24.4 Signalling for WebRTC Negotiation

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

### 24.5 Multiple Contexts in One Sync Space

```javascript
const community = await me.createContext({ displayName: "Acme" });
const general   = await me.createContext({ displayName: "#general", participatesIn: community.did });
const random    = await me.createContext({ displayName: "#random",  participatesIn: community.did });

const c1 = await community.publish({ spaceTopology: "unified" });
const c2 = await general.publish({ spaceTopology: "unified" });
const c3 = await random.publish({ spaceTopology: "unified" });

console.log(c1.spaceUri === c2.spaceUri);   // true — same root context
console.log(c1.spaceUri === c3.spaceUri);   // true
```

### 24.6 Listing Mounted Contexts and Spaces

```javascript
const mounted = await me.listMounted();
for (const m of mounted) {
  console.log(`${m.graphDid} (${m.mode}, ${m.peerCount} peers) on ${m.spaceUri}`);
}

const spaces = await me.listSpaces();
for (const s of spaces) {
  console.log(`${s.spaceUri}: ${s.contextCount} contexts, ${s.peerCount} peers`);
}
```

---

## 25. References

### 25.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[RDF-CANON]** "RDF Dataset Canonicalization", W3C Recommendation, March 2025. https://www.w3.org/TR/rdf-canon/
- **[WEBASSEMBLY]** "WebAssembly Core Specification", W3C Recommendation. https://www.w3.org/TR/wasm-core-2/
- **[WEBTRANSPORT]** "WebTransport", W3C Working Draft. https://www.w3.org/TR/webtransport/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./02_decentralised-identity-web-platform.md).
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./01_personal-linked-data-graphs.md).
- **[GRAPH-GOVERNANCE]** [Graph Governance](./05_graph-governance.md).

### 25.2 Informative References

- **[GRAPH-FLOWS]** [Graph Flows](./07_graph-flows.md).
- **[SHAPE-VALIDATION]** [Dynamic Graph Shape Validation](./04_dynamic-graph-shape-validation.md).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./06_group-identity.md).
