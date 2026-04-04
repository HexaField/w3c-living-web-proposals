# Peer-to-Peer Graph Synchronisation Protocol

**W3C Draft Community Group Report**

**Latest published version:** This document  
**Editor:** [Editor Name]  
**This version:** Draft, 4 April 2026

---

## Abstract

This specification defines a protocol for synchronising personal linked data graphs between multiple agents in a peer-to-peer manner. It defines the sync interface, diff format, conflict resolution semantics, and peer discovery mechanism for shared, eventually-consistent semantic graphs. By standardising the synchronisation layer independently of transport, this specification enables interoperable collaborative data applications without reliance on central servers.

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
6. [Sync Protocol Requirements](#6-sync-protocol-requirements)
7. [Background Sync](#7-background-sync)
8. [Publishing and Joining](#8-publishing-and-joining)
9. [Signalling](#9-signalling)
10. [Security Considerations](#10-security-considerations)
11. [Privacy Considerations](#11-privacy-considerations)
12. [Examples](#12-examples)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 Motivation

The web's data model is fundamentally client-server: applications fetch data from centralised endpoints and write data back to them. This architecture creates single points of failure, imposes trust in server operators, and makes offline collaboration difficult or impossible.

Local-first software — in which data resides primarily on the user's device and is synchronised between peers — addresses these limitations. However, the web platform currently provides no native primitives for peer-to-peer data synchronisation. WebRTC enables media and data channels, but applications must build their own sync semantics on top of raw transport.

This specification defines a **synchronisation protocol for linked data graphs**: a standard interface and diff format that enables multiple agents to collaboratively maintain a shared, eventually-consistent semantic graph without requiring a central server.

### 1.2 Use Cases

- **Collaborative editing:** Multiple users co-author a knowledge base, with changes propagating in real time as peers connect and disconnect.
- **Peer-to-peer social:** Social feeds, profiles, and interactions stored in shared graphs that participants sync directly — no platform intermediary.
- **Distributed knowledge bases:** Research groups, communities, or organisations maintain shared ontologies and datasets across institutional boundaries.
- **Offline-first synchronisation:** Field workers, travellers, or users on intermittent connections make local edits that automatically reconcile when connectivity resumes.

### 1.3 Scope

This specification defines:

- The **SharedGraph** data model (extending Personal Linked Data Graphs [[PERSONAL-LINKED-DATA-GRAPHS]])
- The **GraphDiff** format for describing changes
- The **GraphSyncProtocol** interface that sync implementations MUST satisfy
- Requirements for **eventual consistency**, **causal ordering**, and **conflict resolution**
- A **signalling** mechanism for peer communication outside the graph

This specification does NOT define:

- A specific transport protocol (WebRTC, WebSocket, libp2p, etc.)
- A specific CRDT or merge algorithm
- A specific peer discovery mechanism

---

## 2. Conformance

As well as sections marked as non-normative, all authoring guidelines, diagrams, examples, and notes in this specification are non-normative. Everything else in this specification is normative.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]].

A **conforming user agent** MUST implement all normative requirements of this specification.

A **conforming sync protocol implementation** MUST satisfy the requirements in [Section 6](#6-sync-protocol-requirements).

---

## 3. Terminology

<dl>
<dt><dfn>SharedGraph</dfn></dt>
<dd>A linked data graph that is synchronised between multiple peers. Extends PersonalGraph [[PERSONAL-LINKED-DATA-GRAPHS]] with sync capabilities. Identified by a URI.</dd>

<dt><dfn>SyncProtocol</dfn></dt>
<dd>An implementation of the <code>GraphSyncProtocol</code> interface that provides the transport and reconciliation logic for a SharedGraph.</dd>

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
</dl>

---

## 4. Data Model

### 4.1 SharedGraph

A SharedGraph is a PersonalGraph [[PERSONAL-LINKED-DATA-GRAPHS]] extended with synchronisation capabilities. Each SharedGraph is identified by a globally unique URI.

A SharedGraph MUST:

- Support all operations defined by PersonalGraph (add, remove, query triples)
- Maintain a set of known peers
- Track sync state
- Accept and produce GraphDiff objects

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

A Peer is an agent participating in the synchronisation of a SharedGraph. Each peer is identified by a Decentralised Identifier (DID) [[DID-CORE]].

A peer's DID MUST be resolvable to a DID Document containing at least one verification method suitable for digital signatures.

---

## 5. API

### 5.1 SharedGraphManager

The sharing and joining of shared graphs is integrated into the `navigator.graph` namespace and the `PersonalGraph` interface. A personal graph becomes a `SharedGraph` by calling `share()` on it. Shared graphs are joined via `navigator.graph.join()`.

```webidl
[Exposed=Window, SecureContext]
partial interface PersonalGraphManager {
  [NewObject] Promise<SharedGraph> join(USVString sharedGraphURI);
  [NewObject] Promise<sequence<SharedGraphInfo>> listShared();
};

[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<SharedGraph> share(
    optional SharedGraphOptions options = {}
  );
};

dictionary SharedGraphOptions {
  USVString syncProtocol = "webrtc-crdt";
  SharedGraphMetadata meta;
};

dictionary SharedGraphMetadata {
  USVString name;
  USVString description;
};

dictionary SharedGraphInfo {
  USVString uri;
  USVString name;
  SyncState syncState;
  unsigned long peerCount;
};
```

### 5.2 SharedGraph

The `SharedGraph` interface extends `PersonalGraph` with peer-to-peer synchronisation capabilities.

```webidl
[Exposed=Window,Worker]
interface SharedGraph : PersonalGraph {
  readonly attribute USVString uri;
  readonly attribute SyncState syncState;

  [NewObject] Promise<sequence<USVString>> peers();
  [NewObject] Promise<sequence<OnlinePeer>> onlinePeers();

  Promise<undefined> sendSignal(USVString remoteDid, any payload);
  Promise<undefined> broadcast(any payload);

  attribute EventHandler onpeerjoined;
  attribute EventHandler onpeerleft;
  attribute EventHandler onsyncstatechange;
  attribute EventHandler onsignal;
};

dictionary OnlinePeer {
  USVString did;
  DOMTimeStamp lastSeen;
};
```

### 5.3 GraphSyncProtocol

The `GraphSyncProtocol` interface defines the contract that sync protocol implementations MUST satisfy.

```webidl
[Exposed=Window,Worker]
interface GraphSyncProtocol {
  [NewObject] Promise<GraphDiff> sync();

  [NewObject] Promise<USVString> commit(GraphDiff diff);

  [NewObject] Promise<sequence<USVString>> peers();

  [NewObject] Promise<USVString> currentRevision();

  attribute EventHandler ondiff;
  attribute EventHandler onsyncstatechange;
};
```

The `sync()` method MUST initiate a synchronisation round with connected peers and return a GraphDiff representing any changes received.

The `commit(diff)` method MUST submit a locally-produced diff to the sync protocol for distribution to peers. It MUST return the revision identifier of the committed diff.

### 5.4 GraphDiff

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

### 5.5 SyncState

```webidl
enum SyncState {
  "idle",
  "syncing",
  "synced",
  "error"
};
```

- **"idle"**: The SharedGraph is not currently synchronising (e.g., no peers are connected).
- **"syncing"**: The SharedGraph is actively exchanging diffs with peers.
- **"synced"**: The SharedGraph has converged with all known peers and no pending diffs remain.
- **"error"**: A sync error has occurred. The user agent SHOULD expose error details via a `SyncErrorEvent`.

---

## 6. Sync Protocol Requirements

### 6.1 Eventual Consistency

All peers MUST converge to the same graph state given the same set of GraphDiffs, regardless of the order in which diffs are received.

A conforming sync protocol implementation MUST guarantee that if two peers have received the same set of diffs, their graph states are identical.

[NOTE: This requirement does not mandate a specific convergence algorithm. Implementations MAY use operation-based CRDTs, state-based CRDTs, or any other mechanism that guarantees convergence.]

### 6.2 Causal Ordering

Each GraphDiff MUST declare its causal dependencies as a set of revision identifiers.

A conforming implementation MUST NOT apply a GraphDiff until all of its declared dependencies have been applied. Diffs whose dependencies are not yet satisfied MUST be buffered.

The causal ordering forms a directed acyclic graph (DAG) of revisions. Implementations MAY use this DAG structure for efficient sync (e.g., exchanging only missing revisions).

### 6.3 Conflict Resolution

When concurrent GraphDiffs (diffs with no causal relationship) modify the same triple, the sync protocol MUST define a deterministic merge strategy that all peers apply identically.

This specification does NOT prescribe a specific CRDT or merge algorithm. Conforming implementations MAY use:

- Operation-based CRDTs (e.g., OR-Set for additions/removals)
- State-based CRDTs (e.g., LWW-Element-Set)
- Custom merge functions (provided they are deterministic and commutative)

The chosen merge strategy MUST be identified by the sync protocol identifier (see [Section 8.1](#81-publishing)) so that all peers use the same strategy.

[NOTE: A future version of this specification may define a default merge strategy. Feedback on the desirability of a mandatory-to-implement merge algorithm is welcome.]

### 6.4 Peer Discovery

A conforming sync protocol implementation MUST provide a mechanism for peers to discover each other given a SharedGraph URI.

Discovery mechanisms MAY include:

- Bootstrap servers (well-known HTTP endpoints)
- Distributed hash tables (DHTs)
- Signalling servers
- QR codes or out-of-band URI exchange
- DNS-based discovery

The discovery mechanism MUST be specified as part of the sync protocol identifier.

### 6.5 Transport Agnosticism

This specification defines the diff format and sync semantics. The underlying transport is implementation-defined.

Conforming implementations MAY use any transport that can deliver GraphDiff objects between peers, including but not limited to:

- WebRTC DataChannels
- WebSocket connections
- libp2p streams
- HTTP polling
- Bluetooth or local network protocols

---

## 7. Background Sync

### 7.1 Persistent Connections

User agents SHOULD maintain sync connections for joined SharedGraphs even when no documents or workers are actively using them. This enables graphs to remain up-to-date in the background, analogous to how push notification subscriptions persist across page loads.

[NOTE: The integration with the browser's background processing model (e.g., Background Sync API, Background Fetch API) requires further investigation. Feedback on the appropriate integration point is welcome.]

### 7.2 Resource Constraints

User agents MAY throttle or suspend sync connections under resource constraints, including but not limited to:

- Low battery conditions
- Metered network connections
- Memory pressure
- User-configured sync preferences

When sync is throttled, the `syncState` attribute SHOULD reflect `"idle"` and the user agent SHOULD resume sync when constraints are lifted.

### 7.3 User Controls

User agents SHOULD provide user-visible controls for managing sync status, analogous to a download manager. These controls SHOULD allow users to:

- View all joined SharedGraphs and their sync states
- Pause and resume sync for individual graphs
- View bandwidth and storage consumed by each graph
- Leave a SharedGraph

### 7.4 Service Worker Integration

Sync events MUST be deliverable to Service Workers registered for the origin.

When a GraphDiff is received while no documents are open, the user agent MUST dispatch a `SyncEvent` to the active Service Worker, enabling offline processing of incoming changes.

```webidl
[Exposed=ServiceWorker]
interface SyncEvent : ExtendableEvent {
  readonly attribute USVString sharedGraphURI;
  readonly attribute GraphDiff diff;
};
```

---

## 8. Publishing and Joining

### 8.1 Publishing

Publishing converts a PersonalGraph into a SharedGraph by associating it with a sync protocol and making it discoverable by peers.

The `share()` method on PersonalGraph MUST:

1. Generate a globally unique URI for the SharedGraph.
2. Associate the graph with the specified sync protocol identifier.
3. Register the graph with the sync protocol's peer discovery mechanism.
4. Return a SharedGraph object that reflects the current state of the underlying PersonalGraph.

The sync protocol identifier is a URI that uniquely identifies the sync implementation and its configuration (including merge strategy, discovery mechanism, and transport).

### 8.2 Joining

Joining connects an agent to an existing SharedGraph and begins synchronisation.

The `join()` method on `navigator.graph` MUST:

1. Resolve the SharedGraph URI to determine the sync protocol.
2. Obtain or instantiate the appropriate sync protocol implementation.
3. Connect to peers via the protocol's discovery mechanism.
4. Begin synchronisation, applying received diffs to the local graph.
5. Return a SharedGraph object.

If the sync protocol specified by the SharedGraph is not available to the user agent, the `join()` method MUST reject with a `NotSupportedError` DOMException.

### 8.3 Leaving

Leaving disconnects an agent from a SharedGraph.

The `leave()` method MUST:

1. Disconnect from all peers.
2. Cease all sync activity for this graph.
3. If the `retainLocalCopy` option is `true` (the default), the local graph data MUST be preserved and accessible as a read-only PersonalGraph.
4. If the `retainLocalCopy` option is `false`, the local graph data MAY be deleted.

---

## 9. Signalling

### 9.1 sendSignal

The `sendSignal(did, payload)` method sends arbitrary data to a specific peer identified by their DID.

```webidl
Promise<undefined> sendSignal(USVString remoteDid, any payload);
```

The payload MUST be serialisable via the structured clone algorithm. The signal is delivered on a best-effort basis — delivery is NOT guaranteed if the target peer is offline.

Signals are intended for out-of-band coordination such as WebRTC negotiation, custom protocol handshakes, or application-level messaging that does not belong in the graph.

### 9.2 broadcast

The `broadcast(payload)` method sends arbitrary data to all currently connected peers.

```webidl
Promise<undefined> broadcast(any payload);
```

The same delivery semantics as `sendSignal` apply. The broadcast is sent to all peers known to be online at the time of the call.

### 9.3 Ephemeral Semantics

Signals are ephemeral. They MUST NOT be persisted in the graph, included in GraphDiffs, or replayed during sync. A signal exists only as a transient message between peers.

Receiving peers MUST dispatch a `SignalEvent` to the SharedGraph:

```webidl
[Exposed=Window,Worker]
interface SignalEvent : Event {
  readonly attribute USVString senderDid;
  readonly attribute any payload;
};
```

---

## 10. Security Considerations

### 10.1 Triple Signing

All triples within a GraphDiff — both additions and removals — MUST include a cryptographic signature from the authoring agent. This provides authentication: peers can verify that a triple was authored by the agent whose DID is associated with the signature.

### 10.2 Signature Verification

A conforming sync protocol implementation MUST verify the signature of every triple in a received GraphDiff before applying it. Triples with invalid or missing signatures MUST be rejected.

### 10.3 Peer Identity

Peers are identified by DIDs [[DID-CORE]]. Implementations MUST verify that a peer's claimed DID corresponds to the key material used for signing triples and establishing connections. This prevents peer impersonation.

### 10.4 Denial-of-Service

Sync protocols SHOULD implement mitigations against denial-of-service attacks via diff flooding, including:

- Rate limiting incoming diffs per peer
- Maximum diff size limits
- Banning peers that repeatedly submit invalid diffs

[NOTE: The interaction between application-level rate limiting and sync-protocol-level rate limiting requires further specification. A companion governance specification may address this.]

### 10.5 Graph URI Security

SharedGraph URIs SHOULD be unguessable (e.g., containing sufficient entropy) to prevent unauthorised join attempts. Knowledge of a SharedGraph URI constitutes the minimum requirement for joining — additional access control mechanisms are out of scope for this specification.

---

## 11. Privacy Considerations

### 11.1 Identity Disclosure

Peers in a SharedGraph are identified by their DIDs. All peers can see the DIDs of all other peers. This constitutes identity disclosure — agents participating in a SharedGraph reveal their decentralised identity to all other participants.

Users MUST be informed when joining a SharedGraph that their DID will be visible to other peers. User agents SHOULD provide a clear consent prompt.

### 11.2 Graph Content Visibility

By default, all graph content is visible to all peers. There is no built-in encryption of triple content.

Implementations MAY layer end-to-end encryption (E2EE) over the sync protocol. When E2EE is applied:

- Triple payloads SHOULD be encrypted before being included in a GraphDiff
- Key management is the responsibility of the E2EE layer, not this specification

### 11.3 Metadata Leakage

Even with E2EE, metadata such as the number of triples, diff frequency, peer connection times, and graph URI are observable by peers and potentially by network intermediaries.

### 11.4 Local Storage

SharedGraph data stored locally by the user agent SHOULD be protected with the same security measures as other origin-scoped storage (e.g., IndexedDB). User agents MUST delete SharedGraph data when the user clears site data, unless the graph has been explicitly marked for retention.

---

## 12. Examples

*This section is non-normative.*

### 12.1 Publishing a SharedGraph

```javascript
// Create a personal graph
const graph = await navigator.graph.create("project-notes");

// Add some initial data
await graph.addTriple({
  source: "note:1",
  predicate: "schema:name",
  target: "Meeting Notes — April 2026"
});

// Share it as a shared graph
const shared = await graph.share({
  protocol: "urn:sync-protocol:example-crdt-v1",
  meta: { name: "Project Notes", description: "Shared notes for the team" }
});

console.log("SharedGraph URI:", shared.url);
// → "graph://a3f8c2d1-..."
```

### 12.2 Joining an Existing SharedGraph

```javascript
// Join using a URI received out-of-band (e.g., shared via link)
const shared = await navigator.graph.join(
  "graph://a3f8c2d1-..."
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

### 12.3 Handling Incoming Diffs

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

### 12.4 Sending Signals Between Peers

```javascript
const shared = await navigator.graph.join(graphURI);

// Listen for signals from other peers
shared.onsignal = (event) => {
  console.log(`Signal from ${event.senderDid}:`, event.payload);

  if (event.payload.type === "cursor-position") {
    showRemoteCursor(event.senderDid, event.payload.x, event.payload.y);
  }
};

// Broadcast cursor position to all peers (ephemeral, not stored)
document.addEventListener("mousemove", (e) => {
  shared.broadcast({
    type: "cursor-position",
    x: e.clientX,
    y: e.clientY
  });
});
```

---

## 13. References

### 13.1 Normative References

<dl>
<dt>[DID-CORE]</dt>
<dd><a href="https://www.w3.org/TR/did-core/">Decentralized Identifiers (DIDs) v1.0</a>. W3C Recommendation.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>. Draft. (Companion specification)</dd>

<dt>[RDF-CANON]</dt>
<dd><a href="https://www.w3.org/TR/rdf-canon/">RDF Dataset Canonicalization</a>. W3C Recommendation.</dd>

<dt>[RFC2119]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc2119">Key words for use in RFCs to Indicate Requirement Levels</a>. IETF RFC 2119.</dd>
</dl>

### 13.2 Informative References

<dl>
<dt>[WEBRTC]</dt>
<dd><a href="https://www.w3.org/TR/webrtc/">WebRTC: Real-Time Communication in Browsers</a>. W3C Recommendation.</dd>

<dt>[CRDT]</dt>
<dd>Shapiro, M. et al. "Conflict-free Replicated Data Types." SSS 2011.</dd>

<dt>[LOCAL-FIRST]</dt>
<dd>Kleppmann, M. et al. "Local-first software: you own your data, in spite of the cloud." Onward! 2019.</dd>

<dt>[SOLID]</dt>
<dd><a href="https://solidproject.org/TR/protocol">Solid Protocol</a>. W3C Solid Community Group.</dd>
</dl>
