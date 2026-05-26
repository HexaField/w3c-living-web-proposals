# Personal Linked Data Graphs

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_personal-linked-data-graphs.md
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_personal-linked-data-graphs.md
**Editor:** [TBD]

---

## Abstract

This specification defines a client-side API for creating, querying, and managing linked data on the web. The unit of coherence is a **context**: a named graph of RDF triples whose identifier is content-addressed — a `graph://<content-hash>` IRI that is the SHA-256 of the context's current triples. **The IRI encodes a snapshot.** Two graphs with identical triple sets share an IRI; any mutation to a graph produces a new IRI. This is a hard limitation, not an accident — it gives the substrate snapshot-level immutability and invokes a version-control discipline at the protocol layer: the same address cannot ever name two different contents. The corollary is that a graph IRI cannot, by itself, refer to "the same graph over time" — only to one of its states. **Sovereign, content-independent identity for an evolving graph is provided by [[GROUP-IDENTITY]]'s `did:graph` layer.** A `did:graph:...` is an optional layer that wraps a context and gives it a persistent identity that survives content change; any non-trivial mutable application needs one. Capability invocation, sync, and long-lived references in this and related specifications operate on `did:graph` when a context is groupified; raw `graph://<content-hash>` IRIs identify specific snapshots (immutable artifacts, snapshot transfer, content-addressed cache keys). A **GraphStore** (consistent with the term in [[SPARQL12-GRAPH-STORE]]) is the agent-local collection of contexts the user agent currently has open; it consists of a small private graph for agent-local state, plus a mount table referencing zero or more shared contexts. The API is exposed on the `navigator.graph` namespace and supports RDF 1.2 triples with reifier-based per-triple provenance, SPARQL 1.2 queries, SHACL-based shape registration (see [[SHAPE-VALIDATION]]), context-scoped and cross-context queries, and serialisation of any context as a signed, addressable **graph snapshot**.

---

## Status of This Document

This document is a **First Public Working Draft** published by the [TBD] Working Group. It is intended to become a W3C Recommendation.

Publication as a First Public Working Draft does not imply endorsement by W3C and its Members. This is a draft document and may be updated, replaced, or obsoleted by other documents at any time. It is inappropriate to cite this document as other than work in progress.

Feedback and comments on this specification are welcome. Please file issues on the GitHub repository.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Data Model](#3-data-model)
4. [API](#4-api)
5. [Graph Snapshots](#5-graph-snapshots)
6. [Context-Scoped Queries](#6-context-scoped-queries)
7. [Shape System](#7-shape-system)
8. [Storage](#8-storage)
9. [Security Considerations](#9-security-considerations)
10. [Privacy Considerations](#10-privacy-considerations)
11. [Examples](#11-examples)
12. [References](#12-references)

---

## 1. Introduction

### 1.1 Motivation

The web platform provides several client-side storage mechanisms — cookies, Web Storage, IndexedDB, the Origin Private File System — yet none offer semantic structure. Applications store opaque blobs and key-value pairs with no interoperability, no queryability across applications, and no user-meaningful data model. Meanwhile, the web has no way for a unit of structured data — a community's messages, a personal calendar, a shared document — to carry a stable identity, declare its own constraints, or move between user agents without losing its integrity.

This specification addresses that gap by defining contexts: **named graphs of RDF triples whose IRI is the content hash of their current state**, each with its own store, its own shapes, and its own governance. The content-hash IRI is a snapshot identifier: it cannot, by construction, refer to two different states of a graph; any mutation produces a new IRI. This forces a clean distinction in the substrate between **snapshots** (immutable, content-addressed) and **evolving graphs** (which require a stable, content-independent identity). The stable-identity layer is `did:graph` from [[GROUP-IDENTITY]] — a context that needs to be referenced across mutations MUST be groupified to gain a `did:graph:...`. A user agent's collection of mounted contexts is its `navigator.graph` GraphStore.

### 1.2 Use Cases

- **Personal knowledge management.** A user maintains personal contexts of notes, references, and connections. Multiple web applications read and write to the same contexts through `navigator.graph`.
- **Local-first applications.** Applications that work offline by default, storing data in user-owned contexts.
- **Cross-application data sharing.** A calendar application writes events into a Calendar context; a task manager reads from it. Both use the same agreed vocabulary.
- **Cross-agent collaboration.** Two user agents mount the same `graph://<content-hash>` and operate on the same underlying state, synchronised via [[CONTEXT-SYNC]].
- **Self-describing portable data.** A context's shapes ([[SHAPE-VALIDATION]]), flows ([[GRAPH-FLOWS]]), and governance ([[CAPABILITY-FRAMEWORK]]) live as triples *inside* the context. Mounting the context gives an application everything it needs to interact with the data.

### 1.3 Relationship to Other Specifications

- **RDF 1.2** [[RDF12-CONCEPTS]] — triple data model with reifiers for per-triple provenance.
- **SPARQL 1.2** [[SPARQL12-QUERY]] — query semantics.
- **Web IDL** [[WEBIDL]] — API surface.
- [[DECENTRALISED-IDENTITY]] defines the `DIDCredential` surface used to sign triples and snapshots. Triples in this specification are signed by an *agent* DID (any method); contexts themselves are identified by IRI, not by DID.
- [[GROUP-IDENTITY]] defines `did:graph` and the DID-document delegate model — the layer by which a context becomes addressable independent of its content. The `did:graph` is what resolves the version-control tension this specification's IRI scheme introduces: snapshots are content-addressed; the DID is the *evolving* graph's sovereign identity. Specs 03, 04, and this one reference *mutable* graphs by `did:graph` and *snapshots* by IRI.
- [[CAPABILITY-FRAMEWORK]] defines ZCAP-based write authorisation on contexts (resource = graph IRI; signer = any DID).
- [[CONTEXT-SYNC]] defines how contexts are synchronised between agents (keyed by graph IRI).
- [[SHAPE-VALIDATION]] defines SHACL-based action semantics on contexts.
- [[GRAPH-FLOWS]] defines state-machine processes over context data.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]] and [[RFC8174]] when, and only when, they appear in ALL CAPITALS.

A conforming user agent MUST:

1. Implement the data model in [§3](#3-data-model).
2. Implement the `navigator.graph` API in [§4](#4-api).
3. Support per-context persistent storage ([§8](#8-storage)).
4. Implement graph snapshots ([§5](#5-graph-snapshots)).
5. Implement context-scoped queries ([§6](#6-context-scoped-queries)).
6. Support shape registration on contexts ([§7](#7-shape-system)).

---

## 3. Data Model

### 3.1 Triple

A **Triple** is a directed labelled relationship — subject, predicate, object. This specification follows RDF 1.2 semantics.

- The `subject` attribute MUST be a valid URI [[RFC3986]].
- The `predicate` attribute MUST be a valid URI [[RFC3986]]. **Predicate is REQUIRED.**
- The `object` attribute MUST be a valid URI [[RFC3986]] or a literal value.

```webidl
[Exposed=(Window,Worker)]
interface Triple {
  constructor(USVString subject, USVString predicate, (USVString or LiteralValue) object);
  readonly attribute USVString subject;
  readonly attribute USVString predicate;
  readonly attribute (USVString or LiteralValue) object;
};

[Exposed=(Window,Worker)]
interface LiteralValue {
  readonly attribute DOMString lexicalValue;
  readonly attribute USVString datatype;     // XSD URI
  readonly attribute USVString? language;    // BCP 47, for xsd:string with @language
};
```

### 3.2 Triple Provenance via RDF 1.2 Reifiers

Per-triple provenance — author, timestamp, signature — is carried using RDF 1.2 reifiers. A reifier is a node that reifies a triple (via `rdf:reifies`); it carries metadata about the triple as additional triples. This keeps provenance SPARQL-visible and avoids a bespoke wrapper type.

```turtle
# A triple plus its provenance:
<urn:event:1> <schema://name> "Coffee with Alice" .

# Reifier (typically a blank node):
_:r1 rdf:reifies <<( <urn:event:1> <schema://name> "Coffee with Alice" )>> .
_:r1 prov://author      <did:key:z6Mk...> .
_:r1 prov://timestamp   "2026-05-23T12:00:00Z"^^xsd:dateTime .
_:r1 prov://signature   "z58D..." .
_:r1 prov://method      <did:key:z6Mk...#z6Mk...> .   # the verification method that signed
```

The signature is computed as `Ed25519-Sign(privateKey, SHA-256(canonical(triple) || timestamp))`, where `canonical(triple)` is the triple's canonical N-Triples serialisation. The `prov://author` is the DID of the signing agent; `prov://method` is the specific verification method that produced the signature. The author is typically the writer's own `did:key:...`. If the context has been groupified with a `did:graph:...` ([[GROUP-IDENTITY]]) AND the writer is signing on behalf of the graph, the `prov://author` is the graph's `did:graph` and `prov://method` is the specific delegate method that produced the signature.

User agents MUST attach a reifier carrying author, timestamp, and signature to every triple they accept via `addTriple()`. User agents SHOULD verify reifier signatures on every triple read from a non-trusted source.

All **provenance-bearing timestamps** in this and related specifications — values that travel on the wire, enter signed material, or are otherwise reproducible across agents (`Reifier.timestamp`, `SignedContent.timestamp` [[DECENTRALISED-IDENTITY]], `GraphSnapshot.timestamp`, `ContextDiff.timestamp` [[CONTEXT-SYNC]]) — MUST be `DOMString`s in RFC 3339 [[RFC3339]] format. **Operational timestamps** local to the user agent (e.g., `Peer.lastSeen`) MAY use `DOMTimeStamp` (milliseconds since the Unix epoch).

### 3.3 Context

A **Context** is a named graph of triples. Its `iri` is a `graph://<content-hash>` URI — the SHA-256 of the *current* triple set, computed deterministically (lexicographic N-Quad canonicalisation; see [§5.2](#52-content-hash-computation)). This makes the IRI a snapshot identifier:

- **The IRI changes whenever the context's triples change.** Adding, removing, or rewriting a triple advances the context to a new state with a new IRI.
- **Two contexts with the same triples have the same IRI.** Content-addressing means the address is a function of the content alone — not of which agent assembled it, when, or why.
- **The same IRI never names two different states.** An IRI is a content commitment; verifying that a received bag of triples matches a given IRI is a single hash check.

Because of this, the IRI alone cannot identify "the same graph over time" — only a specific state. For sovereign, content-independent identity (the kind needed by any application that mutates a graph and wants others to keep referencing *the graph*, not a snapshot), a context MUST be groupified per [[GROUP-IDENTITY]] §6. Groupification attaches a `did:graph:...` to the context — an identifier that persists across all subsequent IRI changes.

Every context has:

- A *current* IRI (`graph://<content-hash>`) — content-derived; changes per mutation.
- A *stable* internal handle that the host user agent uses to track the context across IRI changes (an implementation detail; not normatively exposed).
- Optionally, a `did:graph:...` DID and its supporting DID-document triples ([[GROUP-IDENTITY]]) — REQUIRED for any context that will be referenced externally across mutations (sync, long-lived ZCAPs, durable participation links).
- Optionally, one or more `context://participates_in` triples declaring participation in a parent context.
- Zero or more registered shapes ([[SHAPE-VALIDATION]]).
- Zero or more registered flows ([[GRAPH-FLOWS]]).
- Zero or more governance constraints ([[CAPABILITY-FRAMEWORK]]).
- Zero or more triples of application data.

```webidl
[Exposed=(Window,Worker), SecureContext]
interface Context : EventTarget {
  /** Current snapshot IRI — graph://<content-hash> of the current triple set.
   *  Recomputed after every mutation. */
  readonly attribute USVString iri;
  /** Optional did:graph:... — sovereign, content-independent identity. Set
   *  by groupification ([[GROUP-IDENTITY]] §6). Null until groupified. */
  readonly attribute USVString? did;
  readonly attribute DOMString? displayName;
  readonly attribute MountMode mountMode;
  readonly attribute ContextSubscriptionState state;
  readonly attribute DOMString? trustLevel;            // for snapshot-mounted contexts

  [NewObject] Promise<Triple> addTriple(Triple triple);
  [NewObject] Promise<sequence<Triple>> addTriples(sequence<Triple> triples);
  [NewObject] Promise<boolean> removeTriple(Triple triple);
  [NewObject] Promise<sequence<Triple>> queryTriples(TripleQuery query);
  [NewObject] Promise<SparqlResult> querySparql(USVString sparql, optional SparqlQueryOptions options);
  [NewObject] Promise<sequence<Triple>> snapshot();
  [NewObject] Promise<sequence<Reifier>> provenance(Triple triple);

  attribute EventHandler ontripleadded;
  attribute EventHandler ontripleremoved;
  /** Fired whenever the context's IRI changes (i.e., after every mutation). */
  attribute EventHandler oniriChanged;
};

enum MountMode { "read", "write", "governance" };
enum ContextSubscriptionState { "local", "subscribed", "external", "error" };
```

| MountMode | Meaning |
|---|---|
| `"read"` | The agent can read the context but cannot write. |
| `"write"` | The agent holds a capability authorising at least one write action. |
| `"governance"` | The agent holds a capability authorising changes to governance/shapes/DID document. |

| State | Meaning |
|---|---|
| `"local"` | A context the agent created or holds privately; not shared. |
| `"subscribed"` | The agent is actively receiving updates from sync peers ([[CONTEXT-SYNC]]). |
| `"external"` | Mounted from a snapshot for reading; not subscribed for updates. |
| `"error"` | Mounting or syncing failed. |

### 3.4 GraphStore

A **GraphStore** is the agent's view onto the contexts it has mounted. Consistent with [[SPARQL12-GRAPH-STORE]], it is a collection of named graphs (here, contexts) plus a default (private) graph. It is identified by a UUID and owned by an agent.

```webidl
[Exposed=Window, SecureContext]
interface GraphStore : EventTarget {
  readonly attribute USVString uuid;
  readonly attribute DOMString name;
  readonly attribute USVString agentDid;            // owning agent's did:key:...
  readonly attribute USVString privateGraphIri;     // graph://<content-hash> of the private context
  readonly attribute FrozenArray<Context> mounts;

  [NewObject] Promise<Context> createContext(optional ContextCreationOptions options);
  [NewObject] Promise<Context> mount(USVString graphIri, optional MountOptions options);
  [NewObject] Promise<undefined> unmount(USVString graphIri);
  [NewObject] Promise<boolean> dissolveContext(USVString graphIri);
  [NewObject] Promise<Context?> getContext(USVString graphIri);

  [NewObject] Promise<SparqlResult> querySparql(USVString sparql, optional SparqlQueryOptions options);
  ContextQueryBuilder inContext(USVString graphIri);

  attribute EventHandler oncontextmounted;
  attribute EventHandler oncontextunmounted;
  attribute EventHandler oncontextcreated;
  attribute EventHandler oncontextdissolved;
};

dictionary ContextCreationOptions {
  DOMString displayName;
  USVString participatesIn;             // graph IRI (or did:graph) of parent context (optional)
};

dictionary MountOptions {
  MountMode mode = "read";
  object capabilityProof;               // ZCAP chain; required for "write" or "governance"
  USVString snapshotUri;                // optional initial snapshot to mount from
};
```

The **private graph** is a context with its own `graph://<content-hash>` IRI whose only writer is the owning agent. It is never offered for sync. Any triple written without specifying a target context lands here. The private graph is ungroupified by default — it has no `did:graph` — because there is no collective signing authority to express; the agent IS its single writer.

### 3.5 GraphStoreManager

```webidl
[Exposed=Window, SecureContext]
partial interface Navigator {
  [SameObject] readonly attribute GraphStoreManager graph;
};

[Exposed=Window, SecureContext]
interface GraphStoreManager {
  [NewObject] Promise<GraphStore> create(optional DOMString name);
  [NewObject] Promise<sequence<GraphStore>> list();
  [NewObject] Promise<GraphStore?> get(USVString uuid);
  [NewObject] Promise<boolean> remove(USVString uuid);

  /** Resolve a context across all known stores by IRI or by attached did:graph. */
  [NewObject] Promise<Context?> resolveContext(USVString iriOrDid);
};
```

### 3.6 TripleQuery

```webidl
dictionary TripleQuery {
  USVString? subject;
  USVString? predicate;
  USVString? object;
  USVString? author;
  DOMString? fromDate;
  DOMString? untilDate;
  unsigned long? limit;
};
```

Filtering on `author` matches the reifier's `prov://author`. Multiple fields combine with logical AND.

### 3.7 SparqlQueryOptions

```webidl
dictionary SparqlQueryOptions {
  sequence<USVString> graphs;       // contexts to include in the dataset (DIDs or IRIs)
  DefaultGraphMode defaultGraphMode;
  unsigned long? timeout;
};

enum DefaultGraphMode {
  "default",   // the GraphStore's private graph
  "union",     // union of all mounted contexts
  "listed"     // only the contexts listed in `graphs`
};
```

### 3.8 Reifier

```webidl
[Exposed=(Window,Worker)]
interface Reifier {
  readonly attribute USVString id;
  readonly attribute Triple triple;
  readonly attribute USVString author;        // DID URI
  readonly attribute DOMString timestamp;     // RFC 3339
  readonly attribute USVString method;        // verification method URI
  readonly attribute DOMString signature;     // multibase-encoded Ed25519 signature
};
```

---

## 4. API

### 4.1 Creating a GraphStore and a Context

```webidl
// On GraphStoreManager:
[NewObject] Promise<GraphStore> create(optional DOMString name);
```

The `create()` method MUST:

1. Generate a fresh version 4 UUID [[RFC4122]] for the GraphStore.
2. Mint a private context for the GraphStore via `createContext()` (with the owning agent as creator). The private context's current IRI is `graph://<content-hash>` of whatever triples are written to it; it tracks state as the agent writes to it. The agent's own DID signs the triples — no DID-document delegate machinery is set up. The private graph stays ungroupified, on the basis that it is local-only and the agent never needs to refer to it externally across mutations.
3. Persist the GraphStore record with the private graph mounted in `"governance"` mode.
4. Return the `GraphStore`.

```webidl
// On GraphStore:
[NewObject] Promise<Context> createContext(optional ContextCreationOptions options);
```

The `createContext()` method MUST:

1. Allocate a fresh per-context store ([§8](#8-storage)), keyed by an internal handle (an implementation-defined UUID, not the IRI — because the IRI will change with content).
2. Return a `Context` whose initial state has no application triples. Its current `iri` is `graph://<content-hash-of-empty-or-seed-state>`; its `did` is `null`.
3. If `options.participatesIn` is provided, write `<this-context.iri> context://participates_in <parent>` into the new context as its first application triple. Note that this changes the context's IRI.
4. Mount the new context into the GraphStore in `"governance"` mode.
5. Fire `contextcreated` and `contextmounted` events.
6. Fire `iriChanged` whenever the IRI subsequently changes (i.e., after every `addTriple`, `addTriples`, or `removeTriple`).
7. Callers that need an identity for this graph that survives mutations MUST invoke `[[GROUP-IDENTITY]] §6` to groupify it; after groupification, `context.did` is a stable `did:graph:...` while `context.iri` continues to track the current snapshot.

Ungroupified contexts are useful for one-shot immutable artifacts (e.g., a snapshot to be published once and never modified) and for agent-private scratchpads. Any other use case — anything that involves another agent later referring back to "the same graph", or anything that synchronises across devices — SHOULD groupify at creation time via `[[GROUP-IDENTITY]] §8.2`'s `createGroup()` (which performs createContext + groupify atomically).

### 4.2 Mounting and Unmounting

```webidl
[NewObject] Promise<Context> mount(USVString graphDid, optional MountOptions options);
```

The `mount()` method MUST:

1. Reject with `"InvalidStateError"` if the graph is already mounted in this GraphStore.
2. If `options.mode` is `"write"` or `"governance"`, require a `capabilityProof` and validate it against the context's governance ([[CAPABILITY-FRAMEWORK]]). Reject with `"NotAllowedError"` on failure.
3. If the context's per-context store does not exist locally:
   - If `options.snapshotUri` is provided, fetch the snapshot ([§5](#5-graph-snapshots)), verify its signatures, and create the per-context store from its contents with a `trustLevel` of `"external"`.
   - Otherwise, attempt to resolve via known sync spaces ([[CONTEXT-SYNC]]).
   - If neither succeeds, reject with `"NotFoundError"`.
4. Register the mount entry (graph DID, mode, capability proof).
5. Fire a `contextmounted` event.
6. Return the `Context`.

The `unmount()` method MUST remove the mount entry from the GraphStore and fire `contextunmounted`. The per-context store stays on disk; other GraphStores that mount it are unaffected.

The `dissolveContext()` method MUST:

1. Reject with `"NotFoundError"` if the named context has no per-context store in this GraphStore.
2. Reject with `"NotAllowedError"` if the calling agent does not hold a `"governance"`-mode mount of the context.
3. Unmount the context (if mounted) and remove its per-context store from local persistent storage.
4. Fire a `contextdissolved` event with `eventType = "dissolved"`.
5. Resolve with `true` if storage was removed, `false` if it was already absent.

Dissolution is local to the dissolving agent's GraphStore; it does not propagate to other agents that have mounted the same `graph://<content-hash>`. Other agents continue to hold their own copies.

### 4.3 Triple Operations

When called on a `Context`, `addTriple()` MUST:

1. Resolve the active signing identity (an `id` obtained from [[DECENTRALISED-IDENTITY]]).
2. Validate the triple against any shapes registered on this context ([[SHAPE-VALIDATION]]).
3. Check governance ([[CAPABILITY-FRAMEWORK]]): the active identity must hold a valid capability authorising `createLink` against this context's resource. For groupified contexts the resource is the `did:graph:...` (stable across writes); for ungroupified contexts it is the current `graph://<content-hash>`. Long-lived ZCAPs therefore SHOULD target a `did:graph`.
4. Compute the reifier (author, timestamp, signature, method) and persist the triple plus its reifier triples.
5. Fire a `tripleadded` event with the triple.
6. Return the `Triple`.

If no active identity is available, reject with `"InvalidStateError"`. If governance rejects, reject with `"NotAllowedError"` and include the rejecting constraint's reason.

`addTriples()` runs atomically: shape, governance, and signing validation are applied to the full batch before any triple is persisted.

`removeTriple()` removes a triple and its reifiers, subject to governance.

`queryTriples()` returns triples matching the `TripleQuery`. When called on a `Context`, the scope is that context only. When called on a `GraphStore`, the scope is the union of all mounted contexts unless restricted via [§6](#6-context-scoped-queries).

`querySparql()` accepts an options object (see [§3.7](#37-sparqlqueryoptions)) that controls the SPARQL dataset configuration.

`snapshot()` returns the triples currently in the context, ordered by reifier timestamp ascending. See [§5](#5-graph-snapshots) for the addressable, signed form.

`provenance(triple)` returns the reifier(s) attached to the triple.

---

## 5. Graph Snapshots

This section is normative.

### 5.1 The Principle

A context's `iri` *is* its current snapshot address. A **GraphSnapshot** wraps the IRI with the serialised triples and one or more cryptographic proofs, so the snapshot can be transported and verified by another agent. The triple — with its reifier carrying authorship, timestamp, and signature — is the atomic unit of verifiable content. A GraphSnapshot is the serialised, signed form of a context's current state.

Because the IRI is content-derived ([§3.3](#33-context)), it is also the snapshot's integrity address. There is no separate "content hash" — the IRI *is* the content hash. Verifying a received snapshot is one SHA-256 over the serialised triples + a string compare against `snapshot.graphIri`.

This makes contexts portable as immutable artifacts: a snapshot at IRI *G* is, forever, the same triples. To track an *evolving* graph between agents, both sides must agree on the graph's stable `did:graph` ([[GROUP-IDENTITY]]); the DID is then the durable handle and the current IRI is one of its (changing) states.

### 5.2 Content Hash Computation

The content hash of a context (which determines its IRI) is computed as:

1. Canonicalise the context's current triple set as N-Quads, sorting lexicographically.
2. Append each triple's reifier metadata (`author`, `timestamp`, `method`, `signature`) in the same line as the triple.
3. Compute SHA-256 over the resulting UTF-8 byte sequence.
4. Encode the digest as lowercase hex.

The full content hash is `graph://` + the hex digest. A conforming user agent MUST recompute this whenever the triple set changes and MUST update `context.iri` accordingly, firing `iriChanged`.

### 5.3 Producing a Snapshot

```webidl
partial interface Context {
  [NewObject] Promise<GraphSnapshot> getAsSnapshot(optional GraphSnapshotOptions options);
};

dictionary GraphSnapshotOptions {
  DOMString format = "nquads";     // "nquads", "turtle", "jsonld"
  GraphSignBy signBy = "agent";    // "agent", "graph", "both"
};

enum GraphSignBy { "agent", "graph", "both" };

[Exposed=(Window,Worker)]
interface GraphSnapshot {
  /** The content-hash IRI of this snapshot. Verifies the snapshot's triples. */
  readonly attribute USVString graphIri;
  /** The sovereign DID of the underlying context, if groupified. Identifies the
   *  *graph* (across versions); use with [[GROUP-IDENTITY]] to look up the
   *  graph's current state via sync. Null if the source context is ungroupified
   *  (in which case the snapshot is a standalone immutable artifact). */
  readonly attribute USVString? graphDid;
  readonly attribute DOMString format;
  readonly attribute DOMString timestamp;
  readonly attribute DOMString data;              // serialised triples
  readonly attribute FrozenArray<SnapshotProof> proofs;
};

[Exposed=(Window,Worker)]
interface SnapshotProof {
  readonly attribute DOMString role;       // "agent" or "graph"
  readonly attribute USVString author;     // signing DID
  readonly attribute USVString method;     // verification method URI
  readonly attribute DOMString signature;  // multibase-encoded
};
```

The `getAsSnapshot()` method MUST:

1. Serialise the context's triples (including reifiers) in the requested `format`.
2. Compute `graphIri` per [§5.2](#52-content-hash-computation).
3. Produce proofs:
   - For `signBy: "agent"` — the active agent identity signs the IRI (= content hash).
   - For `signBy: "graph"` — REQUIRES the context to be groupified ([[GROUP-IDENTITY]]). A delegate currently listed in the graph's `assertionMethod` signs on behalf of `graphDid`. Reject with `"NotAllowedError"` if no `did:graph` or no such delegate key is held locally.
   - For `signBy: "both"` — both proofs are produced.
4. Return the `GraphSnapshot`.

### 5.4 Mounting a Snapshot

```webidl
partial interface GraphStore {
  [NewObject] Promise<Context> mountSnapshot(GraphSnapshot snapshot, optional MountSnapshotOptions options);
};

dictionary MountSnapshotOptions {
  DOMString trustLevel = "external";
};
```

The `mountSnapshot()` method MUST:

1. Verify all proofs in `snapshot.proofs` against `snapshot.graphIri`. If any fail, reject with `"DataError"`.
2. Recompute the content hash from `snapshot.data` per [§5.2](#52-content-hash-computation); if it does not equal `snapshot.graphIri`, reject with `"DataError"`.
3. Allocate a fresh per-context store, insert the parsed triples (including reifiers, optional DID-document triples, shape triples, flow triples, governance triples), and record provenance metadata: `<graphIri> context://mounted_from <sourceUri>` and `<graphIri> context://trust_level <trustLevel>`.
4. If the snapshot's triples include a `<graphIri> group://didIdentity <did>` binding, the mounted context's `did` attribute is set to that DID; otherwise `did` is `null`.
5. Mount the context (read mode unless a capability proof is provided separately).
6. Return the `Context`. Its `iri` matches `snapshot.graphIri` *at this instant*; any subsequent mutation will change it.

Because governance, shapes, and flows live as triples *inside* the context, this single operation transfers everything needed to participate. No separate governance sync.

### 5.5 Snapshot Address vs Sovereign Identity

The graph IRI (`graph://<content-hash>`) is the **snapshot address** — it identifies one specific state. Verifying integrity ("are these the triples that produce this hash?") and content equivalence ("do these two graphs have the same triples?") both reduce to comparing IRIs. An IRI cannot, by construction, change while pointing to the same content; conversely, two states of an evolving graph have two different IRIs.

The graph DID (`did:graph:...`, from [[GROUP-IDENTITY]]) is the **sovereign identity** — it identifies the *graph* across all its states. "Is this the same graph I was talking to before?" reduces to a DID comparison. "What is the graph's current state?" requires looking up the current snapshot via sync ([[CONTEXT-SYNC]]).

Both layers serve different purposes and SHOULD be used together where applicable:

- A long-lived ZCAP whose `resource` is a graph SHOULD target the `did:graph` (it then applies across all states); a ZCAP that authorises action against one specific snapshot MAY target the IRI.
- A sync subscription is keyed by `did:graph` (otherwise it could only follow one state).
- A snapshot transfer for archival uses the IRI as the verifiable, immutable address.
- A signed assertion of "I observed this graph at state X" pairs the `did:graph` with the IRI.

---

## 6. Context-Scoped Queries

This section is normative.

### 6.1 Structural vs Value Scoping

Structural scoping (*which context*) is kept explicitly separate from value filtering (*which values*).

```webidl
partial interface GraphStore {
  ContextQueryBuilder inContext(USVString graphIri);
};

partial interface Context {
  ContextQueryBuilder query();
};

[Exposed=Window]
interface ContextQueryBuilder {
  ContextQueryBuilder inContext(USVString graphIri);
  ContextQueryBuilder where(TripleQuery filter);
  ContextQueryBuilder include(sequence<USVString> predicates);  // cross-context hydration
  ContextQueryBuilder page(unsigned long offset, unsigned long size);
  [NewObject] Promise<sequence<Triple>> run();
};
```

`inContext(graphIri)` scopes the query to one context. `where()` constrains by value. They MUST NOT be conflated.

### 6.2 Cross-Context Include Resolution

When a query result references entities in *other* contexts (for example, a message in `graph://<channel-general-hash>` references its parent channel in `graph://<community-root-hash>`), `include(['channel'])` instructs the runtime to:

1. For each result whose target is an entity in another context, identify the target's home graph IRI via the entity's `context://participates_in` link or shape-declared `graph` property.
2. Issue a hydration query against that graph's store.
3. Attach the hydrated data to the result.

Authorisation is layered on top via [[CAPABILITY-FRAMEWORK]]: an agent cannot `include()` data from a context for which they hold no read capability.

### 6.3 Context Lifecycle Events

Real-time applications need to know when contexts themselves come into existence or are dissolved, not only when their data changes.

```webidl
[Exposed=Window]
interface ContextLifecycleEvent : Event {
  readonly attribute USVString graphIri;
  readonly attribute DOMString eventType;     // "created" | "dissolved" | "mounted" | "unmounted"
  readonly attribute DOMString timestamp;
  readonly attribute USVString? creator;
};
```

A community application with many channels does not need to statically subscribe to each one. It subscribes to lifecycle events on the parent context and adapts as child contexts emerge.

---

## 7. Shape System

This section is informative. The normative shape API — registration, instance lifecycle, property setters, and constructor action semantics — is specified by [[SHAPE-VALIDATION]] as `partial interface Context` extensions.

Shapes are stored as triples inside the context they describe and participate in graph-snapshot serialisation: exporting a context exports its shapes; mounting a snapshot mounts the shapes. A shape registered on a parent context is visible to child contexts that participate in it via `context://participates_in`. See [[SHAPE-VALIDATION]] for the full API surface and processing model.

---

## 8. Storage

### 8.1 Per-Context Stores

Each context has its own backing store, keyed by `graph://<content-hash>`. The RECOMMENDED layout for a conforming user agent:

```
<agent-storage>/graphs/<content-hash>/    ← one IndexedDB / OPFS subtree per context
<agent-storage>/graph-stores/<uuid>/      ← GraphStore metadata + mount table
```

Two GraphStores within the same agent that mount the same `graph://<content-hash>` MUST share the underlying store. Mounting is by reference.

### 8.2 Store Lifecycle

- **Open on mount.** Mounting a context opens its store if not already open and increments a refcount.
- **Close on last unmount.** When the refcount reaches zero, the store is closed.
- **LRU cache.** Open stores are kept in a least-recently-used cache bounded by a UA-defined limit (recommended: 64). Beyond the limit, the least-recently-used store is closed even if refcount > 0; it reopens on next access.
- **Delete on creator decision.** A context's store is removed permanently only when the creator (or a `"governance"`-mode mount holder) issues a `dissolve` operation. Unmounting does not delete data.

### 8.3 Persistence

Context data MUST persist across browsing sessions. Context data MUST survive browser restarts. Context data SHOULD survive "clear browsing data" only if the user explicitly opts to preserve it (analogous to `navigator.storage.persist()`).

### 8.4 Crash Recovery

User agents MUST use transactional writes for context mutations. If a mutation is interrupted, the store MUST be restored to its pre-mutation state.

### 8.5 Eviction

When storage quota is exceeded, the user agent SHOULD prompt the user before evicting any context. Contexts whose mount mode is `"governance"` (the agent is a key custodian) MUST NOT be evicted without explicit user consent.

### 8.6 Cross-Origin Access

Origin is not the sole authorisation boundary for context data; the graph IRI is. Multiple origins MAY mount the same `graph://<content-hash>` for the same agent, subject to:

1. A user gesture and a user-agent-mediated prompt identifying the requesting origin and the target context.
2. The origin presenting (or the user supplying) a valid capability proof for the requested mount mode.

```webidl
partial interface GraphStore {
  [NewObject] Promise<undefined> grantOriginAccess(USVString origin, USVString graphIri, MountMode mode);
  [NewObject] Promise<undefined> revokeOriginAccess(USVString origin, USVString graphIri);
};
```

*This API is at risk pending further design.*

---

## 9. Security Considerations

### 9.1 Reifier Signature Verification

User agents SHOULD verify reifier signatures on every triple read from a non-trusted context (a context whose `trustLevel` is `"external"`). Triples without a valid reifier signature MUST be marked unverified or filtered.

### 9.2 Shape Validation

Shapes prevent malformed writes. Shape registration is governance-controlled — only holders of `updateSHACL` capabilities may modify shapes ([[SHAPE-VALIDATION]] / [[CAPABILITY-FRAMEWORK]]).

### 9.3 Storage Quotas

User agents MUST apply storage quotas consistent with [[STORAGE]]. Per-context quota visibility SHOULD be exposed to the user.

### 9.4 Mount-Mode Escalation

An agent holding a `"read"` mount cannot upgrade to `"write"` without a fresh capability proof. Upgrading is an explicit mount operation with a new `capabilityProof`.

### 9.5 Snapshot Integrity

A mounted GraphSnapshot inherits its trust from the signatures on the snapshot. User agents MUST verify all proofs before persisting snapshot data and MUST mark the resulting context with the appropriate `trustLevel`.

---

## 10. Privacy Considerations

### 10.1 Local-First by Default

The GraphStore's private graph and any locally-created contexts are local-first. No data leaves the user's device unless the user explicitly shares a graph IRI (via mount, snapshot, or sync space membership).

### 10.2 Per-Context Identity

The recommended privacy posture is per-context identity: an agent may use a different `did:key` (or, for groupified contexts, hold a different delegate key on a `did:graph`) for different contexts. The substrate makes this cheap; the graph IRI — not the origin — is the natural correlation boundary.

### 10.3 DID Correlation

If an agent presents the same `did:key` across multiple contexts, those contexts can correlate the agent's activity. User agents SHOULD allow users to create per-context DIDs and SHOULD suggest doing so when the privacy posture warrants it.

### 10.4 Context Metadata

The existence, IRI, optional `did:graph`, and display name of mounted contexts could reveal information. The `list()` and `getContext()` methods MUST only return contexts the calling origin has been granted access to.

### 10.5 Mount-Table Disclosure

A GraphStore's full mount table is sensitive — it discloses the set of contexts the agent is subscribed to. APIs that enumerate mounts MUST require an explicit user gesture for cross-origin disclosure.

---

## 11. Examples

### 11.1 Creating a GraphStore with a Calendar Context

```javascript
const me = await navigator.graph.create("My Workspace");
const calendar = await me.createContext({ displayName: "My Calendar" });

const iri0 = calendar.iri;    // "graph://<hash-of-empty-or-seed-state>"
console.log(calendar.did);    // null — ungroupified

await calendar.addTriple(new Triple(
  "urn:event:1",
  "schema://name",
  "Coffee with Alice"
));

const iri1 = calendar.iri;
console.log(iri0 === iri1);   // false — IRI changed because content changed
// The triple's prov://author is `me`'s did:key (not the graph's identity).
```

### 11.1a Groupifying for Stable Identity

Without a `did:graph`, the calendar's IRI changes with every write. To give it a sovereign identity that other agents can refer to across mutations, groupify it ([[GROUP-IDENTITY]]):

```javascript
const calendarGroup = await me.groupify(calendar.iri);
const sovereignId = calendar.did;   // "did:graph:z6Mk..." — stable

await calendar.addTriple(new Triple("urn:event:2", "schema://name", "Lunch with Bob"));
console.log(calendar.did === sovereignId);   // true — DID survives content change
console.log(calendar.iri === iri1);          // false — IRI tracks current snapshot
```

For applications that mutate a graph and want others to keep referencing the same graph, groupify at creation:

```javascript
const team = await me.createGroup({
  displayName: "Engineering",
  initialDelegates: ["did:key:zAlice...", "did:key:zBob..."],
});
console.log(team.did);   // stable from this moment on
```

### 11.2 Reading Triple Provenance

```javascript
const triples = await calendar.queryTriples({ subject: "urn:event:1" });
for (const t of triples) {
  const [reifier] = await calendar.provenance(t);
  console.log(`${t.object}  by ${reifier.author} at ${reifier.timestamp}`);
}
```

### 11.3 Cross-Context SPARQL Query

```javascript
// Find every message across every channel the GraphStore has mounted,
// authored by a specific DID.
const results = await me.querySparql(`
  SELECT ?msg ?channel ?body WHERE {
    GRAPH ?channel {
      ?msg <msg://body>   ?body ;
           <msg://author> <did:key:z6MkAlice...> .
    }
  }
`, { defaultGraphMode: "union" });
```

### 11.4 Context-Scoped Query With Cross-Context Hydration

```javascript
const messages = await me
  .inContext("graph://<channel-general-hash>")
  .where({ predicate: "msg://body" })
  .include(["channel"])
  .page(0, 20)
  .run();
```

### 11.5 Snapshot, Sign, Transfer, Mount

```javascript
// In GraphStore A:
const snapshot = await calendar.getAsSnapshot({ signBy: "agent" });

// Transport `snapshot` to GraphStore B (file, IPFS, etc.).

// In GraphStore B:
const mounted = await otherStore.mountSnapshot(snapshot);
// `mounted.iri` === `snapshot.graphIri`. Both stores now reference the same
// context. With sync ([[CONTEXT-SYNC]]), writes propagate between them.
// Note: `signBy: "graph"` is only available when the context has been
// groupified via [[GROUP-IDENTITY]]; until then, only "agent" works.
```

### 11.6 Subscribing to Context Lifecycle

```javascript
me.oncontextmounted = (e) => console.log(`Mounted ${e.graphIri}`);
me.oncontextcreated = (e) => console.log(`New context ${e.graphIri} created by ${e.creator}`);
```

---

## 12. References

### 12.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC3986]** Berners-Lee, T., Fielding, R., and L. Masinter, "Uniform Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005. https://www.rfc-editor.org/rfc/rfc3986
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. https://www.rfc-editor.org/rfc/rfc3339
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017. https://www.rfc-editor.org/rfc/rfc8032
- **[RFC4122]** Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005. https://www.rfc-editor.org/rfc/rfc4122
- **[WEBIDL]** Chen, E., "Web IDL Standard". https://webidl.spec.whatwg.org/
- **[DID-CORE]** Sporny, M., Guy, A., Sabadello, M., and D. Reed, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./01_decentralised-identity-web-platform.md).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./10_decentralised-group-identity.md) — defines `did:graph` and the DID-document delegate model.

### 12.2 Informative References

- **[RDF12-CONCEPTS]** "RDF 1.2 Concepts and Abstract Syntax", W3C Working Draft. https://www.w3.org/TR/rdf12-concepts/
- **[SPARQL12-QUERY]** "SPARQL 1.2 Query Language", W3C Working Draft. https://www.w3.org/TR/sparql12-query/
- **[SPARQL12-GRAPH-STORE]** "SPARQL 1.2 Graph Store HTTP Protocol", W3C Working Draft. https://www.w3.org/TR/sparql12-graph-store-protocol/
- **[SHACL]** Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, 20 July 2017. https://www.w3.org/TR/shacl/
- **[INDEXEDDB]** "Indexed Database API 3.0", W3C Working Draft. https://www.w3.org/TR/IndexedDB/
- **[STORAGE]** "Storage Standard". https://storage.spec.whatwg.org/
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./03_graph-capability-framework.md).
- **[CONTEXT-SYNC]** [Context Synchronisation Protocol](./04_context-sync-protocol.md).
- **[SYNC-MODULE]** [Sync Module Architecture](./05_sync-module-architecture.md).
- **[SHAPE-VALIDATION]** [Dynamic Graph Shape Validation](./06_dynamic-graph-shape-validation.md).
- **[CONSTRAINT-VOCABULARY]** [Governance Constraint Vocabulary](./07_governance-constraint-vocabulary.md).
- **[DEFAULT-SYNC-MODULE]** [Default Sync Module](./08_default-sync-module.md).
- **[GRAPH-FLOWS]** [Graph Flows](./09_graph-flows.md).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./10_decentralised-group-identity.md).
