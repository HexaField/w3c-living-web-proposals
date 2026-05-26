# Context Synchronisation Protocol

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a protocol for synchronising **contexts** (named graphs, per [[PERSONAL-LINKED-DATA-GRAPHS]]) between multiple agents in a peer-to-peer manner. Synchronisation is keyed by a context's `did:graph:...` (defined in [[GROUP-IDENTITY]]). A `did:graph` is REQUIRED for sync: a context's `graph://<content-hash>` IRI changes whenever its triples change, so it cannot serve as the durable subscription handle that sync needs. Ungroupified contexts can still be transported between agents as immutable snapshots ([[PERSONAL-LINKED-DATA-GRAPHS]] §5), but they cannot be *synced* — sync presupposes an evolving graph with a stable identity, which is exactly what `did:graph` provides. This specification defines:

- The **ContextDiff** format — additions and removals scoped to a specific graph DID, accompanied by a capability proof per [[CAPABILITY-FRAMEWORK]].
- The **mount-and-subscribe** lifecycle — a graduated, per-context subscription model.
- The separation of **logical contexts** (with self-contained governance) from **sync spaces** (gossip topologies that may carry one or many contexts).
- The Context-API additions that user agents expose for publish, subscribe, and signal.

The protocol is *transport-neutral* and *module-neutral*: it is realised over a pluggable module architecture ([[SYNC-MODULE]]) in which each module supplies transport, merge logic, peer discovery, and governance validation. Conforming user agents ship a built-in default module ([[DEFAULT-SYNC-MODULE]]).

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

This specification defines a **synchronisation protocol for linked data contexts** — a standard interface and diff format that enables multiple agents to maintain a shared, eventually-consistent named graph without a central server.

This specification *does not* prescribe a specific transport, merge algorithm, or peer-discovery mechanism. Those choices are encapsulated in **sync modules** ([[SYNC-MODULE]]). Conforming user agents ship a default module ([[DEFAULT-SYNC-MODULE]]), and communities may install additional modules that implement different strategies.

### 1.2 Use Cases

- **Collaborative editing.** Multiple users co-author contexts, with changes propagating in real time.
- **Peer-to-peer social.** Per-context feeds, profiles, interactions; no platform intermediary.
- **Distributed knowledge bases.** Research groups maintain shared contexts across institutional boundaries.
- **Offline-first.** Users on intermittent connections make local edits that reconcile when connectivity resumes.
- **Governance-enforced collaboration.** Contexts enforce membership, rate limits, and content rules at the sync layer via [[CAPABILITY-FRAMEWORK]] and [[CONSTRAINT-VOCABULARY]].

### 1.3 Scope

This specification defines:

- The **Context** API additions for sync (publish, unpublish, mount, subscription lifecycle).
- The **ContextDiff** format.
- The **sync space** abstraction and three standard topologies (Unified / Privacy-Tiered / Fully Partitioned).
- The **subscription** state model.
- **Governance integration** — how the protocol invokes [[CAPABILITY-FRAMEWORK]] validation on every incoming diff.
- **Signalling** for ephemeral peer communication outside the context.

### 1.4 Relationship to Other Specifications

- [[DECENTRALISED-IDENTITY]] defines `did:key` and the `DIDCredential` signing surface.
- [[GROUP-IDENTITY]] defines `did:graph` and its resolution algorithm — the durable identifier on which sync subscriptions are keyed. Subscribing to a graph that has not been groupified is not possible; see [[PERSONAL-LINKED-DATA-GRAPHS]] §5 for the immutable-snapshot transport path that ungroupified contexts use instead.
- [[PERSONAL-LINKED-DATA-GRAPHS]] defines the Context interface and GraphStore that this protocol synchronises.
- [[CAPABILITY-FRAMEWORK]] defines the ZCAP rules that the protocol's governance integration enforces.
- [[SYNC-MODULE]] defines the pluggable module interface that handles transport, merge, peer discovery, and `validate()` for the protocol.
- [[DEFAULT-SYNC-MODULE]] defines the built-in module that conforming user agents MUST ship.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A **conforming user agent** MUST implement:

1. The Context sync API additions ([§6](#6-api)).
2. The sync space abstraction ([§7](#7-sync-spaces)).
3. The subscription lifecycle ([§8](#8-subscription-lifecycle)).
4. Governance integration ([§9](#9-governance-integration)).
5. Background operation ([§10](#10-background-operation)).
6. The pluggable module sandbox defined in [[SYNC-MODULE]].
7. The default sync module defined in [[DEFAULT-SYNC-MODULE]].

---

## 3. Terminology

<dl>
<dt><dfn>Context</dfn></dt>
<dd>A named graph identified by a <code>graph://&lt;content-hash&gt;</code> IRI (optionally also by a <code>did:graph:...</code> DID when groupified). See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt><dfn>ContextDiff</dfn></dt>
<dd>A unit of change to a specific context: additions, removals, a revision identifier, causal dependencies, and a CapabilityProof. The unit of gossip.</dd>

<dt><dfn>CapabilityProof</dfn></dt>
<dd>The ZCAP delegation chain that authorises the committing agent's writes for this context. See [§5.3](#53-capabilityproof) and [[CAPABILITY-FRAMEWORK]].</dd>

<dt><dfn>Mount</dfn></dt>
<dd>The act of opening a context's per-context store in a GraphStore, with a specified mount mode (<code>read</code>, <code>write</code>, or <code>governance</code>). See [[PERSONAL-LINKED-DATA-GRAPHS]] §4.2.</dd>

<dt><dfn>Subscription</dfn></dt>
<dd>An agent is subscribed to a context when they (a) hold a valid capability chain for it, (b) have it mounted, and (c) are subscribed to the appropriate sync space that gossips its diffs.</dd>

<dt><dfn>Sync Space</dfn></dt>
<dd>A lightweight gossip network identified by a hash. One sync space MAY carry diffs for one context (Fully Partitioned topology) or many contexts (Unified / Privacy-Tiered topologies). The unit of physical message propagation.</dd>

<dt><dfn>Topology</dfn></dt>
<dd>A policy that maps contexts to sync spaces. See [§7.2](#72-topology-policy).</dd>

<dt><dfn>Sync Module</dfn></dt>
<dd>A content-addressed WebAssembly bundle implementing the <code>GraphSyncModule</code> interface defined by [[SYNC-MODULE]]. The module handles transport, merge, peer discovery, and validation for a sync space.</dd>

<dt><dfn>Peer</dfn></dt>
<dd>An agent participating in synchronisation of a context. Identified by (DID, sessionId).</dd>

<dt><dfn>Revision</dfn></dt>
<dd>A content-addressed identifier for a ContextDiff, computed as a cryptographic hash of additions, removals, and dependencies.</dd>

<dt><dfn>Snapshot</dfn></dt>
<dd>An addressable serialised form of a context, produced when diff chains exceed a configured length. Maps to the GraphSnapshot in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.</dd>
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

**Logical layer**: Each context is identified by a `did:graph:...` (its sovereign identity — required for sync) and has its own governance, shapes, flows, and data. Its current state has a `graph://<content-hash>` IRI which changes with every diff. **Authorization** lives here, per-context.

**Sync layer**: Sync spaces determine what gossips with what. **Membership in a space** carries diffs to your peer; **a valid capability** lets you process them. The two are orthogonal.

A receiving peer in a shared space:

1. Receives a diff carrying its `graphDid`.
2. Checks "am I subscribed to this context?" — if no, discard.
3. If yes, verify the `CapabilityProof` against the context's governance ([[CAPABILITY-FRAMEWORK]]).
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
  readonly attribute USVString graphDid;          // did:graph:... — the sovereign id of the graph
  readonly attribute USVString revision;           // sha256 hex
  readonly attribute FrozenArray<Triple> additions;
  readonly attribute FrozenArray<Triple> removals;
  readonly attribute FrozenArray<USVString> dependencies;  // prior revisions in this context's chain
  readonly attribute CapabilityProof? capabilityProof;
  readonly attribute USVString author;             // did:key:... (the committing agent)
  readonly attribute DOMString timestamp;          // RFC 3339; authoritative commit time
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

The chain is the ordered list of ZCAPs from the committing agent's leaf capability up to the context's root capability ([[CAPABILITY-FRAMEWORK]] §4.3). Each entry is a content-addressed reference; resolving them requires the context's local store (so the receiving peer must already be mounted to verify).

`caveatsSatisfied` records which caveats the committing agent's executor evaluated and accepted before commit. The receiving peer re-evaluates independently; this field is an audit trail, not a trust shortcut.

`hasContentCaveats` is `true` if any delegation in the chain has caveats whose evaluation depends on the link's content (Predicate, Shape, Property, Content, Subject, Object — see [[CAPABILITY-FRAMEWORK]] §9 and [[CONSTRAINT-VOCABULARY]]). When `false`, the receiving peer MAY skip per-link caveat re-evaluation as an optimisation.

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

When a user opens a context in a new tab or on a new device, the user agent MUST generate a new sessionId. The sessionId is ephemeral — it does not persist across user agent restarts.

### 5.5 Context Sync State

```webidl
enum ContextSyncState {
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

1. If `options.moduleHash` is specified and not installed, initiate module installation ([[SYNC-MODULE]] §6.1). If the user denies, reject with `"NotAllowedError"`.
2. If `options.moduleHash` is not specified, use the user agent's default sync module ([[DEFAULT-SYNC-MODULE]]).
3. Determine the space URI ([§7](#7-sync-spaces)).
4. Initialise the sync module if not already running for this space.
5. Subscribe to the space.
6. Return a `PublishedContext` carrying the addressing.

### 6.2 Mounting a Remote Context

The `mount()` method is defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §4.2. This specification extends its options dictionary with sync-layer hints:

```webidl
partial dictionary MountOptions {
  USVString spaceUri;            // hint: the space carrying this context's diffs
  USVString moduleHash;          // hint: the sync module the space uses
  sequence<USVString> relays;    // hint: relay endpoints
};
```

When a `Context` is mounted with any of these hints present, the user agent MUST in addition to the steps of [[PERSONAL-LINKED-DATA-GRAPHS]] §4.2:

1. Subscribe to `spaceUri` using `moduleHash` (downloading the module if needed, with user consent — see [[SYNC-MODULE]] §6.2).
2. Begin emitting and accepting `ContextDiff`s scoped to the mounted graph IRI.

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

  attribute EventHandler onsubscriptiongained;
  attribute EventHandler onsubscriptionlost;
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

Pulls target a specific context within a space, identified by `graphDid` + last-known-revision.

---

## 8. Subscription Lifecycle

This section is normative.

### 8.1 Becoming Subscribed

The full handshake for an agent to subscribe to a context they have not previously mounted:

1. **Discover.** The agent obtains the context's `did:graph:...` plus addressing hints (space URI, module hash, relay endpoints, snapshot URI) — typically out of band (invitation link, paper, side-channel).
2. **Resolve.** The runtime resolves the DID per [[GROUP-IDENTITY]] §4.4. If no snapshot is locally available, fetch one via the snapshot URI hint and verify it (the snapshot's `graphIri` is its content hash; the snapshot's `group://wrapsGraph` triple confirms the binding to the `did:graph`).
3. **Verify snapshot.** Verify the snapshot's signatures.
4. **Verify capability.** If the mount mode requires authorisation, verify the agent's `capabilityProof` against the (now-resolved) context governance.
5. **Mount.** Open the per-context store and write the snapshot triples ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.3).
6. **Join space.** Subscribe to the space identified by the topology + module.
7. **Sync.** Pull diffs from the space since the snapshot's `currentRevision`. Apply each (re-verifying CapabilityProofs).

The agent is now subscribed. Subsequent diffs propagate via gossip; subsequent writes by the agent are authored to the context, packaged into ContextDiffs, signed with their capability chain, and committed to the space.

### 8.2 Maintaining the Subscription

The runtime keeps the per-context store in sync via the module's `connect()` / `onRemoteDiff()` flow ([[SYNC-MODULE]] §5). Heartbeats, peer discovery, and retry are module-defined.

### 8.3 Losing the Subscription

| Trigger | Effect |
|---|---|
| **Agent unmounts the context** | The runtime leaves the space (if no other mounted context requires it), drops the local store reference, fires `contextunmounted`. The per-context store stays on disk; remounting reopens it. |
| **Capability is revoked** | A revocation triple arrives. The runtime detects it, fires `subscriptionlost`, and either downgrades mount mode (if a partial chain remains valid) or fully unmounts. |
| **Snapshot promotion makes prior diffs unreachable** | If the agent has been offline long enough that the chain has been promoted past their last-known revision, the runtime pulls a fresh snapshot to catch up. |

### 8.4 Subscription Events

`subscriptiongained` and `subscriptionlost` events are dispatched on the `GraphStore` (see [§6.4](#64-graphstore-level-sync-management)).

### 8.5 Read-Only Snapshots

Mounting in `"read"` mode does not require a capability proof beyond the context's general read policy. A read-only mount receives diffs but cannot author them. Applications MAY upgrade later by calling `mount()` again with a write capability proof.

---

## 9. Governance Integration

This specification integrates with [[CAPABILITY-FRAMEWORK]] at three normative points.

### 9.1 Three Verification Points

Every `ContextDiff` is governance-verified at three points:

| Point | Who | What is checked |
|---|---|---|
| **Commit time** | Committing agent's runtime | Full SHACL + ZCAP + caveats against the agent's local state, batch-scoped |
| **Gossip time** | Each receiving peer | Re-verify capability chain, re-verify caveats with link content, re-verify SHACL conformance |
| **Transport integrity** | Underlying transport (e.g., relay's validation) | Cryptographic signatures only — chain valid, link signatures valid, graph IRI consistent |

### 9.2 The validate() Contract

A conforming sync module's `validate(graphDid, diff, author, graphState)` MUST:

1. Verify the diff's `CapabilityProof.chain` against the context's governance ([[CAPABILITY-FRAMEWORK]] §7).
2. Re-evaluate any content-dependent caveats against the actual triples in `additions` and `removals` (per [[CAPABILITY-FRAMEWORK]] §9 and [[CONSTRAINT-VOCABULARY]]).
3. Verify each triple's reifier signature against the resolved author.
4. Return `{ accepted: true }` or `{ accepted: false, module: ..., reason: ... }`.

### 9.3 Rejection Behaviour

A diff that fails validation MUST NOT be:

- Stored in the local per-context store.
- Forwarded to other peers (the receiving peer should not re-broadcast).

Implementations SHOULD log rejected diffs for audit but MUST NOT retain rejected triple content beyond what is needed for the audit.

### 9.4 Enforcement Mode Awareness

The runtime SHALL inspect the context's `governance://enforcement_mode` ([[CAPABILITY-FRAMEWORK]] §5) before applying capability checks:

- **Open**: Skip ZCAP checks; accept diffs without capability proofs.
- **Announced**: Verify but do not reject on capability failure; log.
- **Enforced**: Verify and reject.

Constraint kinds supplied by [[CONSTRAINT-VOCABULARY]] (content, temporal, credential) are applied in all modes per their own rules.

---

## 10. Background Operation

Sync activity executes in the user-agent-managed environment and persists across:

- Tab navigation
- Window closing (with active mounted contexts in other windows)
- Background tabs
- User agent restart (sessions reconnect)

The user agent MAY pause sync activity under battery / network / resource pressure, surfacing pause/resume controls via the module management UI ([[SYNC-MODULE]] §6.6).

When all top-level browsing contexts are closed, the user agent MAY continue running modules briefly (e.g., to flush pending diffs) before fully suspending.

---

## 11. Signalling

Signalling carries opaque ephemeral messages between peers (e.g., WebRTC ICE candidates, presence, typing indicators) without entering the context's diff stream.

### 11.1 sendSignal

```javascript
await context.sendSignal("did:key:z6MkBob...", encoder.encode("hello"));
```

Targets all sessions of the named DID. `sendSignalToSession(did, sessionId, payload)` targets one specific session.

### 11.2 onsignal

```javascript
context.onsignal = (event) => {
  console.log(`signal from ${event.from.did}:`, event.payload);
};
```

### 11.3 Signal Properties

- Signals are NOT diffed, NOT signed (beyond transport authentication), NOT stored.
- Signals are best-effort: if the recipient is offline, the signal is dropped.
- Signals are subject to rate limits at the transport layer.

### 11.4 broadcast

```javascript
await context.broadcast(encoder.encode("typing..."));
```

Sends to all currently-online peers in the context's space who are subscribed to the same context.

---

## 12. Security Considerations

### 12.1 Capability Proof Verification

Receiving peers MUST independently verify `CapabilityProof.chain` against the context's governance ([[CAPABILITY-FRAMEWORK]]) before applying a diff.

### 12.2 DID Resolution Trust

Resolving a `did:graph:...` from snapshots is subject to the trust level of the snapshot source ([[DECENTRALISED-IDENTITY]] §7.2). Security-sensitive operations SHOULD require `"local"` or `"mounted-read"` trust. Verifying a snapshot's `graphIri` is intrinsically a single hash check (the IRI is the SHA-256 of the snapshot's triples; either it matches or it does not); the snapshot's signature establishes the trust level for the surrounding data.

### 12.3 Sync Space Membership Privacy

A peer's presence in a sync space is visible to other space members. In a shared space, this reveals which contexts the peer is plausibly interested in (without revealing exact mounts). Communities that need membership privacy SHOULD use Fully Partitioned topology.

### 12.4 Replay Attacks

`ContextDiff.revision` is content-addressed, so replaying a previously-applied diff is a no-op (already in the per-context store).

### 12.5 Authoritative Timestamps

Temporal constraints in [[CONSTRAINT-VOCABULARY]] and reifier-derived "entered state at" times in [[GRAPH-FLOWS]] depend on timestamps. The runtime MUST treat each ContextDiff's `timestamp` as the authoritative time for triples in that diff.

### 12.6 Module Sandbox

Sync modules MUST run in the sandbox defined by [[SYNC-MODULE]] §3 with only the capabilities they requested and the user granted.

---

## 13. Privacy Considerations

### 13.1 Topology Choice Affects Privacy

| Topology | Network Privacy | Notes |
|---|---|---|
| Unified | None — all members see all diffs | Authorization still per-context; non-authorised diffs are discarded after receipt. |
| Privacy-Tiered | Isolated for restricted contexts; shared for public | Auto-adapts. |
| Fully Partitioned | Full — agents only receive their subscribed contexts' diffs | Maximum overhead. |

"Discarded after receipt" means the agent receives bytes but does not store or process them. A compromised agent could log discarded bytes.

### 13.2 Peer Identity Disclosure

Diffs are signed by the committing agent's DID. In encrypted spaces this is visible only to other space members; in open spaces it is visible to relays as well.

### 13.3 Mount-Table Disclosure

A peer's mount table is a sensitive artefact. The runtime MUST NOT disclose the full mount table without explicit user gesture (see [[PERSONAL-LINKED-DATA-GRAPHS]] §10.5).

### 13.4 DID Resolution Side Effects

Resolving a `did:graph:...` can reveal interest in a context. Implementations SHOULD batch resolution requests and SHOULD avoid resolving identifiers based on untrusted input.

### 13.5 Per-Context Identity

Per [[PERSONAL-LINKED-DATA-GRAPHS]] §10.2, the recommended privacy posture is per-context identity.

---

## 14. Examples

### 14.1 Publishing a Context

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

### 14.2 Mounting from an Invitation

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

### 14.5 Multiple Contexts in One Sync Space

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

### 14.6 Listing Mounted Contexts and Spaces

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

## 15. References

### 15.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002.
- **[RDF-CANON]** "RDF Dataset Canonicalization", W3C Recommendation, March 2025. https://www.w3.org/TR/rdf-canon/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./01_decentralised-identity-web-platform.md).
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./03_graph-capability-framework.md).
- **[SYNC-MODULE]** [Sync Module Architecture](./05_sync-module-architecture.md).
- **[DEFAULT-SYNC-MODULE]** [Default Sync Module](./08_default-sync-module.md).

### 15.2 Informative References

- **[CONSTRAINT-VOCABULARY]** [Governance Constraint Vocabulary](./07_governance-constraint-vocabulary.md).
- **[GRAPH-FLOWS]** [Graph Flows](./09_graph-flows.md).
- **[SHAPE-VALIDATION]** [Dynamic Graph Shape Validation](./06_dynamic-graph-shape-validation.md).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./10_decentralised-group-identity.md).
