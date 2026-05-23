# Personal Linked Data Graphs

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md
**Editor:** [TBD]

---

## Abstract

This specification defines a client-side API for creating, querying, and managing linked data on the web. The unit of coherence is a **context**: a named graph of RDF triples identified by a `did:graph:...` DID (see [[DECENTRALISED-IDENTITY]]). Each context has its own persistent store, its own set of registered shapes, and its own governance configuration. A **GraphStore** (consistent with the term in [[SPARQL12-GRAPH-STORE]]) is the agent-local collection of contexts the user agent currently has open; it consists of a small private graph for agent-local state, plus a mount table referencing zero or more shared contexts. The API is exposed on the `navigator.graph` namespace and supports RDF 1.2 triples with reifier-based per-triple provenance, SPARQL 1.2 queries, SHACL-based shape registration (see [[SHAPE-VALIDATION]]), context-scoped and cross-context queries, and serialisation of any context as a signed, addressable **graph snapshot**.

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

This specification addresses that gap by defining contexts: **named graphs of RDF triples, each identified by a `did:graph:...` DID, each with its own store, its own shapes, and its own governance**. A user agent's collection of mounted contexts is its `navigator.graph` GraphStore.

### 1.2 Use Cases

- **Personal knowledge management.** A user maintains personal contexts of notes, references, and connections. Multiple web applications read and write to the same contexts through `navigator.graph`.
- **Local-first applications.** Applications that work offline by default, storing data in user-owned contexts.
- **Cross-application data sharing.** A calendar application writes events into a Calendar context; a task manager reads from it. Both use the same agreed vocabulary.
- **Cross-agent collaboration.** Two user agents mount the same `did:graph:...` and operate on the same underlying state, synchronised via [[P2P-GRAPH-SYNC]].
- **Self-describing portable data.** A context's shapes ([[SHAPE-VALIDATION]]), flows ([[GRAPH-FLOWS]]), and governance ([[GRAPH-GOVERNANCE]]) live as triples *inside* the context. Mounting the context gives an application everything it needs to interact with the data.

### 1.3 Relationship to Other Specifications

This specification builds on:
- **RDF 1.2** [[RDF12-CONCEPTS]] — triple data model with reifiers for per-triple provenance.
- **SPARQL 1.2** [[SPARQL12-QUERY]] — query semantics.
- **DID Core** [[DID-CORE]] — context identity via `did:graph` (see [[DECENTRALISED-IDENTITY]]).
- **Web IDL** [[WEBIDL]] — API surface.

This specification is complemented by [[DECENTRALISED-IDENTITY]] (which defines `did:graph`), [[P2P-GRAPH-SYNC]] (which defines how contexts are synchronised between agents), [[SHAPE-VALIDATION]] (which defines SHACL-based action semantics on contexts), [[GRAPH-GOVERNANCE]] (which defines ZCAP-based write authorisation on contexts), [[GRAPH-FLOWS]] (which defines state-machine processes over context data), and [[GROUP-IDENTITY]] (which defines collective-identity patterns built on `did:graph`).

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

The signature is computed as `Ed25519-Sign(privateKey, SHA-256(canonical(triple) || timestamp))`, where `canonical(triple)` is the triple's canonical N-Triples serialisation. For a triple signed on behalf of a `did:graph:...`, the `prov://author` is the graph DID and `prov://method` is the specific delegate method that produced the signature.

User agents MUST attach a reifier carrying author, timestamp, and signature to every triple they accept via `addTriple()`. User agents SHOULD verify reifier signatures on every triple read from a non-trusted source.

### 3.3 Context

A **Context** is a named graph of triples identified by a `did:graph:...` DID ([[DECENTRALISED-IDENTITY]]). The IRI alias `graph://<did-fragment>` resolves to the same context.

Every context has:

- An identity (`did:graph:...`).
- A DID document (triples inside the context describing the verification methods currently authorised to sign on behalf of the context — see [[DECENTRALISED-IDENTITY]] §4).
- A creation timestamp.
- Optionally, one or more `context://participates_in` triples declaring participation in a parent context.
- Zero or more registered shapes ([[SHAPE-VALIDATION]]).
- Zero or more registered flows ([[GRAPH-FLOWS]]).
- Zero or more governance constraints ([[GRAPH-GOVERNANCE]]).
- Zero or more triples of application data.

```webidl
[Exposed=(Window,Worker), SecureContext]
interface Context : EventTarget {
  readonly attribute USVString did;                    // did:graph:...
  readonly attribute USVString iri;                    // graph://<did-fragment>
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
| `"subscribed"` | The agent is actively receiving updates from sync peers ([[P2P-GRAPH-SYNC]]). |
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
  readonly attribute USVString privateGraphDid;     // did:graph:... of the private context
  readonly attribute FrozenArray<Context> mounts;

  [NewObject] Promise<Context> createContext(optional ContextCreationOptions options);
  [NewObject] Promise<Context> mount(USVString graphDid, optional MountOptions options);
  [NewObject] Promise<undefined> unmount(USVString graphDid);
  [NewObject] Promise<Context?> getContext(USVString graphDid);

  [NewObject] Promise<SparqlResult> querySparql(USVString sparql, optional SparqlQueryOptions options);
  ContextQueryBuilder inContext(USVString graphDid);

  attribute EventHandler oncontextmounted;
  attribute EventHandler oncontextunmounted;
  attribute EventHandler oncontextcreated;
  attribute EventHandler oncontextdissolved;
};

dictionary ContextCreationOptions {
  DOMString displayName;
  USVString participatesIn;             // did:graph of parent context (optional)
  sequence<USVString> initialDelegates; // additional DIDs on the new graph's capabilityInvocation
};

dictionary MountOptions {
  MountMode mode = "read";
  object capabilityProof;               // ZCAP chain; required for "write" or "governance"
  USVString snapshotUri;                // optional initial snapshot to mount from
};
```

The **private graph** is a context with its own `did:graph:...` whose DID document lists exactly one `capabilityInvocation` delegate — the agent. It is never offered for sync. Any triple written without specifying a target context lands here.

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

  /** Resolve a context across all known stores (for `did:graph` resolver delegation). */
  [NewObject] Promise<Context?> resolveContext(USVString graphDid);
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

1. Generate a new UUID for the GraphStore.
2. Mint a fresh `did:graph:...` for the GraphStore's private graph (per [[DECENTRALISED-IDENTITY]] §4). The owning agent becomes the sole `capabilityInvocation` delegate.
3. Persist the GraphStore record with the private graph mounted in `"governance"` mode.
4. Return the `GraphStore`.

```webidl
// On GraphStore:
[NewObject] Promise<Context> createContext(optional ContextCreationOptions options);
```

The `createContext()` method MUST:

1. Mint a fresh `did:graph:...` for the new context.
2. Create the per-context store ([§8](#8-storage)).
3. Write the initial DID-document triples to the context (the calling agent becomes the initial delegate). Add any `initialDelegates` to `capabilityInvocation`.
4. If `options.participatesIn` is provided, write `<this-context> context://participates_in <parent>` into the new context.
5. Mount the new context into the GraphStore in `"governance"` mode.
6. Fire `contextcreated` and `contextmounted` events.
7. Return the `Context`.

### 4.2 Mounting and Unmounting

```webidl
[NewObject] Promise<Context> mount(USVString graphDid, optional MountOptions options);
```

The `mount()` method MUST:

1. Reject with `"InvalidStateError"` if the graph is already mounted in this GraphStore.
2. If `options.mode` is `"write"` or `"governance"`, require a `capabilityProof` and validate it against the context's governance ([[GRAPH-GOVERNANCE]]). Reject with `"NotAllowedError"` on failure.
3. If the context's per-context store does not exist locally:
   - If `options.snapshotUri` is provided, fetch the snapshot ([§5](#5-graph-snapshots)), verify its signatures, and create the per-context store from its contents with a `trustLevel` of `"external"`.
   - Otherwise, attempt to resolve via known sync spaces ([[P2P-GRAPH-SYNC]]).
   - If neither succeeds, reject with `"NotFoundError"`.
4. Register the mount entry (graph DID, mode, capability proof).
5. Fire a `contextmounted` event.
6. Return the `Context`.

The `unmount()` method MUST remove the mount entry from the GraphStore and fire `contextunmounted`. The per-context store stays on disk; other GraphStores that mount it are unaffected.

### 4.3 Triple Operations

When called on a `Context`, `addTriple()` MUST:

1. Resolve the active signing identity (an `id` obtained from [[DECENTRALISED-IDENTITY]]).
2. Validate the triple against any shapes registered on this context ([[SHAPE-VALIDATION]]).
3. Check governance ([[GRAPH-GOVERNANCE]]): the active identity must hold a valid capability authorising `createLink` against this context's `did:graph:...`, satisfying any caveats.
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

A context can be serialised as an addressable, signed **GraphSnapshot**, and a GraphSnapshot can be mounted as a context in another GraphStore. The triple — with its reifier carrying authorship, timestamp, and signature — is the atomic unit of verifiable content. A context is a set of triples with an identity. A GraphSnapshot is a context with an address and a signature.

This duality is what makes contexts portable: a context (with its governance, shapes, and flows) can move between user agents without losing its integrity.

### 5.2 Producing a Snapshot

```webidl
partial interface Context {
  [NewObject] Promise<GraphSnapshot> getAsSnapshot(optional GraphSnapshotOptions options);
  [NewObject] Promise<USVString> contentHash();
};

dictionary GraphSnapshotOptions {
  DOMString format = "nquads";     // "nquads", "turtle", "jsonld"
  GraphSignBy signBy = "agent";    // "agent", "graph", "both"
};

enum GraphSignBy { "agent", "graph", "both" };

[Exposed=(Window,Worker)]
interface GraphSnapshot {
  readonly attribute USVString graphDid;
  readonly attribute USVString contentHash;       // hex SHA-256
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

The `contentHash()` method MUST return a deterministic SHA-256 hex digest computed over the context's triples, sorted in lexicographic N-Quads order. This hash is the integrity address; the graph DID is the logical address.

The `getAsSnapshot()` method MUST:

1. Serialise the context's triples (including reifiers) in the requested `format`.
2. Compute the content hash.
3. Produce proofs:
   - For `signBy: "agent"` — the active agent identity signs the hash.
   - For `signBy: "graph"` — a delegate currently listed in the graph's `assertionMethod` signs on behalf of the graph DID. Reject with `"NotAllowedError"` if no such delegate key is held locally.
   - For `signBy: "both"` — both proofs are produced.
4. Return the `GraphSnapshot`.

### 5.3 Mounting a Snapshot

```webidl
partial interface GraphStore {
  [NewObject] Promise<Context> mountSnapshot(GraphSnapshot snapshot, optional MountSnapshotOptions options);
};

dictionary MountSnapshotOptions {
  USVString targetGraphDid;
  DOMString trustLevel = "external";
};
```

The `mountSnapshot()` method MUST:

1. Verify all proofs in `snapshot.proofs` against `snapshot.contentHash`. If any fail, reject with `"DataError"`.
2. Recompute the content hash from `snapshot.data`; if it mismatches `snapshot.contentHash`, reject with `"DataError"`.
3. Determine the target graph DID (the embedded `snapshot.graphDid` unless overridden).
4. Open or create the per-context store for the target DID.
5. Insert the parsed triples (including reifiers, DID-document triples, shape triples, flow triples, governance triples).
6. Record provenance metadata: `<graphDid> context://mounted_from <sourceUri>` and `<graphDid> context://trust_level <trustLevel>`.
7. Mount the context (read mode unless a capability proof is provided separately).
8. Return the `Context`.

Because governance, shapes, and flows live as triples *inside* the context, this single operation transfers everything needed to participate. No separate governance sync.

### 5.4 Logical Address vs Integrity Address

The graph DID (`did:graph:...`) is the **logical address** — it identifies a context independent of its current state. The content hash is the **integrity address** — it identifies a specific state of the context. "Has this context changed since I last saw it?" reduces to a hash comparison. "Is this the same context I was talking to before?" reduces to a DID comparison.

---

## 6. Context-Scoped Queries

This section is normative.

### 6.1 Structural vs Value Scoping

Structural scoping (*which context*) is kept explicitly separate from value filtering (*which values*).

```webidl
partial interface GraphStore {
  ContextQueryBuilder inContext(USVString graphDid);
};

partial interface Context {
  ContextQueryBuilder query();
};

[Exposed=Window]
interface ContextQueryBuilder {
  ContextQueryBuilder inContext(USVString graphDid);
  ContextQueryBuilder where(TripleQuery filter);
  ContextQueryBuilder include(sequence<USVString> predicates);  // cross-context hydration
  ContextQueryBuilder page(unsigned long offset, unsigned long size);
  [NewObject] Promise<sequence<Triple>> run();
};
```

`inContext(graphDid)` scopes the query to one context. `where()` constrains by value. They MUST NOT be conflated.

### 6.2 Cross-Context Include Resolution

When a query result references entities in *other* contexts (for example, a message in `did:graph:channel-general` references its parent channel in `did:graph:community-root`), `include(['channel'])` instructs the runtime to:

1. For each result whose target is an entity in another context, identify the target's home graph DID via the entity's `context://participates_in` link or shape-declared `graph` property.
2. Issue a hydration query against that graph's store.
3. Attach the hydrated data to the result.

Authorisation is layered on top via [[GRAPH-GOVERNANCE]]: an agent cannot `include()` data from a context for which they hold no read capability.

### 6.3 Context Lifecycle Events

Real-time applications need to know when contexts themselves come into existence or are dissolved, not only when their data changes.

```webidl
[Exposed=Window]
interface ContextLifecycleEvent : Event {
  readonly attribute USVString graphDid;
  readonly attribute DOMString eventType;     // "created" | "dissolved" | "mounted" | "unmounted"
  readonly attribute DOMString timestamp;
  readonly attribute USVString? creator;
};
```

A community application with many channels does not need to statically subscribe to each one. It subscribes to lifecycle events on the parent context and adapts as child contexts emerge.

---

## 7. Shape System

This section is informative; the normative specification of action semantics lives in [[SHAPE-VALIDATION]]. The API surface exposed on a `Context` is:

```webidl
partial interface Context {
  Promise<undefined> addShape(USVString name, USVString shaclJson);
  [NewObject] Promise<sequence<USVString>> getShapeInstances(USVString shapeName);
  [NewObject] Promise<USVString> createShapeInstance(USVString shapeName, USVString address, optional object data);
  [NewObject] Promise<object> getShapeInstanceData(USVString shapeName, USVString instanceUri);
};
```

Shapes are stored as triples inside the context they describe. They participate in graph-snapshot serialisation — exporting a context exports its shapes; mounting a snapshot mounts the shapes. A shape registered on a parent context is visible to child contexts that participate in it via `context://participates_in`. See [[SHAPE-VALIDATION]] for details.

---

## 8. Storage

### 8.1 Per-Context Stores

Each context has its own backing store, keyed by `did:graph:...`. The RECOMMENDED layout for a conforming user agent:

```
<agent-storage>/graphs/<did:graph:...>/   ← one IndexedDB / OPFS subtree per context
<agent-storage>/graph-stores/<uuid>/      ← GraphStore metadata + mount table
```

Two GraphStores within the same agent that mount the same `did:graph:...` MUST share the underlying store. Mounting is by reference.

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

Origin is not the sole authorisation boundary for context data; the graph DID is. Multiple origins MAY mount the same `did:graph:...` for the same agent, subject to:

1. A user gesture and a user-agent-mediated prompt identifying the requesting origin and the target context.
2. The origin presenting (or the user supplying) a valid capability proof for the requested mount mode.

```webidl
partial interface GraphStore {
  [NewObject] Promise<undefined> grantOriginAccess(USVString origin, USVString graphDid, MountMode mode);
  [NewObject] Promise<undefined> revokeOriginAccess(USVString origin, USVString graphDid);
};
```

*This API is at risk pending further design.*

---

## 9. Security Considerations

### 9.1 Reifier Signature Verification

User agents SHOULD verify reifier signatures on every triple read from a non-trusted context (a context whose `trustLevel` is `"external"`). Triples without a valid reifier signature MUST be marked unverified or filtered.

### 9.2 Shape Validation

Shapes prevent malformed writes. Shape registration is governance-controlled — only holders of `updateSHACL` capabilities may modify shapes ([[SHAPE-VALIDATION]] / [[GRAPH-GOVERNANCE]]).

### 9.3 Storage Quotas

User agents MUST apply storage quotas consistent with [[STORAGE]]. Per-context quota visibility SHOULD be exposed to the user.

### 9.4 Mount-Mode Escalation

An agent holding a `"read"` mount cannot upgrade to `"write"` without a fresh capability proof. Upgrading is an explicit mount operation with a new `capabilityProof`.

### 9.5 Snapshot Integrity

A mounted GraphSnapshot inherits its trust from the signatures on the snapshot. User agents MUST verify all proofs before persisting snapshot data and MUST mark the resulting context with the appropriate `trustLevel`.

---

## 10. Privacy Considerations

### 10.1 Local-First by Default

The GraphStore's private graph and any locally-created contexts are local-first. No data leaves the user's device unless the user explicitly shares a graph DID (via mount, snapshot, or sync space membership).

### 10.2 Per-Context Identity

The recommended privacy posture is per-context identity: an agent may use a different `did:key` (or hold a different delegate key on a `did:graph`) for different contexts. The substrate makes this cheap; the graph DID — not the origin — is the natural correlation boundary.

### 10.3 DID Correlation

If an agent presents the same `did:key` across multiple contexts, those contexts can correlate the agent's activity. User agents SHOULD allow users to create per-context DIDs and SHOULD suggest doing so when the privacy posture warrants it.

### 10.4 Context Metadata

The existence, IRI/DID, and display name of mounted contexts could reveal information. The `list()` and `getContext()` methods MUST only return contexts the calling origin has been granted access to.

### 10.5 Mount-Table Disclosure

A GraphStore's full mount table is sensitive — it discloses the set of contexts the agent is subscribed to. APIs that enumerate mounts MUST require an explicit user gesture for cross-origin disclosure.

---

## 11. Examples

### 11.1 Creating a GraphStore with a Calendar Context

```javascript
const me = await navigator.graph.create("My Workspace");
const calendar = await me.createContext({ displayName: "My Calendar" });

console.log(calendar.did);    // "did:graph:z6Mk..."
console.log(calendar.iri);    // "graph://z6Mk..."

await calendar.addTriple(new Triple(
  "urn:event:1",
  "schema://name",
  "Coffee with Alice"
));
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
  .inContext("did:graph:channel-general")
  .where({ predicate: "msg://body" })
  .include(["channel"])
  .page(0, 20)
  .run();
```

### 11.5 Snapshot, Sign, Transfer, Mount

```javascript
// In GraphStore A:
const snapshot = await calendar.getAsSnapshot({ signBy: "both" });

// Transport `snapshot` to GraphStore B (file, IPFS, etc.).

// In GraphStore B:
const mounted = await otherStore.mountSnapshot(snapshot);
// `mounted.did` === `snapshot.graphDid`. Both stores now reference the same
// context. With sync ([[P2P-GRAPH-SYNC]]), writes propagate between them.
```

### 11.6 Subscribing to Context Lifecycle

```javascript
me.oncontextmounted = (e) => console.log(`Mounted ${e.graphDid}`);
me.oncontextcreated = (e) => console.log(`New context ${e.graphDid} created by ${e.creator}`);
```

---

## 12. References

### 12.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC3986]** Berners-Lee, T., Fielding, R., and L. Masinter, "Uniform Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005. https://www.rfc-editor.org/rfc/rfc3986
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. https://www.rfc-editor.org/rfc/rfc3339
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017. https://www.rfc-editor.org/rfc/rfc8032
- **[WEBIDL]** Chen, E., "Web IDL Standard". https://webidl.spec.whatwg.org/
- **[DID-CORE]** Sporny, M., Guy, A., Sabadello, M., and D. Reed, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./02_decentralised-identity-web-platform.md) (companion specification).

### 12.2 Informative References

- **[RDF12-CONCEPTS]** "RDF 1.2 Concepts and Abstract Syntax", W3C Working Draft. https://www.w3.org/TR/rdf12-concepts/
- **[SPARQL12-QUERY]** "SPARQL 1.2 Query Language", W3C Working Draft. https://www.w3.org/TR/sparql12-query/
- **[SPARQL12-GRAPH-STORE]** "SPARQL 1.2 Graph Store HTTP Protocol", W3C Working Draft. https://www.w3.org/TR/sparql12-graph-store-protocol/
- **[SHACL]** Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, 20 July 2017. https://www.w3.org/TR/shacl/
- **[INDEXEDDB]** "Indexed Database API 3.0", W3C Working Draft. https://www.w3.org/TR/IndexedDB/
- **[STORAGE]** "Storage Standard". https://storage.spec.whatwg.org/
- **[P2P-GRAPH-SYNC]** [Peer-to-Peer Context Synchronisation Protocol](./03_p2p-graph-sync.md) (companion specification).
- **[SHAPE-VALIDATION]** [Dynamic Graph Shape Validation](./04_dynamic-graph-shape-validation.md) (companion specification).
- **[GRAPH-GOVERNANCE]** [Graph Governance](./05_graph-governance.md) (companion specification).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./06_group-identity.md) (companion specification).
- **[GRAPH-FLOWS]** [Graph Flows](./07_graph-flows.md) (companion specification).
