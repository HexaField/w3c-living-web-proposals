# Peer-to-Peer Graph Synchronisation Protocol

**W3C Draft Community Group Report**

**Latest published version:** This document  
**Editor:** [Editor Name]  
**This version:** Draft, 5 April 2026

---

## Abstract

This specification defines a protocol for synchronising personal linked data graphs between multiple agents in a peer-to-peer manner. It defines the sync interface, diff format, conflict resolution semantics, peer discovery mechanism, and — critically — a **pluggable sync module architecture** that allows each shared graph to specify its own synchronisation strategy via a content-addressed WebAssembly module. The browser downloads, verifies, and executes the module in a capability-scoped sandbox. The module handles transport, merge logic, peer discovery, and governance validation. By standardising the synchronisation layer with pluggable strategies, this specification enables interoperable collaborative data applications without reliance on central servers while preserving sovereignty over sync semantics.

---

## Status of This Document

This document is a draft Community Group Report produced by the [Personal Linked Data Community Group](). It has not been reviewed or endorsed by the W3C Membership and is not a W3C Standard. This document is subject to change.

Comments on this specification are welcome. Please file issues on the [GitHub repository]().

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Data Model](#4-data-model)
5. [API](#5-api)
6. [Sync Modules](#6-sync-modules)
7. [GraphSyncModule Interface](#7-graphsyncmodule-interface)
8. [Module Capabilities](#8-module-capabilities)
9. [Module Lifecycle](#9-module-lifecycle)
10. [Default Sync Module](#10-default-sync-module)
11. [Wire Protocol (Default Module)](#11-wire-protocol-default-module)
12. [Relay Protocol](#12-relay-protocol)
13. [Peer Discovery](#13-peer-discovery)
14. [NAT Traversal](#14-nat-traversal)
15. [Merge Semantics (Default Module)](#15-merge-semantics-default-module)
16. [Governance Integration](#16-governance-integration)
17. [Background Operation](#17-background-operation)
18. [Publishing and Joining](#18-publishing-and-joining)
19. [Signalling](#19-signalling)
20. [Security Considerations](#20-security-considerations)
21. [Privacy Considerations](#21-privacy-considerations)
22. [Examples](#22-examples)
23. [References](#23-references)

---

## 1. Introduction

### 1.1 Motivation

The web's data model is fundamentally client-server: applications fetch data from centralised endpoints and write data back to them. This architecture creates single points of failure, imposes trust in server operators, and makes offline collaboration difficult or impossible.

Local-first software — in which data resides primarily on the user's device and is synchronised between peers — addresses these limitations. However, the web platform currently provides no native primitives for peer-to-peer data synchronisation. WebRTC enables media and data channels, but applications must build their own sync semantics on top of raw transport.

This specification defines a **synchronisation protocol for linked data graphs**: a standard interface and diff format that enables multiple agents to collaboratively maintain a shared, eventually-consistent semantic graph without requiring a central server.

Critically, this specification recognises that **no single sync strategy is optimal for all use cases**. A collaborative text editor requires different merge semantics than a social feed. A research dataset requires different peer discovery than a private messaging group. Rather than prescribing a single approach, this specification defines a **pluggable sync module architecture**: each shared graph specifies a WebAssembly module that implements the sync strategy. The browser downloads, verifies, sandboxes, and executes the module. The module handles transport, merge, peer discovery, governance validation, and all other sync-layer concerns.

This architecture provides:

- **Sovereignty**: Communities choose their own sync semantics — their module is the one component all peers must agree on.
- **Evolvability**: New sync strategies can be deployed without browser updates — modules are content-addressed code, not browser features.
- **Safety**: Modules run in a capability-scoped WASM sandbox with no access to DOM, filesystem, other graphs, or arbitrary network.
- **Interoperability**: All modules implement the same `GraphSyncModule` interface, so the browser's graph API works identically regardless of the underlying sync strategy.

### 1.2 Use Cases

- **Collaborative editing:** Multiple users co-author a knowledge base, with changes propagating in real time as peers connect and disconnect.
- **Peer-to-peer social:** Social feeds, profiles, and interactions stored in shared graphs that participants sync directly — no platform intermediary.
- **Distributed knowledge bases:** Research groups, communities, or organisations maintain shared ontologies and datasets across institutional boundaries.
- **Offline-first synchronisation:** Field workers, travellers, or users on intermittent connections make local edits that automatically reconcile when connectivity resumes.
- **Custom consensus protocols:** Voting systems, multi-party computation, or domain-specific merge strategies implemented as sync modules without requiring browser changes.
- **Governance-enforced collaboration:** Communities define rules (who can contribute, how often, with what content) that are enforced at the sync layer by the module — not by the application UI.

### 1.3 Scope

This specification defines:

- The **SharedGraph** data model (extending Personal Linked Data Graphs [[PERSONAL-LINKED-DATA-GRAPHS]])
- The **GraphDiff** format for describing changes
- The **GraphSyncModule** WASM interface that sync modules MUST implement
- The **capability-scoped sandbox** in which sync modules execute
- The **module lifecycle** (installation, verification, update, removal, suspension)
- The **default sync module** that conforming user agents MUST ship
- The **wire protocol** and **relay protocol** for the default module
- The **merge semantics** (CRDT) for the default module
- Requirements for **eventual consistency**, **causal ordering**, and **conflict resolution**
- **Governance integration** via the module's `validate()` method
- A **signalling** mechanism for ephemeral peer communication outside the graph
- **Background operation** semantics for persistent sync across tab navigations

This specification does NOT define:

- ~~A specific transport protocol~~ (the default module defines one; custom modules define their own)
- ~~A specific CRDT or merge algorithm~~ (the default module defines one; custom modules define their own)
- ~~A specific peer discovery mechanism~~ (the default module defines one; custom modules define their own)
- The governance rule format (see [[GRAPH-GOVERNANCE]])
- Application-level schemas or ontologies

### 1.4 Relationship to Other Specifications

This specification depends on:

- [[PERSONAL-LINKED-DATA-GRAPHS]] — defines the PersonalGraph interface that SharedGraph extends
- [[DID-CORE]] — defines Decentralised Identifiers used for peer identity
- [[WEBASSEMBLY]] — defines the execution environment for sync modules
- [[WEBTRANSPORT]] — used by the default sync module for transport
- [[RFC2119]] — defines requirement level keywords

This specification is complemented by:

- [[GRAPH-GOVERNANCE]] — defines the governance constraint format and verification algorithms that the default sync module enforces

---

## 2. Conformance

As well as sections marked as non-normative, all authoring guidelines, diagrams, examples, and notes in this specification are non-normative. Everything else in this specification is normative.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]].

A **conforming user agent** MUST implement all normative requirements of this specification, including:

1. The SharedGraph API (Section 5)
2. The sync module sandbox (Section 8)
3. The module lifecycle (Section 9)
4. The default sync module (Section 10)
5. Background operation (Section 17)

A **conforming sync module** MUST implement the `GraphSyncModule` interface defined in Section 7.

---

## 3. Terminology

<dl>
<dt><dfn>SharedGraph</dfn></dt>
<dd>A linked data graph that is synchronised between multiple peers. Extends PersonalGraph [[PERSONAL-LINKED-DATA-GRAPHS]] with sync capabilities. Identified by a URI of the form <code>graph://&lt;relay&gt;/&lt;id&gt;?module=&lt;content-hash&gt;</code>.</dd>

<dt><dfn>Sync Module</dfn></dt>
<dd>A content-addressed WebAssembly bundle that implements the <code>GraphSyncModule</code> interface. The sync module handles transport, merge, peer discovery, and governance validation for a shared graph. All peers in a shared graph MUST run the same sync module.</dd>

<dt><dfn>GraphDiff</dfn></dt>
<dd>A unit of change to a SharedGraph, consisting of additions, removals, a revision identifier, and a set of causal dependencies.</dd>

<dt><dfn>Peer</dfn></dt>
<dd>An agent participating in the synchronisation of a SharedGraph. Identified by a Decentralised Identifier (DID) [[DID-CORE]].</dd>

<dt><dfn>Agent</dfn></dt>
<dd>An entity (human user, automated process, or software agent) that controls a peer identity and interacts with SharedGraphs.</dd>

<dt><dfn>Revision</dfn></dt>
<dd>A content-addressed identifier for a GraphDiff, computed as a cryptographic hash of the diff's additions, removals, and causal dependencies.</dd>

<dt><dfn>Causal Ordering</dfn></dt>
<dd>A partial ordering of diffs such that a diff is applied only after all diffs it depends on have been applied.</dd>

<dt><dfn>Content Hash</dfn></dt>
<dd>A cryptographic hash (SHA-256 or equivalent) of a sync module's WASM binary. Used for content addressing, integrity verification, and ensuring all peers run identical code.</dd>

<dt><dfn>Relay</dfn></dt>
<dd>A server that facilitates message passing between peers. Relays forward messages but have no authority over graph data — they cannot modify, reject, or inspect diffs.</dd>

<dt><dfn>Module Capability</dfn></dt>
<dd>A scoped permission granted to a sync module by the browser's sandbox. Capabilities restrict what system resources (network, storage, cryptography) the module may access.</dd>

<dt><dfn>Graph URI</dfn></dt>
<dd>A URI of the form <code>graph://&lt;relay-endpoints&gt;/&lt;graph-id&gt;?module=&lt;content-hash&gt;</code> that uniquely identifies a shared graph and encodes the information needed to join it: relay endpoint(s), graph identifier, and sync module hash.</dd>
</dl>

---

## 4. Data Model

### 4.1 SharedGraph

A SharedGraph is a PersonalGraph [[PERSONAL-LINKED-DATA-GRAPHS]] extended with synchronisation capabilities. Each SharedGraph is identified by a globally unique Graph URI.

A SharedGraph MUST:

- Support all operations defined by PersonalGraph (add, remove, query triples)
- Maintain a set of known peers
- Track sync state
- Accept and produce GraphDiff objects
- Be associated with exactly one sync module

A SharedGraph MAY be backed by any storage mechanism that satisfies the PersonalGraph interface.

### 4.2 GraphDiff

A GraphDiff represents an atomic unit of change to a SharedGraph. A GraphDiff consists of:

- **additions**: A set of signed semantic triples to be added to the graph. Each triple MUST include a cryptographic signature from the authoring agent.
- **removals**: A set of signed semantic triples to be removed from the graph. Each removal MUST be signed by an agent authorised to perform the removal.
- **revision**: A content-addressed identifier for this diff (see [4.3](#43-revision)).
- **dependencies**: A set of revision identifiers representing the causal dependencies of this diff.

A GraphDiff MUST be treated as immutable once its revision identifier has been computed.

### 4.3 Revision

A Revision is a content-addressed identifier for a GraphDiff, computed as:

```
revision = hash(canonicalize(additions) || canonicalize(removals) || sort(dependencies))
```

The hash algorithm MUST be SHA-256 or a collision-resistant hash function of equivalent or greater strength.

The canonicalisation algorithm for triples MUST produce a deterministic byte representation regardless of insertion order. Implementations SHOULD use the RDF Dataset Canonicalization algorithm [[RDF-CANON]].

### 4.4 Peer

A Peer is an agent participating in the synchronisation of a SharedGraph. A single agent (identified by a DID) MAY have multiple concurrent sessions — for example, multiple browser tabs on the same device, or sessions across different devices. Each session is a distinct peer.

A peer is identified by the combination of:
- **DID**: The agent's Decentralised Identifier [[DID-CORE]], representing the user's identity.
- **Session ID**: A unique, randomly generated identifier for this specific session (tab, device, or context). The session ID MUST be generated using a cryptographically secure random source and MUST contain at least 128 bits of entropy.

Two peers with the same DID but different session IDs represent the same user on different tabs or devices. Two peers with different DIDs are different users.

A peer's DID MUST be resolvable to a DID Document containing at least one verification method suitable for digital signatures.

#### 4.4.1 Session Identity

When a user opens a shared graph in a new tab or on a new device, the browser MUST generate a new session ID for that context. The session ID is ephemeral — it does not persist across page reloads or browser restarts.

The session ID enables:
- **Targeted signalling**: Send a signal to a specific tab or device, not just a user. For example, sending a WebRTC offer to the user's laptop session specifically, not their phone.
- **Presence granularity**: Show which devices a user is active on. "Alice is on her laptop and phone."
- **Session handoff**: A user can start a voice call on one device and transfer it to another by targeting the new session.
- **Cursor/selection tracking**: In collaborative editing, each tab has its own cursor position. The session ID distinguishes them.

#### 4.4.2 Device Labels

Peers MAY include an optional `deviceLabel` — a human-readable string identifying the device or context (e.g., "MacBook Pro", "iPhone", "Work Browser Tab 2"). This is provided by the user agent and is purely informational.

#### 4.4.3 Peer Equality

Two peers are **the same peer** if and only if both their DID and session ID are identical. Two peers with the same DID but different session IDs are **the same user on different sessions**. Implementations MUST treat them as distinct peers for the purposes of sync, signalling, and presence, but MAY group them for display purposes (e.g., showing "Alice (2 devices)" instead of two separate entries).

#### 4.4.4 Signal Targeting

The `sendSignal(remoteDid, payload)` method targets ALL sessions of the specified DID. To target a specific session, use `sendSignalToSession(remoteDid, sessionId, payload)`:

```webidl
Promise<undefined> sendSignalToSession(USVString remoteDid, USVString sessionId, BufferSource payload);
```

This is critical for WebRTC negotiation, where the offer must reach a specific device, and for session handoff scenarios.

### 4.5 Graph URI

A Graph URI uniquely identifies a shared graph and encodes the information required to join it. The URI scheme is `graph://` with the following structure:

```
graph://<relay-endpoints>/<graph-id>?module=<content-hash>
```

Where:

- **relay-endpoints**: One or more comma-separated relay server hostnames. Example: `relay1.example.com,relay2.example.com`
- **graph-id**: A globally unique identifier for the graph, containing sufficient entropy to prevent guessing (RECOMMENDED: UUID v4 or 128+ bits of randomness).
- **module**: The content hash of the sync module's WASM binary. If omitted, the browser's default sync module is used.

Examples:

```
graph://relay.example.com/a3f8c2d1-7e9b-4f0a-8c6d-2e1f3a5b7d9e
graph://relay1.example.com,relay2.example.com/a3f8c2d1?module=sha256-abc123def456
```

The user agent MUST parse Graph URIs according to this scheme. If the URI cannot be parsed, the `join()` method MUST reject with a `SyntaxError` DOMException.

---

## 5. API

### 5.1 SharedGraphManager

The sharing and joining of shared graphs is integrated into the `navigator.graph` namespace and the `PersonalGraph` interface. A personal graph becomes a `SharedGraph` by calling `share()` on it. Shared graphs are joined via `navigator.graph.join()`.

```webidl
[Exposed=Window, SecureContext]
partial interface PersonalGraphManager {
  [NewObject] Promise<SharedGraph> join(USVString graphURI);
  [NewObject] Promise<sequence<SharedGraphInfo>> listShared();
  [NewObject] Promise<sequence<SyncModuleInfo>> listModules();
};

[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<SharedGraph> share(
    optional SharedGraphOptions options = {}
  );
};

dictionary SharedGraphOptions {
  USVString module;
  sequence<USVString> relays;
  SharedGraphMetadata meta;
};

dictionary SharedGraphMetadata {
  USVString name;
  USVString description;
};

dictionary SharedGraphInfo {
  USVString uri;
  USVString name;
  USVString moduleHash;
  SyncState syncState;
  unsigned long peerCount;
};

dictionary SyncModuleInfo {
  USVString contentHash;
  USVString? name;
  unsigned long graphCount;
  ModuleState state;
  unsigned long long storageBytes;
};

enum ModuleState {
  "running",
  "suspended",
  "error"
};
```

The `share()` method on PersonalGraph MUST:

1. If `options.module` is specified:
   1. Let *moduleHash* be the value of `options.module`.
   2. If the module identified by *moduleHash* is not installed, initiate the module installation flow (see [Section 9.1](#91-installation)).
   3. If the user denies installation, reject with a `NotAllowedError` DOMException.
2. If `options.module` is not specified, use the browser's default sync module.
3. Generate a globally unique graph identifier with at least 128 bits of entropy.
4. Construct the Graph URI from the relay endpoints, graph identifier, and module hash.
5. Initialise the sync module for this graph (call `init()`).
6. Call `connect()` on the module.
7. Return a SharedGraph object.

The `listModules()` method MUST return information about all installed sync modules, including their content hash, the number of graphs using them, their current state, and storage consumption.

### 5.2 SharedGraph

The `SharedGraph` interface extends `PersonalGraph` with peer-to-peer synchronisation capabilities.

```webidl
[Exposed=Window,Worker]
interface SharedGraph : PersonalGraph {
  readonly attribute USVString uri;
  readonly attribute USVString moduleHash;
  readonly attribute SyncState syncState;

  [NewObject] Promise<sequence<Peer>> peers();
  [NewObject] Promise<sequence<Peer>> onlinePeers();
  [NewObject] Promise<USVString> currentRevision();

  Promise<undefined> sendSignal(USVString remoteDid, BufferSource payload);
  Promise<undefined> sendSignalToSession(USVString remoteDid, USVString sessionId, BufferSource payload);
  Promise<undefined> broadcast(BufferSource payload);

  attribute EventHandler onpeerjoined;
  attribute EventHandler onpeerleft;
  attribute EventHandler onsyncstatechange;
  attribute EventHandler onsignal;
  attribute EventHandler ondiff;
};

dictionary Peer {
  USVString did;
  USVString sessionId;
  USVString? publicKey;
  USVString? deviceLabel;
  DOMTimeStamp? lastSeen;
  boolean online;
};
```

### 5.3 GraphDiff

```webidl
[Exposed=Window,Worker]
interface GraphDiff {
  readonly attribute USVString revision;
  readonly attribute FrozenArray<SignedTriple> additions;
  readonly attribute FrozenArray<SignedTriple> removals;
  readonly attribute FrozenArray<USVString> dependencies;
  readonly attribute USVString author;
  readonly attribute DOMTimeStamp timestamp;
};

dictionary SignedTriple {
  USVString source;
  USVString predicate;
  USVString target;
  USVString signature;
  USVString signer;
};
```

### 5.4 SyncState

```webidl
enum SyncState {
  "idle",
  "connecting",
  "syncing",
  "synced",
  "error"
};
```

- **"idle"**: The SharedGraph is not currently synchronising (e.g., no peers are connected, or the module is suspended).
- **"connecting"**: The sync module is establishing connections to relay servers or peers.
- **"syncing"**: The SharedGraph is actively exchanging diffs with peers.
- **"synced"**: The SharedGraph has converged with all known peers and no pending diffs remain.
- **"error"**: A sync error has occurred. The user agent SHOULD expose error details via a `SyncErrorEvent`.

### 5.5 ValidationResult

```webidl
dictionary ValidationResult {
  required boolean accepted;
  USVString? module;
  USVString? constraintId;
  USVString? reason;
};
```

The `ValidationResult` is returned by the sync module's `validate()` method. If `accepted` is `false`, the `module`, `constraintId`, and `reason` fields SHOULD be populated to identify the rejecting constraint and provide a human-readable explanation.

---

## 6. Sync Modules

### 6.1 Overview

A **sync module** is a content-addressed WebAssembly bundle that implements the `GraphSyncModule` interface (Section 7). Each shared graph specifies its sync module via the `module` parameter in the Graph URI:

```
graph://relay.example.com/graph-id?module=sha256-<content-hash>
```

The sync module is the **sovereignty boundary** of a shared graph. It is the one component that all peers MUST agree on and execute. The module determines:

- **Transport**: How diffs are transmitted between peers (WebTransport, WebRTC, custom protocol)
- **Merge strategy**: How concurrent changes are reconciled (CRDT, OT, custom)
- **Peer discovery**: How peers find each other (relay-based, DHT, mDNS, custom)
- **Governance validation**: What rules govern who can contribute what (ZCAP, VC, custom)

All peers in a shared graph MUST run the same sync module, verified by content hash. A peer running a different module (different hash) is effectively participating in a different graph.

### 6.2 Content Addressing

Sync modules are identified by the SHA-256 hash of their WASM binary:

```
content-hash = "sha256-" + hex(SHA-256(wasm-binary))
```

The user agent MUST verify the content hash of any downloaded module before installation. If the hash does not match, the module MUST be rejected and the installation MUST fail.

Content addressing provides:

- **Integrity**: The binary has not been tampered with.
- **Identity**: All peers verifiably run the same code.
- **Cacheability**: Modules with the same hash are identical and can be cached indefinitely.

### 6.3 Module Distribution

Sync modules MAY be distributed via any content-addressable storage system, including but not limited to:

- HTTPS endpoints (e.g., `https://modules.example.com/sha256-abc123.wasm`)
- IPFS / content-addressed networks
- Relay servers (modules can be requested from the relay specified in the Graph URI)
- Out-of-band transfer (copied manually)

The user agent SHOULD attempt to retrieve the module from the relay endpoint(s) specified in the Graph URI. The relay SHOULD serve module binaries at a well-known path:

```
https://<relay>/modules/<content-hash>.wasm
```

If the module cannot be retrieved, the `join()` method MUST reject with a `NetworkError` DOMException.

### 6.4 Module Execution Environment

Sync modules execute in the **browser process** (not the renderer process). This means:

- Modules persist across tab navigations and browser restarts.
- Modules are not tied to any origin, page, or worker.
- Multiple pages from different origins can interact with the same shared graph through the same module instance.

The module runs inside a WebAssembly sandbox with capability-scoped permissions (see Section 8). The module has NO access to:

- The DOM or any renderer process state
- Other graphs or their data
- The filesystem
- Arbitrary network endpoints (only endpoints granted by capabilities)
- User data, cookies, local storage, or other browser storage
- Other sync modules

### 6.5 User Consent

Installing a sync module is a privileged operation. The user agent MUST obtain explicit user consent before installing a new sync module. The consent flow SHOULD be analogous to Service Worker registration or extension installation:

1. The user agent MUST display a prompt identifying:
   - The content hash of the module
   - The capabilities the module requests (see Section 8)
   - The graph(s) that will use the module
   - The relay endpoint(s)
2. The user MUST explicitly approve ("Allow") or deny ("Deny") installation.
3. If the user denies, the `join()` or `share()` call MUST reject with a `NotAllowedError` DOMException.
4. The user agent SHOULD remember the user's decision for subsequent encounters with the same module hash.

### 6.6 Module Management UI

The user agent SHOULD provide a management interface for sync modules, analogous to "Manage Extensions" or "Manage Site Data". This interface SHOULD allow users to:

- View all installed sync modules with their content hash, name (if provided), and status
- See which shared graphs use each module
- View resource consumption (memory, network, storage) per module
- Pause and resume individual modules
- Remove modules (which disconnects from all graphs using that module)
- View the capabilities granted to each module

---

## 7. GraphSyncModule Interface

### 7.1 Overview

The `GraphSyncModule` interface defines the contract that all sync modules MUST implement. The interface is defined in WebAssembly Interface Types (WIT) and exposed as WASM exports.

### 7.2 Interface Definition

```webidl
// This is the conceptual interface. The actual binding is via WASM exports.
// Each method corresponds to a named WASM export function.

interface GraphSyncModule {
  // ── Lifecycle ──────────────────────────────────────────────
  
  undefined init(ModuleConfig config);
  undefined shutdown();
  
  // ── Transport ──────────────────────────────────────────────
  
  undefined connect(USVString graphUri, USVString localDid);
  undefined disconnect();
  
  // ── Sync ───────────────────────────────────────────────────
  
  Revision commit(GraphDiff diff);
  undefined onRemoteDiff(RemoteDiffCallback callback);
  undefined requestSync(USVString fromRevision);
  
  // ── Peer Management ────────────────────────────────────────
  
  sequence<Peer> peers();
  sequence<Peer> onlinePeers();
  
  // ── Signalling (Ephemeral) ─────────────────────────────────
  
  undefined sendSignal(USVString remoteDid, bytes payload);
  undefined onSignal(SignalCallback callback);
  
  // ── Governance Validation ──────────────────────────────────
  
  ValidationResult validate(GraphDiff diff, USVString author, GraphReader graphState);
  
  // ── Peer Discovery ─────────────────────────────────────────
  
  sequence<Peer> discoverPeers(USVString graphUri);
};

callback RemoteDiffCallback = ValidationResult (GraphDiff diff);
callback SignalCallback = undefined (USVString remoteDid, bytes payload);
```

### 7.3 ModuleConfig

```webidl
dictionary ModuleConfig {
  USVString graphUri;
  USVString localDid;
  GraphWriter graphWriter;
  GraphReader graphReader;
  CryptoProvider crypto;
  NetworkProvider network;
  unsigned long long maxMemoryBytes;
};
```

The `ModuleConfig` is passed to `init()` and provides the module with capability handles for interacting with the browser's graph store, cryptographic key store, and network stack.

### 7.4 GraphReader

```webidl
interface GraphReader {
  sequence<SignedTriple> query(TripleQuery query);
  USVString? resolveExpression(USVString address);
  unsigned long long tripleCount();
  USVString currentRevision();
};
```

The `GraphReader` provides read-only access to the graph's current state. The sync module uses this for governance validation (inspecting the current graph to validate incoming diffs) and for computing sync state.

### 7.5 GraphWriter

```webidl
interface GraphWriter {
  undefined applyDiff(GraphDiff diff);
  undefined rejectDiff(GraphDiff diff, USVString reason);
};
```

The `GraphWriter` provides write access to the graph. The sync module uses this to apply validated remote diffs to the local graph store.

### 7.6 CryptoProvider

```webidl
interface CryptoProvider {
  bytes sign(bytes data);
  boolean verify(USVString did, bytes data, bytes signature);
  USVString localDid();
  bytes publicKey();
};
```

The `CryptoProvider` grants scoped access to the browser's cryptographic key store. The module can request Ed25519 signatures using the local agent's key and verify signatures from other agents.

### 7.7 NetworkProvider

```webidl
interface NetworkProvider {
  WebTransportSession connectWebTransport(USVString url);
  QUICConnection connectQUIC(USVString host, unsigned short port);
};
```

The `NetworkProvider` grants scoped network access. The module can only establish connections using the protocols and endpoints permitted by its capabilities (see Section 8).

### 7.8 Method Specifications

#### 7.8.1 init(config)

Called once when the module is first associated with a graph. The module MUST:

1. Store the config for later use.
2. Initialise any internal state (CRDT state, peer lists, message queues).
3. NOT establish network connections (that happens in `connect()`).

#### 7.8.2 shutdown()

Called when the module is being removed or the graph is being left. The module MUST:

1. Close all network connections.
2. Flush any pending state to the graph writer.
3. Release all resources.

#### 7.8.3 connect(graphUri, localDid)

Called to begin synchronisation. The module MUST:

1. Parse the graph URI to extract relay endpoints and graph identifier.
2. Establish transport connections to relay(s) or peers.
3. Announce the local peer to the network.
4. Begin receiving and processing remote diffs.

#### 7.8.4 disconnect()

Called to pause or stop synchronisation. The module MUST:

1. Announce departure to connected peers.
2. Close all transport connections.
3. Retain local state for potential reconnection.

#### 7.8.5 commit(diff)

Called when the local agent produces a new diff. The module MUST:

1. Call `validate(diff, localDid, graphState)` on the diff. If validation fails, the module MUST NOT distribute the diff and MUST return the rejection reason.
2. Assign a revision identifier to the diff.
3. Apply the diff to the local graph via `graphWriter.applyDiff(diff)`.
4. Distribute the diff to connected peers via the transport.
5. Return the revision.

#### 7.8.6 onRemoteDiff(callback)

Registers the callback that the browser invokes when the module receives a remote diff. The module calls this internally; the browser binds the callback during initialisation.

When the module receives a remote diff from the network, it MUST:

1. Verify causal dependencies are satisfied. If not, buffer the diff.
2. Call `validate(diff, author, graphState)`. If validation fails, discard the diff and do NOT propagate it.
3. Apply the diff via `graphWriter.applyDiff(diff)`.
4. Invoke the registered callback so the browser can dispatch events to pages.
5. Forward the diff to other connected peers (gossip).

#### 7.8.7 requestSync(fromRevision)

Called to request a full sync from peers starting from a given revision. Used for catch-up after reconnection or initial join.

The module MUST:

1. Send a sync request to connected peers specifying the starting revision.
2. Process the response diffs in causal order.
3. Validate and apply each diff.

#### 7.8.8 validate(diff, author, graphState)

Called to validate a diff before it is applied or propagated. This is the **governance enforcement point**.

The module MUST:

1. Verify the cryptographic signatures of all triples in the diff.
2. Apply any governance rules defined by the module's implementation.
3. Return a `ValidationResult` indicating acceptance or rejection.

The `graphState` parameter provides read-only access to the current graph, enabling the module to inspect governance constraints, capability tokens, credentials, and other state needed for validation.

If `validate()` returns `{ accepted: false }`, the diff MUST NOT be applied and MUST NOT be propagated to other peers.

#### 7.8.9 peers() / onlinePeers()

Return the full set of known peers and the currently connected subset, respectively.

#### 7.8.10 sendSignal(remoteDid, payload) / onSignal(callback)

Send and receive ephemeral signals. Signals are NOT persisted in the graph, NOT included in diffs, and NOT subject to governance validation. They are transient messages for out-of-band coordination (cursor positions, typing indicators, WebRTC negotiation, etc.).

#### 7.8.11 discoverPeers(graphUri)

Actively discover peers for a graph. The module MAY use any mechanism: relay queries, DHT lookups, mDNS broadcasts, etc.

---

## 8. Module Capabilities

### 8.1 Capability Model

Sync modules run in a capability-scoped WASM sandbox. The browser grants a specific set of capabilities to each module at installation time. The module can only access system resources through these capabilities.

Capabilities are **scoped to the module and graph**, not global. A module installed for graph A cannot access resources granted to a module for graph B.

### 8.2 Defined Capabilities

The following capabilities are defined:

| Capability | Description | Scope |
|-----------|-------------|-------|
| `network:webtransport` | Establish WebTransport sessions to specified endpoints | Endpoints derived from Graph URI relay list |
| `network:quic` | Establish raw QUIC connections to specified endpoints | Endpoints derived from Graph URI relay list |
| `storage:graph-read` | Read triples from this graph's store | This graph only |
| `storage:graph-write` | Write diffs to this graph's store | This graph only |
| `crypto:sign` | Request Ed25519 signatures from the browser's key store | Local agent's key only |
| `crypto:verify` | Verify Ed25519 signatures | Any public key |

### 8.3 Denied Access

Sync modules MUST NOT have access to:

- The DOM or any renderer process state
- Other shared graphs or personal graphs
- The filesystem or origin-scoped storage (IndexedDB, localStorage, cookies)
- Arbitrary network endpoints not derived from the Graph URI
- Network protocols other than WebTransport and QUIC
- User data, browsing history, bookmarks, or extensions
- Other sync modules or their state
- System APIs (geolocation, camera, microphone, clipboard, etc.)

### 8.4 Resource Limits

The user agent MUST enforce resource limits on sync modules:

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| Memory | Configurable per module (default: 64 MB) | WASM linear memory limit; module terminated if exceeded |
| CPU | Configurable (default: 10% of one core) | Throttled; excess computation yields to other work |
| Network bandwidth | Configurable (default: 1 MB/s sustained) | Throttled; excess traffic queued |
| Storage | Bounded by graph storage quota | Module cannot allocate storage beyond graph's quota |
| Open connections | Maximum 16 simultaneous transport sessions | Excess connection attempts rejected |

The user agent SHOULD surface resource consumption in the Module Management UI (Section 6.6).

### 8.5 Capability Declaration

Sync modules SHOULD include a capability declaration in their WASM custom section (`sync-module-meta`), specifying:

```json
{
  "name": "Default Graph Sync",
  "version": "1.0.0",
  "capabilities": [
    "network:webtransport",
    "storage:graph-read",
    "storage:graph-write",
    "crypto:sign",
    "crypto:verify"
  ],
  "description": "CRDT-based sync via WebTransport relays"
}
```

This metadata is informational — the browser enforces capabilities regardless of the declaration. However, the declaration enables the consent prompt (Section 6.5) to show the user what the module requests.

---

## 9. Module Lifecycle

### 9.1 Installation

Module installation is triggered by:

- `graph.share({ module: "<content-hash>" })` — when creating a new shared graph with a custom module
- `navigator.graph.join("graph://...?module=<content-hash>")` — when joining a graph that specifies a module

The installation algorithm:

1. Let *hash* be the content hash from the Graph URI or share options.
2. If a module with *hash* is already installed, skip to step 8.
3. Attempt to download the module binary:
   1. For each relay endpoint in the Graph URI, attempt `GET https://<relay>/modules/<hash>.wasm`.
   2. If all relay attempts fail, attempt any configured module registries.
   3. If all attempts fail, reject with `NetworkError`.
4. Compute `SHA-256(downloaded-binary)` and verify it matches *hash*.
5. If the hash does not match, reject with `SecurityError`.
6. Validate that the binary is a valid WebAssembly module with the required exports.
7. Display the user consent prompt (Section 6.5). If denied, reject with `NotAllowedError`.
8. Instantiate the module in the sandbox with appropriate capabilities.
9. The module is now installed and ready for use.

### 9.2 Verification

The user agent MUST verify the content hash of every module:

- At download time (before installation)
- At load time (when loading from cache after browser restart)
- Periodically (RECOMMENDED: at least once per browser session)

If verification fails at any point, the user agent MUST:

1. Immediately terminate the module.
2. Disconnect all graphs using the module.
3. Set the sync state of affected graphs to `"error"`.
4. Notify the user via the Module Management UI.
5. Attempt to re-download and re-verify the module.

### 9.3 Update

When a peer encounters a graph URI with a different module hash than the currently installed module, the user agent MUST:

1. Treat this as a new module installation (Section 9.1).
2. If the user approves the new module:
   1. Call `shutdown()` on the old module instance for this graph.
   2. Install and initialise the new module.
   3. Call `connect()` on the new module.
   4. Call `requestSync("genesis")` to resynchronise from the beginning (since the new module may have different merge semantics).
3. If the user denies the new module, the graph continues with the old module. Note that this may cause sync divergence with peers running the new module.

### 9.4 Removal

A module is removed when:

- The user explicitly removes it via the Module Management UI, OR
- All shared graphs using the module have been left

The removal algorithm:

1. Call `shutdown()` on the module instance.
2. Disconnect all graphs using this module.
3. Delete the module binary from cache.
4. Reclaim sandbox resources.

Graph data is NOT deleted when a module is removed. The SharedGraph's local data persists and remains accessible as a read-only PersonalGraph, consistent with the semantics defined in Section 18.3.

### 9.5 Suspension

The user agent MAY suspend a module under resource pressure:

- Low battery conditions
- Metered network connections
- Memory pressure
- User-configured preferences

When suspending a module:

1. Call `disconnect()` on the module (allowing graceful connection teardown).
2. Serialise the module's WASM memory state to persistent storage.
3. Set the sync state of affected graphs to `"idle"`.
4. Release sandbox resources.

When resuming:

1. Restore the module's WASM memory state.
2. Call `connect()` to re-establish transport.
3. Call `requestSync(lastKnownRevision)` to catch up.
4. Set the sync state of affected graphs to `"syncing"`.

---

## 10. Default Sync Module

### 10.1 Requirement

A conforming user agent MUST ship with a built-in default sync module. The default module is used when:

- `graph.share()` is called without specifying a `module` option
- A Graph URI omits the `module` parameter

The default module MUST be available without download, user consent prompts, or network access. It is part of the browser, not a third-party module.

### 10.2 Default Module Characteristics

The default sync module implements:

| Concern | Strategy |
|---------|----------|
| **Transport** | WebTransport [[WEBTRANSPORT]] over QUIC to relay servers |
| **Merge** | Add-wins Observed-Remove Set (OR-Set) CRDT for triples |
| **Peer discovery** | Relay-based: peers connect to relay, relay groups by graph URI |
| **Governance** | Full governance engine per [[GRAPH-GOVERNANCE]]: ZCAP chain verification, VC credential checking, temporal constraints, content constraints |
| **NAT traversal** | Relay-mediated: all traffic flows through relay, works through any NAT configuration |
| **Conflict resolution** | Deterministic: add-wins for concurrent add/remove of same triple |
| **Causal ordering** | Revision dependency DAG |

### 10.3 Default Module Conformance

The default sync module MUST satisfy all of the following:

1. Implement the complete `GraphSyncModule` interface (Section 7).
2. Guarantee eventual consistency: given the same set of diffs, all peers converge to the same graph state regardless of reception order.
3. Enforce causal ordering: a diff is not applied until all its dependencies are satisfied.
4. Implement the governance validation algorithms defined in [[GRAPH-GOVERNANCE]], including:
   - Scope resolution (walking the entity hierarchy)
   - ZCAP chain verification (delegation chains up to depth 10)
   - Credential requirement checking
   - Temporal constraint enforcement
   - Content constraint enforcement
5. Support the wire protocol defined in Section 11.
6. Support the relay protocol defined in Section 12.

---

## 11. Wire Protocol (Default Module)

### 11.1 Overview

This section defines the wire protocol used by the default sync module. Custom sync modules are NOT required to use this protocol — they define their own.

All messages are serialised as CBOR [[RFC8949]] and transmitted over WebTransport streams.

### 11.2 Message Types

The default module defines the following message types:

| Type Code | Name | Direction | Description |
|-----------|------|-----------|-------------|
| `0x01` | `DIFF` | Bidirectional | A new diff to be applied |
| `0x02` | `SYNC_REQ` | Client → Peer | Request diffs from a given revision |
| `0x03` | `SYNC_RESP` | Peer → Client | Response containing requested diffs |
| `0x04` | `SIGNAL` | Bidirectional | Ephemeral signal (not persisted) |
| `0x05` | `PEER_JOIN` | Bidirectional | Announce a new peer |
| `0x06` | `PEER_LEAVE` | Bidirectional | Announce a departing peer |
| `0x07` | `GOVERNANCE` | Bidirectional | Governance rule changes (propagated via sync like any diff, but typed for priority routing) |

### 11.3 Message Formats

#### 11.3.1 DIFF

```
DIFF {
  type: 0x01,
  revision: bytes(32),           // SHA-256 hash
  author: string,                // DID of the diff author
  timestamp: uint64,             // Unix timestamp (milliseconds)
  additions: [SignedTriple],     // Array of signed triples to add
  removals: [SignedTriple],      // Array of signed triples to remove
  dependencies: [bytes(32)]      // Array of revision hashes this diff depends on
}

SignedTriple {
  source: string,                // Subject URI
  predicate: string,             // Predicate URI
  target: string,                // Object URI or literal
  signature: bytes(64),          // Ed25519 signature
  signer: string                 // DID of the signer
}
```

#### 11.3.2 SYNC_REQ

```
SYNC_REQ {
  type: 0x02,
  fromRevision: bytes(32),       // Request diffs after this revision
  maxDiffs: uint32               // Maximum number of diffs to return (0 = no limit)
}
```

If `fromRevision` is all zeros (`0x00` × 32), the request is for a full sync from genesis.

#### 11.3.3 SYNC_RESP

```
SYNC_RESP {
  type: 0x03,
  diffs: [DIFF],                 // Array of DIFF messages in causal order
  hasMore: bool                  // Whether more diffs are available
}
```

#### 11.3.4 SIGNAL

```
SIGNAL {
  type: 0x04,
  senderDid: string,             // DID of the sender
  recipientDid: string,          // DID of the recipient ("*" for broadcast)
  payload: bytes                 // Arbitrary payload (max 64 KB)
}
```

#### 11.3.5 PEER_JOIN

```
PEER_JOIN {
  type: 0x05,
  did: string,                   // DID of the joining peer
  sessionId: string,             // Unique session identifier (tab/device)
  publicKey: bytes(32),          // Ed25519 public key
  deviceLabel: string?,          // Optional human-readable device label
  timestamp: uint64              // Join timestamp
}
```

A single DID MAY have multiple concurrent PEER_JOIN messages with different session IDs. Each represents a distinct session (tab or device) for the same user.

#### 11.3.6 PEER_LEAVE

```
PEER_LEAVE {
  type: 0x06,
  did: string,                   // DID of the departing peer
  sessionId: string,             // Session that is leaving
  timestamp: uint64              // Leave timestamp
}
```

#### 11.3.7 GOVERNANCE

```
GOVERNANCE {
  type: 0x07,
  diff: DIFF                     // A DIFF containing governance constraint triples
}
```

Governance messages are structurally identical to DIFF messages but are typed separately so that relay servers and peers can prioritise their delivery. Governance diffs propagate via the same sync mechanism as content diffs but SHOULD be processed before content diffs when received simultaneously.

### 11.4 Message Size Limits

| Message Type | Maximum Size |
|-------------|-------------|
| DIFF | 1 MB |
| SYNC_REQ | 256 bytes |
| SYNC_RESP | 16 MB |
| SIGNAL | 64 KB |
| PEER_JOIN | 1 KB |
| PEER_LEAVE | 256 bytes |
| GOVERNANCE | 1 MB |

Messages exceeding these limits MUST be rejected by the receiver.

### 11.5 Framing

Each message is framed with a 4-byte big-endian length prefix followed by the CBOR-encoded message body:

```
[length: uint32-be][body: CBOR]
```

---

## 12. Relay Protocol

### 12.1 Overview

A relay server facilitates message passing between peers participating in the same shared graph. The relay protocol is intentionally simple — relays are dumb pipes, not authorities. Anyone can run a relay.

### 12.2 Connection

Peers connect to relay servers via WebTransport [[WEBTRANSPORT]] using the following URL scheme:

```
https://<relay-host>/graph/<graph-id>
```

Where `<relay-host>` is the relay hostname from the Graph URI and `<graph-id>` is the graph identifier.

Upon connection, the peer MUST send a `PEER_JOIN` message to identify itself. The relay MUST forward this message to all other peers connected to the same graph.

### 12.3 Message Forwarding

The relay operates as a message broker:

1. When a peer sends a message (DIFF, SIGNAL, GOVERNANCE, etc.), the relay MUST forward it to all other peers connected to the same graph identifier.
2. The relay MUST NOT modify message content.
3. The relay MUST NOT inspect message content beyond the type code (needed for prioritisation).
4. The relay MUST NOT reject messages based on content (it has no authority over graph data).
5. The relay MAY prioritise GOVERNANCE messages over DIFF messages.

### 12.4 Peer Grouping

The relay groups connections by graph identifier:

1. When a peer connects to `/graph/<id>`, the relay adds the connection to the group for `<id>`.
2. Messages sent by any peer in the group are forwarded to all other peers in the group.
3. When a peer disconnects, the relay MUST send a `PEER_LEAVE` message to all remaining peers in the group.
4. Groups are created implicitly on first connection and destroyed when the last peer disconnects.

### 12.5 Diff Retention

The relay MAY store recent diffs for catch-up purposes:

1. When a relay stores diffs, it MUST respond to `SYNC_REQ` messages from newly connecting peers.
2. The retention period is configurable by the relay operator. The relay SHOULD retain at least the most recent 1000 diffs or 24 hours of diffs, whichever is less.
3. Stored diffs are served in causal order via `SYNC_RESP` messages.
4. The relay MUST NOT modify stored diffs.

Relay-side diff retention is OPTIONAL. Peers MUST NOT rely on relay retention for durability — the local graph store is the authoritative copy.

### 12.6 Relay Authority

The relay has **no authority** over graph data:

- The relay cannot modify, reject, or filter diffs.
- The relay cannot read diff content (beyond the type code for routing).
- The relay cannot impersonate peers (peers authenticate via DID signatures).
- The relay cannot determine graph membership (it only knows which connections are grouped).

If a relay behaves maliciously (dropping messages, modifying content), peers can detect this through:

- Missing diffs (detected during sync catch-up with other peers)
- Invalid signatures (detected by receivers)
- Peer presence inconsistency (detected via direct peer-to-peer verification)

Peers SHOULD connect to multiple relays for resilience.

### 12.7 Multiple Relays

A Graph URI MAY specify multiple relay endpoints:

```
graph://relay1.example.com,relay2.example.com/graph-id?module=sha256-abc
```

The sync module SHOULD connect to all specified relays simultaneously. Messages are sent to all relays and deduplicated by revision hash on receipt. This provides:

- **Resilience**: If one relay goes down, sync continues via others.
- **Censorship resistance**: No single relay can block a peer.
- **Performance**: Peers discover each other faster.

### 12.8 Relay Implementation Requirements

A conforming relay MUST:

1. Accept WebTransport connections at `https://<host>/graph/<id>`.
2. Forward messages between peers in the same graph group.
3. Send `PEER_LEAVE` messages when peers disconnect.
4. Serve module binaries at `https://<host>/modules/<hash>.wasm` (if hosting modules).

A conforming relay SHOULD:

1. Implement diff retention for catch-up.
2. Rate-limit connections per IP and per graph to prevent abuse.
3. Support TLS 1.3 for transport security.
4. Log connection metadata (not message content) for operational purposes.

The relay protocol is simple enough that a minimal implementation requires only:

- A WebTransport server
- A map from graph ID to connected peer set
- Message forwarding logic

---

## 13. Peer Discovery

### 13.1 Relay-Based Discovery (Default)

The default peer discovery mechanism is relay-based:

1. The Graph URI encodes one or more relay endpoints.
2. A peer connects to the relay(s) and sends `PEER_JOIN`.
3. The relay forwards `PEER_JOIN` to all other connected peers.
4. Each peer maintains a local peer list based on `PEER_JOIN` and `PEER_LEAVE` messages.

This mechanism requires no additional infrastructure. Any peer that can reach a relay can discover all other peers connected to the same graph.

### 13.2 DHT-Based Discovery (Optional)

Custom sync modules MAY implement DHT-based peer discovery for relay-less operation:

1. The module publishes the local peer's DID and connection information to a distributed hash table, keyed by the graph identifier.
2. Other peers query the DHT with the graph identifier to discover peers.
3. Once peers are discovered, direct connections can be established.

The specification does NOT mandate a specific DHT implementation. Modules MAY use Kademlia, Chord, or any other DHT that satisfies their requirements.

### 13.3 Local Network Discovery (Optional)

Custom sync modules MAY implement mDNS-based peer discovery for local network synchronisation:

1. The module broadcasts an mDNS service record advertising the graph identifier and the local peer's connection information.
2. Other peers on the same local network discover the advertisement and establish direct connections.
3. This enables zero-configuration sync on LANs without internet connectivity.

### 13.4 Discovery Extensibility

The sync module architecture allows arbitrary discovery mechanisms:

- QR code exchange (out-of-band URI sharing)
- Bluetooth Low Energy advertisements
- NFC tap-to-share
- DNS-based service discovery
- Social graph traversal

The specification does NOT constrain discovery mechanisms. Modules decide what works for their use case.

---

## 14. NAT Traversal

### 14.1 Default Module: Relay-Mediated

The default sync module uses relay-mediated NAT traversal:

1. All traffic between peers flows through the relay server.
2. Peers do not establish direct connections.
3. This works through any NAT configuration (symmetric NAT, CGNAT, firewalls) because the peer only needs outbound connectivity to the relay.

This approach trades latency and bandwidth for universal connectivity. The relay adds a single hop to all traffic.

### 14.2 Custom Modules: Direct Connections

Custom sync modules MAY implement direct peer-to-peer connections with NAT traversal:

1. **ICE-like hole punching**: The module uses the relay as a signalling channel to exchange connection candidates, then attempts direct QUIC connections through NAT.
2. **TURN-style relay fallback**: If direct connection fails, the module falls back to relay-mediated traffic.
3. **Port mapping (UPnP/PCP)**: The module requests port mappings from the local NAT gateway.

### 14.3 No Prescribed Strategy

The specification does NOT prescribe a specific NAT traversal strategy. The sync module decides based on its deployment context:

- Modules for mobile/constrained devices SHOULD use relay-mediated traffic (simpler, more reliable).
- Modules for desktop/server environments MAY implement direct connections (lower latency, less relay dependency).
- Modules for local-network-only use cases MAY skip NAT traversal entirely (mDNS discovery + direct LAN connections).

---

## 15. Merge Semantics (Default Module)

### 15.1 CRDT Choice

The default sync module uses an **Add-wins Observed-Remove Set (OR-Set)** CRDT for triples. This provides:

- Deterministic conflict resolution
- Commutative and associative merge
- Eventual consistency guarantee
- Tolerance of message reordering and duplication

### 15.2 Triple Identity

Each triple has a unique identity computed as:

```
triple-id = SHA-256(source || predicate || target || author-did || timestamp)
```

This means the same `(source, predicate, target)` content authored by different agents or at different times produces different triple identities. This is intentional — it allows multiple agents to independently assert the same fact.

### 15.3 Add Operation

To add a triple:

1. The agent signs the triple with their Ed25519 key.
2. The signed triple is included in a GraphDiff's `additions` array.
3. The triple is inserted into the OR-Set.
4. The triple's identity is recorded in the set's add-set.

### 15.4 Remove Operation

To remove a triple:

1. The agent signs a removal for the triple with their Ed25519 key.
2. The signed removal is included in a GraphDiff's `removals` array.
3. The triple's identity is added to the set's remove-set (tombstone).
4. The triple is marked as removed but NOT deleted from storage.

### 15.5 Concurrent Add and Remove

When concurrent (causally independent) operations produce both an add and a remove for the same triple identity:

- **Add wins.** The triple is present in the final state.

This is the OR-Set's defining property. It ensures that data is not accidentally lost due to concurrent operations. If removal is intended, the removing agent must re-issue the removal after observing the concurrent add.

### 15.6 Causal Ordering

Diffs are causally ordered via revision dependencies:

1. Each diff declares its dependencies — the set of revision hashes it was produced "on top of".
2. A diff MUST NOT be applied until all its dependencies have been applied.
3. Dependencies form a Directed Acyclic Graph (DAG) of revisions.
4. The DAG enables efficient sync: peers exchange missing revisions by traversing the DAG from their last known common point.

### 15.7 Convergence Guarantee

The OR-Set CRDT guarantees that:

> Given any two peers that have received the same set of diffs (regardless of order), their graph states are identical.

Proof sketch: The OR-Set merge function is commutative, associative, and idempotent. Applying the same set of add/remove operations in any order produces the same result. Causal ordering ensures that dependency relationships are respected, but the CRDT converges regardless of operation order within a causal generation.

### 15.8 Tombstone Management

Tombstones (remove-set entries) accumulate over time. The default module SHOULD implement tombstone garbage collection:

1. A tombstone MAY be garbage-collected after all peers have acknowledged the revision containing the removal.
2. A tombstone MUST NOT be garbage-collected if any peer may not yet have received it (this would cause the removed triple to reappear).
3. Implementations SHOULD track peer sync state to determine when garbage collection is safe.
4. As a conservative default, tombstones SHOULD be retained for at least 30 days.

---

## 16. Governance Integration

### 16.1 The Sovereignty Boundary

The sync module's `validate()` method is the **governance enforcement point** for a shared graph. It is the one place where rules are checked, and it runs identically on all peers. This makes the sync module the sovereignty boundary — the component that defines what is and is not permitted in the graph.

### 16.2 Validation Flow

When a diff arrives (either from the local agent or from a remote peer), the following validation flow occurs:

1. The sync module receives the diff.
2. The module calls `validate(diff, author, graphState)`.
3. The `validate()` method receives:
   - **diff**: The GraphDiff containing additions and removals.
   - **author**: The DID of the agent who produced the diff.
   - **graphState**: A `GraphReader` providing read-only access to the current graph state.
4. The module inspects the graph state for governance constraints (e.g., `governance://` predicates per [[GRAPH-GOVERNANCE]]).
5. The module evaluates each triple in the diff against applicable constraints.
6. If all triples pass validation, `validate()` returns `{ accepted: true }`.
7. If any triple fails validation, `validate()` returns `{ accepted: false, module: "...", constraintId: "...", reason: "..." }`.

### 16.3 Rejected Diffs

When a diff is rejected:

1. The diff MUST NOT be applied to the local graph.
2. The diff MUST NOT be forwarded to other peers.
3. If the diff was produced locally, the `commit()` method MUST return the rejection reason.
4. If the diff was received remotely, the module SHOULD log the rejection for debugging.

### 16.4 Default Module Governance

The default sync module implements the full governance specification defined in [[GRAPH-GOVERNANCE]]. This includes:

1. **Scope resolution**: Walking the entity hierarchy to determine which constraints apply to a given triple (ancestry chain, scope inheritance, precedence rules).
2. **Capability verification (ZCAP)**: Verifying that the diff author holds a valid Authorization Capability chain for the triple's predicate and scope.
3. **Credential verification (VC)**: Checking that the diff author holds required Verifiable Credentials.
4. **Temporal verification**: Enforcing rate limits (minimum intervals, maximum counts per window).
5. **Content verification**: Validating triple targets against content constraints (length limits, blocked patterns, URL policies, media type restrictions).

The default module evaluates constraints in the order listed above (cheapest first) and stops at the first rejection.

### 16.5 Custom Module Governance

Custom sync modules implement whatever governance logic they want. A module MAY:

- Implement a subset of [[GRAPH-GOVERNANCE]] (e.g., only ZCAP, no content constraints).
- Implement entirely different governance models (voting, reputation, proof-of-work, etc.).
- Implement no governance at all (permissive — any signed diff is accepted).
- Implement governance models that don't yet exist.

The specification does NOT constrain governance implementations. The sync module is sovereign.

### 16.6 Governance Rule Propagation

Governance rules are graph data — triples with `governance://` predicates stored in the same graph they govern. Changes to governance rules propagate via the same sync protocol as content changes:

1. An authorised agent adds or removes governance triples.
2. The triples are included in a GraphDiff.
3. The diff is validated and distributed.
4. All peers receive the governance changes and enforce them.

The default module types governance diffs as `GOVERNANCE` messages (Section 11.2) for priority routing, but structurally they are ordinary diffs.

### 16.7 Consensus Enforcement

Because all peers run the same sync module (verified by content hash):

- The same diff evaluated against the same graph state produces the same validation result on every peer.
- A triple rejected by one honest peer will be rejected by all honest peers.
- No application, UI, or agent can bypass governance — the sync module is the enforcement point, and it runs below the application layer.

This is the fundamental security property of the architecture. The application layer is cosmetic. The sync module is authoritative.

---

## 17. Background Operation

### 17.1 Browser Process Execution

Sync modules run in the browser process, NOT in page or worker context. This provides:

- **Persistence**: Modules continue running when tabs are closed, navigated, or the user switches to a different application.
- **Independence**: No origin or page owns the sync module. It serves all pages that access the graph.
- **Background sync**: Incoming diffs are applied to the graph store in the background. When a page opens a graph, data is already current.

### 17.2 Persistent Connections

The user agent SHOULD maintain WebTransport connections to relay servers even when no tabs or pages are accessing a shared graph. This enables:

- Real-time sync in the background
- Instant data availability when a page opens a graph
- Push-style updates without polling

### 17.3 Resource Throttling

The user agent SHOULD throttle background sync under resource constraints:

| Condition | Throttling |
|-----------|-----------|
| Battery below 20% | Reduce sync frequency to every 5 minutes |
| Battery below 10% | Suspend all sync modules; resume on charge |
| Metered network | Reduce sync frequency; defer large diffs |
| Memory pressure | Suspend least-recently-used modules |
| User preference "Low Data Mode" | Sync on explicit request only |

### 17.4 Sync Status UI

The user agent SHOULD provide UI showing sync status per graph:

- Graph name and URI
- Current sync state (idle, connecting, syncing, synced, error)
- Number of online peers
- Last sync timestamp
- Bandwidth consumed
- Pending diffs (outgoing changes not yet acknowledged)

This UI SHOULD be accessible from the browser's settings or toolbar, analogous to download manager or notification settings.

### 17.5 Service Worker Integration

Sync events MUST be deliverable to Service Workers registered for the origin that created or joined the graph.

When a GraphDiff is received while no documents are open, the user agent MUST dispatch a `SyncEvent` to the active Service Worker, enabling offline processing of incoming changes.

```webidl
[Exposed=ServiceWorker]
interface SyncEvent : ExtendableEvent {
  readonly attribute USVString sharedGraphURI;
  readonly attribute GraphDiff diff;
};
```

### 17.6 Wake-on-Diff

The user agent MAY implement wake-on-diff for suspended modules:

1. The relay server sends a lightweight push notification (e.g., Web Push) when a new diff is available for a graph.
2. The user agent wakes the relevant sync module.
3. The module connects, syncs, and processes the diff.
4. The module returns to suspended state.

This enables battery-efficient background sync without persistent connections.

---

## 18. Publishing and Joining

### 18.1 Publishing

Publishing converts a PersonalGraph into a SharedGraph by associating it with a sync module and making it discoverable by peers.

The `share()` method on PersonalGraph MUST:

1. Determine the sync module:
   1. If `options.module` is specified, use that module (install if necessary per Section 9.1).
   2. If `options.module` is not specified, use the default sync module.
2. Determine relay endpoints:
   1. If `options.relays` is specified, use those relays.
   2. If `options.relays` is not specified, the user agent SHOULD use a default relay. Implementations MAY operate their own default relays or prompt the user.
3. Generate a globally unique graph identifier with at least 128 bits of entropy.
4. Construct the Graph URI: `graph://<relays>/<id>?module=<hash>`.
5. Call `init()` on the sync module with a `ModuleConfig` containing the graph URI and local DID.
6. Call `connect()` on the sync module.
7. Return a SharedGraph object that reflects the current state of the underlying PersonalGraph.

### 18.2 Joining

Joining connects an agent to an existing SharedGraph and begins synchronisation.

The `join()` method on `navigator.graph` MUST:

1. Parse the Graph URI to extract relay endpoints, graph identifier, and module hash.
2. If a module hash is specified:
   1. If the module is already installed, use it.
   2. If the module is not installed, initiate installation (Section 9.1).
   3. If installation fails or the user denies it, reject with `NotAllowedError`.
3. If no module hash is specified, use the default sync module.
4. Create a new local graph store for this shared graph.
5. Call `init()` on the sync module.
6. Call `connect()` on the sync module.
7. Call `requestSync("genesis")` to perform initial synchronisation.
8. Return a SharedGraph object.

The user agent SHOULD display a consent prompt before joining, informing the user:

- The graph URI and relay endpoint(s)
- The sync module being used
- That their DID will be visible to other peers
- Estimated storage requirements

### 18.3 Leaving

Leaving disconnects an agent from a SharedGraph.

The `leave()` method MUST:

1. Call `disconnect()` on the sync module.
2. Cease all sync activity for this graph.
3. If the `retainLocalCopy` option is `true` (the default), the local graph data MUST be preserved and accessible as a read-only PersonalGraph.
4. If the `retainLocalCopy` option is `false`, the local graph data MAY be deleted.
5. If no other graphs use the same sync module, the module MAY be removed (Section 9.4).

---

## 19. Signalling

### 19.1 sendSignal

The `sendSignal(did, payload)` method sends arbitrary data to a specific peer identified by their DID.

```webidl
Promise<undefined> sendSignal(USVString remoteDid, BufferSource payload);
```

The payload is an arbitrary byte sequence (maximum 64 KB). The signal is delivered on a best-effort basis — delivery is NOT guaranteed if the target peer is offline.

Signals are intended for out-of-band coordination such as:

- Cursor position sharing
- Typing indicators
- WebRTC negotiation
- Custom protocol handshakes
- Application-level messaging that does not belong in the graph

The sync module's `sendSignal()` method is called to transmit the signal via the module's transport.

### 19.2 broadcast

The `broadcast(payload)` method sends arbitrary data to all currently connected peers.

```webidl
Promise<undefined> broadcast(BufferSource payload);
```

The same delivery semantics as `sendSignal` apply. The broadcast is sent to all peers known to be online at the time of the call.

### 19.3 Ephemeral Semantics

Signals are ephemeral. They MUST NOT be persisted in the graph, included in GraphDiffs, or replayed during sync. A signal exists only as a transient message between peers.

Signals are NOT subject to governance validation. They bypass the `validate()` method entirely. This is intentional — signals are for coordination, not data.

Receiving peers MUST dispatch a `SignalEvent` to the SharedGraph:

```webidl
[Exposed=Window,Worker]
interface SignalEvent : Event {
  readonly attribute USVString senderDid;
  readonly attribute ArrayBuffer payload;
};
```

---

## 20. Security Considerations

### 20.1 Triple Signing

All triples within a GraphDiff — both additions and removals — MUST include a cryptographic signature from the authoring agent. This provides authentication: peers can verify that a triple was authored by the agent whose DID is associated with the signature.

The default signature algorithm is Ed25519 over SHA-256. The signing input is:

```
sign-input = SHA-256(source || predicate || target || timestamp)
```

### 20.2 Signature Verification

A conforming sync module MUST verify the signature of every triple in a received GraphDiff before applying it. Triples with invalid or missing signatures MUST be rejected.

### 20.3 Peer Identity

Peers are identified by DIDs [[DID-CORE]]. Implementations MUST verify that a peer's claimed DID corresponds to the key material used for signing triples and establishing connections. This prevents peer impersonation.

### 20.4 Sync Module Security

#### 20.4.1 Code Integrity

Sync module code is content-addressed. The SHA-256 hash of the WASM binary is verified before execution and periodically thereafter. This ensures:

- The module has not been tampered with after download.
- All peers verifiably run the same code.
- Cached modules can be verified without re-downloading.

#### 20.4.2 Sandbox Isolation

Sync modules run in a WASM sandbox with capability-scoped permissions (Section 8). The sandbox provides:

- **Memory isolation**: The module cannot read or write memory outside its WASM linear memory.
- **Network isolation**: The module can only access network endpoints granted by capabilities.
- **Storage isolation**: The module can only access the graph it is associated with.
- **No DOM access**: The module cannot manipulate the renderer or page content.

#### 20.4.3 Malicious Module Threats

A malicious sync module could:

| Threat | Mitigation |
|--------|-----------|
| Consume excessive resources (CPU, memory, network) | Browser enforces resource limits (Section 8.4); user can suspend/remove via Module Management UI |
| Produce invalid diffs (corrupt data) | Other peers' modules validate incoming diffs; invalid diffs are rejected |
| Leak graph data to the relay or external parties | Relay transport uses TLS; module cannot access endpoints outside its capabilities; E2E encryption can be layered above the module |
| Accept diffs that should be rejected (weak governance) | All peers must agree on the module (content hash); a module with weak governance is a community choice, not a browser vulnerability |
| Deny-of-service via slow validation | Browser enforces timeout on `validate()` calls (RECOMMENDED: 5 seconds); module terminated if exceeded |

#### 20.4.4 Module Agreement

All peers in a shared graph MUST run the same sync module, verified by the content hash in the Graph URI. A peer running a different module (different hash) is not part of the same graph.

When a module update occurs (new hash):

- The new hash constitutes a new graph configuration.
- Peers must migrate to the new module to continue participating.
- The browser handles this via the update flow (Section 9.3).

### 20.5 Denial-of-Service

Sync modules SHOULD implement mitigations against denial-of-service attacks via diff flooding, including:

- Rate limiting incoming diffs per peer
- Maximum diff size limits (Section 11.4)
- Banning peers that repeatedly submit invalid diffs
- Relay-side connection rate limiting (Section 12.8)

### 20.6 Graph URI Security

SharedGraph URIs SHOULD contain sufficient entropy (128+ bits) in the graph identifier to prevent unauthorised join attempts via guessing. Knowledge of a SharedGraph URI constitutes the minimum requirement for joining — additional access control is handled by the sync module's governance validation.

### 20.7 Relay Trust Model

Relays are untrusted intermediaries:

- Relays cannot modify diff content (signatures verify integrity).
- Relays cannot forge diffs (they don't have agents' private keys).
- Relays can drop messages (detected by sync catch-up with other peers).
- Relays can observe connection metadata (who connects to what graph, when).

For metadata privacy, peers MAY:

- Connect through Tor or VPN.
- Use multiple relays and rotate between them.
- Implement relay-blinding techniques in custom modules.

---

## 21. Privacy Considerations

### 21.1 Identity Disclosure

Peers in a SharedGraph are identified by their DIDs. All peers can see the DIDs of all other peers. This constitutes identity disclosure — agents participating in a SharedGraph reveal their decentralised identity to all other participants.

Users MUST be informed when joining a SharedGraph that their DID will be visible to other peers. User agents SHOULD provide a clear consent prompt (Section 18.2).

### 21.2 Graph Content Visibility

By default, all graph content is visible to all peers. There is no built-in encryption of triple content.

Implementations MAY layer end-to-end encryption (E2EE) over the sync protocol. When E2EE is applied:

- Triple payloads SHOULD be encrypted before being included in a GraphDiff.
- Key management is the responsibility of the E2EE layer, not this specification.
- Custom sync modules MAY implement E2EE natively.

### 21.3 Metadata Leakage

Even with E2EE, metadata such as the number of triples, diff frequency, peer connection times, and graph URI are observable by:

- Relay servers (connection metadata)
- Other peers (diff metadata)
- Network intermediaries (connection patterns)

### 21.4 Relay Metadata

Relay servers observe:

- Which DIDs connect to which graphs
- Connection timestamps and durations
- Message sizes and frequencies
- IP addresses of connecting peers

Relay operators SHOULD minimise metadata retention. Relay operators SHOULD publish a privacy policy.

### 21.5 Module Fingerprinting

The content hash of a sync module reveals what type of graph a peer is participating in. If a module is unique to a specific community or application, the module hash alone can identify the community. Users should be aware that the module hash in a Graph URI is not secret.

### 21.6 Local Storage

SharedGraph data stored locally by the user agent SHOULD be protected with the same security measures as other browser storage (e.g., IndexedDB). User agents MUST delete SharedGraph data when the user clears site data, unless the graph has been explicitly marked for retention via the Module Management UI.

---

## 22. Examples

*This section is non-normative.*

### 22.1 Publishing a SharedGraph (Default Module)

```javascript
// Create a personal graph
const graph = await navigator.graph.create("project-notes");

// Add some initial data
await graph.addTriple({
  source: "note:1",
  predicate: "schema:name",
  target: "Meeting Notes — April 2026"
});

// Share it using the default sync module
const shared = await graph.share({
  meta: { name: "Project Notes", description: "Shared notes for the team" }
});

console.log("SharedGraph URI:", shared.uri);
// → "graph://default-relay.browser.example/a3f8c2d1-7e9b-4f0a-..."
// No ?module= parameter — default module is implied
```

### 22.2 Publishing with a Custom Sync Module

```javascript
const graph = await navigator.graph.create("voting-system");

// Share with a custom module that implements quadratic voting
const shared = await graph.share({
  module: "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  relays: ["relay1.example.com", "relay2.example.com"],
  meta: { name: "Community Votes" }
});

console.log("SharedGraph URI:", shared.uri);
// → "graph://relay1.example.com,relay2.example.com/b7d9e2f1-...?module=sha256-e3b0c44..."
```

### 22.3 Joining an Existing SharedGraph

```javascript
// Join using a URI received out-of-band (e.g., shared via link)
// Browser prompts: "Install sync module sha256-abc123? [Allow/Deny]"
const shared = await navigator.graph.join(
  "graph://relay.example.com/a3f8c2d1-...?module=sha256-abc123"
);

// Listen for sync state changes
shared.onsyncstatechange = (event) => {
  console.log("Sync state:", shared.syncState);
};

// Query the graph (standard PersonalGraph API)
const results = await shared.query("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
console.log("Triples:", results.length);

// See who else is here
const peers = await shared.onlinePeers();
console.log("Online peers:", peers.map(p => p.did));
```

### 22.4 Handling Incoming Diffs

```javascript
const shared = await navigator.graph.join(graphURI);

// React to incoming changes from peers
shared.addEventListener("diff", (event) => {
  const diff = event.diff;
  console.log(`Revision ${diff.revision} from ${diff.author}:`);
  console.log(`  +${diff.additions.length} triples`);
  console.log(`  -${diff.removals.length} triples`);

  // Update UI based on the changes
  for (const triple of diff.additions) {
    if (triple.predicate === "schema:name") {
      updateTitleInUI(triple.source, triple.target);
    }
  }
});
```

### 22.5 Sending Signals Between Peers

```javascript
const shared = await navigator.graph.join(graphURI);

// Listen for signals from other peers
shared.onsignal = (event) => {
  const payload = new TextDecoder().decode(event.payload);
  const data = JSON.parse(payload);
  
  if (data.type === "cursor-position") {
    showRemoteCursor(event.senderDid, data.x, data.y);
  }
};

// Broadcast cursor position to all peers (ephemeral, not stored)
document.addEventListener("mousemove", (e) => {
  const payload = new TextEncoder().encode(JSON.stringify({
    type: "cursor-position",
    x: e.clientX,
    y: e.clientY
  }));
  shared.broadcast(payload);
});
```

### 22.6 Managing Sync Modules

```javascript
// List all installed modules
const modules = await navigator.graph.listModules();
for (const mod of modules) {
  console.log(`Module ${mod.contentHash}:`);
  console.log(`  Name: ${mod.name}`);
  console.log(`  Graphs: ${mod.graphCount}`);
  console.log(`  State: ${mod.state}`);
  console.log(`  Storage: ${mod.storageBytes} bytes`);
}

// List all shared graphs
const graphs = await navigator.graph.listShared();
for (const g of graphs) {
  console.log(`Graph ${g.uri}:`);
  console.log(`  Name: ${g.name}`);
  console.log(`  Module: ${g.moduleHash}`);
  console.log(`  Peers: ${g.peerCount}`);
  console.log(`  State: ${g.syncState}`);
}
```

### 22.7 Governance Pre-Check

```javascript
const shared = await navigator.graph.join(graphURI);

// Check if a triple would be allowed before attempting to add it
const result = await shared.canAddTriple({
  source: "msg:123",
  predicate: "app:body",
  target: "Hello, world!"
});

if (result.allowed) {
  await shared.addTriple({ source: "msg:123", predicate: "app:body", target: "Hello, world!" });
} else {
  console.log(`Blocked by ${result.module}: ${result.reason}`);
  // e.g., "Blocked by temporal: Rate limit: wait 20 more seconds"
}
```

---

## 23. References

### 23.1 Normative References

<dl>
<dt>[DID-CORE]</dt>
<dd><a href="https://www.w3.org/TR/did-core/">Decentralized Identifiers (DIDs) v1.0</a>. W3C Recommendation.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>. Draft. (Companion specification)</dd>

<dt>[GRAPH-GOVERNANCE]</dt>
<dd><a href="https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/05_graph-governance.md">Graph Governance: Constraint Enforcement for Shared Linked Data Graphs</a>. Draft. (Companion specification)</dd>

<dt>[RDF-CANON]</dt>
<dd><a href="https://www.w3.org/TR/rdf-canon/">RDF Dataset Canonicalization</a>. W3C Recommendation.</dd>

<dt>[RFC2119]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc2119">Key words for use in RFCs to Indicate Requirement Levels</a>. IETF RFC 2119.</dd>

<dt>[RFC8949]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc8949">Concise Binary Object Representation (CBOR)</a>. IETF RFC 8949.</dd>

<dt>[WEBASSEMBLY]</dt>
<dd><a href="https://www.w3.org/TR/wasm-core-2/">WebAssembly Core Specification</a>. W3C Recommendation.</dd>

<dt>[WEBTRANSPORT]</dt>
<dd><a href="https://www.w3.org/TR/webtransport/">WebTransport</a>. W3C Working Draft.</dd>
</dl>

### 23.2 Informative References

<dl>
<dt>[WEBRTC]</dt>
<dd><a href="https://www.w3.org/TR/webrtc/">WebRTC: Real-Time Communication in Browsers</a>. W3C Recommendation.</dd>

<dt>[CRDT]</dt>
<dd>Shapiro, M. et al. "Conflict-free Replicated Data Types." SSS 2011.</dd>

<dt>[LOCAL-FIRST]</dt>
<dd>Kleppmann, M. et al. "Local-first software: you own your data, in spite of the cloud." Onward! 2019.</dd>

<dt>[SOLID]</dt>
<dd><a href="https://solidproject.org/TR/protocol">Solid Protocol</a>. W3C Solid Community Group.</dd>

<dt>[ZCAP-LD]</dt>
<dd><a href="https://w3c-ccg.github.io/zcap-spec/">Authorization Capabilities for Linked Data</a>. W3C Community Group Report.</dd>

<dt>[VC-DATA-MODEL-2.0]</dt>
<dd><a href="https://www.w3.org/TR/vc-data-model-2.0/">Verifiable Credentials Data Model v2.0</a>. W3C Recommendation.</dd>
</dl>
