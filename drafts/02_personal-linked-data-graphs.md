# Personal Linked Data Graphs

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_personal-linked-data-graphs.md
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_personal-linked-data-graphs.md
**Editor:** [TBD]

---

## Abstract

This specification defines a client-side API for creating, querying, and managing linked data on the web. The unit of coherence is a **graph**: a named set of RDF 1.2 triples [[RDF12-CONCEPTS]] whose identifier is content-addressed — a `graph://<content-hash>` IRI that is the SHA-256 of the graph's RDF Dataset Canonicalization [[RDF-CANON]]. **The IRI encodes a snapshot.** Two graphs with identical triple sets share an IRI; any mutation produces a new IRI. The same address cannot ever name two different contents. A graph IRI therefore cannot, by itself, refer to "the same graph over time" — only to one of its states; for that, the graph carries an optional second identifier, a DID, in its `did` slot. Triples carry per-triple provenance via RDF 1.2 reifiers; provenance triples are part of the graph and round-trip through every serialisation defined here. Graphs compose **holonically**: any graph may reference any other graph by IRI in a triple, and SPARQL 1.2 queries over a graph MAY include other graphs as named graphs in the dataset. The API is exposed on the `navigator.graph` namespace and is foundational: other specifications amend it (by adding to the `Graph` and `GraphManager` interfaces, by inserting steps into the algorithms defined here, or by populating the `did` slot) without altering the substrate guarantees this specification establishes.

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
6. [Storage](#6-storage)
7. [Holonic Composition and SPARQL](#7-holonic-composition-and-sparql)
8. [Extensibility](#8-extensibility)
9. [Security Considerations](#9-security-considerations)
10. [Privacy Considerations](#10-privacy-considerations)
11. [IANA Considerations](#11-iana-considerations)
12. [Examples](#12-examples)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 Motivation

The web platform provides several client-side storage mechanisms — cookies, Web Storage, IndexedDB, the Origin Private File System — yet none offer semantic structure. Applications store opaque blobs and key-value pairs with no interoperability, no queryability across applications, and no user-meaningful data model. Meanwhile, the web has no way for a unit of structured data — a personal calendar, a community's messages, a shared document — to carry a stable identity, declare its own constraints, or move between user agents without losing its integrity.

This specification addresses that gap by defining graphs: **named sets of RDF triples whose IRI is the content hash of their current state**. The content-hash IRI is a snapshot identifier: it cannot, by construction, refer to two different states of a graph; any mutation produces a new IRI. An **evolving graph** is the live, mutable object exposed by the JavaScript API: triples are added and removed through the `Graph` methods defined here, and after each mutation the runtime recomputes the IRI so that the graph's `iri` attribute always names its current snapshot.

A graph also carries an optional secondary identifier, the `did` attribute, which — when set — identifies the graph across all its states. This specification reserves the slot and defines the rules under which it interacts with snapshots and signing; it does not, on its own, populate or rotate it.

### 1.2 Holonic Composition

A graph is a **holon**: a whole that is also a part. Any triple may reference another graph by its IRI (in subject or object position), making the second graph a part of the first. SPARQL queries naturally traverse these compositions: the calling graph is the default graph of the SPARQL dataset, and additional graphs may be included as named graphs. There is no restriction on depth or topology — graphs may reference each other in arbitrary directed structures, including cycles.

### 1.3 Use Cases

- **Personal knowledge management.** A user maintains personal graphs of notes, references, and connections. Multiple web applications read and write to the same graphs through `navigator.graph`.
- **Local-first applications.** Applications that work offline by default, storing data in user-owned graphs.
- **Cross-application data sharing.** A calendar application writes events into a Calendar graph; a task manager reads from it. Both use the same agreed vocabulary.
- **Cross-agent collaboration.** Two user agents share the same graph and operate on the same underlying state, synchronised via a separate sync protocol layered on top.
- **Composable data.** A community graph references its channel graphs, which reference their message graphs, all queryable in a single SPARQL request.
- **Portable verifiable artifacts.** A graph's full state — including provenance — can be exported as a self-verifying snapshot and re-materialised on another user agent without loss of integrity.

### 1.4 Relationship to Other Specifications

This specification depends on:

- **RDF 1.2** [[RDF12-CONCEPTS]] — triple data model with reifiers (`rdf:reifies`, triple terms) for per-triple provenance.
- **SPARQL 1.2** [[SPARQL12-QUERY]] — query semantics.
- **RDF Dataset Canonicalization** [[RDF-CANON]] — deterministic byte-form for content hashing.
- **Web IDL** [[WEBIDL]] — API surface.
- [[DECENTRALISED-IDENTITY]] — defines the `DIDCredential` interface used to sign triples and snapshots. Triples in this specification are signed by an *agent* DID, of any method; graphs themselves are identified by IRI, with the optional `did` slot for a method-agnostic graph-level identifier.

This specification is **foundational** within its document family. Other specifications layer on top by amending its interfaces and algorithms ([§8](#8-extensibility)). No other specification is required for a conforming implementation to function.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]] and [[RFC8174]] when, and only when, they appear in ALL CAPITALS.

DOMException names (`"InvalidStateError"`, `"NotAllowedError"`, `"DataError"`, `"NotFoundError"`, `"QuotaExceededError"`) refer to those defined in [[WEBIDL]].

A conforming user agent MUST:

1. Implement the data model in [§3](#3-data-model).
2. Implement the `navigator.graph` API in [§4](#4-api).
3. Implement graph snapshots ([§5](#5-graph-snapshots)) including the content-hash algorithm in [§5.2](#52-content-hash-computation) and the lossless serialisation format in [§5.3.1](#531-the-canonical-serialisation).
4. Support per-graph persistent storage as required by [§6](#6-storage).
5. Implement holonic SPARQL queries as defined in [§7](#7-holonic-composition-and-sparql).

A conforming user agent MAY expose the GraphManager interface in dedicated worker realms ([§4.4](#44-cross-realm-and-cross-document-behaviour)).

---

## 3. Data Model

### 3.1 Triple

A **Triple** is a directed labelled relationship — subject, predicate, object. This specification follows RDF 1.2 semantics [[RDF12-CONCEPTS]].

- The `subject` attribute MUST be a valid URI [[RFC3986]] or a blank-node identifier (an opaque string beginning with `_:`).
- The `predicate` attribute MUST be a valid URI [[RFC3986]]. **Predicate is REQUIRED.** Predicates may use any URI scheme; conforming user agents do not require predicate schemes to be IANA-registered.
- The `object` attribute MUST be a valid URI, a blank-node identifier, or a `LiteralValue`.

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
  constructor(DOMString lexicalValue, optional LiteralValueInit init = {});
  readonly attribute DOMString lexicalValue;
  readonly attribute USVString datatype;     // XSD URI; defaults to xsd:string
  readonly attribute USVString? language;    // BCP 47; only meaningful for rdf:langString
};

dictionary LiteralValueInit {
  USVString datatype = "http://www.w3.org/2001/XMLSchema#string";
  USVString? language;
};
```

A `LiteralValue` serialises (in N-Triples/N-Quads 1.2 and in `Triple.toString()`) as:

- `"<lexical>"^^<datatype>` when `datatype` is not `xsd:string`;
- `"<lexical>"@<language>` when `language` is set (in which case `datatype` MUST be `rdf:langString`);
- `"<lexical>"` when `datatype` is `xsd:string` and `language` is absent.

The lexical form MUST be escaped per [[N-TRIPLES]].

### 3.2 Triple Provenance via RDF 1.2 Reifiers

Per-triple provenance — author, timestamp, signature — is carried using RDF 1.2 reifiers. A reifier is a node that **reifies** a triple (via `rdf:reifies` referencing a triple term `<<( s p o )>>`) and carries metadata about the triple as additional triples. Provenance is therefore SPARQL-visible and round-trips through the canonical serialisation defined in [§5.3.1](#531-the-canonical-serialisation).

```turtle
# A data triple:
<urn:event:1> <https://schema.org/name> "Coffee with Alice" .

# Its reifier (a blank node):
_:r1 rdf:reifies <<( <urn:event:1> <https://schema.org/name> "Coffee with Alice" )>> .
_:r1 <prov://author>      <did:key:z6Mk...> .
_:r1 <prov://timestamp>   "2026-05-23T12:00:00Z"^^xsd:dateTime .
_:r1 <prov://method>      <did:key:z6Mk...#z6Mk...> .   # verification method that signed
_:r1 <prov://signature>   "z58D..." .                   # multibase-encoded signature bytes
```

The four `prov://*` predicates above are defined by this specification. Their object semantics:

| Predicate           | Object datatype                     | Meaning                                                            |
|---------------------|-------------------------------------|--------------------------------------------------------------------|
| `prov://author`     | URI (a DID)                         | The author DID, per [[DECENTRALISED-IDENTITY]].                    |
| `prov://timestamp`  | `xsd:dateTime` (RFC 3339)           | When the triple was signed.                                        |
| `prov://method`     | URI (a verification method URI)     | The specific verification method used; resolvable per [[DID-CORE]]. |
| `prov://signature`  | `xsd:string` (multibase-encoded)    | Signature bytes over the payload defined in [§3.2.1](#321-signature-payload). |

#### 3.2.1 Signature Payload

The signature payload is:

```
payload = SHA-256( canonical(triple) ‖ "|" ‖ timestamp ‖ "|" ‖ graphIdentifier )
```

where:

- `canonical(triple)` is the triple's serialisation as one N-Triples 1.2 line per [[N-TRIPLES]] (no terminating newline). `LiteralValue` objects serialise per [§3.1](#31-triple).
- `timestamp` is the `xsd:dateTime` lexical form (RFC 3339).
- `graphIdentifier` is the value of `Graph.did` if set, otherwise the value of `Graph.id` ([§3.3](#33-graph)). Binding the signature to a stable identifier prevents reifier signatures being silently relabelled into another graph; the volatile `iri` is NOT used because it would invalidate every reifier on the next mutation.
- `‖` denotes byte concatenation; `"|"` is the literal pipe character (U+007C).

The **signature operation** is `DIDCredential.signRaw(payload)` per [[DECENTRALISED-IDENTITY]] §6.1. The signature algorithm follows the verification method; this specification does not pin a particular algorithm. The resulting bytes are multibase-encoded (with the `z` (base58btc) prefix recommended) and stored as `prov://signature`.

#### 3.2.2 Mandatory Reifier Attachment

User agents MUST attach a reifier carrying the four predicates above to every triple they accept via `addTriple()` ([§4.2](#42-triple-operations)). Reifier triples are part of the graph's triple set and are included in:

- The content-hash computation ([§5.2](#52-content-hash-computation)).
- The canonical snapshot serialisation ([§5.3.1](#531-the-canonical-serialisation)).
- SPARQL query results that match the reifier subject.
- `Graph.snapshot()` results (sorted alongside their data triples).

User agents SHOULD verify reifier signatures on every triple read from a graph whose `trustLevel` is not `"local"`.

#### 3.2.3 Timestamp Representation

All **provenance-bearing timestamps** in this specification — values that travel on the wire, enter signed material, or are otherwise reproducible across agents (`Reifier.timestamp`, `SignedContent.timestamp` [[DECENTRALISED-IDENTITY]], `GraphSnapshot.timestamp`) — are RFC 3339 strings [[RFC3339]]. They are exposed on Web IDL interfaces as `DOMString`, and serialised in RDF as `"…"^^xsd:dateTime` typed literals. The two representations are equivalent; `DOMString` is the API form, the typed literal is the on-wire/canonical form. **Operational timestamps** local to the user agent (event firing order, performance metrics) MAY use `DOMTimeStamp` (milliseconds since the Unix epoch).

### 3.3 Graph

A **Graph** is a named set of triples. Its `iri` is a `graph://<content-hash>` URI computed deterministically from the graph's triples (data triples plus their reifier triples) per [§5.2](#52-content-hash-computation). The IRI is a snapshot identifier:

- **The IRI changes whenever the graph's triples change.** Adding, removing, or rewriting a triple advances the graph to a new state with a new IRI.
- **Two graphs with the same triples have the same IRI.** Content-addressing means the address is a function of the content alone — not of which agent assembled it, when, or why. In particular, every empty graph shares the IRI of the canonicalised empty triple-set; this is intentional, and graphs are tracked locally by their stable internal `id`, not by IRI.
- **The same IRI never names two different states.** An IRI is a content commitment; verifying that a received bag of triples matches a given IRI is one canonicalisation + one SHA-256 + a string compare.

A graph carries:

- A stable internal `id` (a URN), assigned at creation and never changing. This is what the user agent uses to track the graph across IRI mutations and what the storage layer keys on.
- A *current* IRI (`graph://<content-hash>`), recomputed after every mutation.
- An optional `did` — an identifier separate from the content-hash IRI that identifies the graph across all its states. This specification defines the slot and the semantics of having one (signing, snapshot binding, see [§5.5](#55-iri-vs-did)) but does not define how the slot is populated; that is left to other specifications or to application code.
- A `displayName` (optional human-readable label).
- A `trustLevel` (see [§7.4](#74-trust-levels-defined-by-this-specification)).
- Zero or more RDF 1.2 triples — the graph itself, comprising both data triples and their reifier triples.

```webidl
[Exposed=(Window,Worker), SecureContext]
interface Graph : EventTarget {
  /** Stable internal identifier (URN), unchanged for the lifetime of the graph. */
  readonly attribute USVString id;
  /** Current snapshot IRI — graph://<content-hash> of the current triple set. */
  readonly attribute USVString iri;
  /** Optional DID identifying the graph across all its states. Null when none is attached. */
  readonly attribute USVString? did;
  readonly attribute DOMString? displayName;
  /** Provenance tag for this graph's local instance — see §7.4. */
  readonly attribute GraphTrustLevel trustLevel;

  // Triple operations — see §4.2.
  [NewObject] Promise<Triple> addTriple(Triple triple);
  [NewObject] Promise<sequence<Triple>> addTriples(sequence<Triple> triples);
  [NewObject] Promise<boolean> removeTriple(Triple triple);
  [NewObject] Promise<sequence<Triple>> queryTriples(TripleQuery query);
  [NewObject] Promise<SparqlResult> querySparql(USVString sparql, optional SparqlQueryOptions options = {});
  [NewObject] Promise<sequence<Triple>> snapshot();
  [NewObject] Promise<sequence<Reifier>> provenance(Triple triple);
  [NewObject] Promise<GraphSnapshot> getAsSnapshot(optional GraphSnapshotOptions options = {});
  [NewObject] Promise<undefined> dissolve();

  attribute EventHandler ontripleadded;
  attribute EventHandler ontripleremoved;
};

enum GraphTrustLevel { "local", "external" };
```

The `GraphTrustLevel` enum lists the values defined by this specification ([§7.4](#74-trust-levels-defined-by-this-specification)). Other specifications MAY extend the enum.

### 3.4 GraphManager

The **GraphManager** is the user agent's entry point for creating and materialising graphs. It is reached via `navigator.graph`.

```webidl
[Exposed=(Window,Worker), SecureContext]
partial interface Navigator {
  [SameObject] readonly attribute GraphManager graph;
};

[Exposed=(Window,Worker), SecureContext]
interface GraphManager {
  /** Create a fresh, empty graph owned by the calling agent. */
  [NewObject] Promise<Graph> create(optional GraphCreationOptions options = {});
  /** Materialise a graph from a previously-serialised snapshot. */
  [NewObject] Promise<Graph> fromSnapshot(GraphSnapshot snapshot, optional GraphFromSnapshotOptions options = {});
};

dictionary GraphCreationOptions {
  DOMString displayName;
};

dictionary GraphFromSnapshotOptions {
  GraphTrustLevel trustLevel = "external";
};
```

This specification deliberately exposes only graph creation and snapshot materialisation on `GraphManager`. Mechanisms for enumerating, re-opening by IRI, sharing across origins, mounting for collaborative writes, and synchronising across agents are not defined here; the user agent MAY maintain whatever internal registries those use cases require without exposing them as JavaScript surface in this specification.

### 3.5 TripleQuery

```webidl
dictionary TripleQuery {
  USVString? subject;
  USVString? predicate;
  USVString? object;
  USVString? author;        // matches reifier prov://author
  DOMString? fromDate;      // RFC 3339; matches reifier prov://timestamp >= fromDate
  DOMString? untilDate;     // RFC 3339; matches reifier prov://timestamp <  untilDate
  unsigned long? offset;
  unsigned long? limit;
};
```

`queryTriples()` returns triples whose data triple matches the supplied `subject`/`predicate`/`object` and whose reifier matches `author`/`fromDate`/`untilDate`. All supplied fields combine with logical AND. Reifier triples (subjects beginning `_:r`) are not returned by `queryTriples()`; they are retrieved by `provenance()` instead.

### 3.6 SparqlQueryOptions

```webidl
dictionary SparqlQueryOptions {
  /** Other Graphs to include as named graphs in the SPARQL dataset.
   *  Each is addressable in the query via GRAPH <graph.iri> { ... }. */
  sequence<Graph> namedGraphs;
  /** Query timeout in milliseconds. After this duration the query MUST
   *  reject with `"TimeoutError"`. */
  unsigned long? timeout;
};
```

The dataset construction for a SPARQL query is defined in [§7](#7-holonic-composition-and-sparql).

### 3.7 Reifier

```webidl
[Exposed=(Window,Worker)]
interface Reifier {
  readonly attribute USVString id;
  readonly attribute Triple triple;
  readonly attribute USVString author;        // DID URI (value of prov://author)
  readonly attribute DOMString timestamp;     // RFC 3339 (value of prov://timestamp)
  readonly attribute USVString method;        // verification method URI (value of prov://method)
  readonly attribute DOMString signature;     // multibase-encoded (value of prov://signature)
};
```

The `Reifier.id` is the blank-node identifier of the reifier in the current graph state. It is stable for the lifetime of a `Graph` instance; across serialisation and materialisation it may be relabelled (canonicalisation renames blank nodes), but the canonical form — and therefore the IRI — is unchanged.

---

## 4. API

### 4.1 Creating a Graph

```webidl
[NewObject] Promise<Graph> create(optional GraphCreationOptions options = {});
```

The `create()` method MUST:

1. Allocate a fresh internal `id` of the form `urn:graph:<UUIDv4>` per [[RFC4122]].
2. Allocate a fresh per-graph store ([§6](#6-storage)), keyed by that `id`.
3. Construct and return a `Graph` whose initial state has no application triples. Its `iri` is `graph://<content-hash-of-the-empty-set>`; its `did` is `null`; its `trustLevel` is `"local"`.

The empty-graph IRI is an invariant: all freshly-created empty graphs share it. The user agent disambiguates them by their internal `id`; once any triple is written, the IRI diverges. Applications that need a stable identifier from creation onward SHOULD attach a `did`; how a `did` is attached is not defined by this specification.

### 4.2 Triple Operations

When called on a `Graph`, `addTriple(triple)` MUST execute the following algorithm:

1. **Liveness check.** If the graph has been dissolved ([§4.3](#43-dissolving-a-graph)), reject with `"InvalidStateError"`.
2. **Identity resolution.** Obtain the active `DIDCredential` per [[DECENTRALISED-IDENTITY]] §3. If none is available, reject with `"InvalidStateError"`.
3. **Pre-write validation (extension point).** This specification defines no pre-write validation. Other specifications MAY amend this step to add validation steps; see [§8.2](#82-amending-algorithms). The default is to perform no validation and proceed to step 4.
4. **Reifier construction.** Compute the signature payload per [§3.2.1](#321-signature-payload), invoke `signRaw(payload)` on the active credential, and assemble the reifier triples (`prov://author`, `prov://timestamp`, `prov://method`, `prov://signature`) bound to the data triple via `rdf:reifies`.
5. **Commit.** Persist the data triple and all four reifier triples atomically to the per-graph store ([§6.4](#64-crash-recovery)).
6. **IRI update.** Invalidate the cached IRI; the next read of `graph.iri` recomputes it per [§5.2](#52-content-hash-computation).
7. **Dispatch.** Fire a `tripleadded` event whose `triple` attribute is the newly-written data triple.
8. **Resolve** the returned promise with the data triple.

`addTriples(triples)` runs the same algorithm in a single batch:

- Steps 1–4 run for each input triple. If any rejection occurs, the entire batch is aborted and no triple is committed.
- Step 5 (commit) is a single atomic transaction over the entire batch.
- Step 6 (IRI update) happens once at the end of the batch; the IRI advances exactly once.
- Step 7 (dispatch) fires one `tripleadded` event per committed triple, in input order, after the batch commits.

`removeTriple(signed)` removes a triple and its four reifier triples. Two triples are considered equal for removal purposes when their `subject`, `predicate`, `object`, and reifier `author` + `timestamp` all match. The IRI advances; a `tripleremoved` event fires. The graph's storage write is atomic.

`queryTriples()` returns data triples (NOT reifier triples) matching the `TripleQuery` per [§3.5](#35-triplequery). Results are sorted by reifier timestamp descending; ties broken by subject IRI ascending.

`querySparql()` executes a SPARQL 1.2 query over a dataset constructed per [§7](#7-holonic-composition-and-sparql).

`snapshot()` returns the data triples currently in the graph, ordered by reifier timestamp ascending. (For the addressable, signed form see [§5](#5-graph-snapshots).)

`provenance(triple)` returns all reifiers whose `rdf:reifies` target matches the given triple (by subject/predicate/object).

After `dissolve()` ([§4.3](#43-dissolving-a-graph)), all of the above operations reject with `"InvalidStateError"`.

### 4.3 Dissolving a Graph

```webidl
[NewObject] Promise<undefined> dissolve();
```

`dissolve()` MUST:

1. Release the graph's per-graph store from local persistent storage.
2. Close any broadcast channels or listeners associated with the graph.
3. Mark the `Graph` object as dissolved. Subsequent calls to any method other than `dissolve()` itself MUST reject with `"InvalidStateError"`. Subsequent calls to `dissolve()` MUST resolve with `undefined` (idempotent).

Dissolution is local to the calling user agent. Other agents that hold their own materialisation of the same `graph://<content-hash>` are unaffected.

### 4.4 Cross-Realm and Cross-Document Behaviour

`navigator.graph` is per-realm: each `Window` and each dedicated worker has its own `GraphManager` instance. `Graph` instances are local to the realm that created or materialised them; `Graph` is **not** structured-cloneable and MUST NOT be transferred across realms.

Different realms on the same origin (e.g., multiple tabs of the same page, a page and its dedicated worker) share the underlying per-graph storage ([§6](#6-storage)). When one realm mutates a graph, other realms holding a `Graph` object backed by the same per-graph store MUST observe the mutation by firing `tripleadded`/`tripleremoved` events in the order the writes were committed. The mechanism for cross-realm notification is implementation-defined; user agents implementing this specification on top of browser primitives are RECOMMENDED to use `BroadcastChannel` keyed by the graph's internal `id`.

Cross-origin sharing of a graph is not defined by this specification.

---

## 5. Graph Snapshots

This section is normative.

### 5.1 The Principle

A graph's `iri` *is* its current snapshot address. A **GraphSnapshot** wraps the IRI with the serialised triples (data + reifier triples) and one or more cryptographic proofs, so the snapshot can be transported and verified by another agent. Verification is one canonicalisation + one SHA-256 + a string compare against `snapshot.graphIri`.

### 5.2 Content Hash Computation

The content hash of a graph is computed as follows:

1. Form the **canonical dataset**: the union of the graph's data triples and their reifier triples, all placed in the default graph of an RDF dataset (no named graphs).
2. Canonicalise the dataset by running RDF Dataset Canonicalization [[RDF-CANON]] (the `rdfc-1.0` algorithm) over it. The output is the canonical N-Quads serialisation as a UTF-8 byte sequence.
3. Compute SHA-256 of those UTF-8 bytes.
4. Encode the digest as lowercase hexadecimal.

The **IRI** is the literal string `graph://` concatenated with the hexadecimal digest from step 4.

A conforming user agent MUST recompute the IRI whenever the triple set changes and MUST update `graph.iri` accordingly. Recomputation MAY be deferred until the IRI is read (the cached IRI is invalidated by every mutation); the value MUST be consistent with the canonical-dataset definition above whenever it is observable.

Observers that need to react to IRI changes do so via `tripleadded` / `tripleremoved` events; this specification defines no separate `iriChanged` event because every IRI change is caused by exactly one such event (or one `addTriples` batch).

### 5.3 Serialisation Formats

Two roles of serialisation are distinguished:

- The **canonical serialisation** (§5.3.1) is lossless: it preserves the full triple set including reifier triples, and `fromSnapshot()` can re-materialise an identical graph (same IRI) from it. This is the only format guaranteed to round-trip.
- **Export formats** (§5.3.2) are intended for interoperability with external tools that operate on data triples only. They are lossy: they discard reifier triples (or downgrade them to non-RDF-1.2 reification), and a snapshot in an export format MUST NOT be passed to `fromSnapshot()`.

```webidl
enum SnapshotFormat { "nquads-canonical", "nquads", "turtle", "jsonld" };
enum GraphSignBy    { "agent", "graph", "both" };

dictionary GraphSnapshotOptions {
  SnapshotFormat format = "nquads-canonical";
  GraphSignBy   signBy = "agent";
};

[Exposed=(Window,Worker)]
interface GraphSnapshot {
  /** The content-hash IRI of this snapshot. */
  readonly attribute USVString graphIri;
  /** The DID of the underlying graph, if one is attached. Null otherwise. */
  readonly attribute USVString? graphDid;
  readonly attribute SnapshotFormat format;
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

#### 5.3.1 The Canonical Serialisation

The `"nquads-canonical"` format is the canonical N-Quads output of RDF Dataset Canonicalization [[RDF-CANON]] over the graph's full triple set (data triples + reifier triples) per [§5.2](#52-content-hash-computation), placed in the default graph of the dataset.

This format is lossless:

- It contains every triple that contributes to the IRI.
- Reifier triples are present, with their `rdf:reifies` triple-term targets and all four `prov://*` predicates.
- Blank-node labels are canonical (the [[RDF-CANON]] output is a function of the abstract triples, not of the labels supplied to the algorithm).

A snapshot in `"nquads-canonical"` format MUST satisfy:

```
snapshot.graphIri == "graph://" + hex(SHA-256(snapshot.data))
```

This is the invariant that `fromSnapshot()` ([§5.4](#54-materialising-a-snapshot)) checks.

#### 5.3.2 Export Formats

The `"nquads"`, `"turtle"`, and `"jsonld"` formats serialise the **data triples only**, omitting reifier triples. They are intended for interoperability with external RDF tooling that does not understand RDF 1.2 reifiers. A user agent that produces these formats MUST emit only the data triples (subjects not beginning `_:r-`) and MUST emit them in the canonical order produced by [[RDF-CANON]].

Snapshots in export formats:

- MAY be transported, archived, and inspected by RDF tooling.
- MUST NOT be passed to `fromSnapshot()`. Calling `fromSnapshot()` with `snapshot.format !== "nquads-canonical"` MUST reject with `"NotSupportedError"`.

A user agent that needs to import a non-canonical snapshot MUST do so via application code that re-signs each triple under the importing identity; the resulting graph will have a different IRI from the source.

### 5.4 Producing a Snapshot

`Graph.getAsSnapshot(options?)` MUST:

1. Compute the canonical dataset per [§5.2](#52-content-hash-computation) steps 1–2.
2. Compute `graphIri` per [§5.2](#52-content-hash-computation) steps 3–4.
3. Serialise the dataset per [§5.3.1](#531-the-canonical-serialisation) when `format` is `"nquads-canonical"`, or per [§5.3.2](#532-export-formats) otherwise.
4. Capture `timestamp` as the current time in RFC 3339 form.
5. Produce proofs. Let `proofPayload = SHA-256(graphIri || "|" || timestamp)`:
   - If `signBy` is `"agent"` or `"both"`, sign `proofPayload` with the active agent credential and append a proof with `role = "agent"`.
   - If `signBy` is `"graph"` or `"both"`, REQUIRE that `graph.did` is set AND that the active credential's `did` equals `graph.did`. If either condition fails, reject with `"NotAllowedError"`. Otherwise sign `proofPayload` with the active credential and append a proof with `role = "graph"`. (This specification does not define a graph-delegate model; other specifications that introduce delegate signing for graph DIDs amend this step per [§8.2](#82-amending-algorithms).)
   - If `signBy` is `"both"` and either proof cannot be produced, reject with `"NotAllowedError"`.
6. Construct and return the `GraphSnapshot`.

### 5.5 Materialising a Snapshot

`GraphManager.fromSnapshot(snapshot, options?)` MUST:

1. **Format check.** If `snapshot.format` is not `"nquads-canonical"`, reject with `"NotSupportedError"`. Only the canonical format is round-trippable; see [§5.3.2](#532-export-formats).
2. **Proof check.** Verify every proof in `snapshot.proofs`. If `snapshot.proofs` is empty OR any proof fails verification, reject with `"DataError"`.
3. **Hash check.** Compute `expected = "graph://" + hex(SHA-256(snapshot.data))`. If `expected !== snapshot.graphIri`, reject with `"DataError"`.
4. **Parse.** Parse `snapshot.data` as N-Quads 1.2 [[N-QUADS]]. Recover the data triples and their reifier triples.
5. **Allocate.** Mint a fresh internal `id` and per-graph store as in `create()` ([§4.1](#41-creating-a-graph)).
6. **Insert.** Write every triple (data + reifier) into the new per-graph store without re-signing.
7. **DID attachment.** If `snapshot.graphDid` is non-null, set the materialised graph's `did` attribute to that value. This specification does not define which predicate inside the graph's triples carries the DID binding; the snapshot's top-level `graphDid` field is the authoritative source for materialisation purposes.
8. **Trust level.** Set `graph.trustLevel` to `options.trustLevel` (defaulting to `"external"`).
9. **Verify invariant.** Confirm that the newly-materialised graph's computed IRI equals `snapshot.graphIri`. If not, dissolve the graph and reject with `"DataError"`. (This is a defensive check; with a correct implementation it cannot fail.)
10. Return the `Graph`.

The materialised graph's `iri` equals `snapshot.graphIri` *at this instant*; any subsequent mutation will change it.

### 5.6 IRI vs DID

The graph IRI (`graph://<content-hash>`) is the **snapshot address** — it identifies one specific state. Verifying integrity ("are these the triples that produce this hash?") and content equivalence ("do these two graphs have the same triples?") both reduce to comparing IRIs. An IRI cannot, by construction, change while pointing to the same content; conversely, two distinct states of an evolving graph have two distinct IRIs.

A graph's optional **DID** (the `did` attribute) is the **content-independent identity** — it identifies the *graph* across all its states. "Is this the same graph I was talking to before?" reduces to a DID comparison.

Both layers serve different purposes and SHOULD be used together where applicable:

- A long-lived authorisation token whose `resource` is a graph SHOULD target the DID (it then applies across all states); one that authorises action against one specific snapshot MAY target the IRI.
- A live subscription to an evolving graph is keyed by the DID (the IRI changes every write).
- A snapshot transfer for archival uses the IRI as the verifiable, immutable address.
- A signed assertion of "I observed this graph at state X" pairs the DID with the IRI.

The DID is also the only `signBy: "graph"` referent ([§5.4](#54-producing-a-snapshot) step 5).

---

## 6. Storage



This section is split into normative requirements ([§6.1](#61-normative-requirements)) and informative implementation guidance ([§6.2](#62-implementation-guidance)).

### 6.1 Normative Requirements

A conforming user agent MUST:

1. **Persist.** Graph data MUST persist across browsing sessions and user-agent restarts.
2. **Isolate per origin.** Each origin maintains an independent set of graphs. Two origins MUST NOT share a per-graph store, even if they hold the same graph IRI. The mechanism is the same per-origin partitioning used by [[INDEXEDDB]].
3. **Write transactionally.** Every triple write (`addTriple`, `addTriples`, `removeTriple`) MUST be atomic with respect to crash recovery: after a crash or process termination, the per-graph store MUST be either in its pre-mutation state or in its fully-committed post-mutation state, never in between.
4. **Apply storage quotas.** Storage usage MUST be accounted against the origin's quota per [[STORAGE]]. When the quota is exceeded, write operations MUST reject with `"QuotaExceededError"`.
5. **Honour user persistence preferences.** When the user has granted persistent storage per [[STORAGE]] §6, graph data MUST survive automatic eviction. Otherwise, the user agent MAY evict per-graph stores under storage pressure, in which case `Graph` instances backed by an evicted store MUST behave as if dissolved ([§4.3](#43-dissolving-a-graph)).
6. **Respect "clear browsing data".** When the user clears site data for the origin, all per-graph stores for that origin MUST be removed.

### 6.4 Crash Recovery

User agents MUST use transactional writes for graph mutations as required by [§6.1](#61-normative-requirements) item 3. The reifier triples and the data triple of a single write are committed as one atomic unit; partial commits are not observable.

### 6.2 Implementation Guidance

This section is informative.

A typical implementation maintains one storage subtree per graph, keyed by the graph's internal `id`. Open subtrees may be cached behind an LRU; a cache size of 64 is reasonable for general-purpose user agents. On reference release the implementation may close the subtree to free file handles, reopening it on next access.

Storage layout RECOMMENDED for browser-based implementations:

```
<origin>/<agent>/graphs/<graph-id>/triples
<origin>/<agent>/graphs/<graph-id>/reifiers
```

implemented over [[INDEXEDDB]] or the Origin Private File System. Other backends (SQLite, B-tree files) are equally valid as long as the normative requirements in [§6.1](#61-normative-requirements) are met.

---

## 7. Holonic Composition and SPARQL

This section is normative.

### 7.1 Graphs as Holons

A graph is a **holon**: a whole that is also a part. Holonic composition is structural — it falls out of two existing properties of the data model:

- Every graph has a globally unique IRI.
- Any triple may have a `graph://...` IRI in its subject or object position.

A triple `<a> <hasChannel> <graph://b>` makes the graph identified by `graph://b` a part of the graph that contains the triple. The relationship is by reference; no copy is made. Either graph remains independently addressable, mutable (within its own scope), and queryable.

There is no restriction on:

- **Depth.** Graphs may reference graphs that reference graphs, to any depth.
- **Direction.** A graph may reference another graph that references it back; cycles are permitted.
- **Multiplicity.** A graph may participate in any number of parent compositions and contain any number of part graphs.

### 7.2 SPARQL Dataset Construction

`Graph.querySparql(sparql, options)` constructs a SPARQL 1.2 dataset [[SPARQL12-QUERY]] as follows:

1. The **default graph** of the dataset is the `Graph` on which `querySparql` was called. Its IRI at query-start time is used.
2. The **named graphs** of the dataset are the entries of `options.namedGraphs` (an empty sequence if absent). Each named graph is keyed in the dataset by its current `iri` at query-start time.
3. The query is executed against the resulting dataset per [[SPARQL12-QUERY]]. All `Graph` instances in the dataset (default + named) MUST appear consistent throughout query execution; concurrent mutations to any of them MUST NOT be observed mid-query. (Implementations typically achieve this by snapshotting each Graph's triple set at query-start and querying over the snapshots.)
4. If `options.timeout` is set and the query has not completed by that duration, the query MUST be aborted and the promise rejected with `"TimeoutError"`.

`GRAPH ?g { ... }` in the query body matches over the named graphs. `GRAPH <graph://abc...> { ... }` matches the named graph with that exact IRI; if no `Graph` in the dataset has that IRI, the inner pattern matches no solutions.

This specification does not auto-resolve `graph://...` IRIs referenced in query patterns into the dataset. The caller is responsible for assembling the holon of graphs they want to query by passing the relevant `Graph` instances via `options.namedGraphs`. This keeps the algorithm deterministic and side-effect-free; user agents and applications MAY layer auto-resolution on top.

### 7.3 Holonic Query Examples

A community graph that has a triple `<community> <hasChannel> <graph://general...>` can be queried with the channel graph included:

```javascript
const messages = await communityGraph.querySparql(`
  SELECT ?msg ?body ?author WHERE {
    <community> <hasChannel> ?channelIri .
    GRAPH ?channelIri {
      ?msg <msg:body>   ?body ;
           <msg:author> ?author .
    }
  }
`, { namedGraphs: [channelGraph] });
```

The default graph holds the `<community> <hasChannel> ...` triple; the named graph holds the messages. SPARQL bridges them in one request.

### 7.4 Trust Levels Defined by This Specification

`Graph.trustLevel` carries the provenance of the local instance:

| Value          | Set by                                                         | Meaning                                                                |
|----------------|----------------------------------------------------------------|------------------------------------------------------------------------|
| `"local"`      | `GraphManager.create()` ([§4.1](#41-creating-a-graph))         | Created on this user agent by the calling agent.                       |
| `"external"`   | `GraphManager.fromSnapshot()` ([§5.5](#55-materialising-a-snapshot)) | Materialised from a snapshot received from outside this user agent.    |

Other specifications MAY extend the `GraphTrustLevel` enum to introduce additional provenance values (e.g., live-synced sources). The trust level participates in [§9.1](#91-reifier-signature-verification): user agents SHOULD verify reifier signatures on every read from a non-`"local"` graph.

---

## 8. Extensibility

This section describes how other specifications amend this one. It is normative for those specifications; it is informative for consumers of the `Graph` and `GraphManager` interfaces.

### 8.1 Amending Interfaces

Other specifications MAY add operations, attributes, and event handlers to `Graph`, `GraphManager`, and `Triple` via Web IDL `partial interface` declarations [[WEBIDL]]. They MUST NOT redefine or remove members defined here. They MAY extend the `GraphTrustLevel` and `SnapshotFormat` enums by declaring additional values.

### 8.2 Amending Algorithms

Several algorithms in this specification have explicit amendment points where other specifications insert behaviour:

- **`addTriple` step 3 (pre-write validation).** Other specifications MAY require additional checks before commit (e.g., shape conformance, capability authorisation). Each such specification MUST define: which step it amends, where the new step is inserted, what input it receives, what rejection it produces, and how it composes with other amendments. Composition order is the order in which the specifications are imported into the user agent.
- **`getAsSnapshot` step 5 (`signBy: "graph"`).** Other specifications that introduce delegate-signing models for graph DIDs MAY amend the credential-equality check to also accept signatures by current delegates of `graph.did`.
- **`fromSnapshot` step 7 (DID attachment).** Other specifications that store the DID binding inside the graph's triples (rather than relying solely on the snapshot's top-level `graphDid`) MAY amend this step to also recover the DID from in-graph triples and to validate consistency with `snapshot.graphDid`.

Amendments MUST NOT relax any safety invariant defined here (e.g., the IRI-equality check in `fromSnapshot` step 9).

### 8.3 Predicate and Trust-Level Reservations

Other specifications MUST NOT define predicates in the `prov://` namespace; that namespace is reserved by this specification.

Other specifications MAY define new `GraphTrustLevel` values, new `SnapshotFormat` values, and new predicates in any other URI scheme.

---

## 9. Security Considerations

### 9.1 Reifier Signature Verification

User agents SHOULD verify reifier signatures on every triple read from a graph whose `trustLevel` is not `"local"`. Triples without a valid reifier signature MUST be marked unverified or filtered out of `queryTriples()` / `querySparql()` results.

Verification of a reifier:

1. Recompute the signature payload per [§3.2.1](#321-signature-payload).
2. Resolve the `prov://method` URI to a public key per [[DID-CORE]].
3. Verify the `prov://signature` against the payload using the algorithm associated with the verification method.

### 9.2 Snapshot Integrity

The trust of a materialised graph is bounded by the trust of the proofs on its source snapshot. `fromSnapshot()` MUST verify all proofs and the hash invariant before persisting any triples ([§5.5](#55-materialising-a-snapshot) steps 2–3).

Snapshots with empty `proofs` MUST be rejected with `"DataError"`; an unsigned snapshot offers no integrity guarantee against tampering during transport.

### 9.3 Replay Protection

A snapshot is content-addressed; replaying a previously-applied snapshot has no effect beyond materialising the same graph again (a no-op if it is already materialised). A graph IRI may be observed by multiple parties; the IRI itself is not a secret.

The `proofPayload` includes the snapshot's `timestamp` ([§5.4](#54-producing-a-snapshot) step 5) so that proofs are not silently reusable across snapshots of the same IRI; verifiers MAY enforce that snapshot timestamps are not unreasonably far in the past relative to the verifier's clock.

### 9.4 Signing-Oracle Limits

`addTriple` invokes the active credential's `signRaw()`. User agents that obtain credentials via [[DECENTRALISED-IDENTITY]] SHOULD enforce signing rate limits on credentials shared with script, to prevent malicious script from extracting signatures over arbitrary content. The user agent MAY refuse `addTriple` calls that exceed a per-credential rate limit, rejecting with `"NotAllowedError"`.

### 9.5 Storage Quotas

User agents MUST apply storage quotas consistent with [[STORAGE]]. Per-graph quota visibility SHOULD be exposed to the user. Applications MUST handle `"QuotaExceededError"` from triple writes; user agents SHOULD prompt the user before evicting any graph.

### 9.6 Trust-Level Downgrade

`Graph.trustLevel` is determined at materialisation time and is not mutable from script. Other specifications that amend the trust-level enum MUST define their own setting paths and MUST NOT permit script to elevate trust from `"external"` to `"local"`.

### 9.7 Large-Snapshot DoS

A maliciously crafted snapshot could be arbitrarily large. User agents MUST apply a configurable upper bound on `snapshot.data` size for `fromSnapshot()`; the RECOMMENDED bound is the lesser of 100 MB or 10% of remaining origin quota. Exceeding the bound MUST reject with `"QuotaExceededError"`.

---

## 10. Privacy Considerations

### 10.1 Local-First by Default

Locally-created graphs are local-first. No data leaves the user's device unless the user (or application acting on the user's behalf) explicitly exports it (via `getAsSnapshot()` followed by transport, or via a separately-defined sync mechanism).

### 10.2 Per-Graph Identity

The recommended privacy posture is per-graph identity: an agent uses a different `did:key` for different graphs. The substrate makes this cheap; the graph IRI is the natural correlation boundary. User agents SHOULD allow users to create per-graph identities and SHOULD suggest doing so when the privacy posture warrants it.

### 10.3 DID Correlation

If an agent uses the same `did:key` as `prov://author` across multiple graphs, those graphs can correlate the agent's activity. The reifier `prov://author` is part of the canonical hash and therefore appears in any export of the graph. Privacy-sensitive applications SHOULD use a per-graph credential.

### 10.4 Graph Metadata

The existence, IRI, optional `did`, and `displayName` of a graph could reveal information. `GraphManager.create()` and `GraphManager.fromSnapshot()` return `Graph` instances only to the calling realm (which is, in turn, scoped to the calling origin); this specification defines no enumeration or lookup API on `GraphManager` that could leak graphs to other origins.

### 10.5 Stable IRIs as a Fingerprint

Because two parties who hold the same graph compute the same `graph://<hash>` IRI, the IRI is a high-entropy shared identifier. Sharing an IRI with a third party effectively confesses to holding that exact triple set. Applications SHOULD treat graph IRIs as confidential when the graph's existence on a particular agent is itself sensitive.

### 10.6 Snapshot Timestamp Disclosure

`snapshot.timestamp` reveals when the snapshot was produced; reifier timestamps reveal when each triple was authored. These are unavoidable because they are part of the signed material. Applications that need to obscure write times SHOULD batch writes and rotate the active credential.

---

## 11. IANA Considerations

### 11.1 The `graph` URI Scheme

This specification defines the `graph://` URI scheme. Registration is requested per [[RFC7595]].

| Field                          | Value                                                                                            |
|--------------------------------|--------------------------------------------------------------------------------------------------|
| Scheme name                    | `graph`                                                                                          |
| Status                         | Provisional                                                                                      |
| Applications/protocols         | Web platform; this specification                                                                 |
| Contact                        | [TBD]                                                                                            |
| Change controller              | W3C                                                                                              |
| References                     | This document                                                                                    |

**Syntax**: a `graph://` URI is `graph://` followed by 64 lowercase hexadecimal characters (a SHA-256 digest). No additional path, query, or fragment components are defined; user agents MUST treat URIs that contain them as invalid.

```
graph-uri = "graph://" 64HEXDIGLOW
HEXDIGLOW = DIGIT / "a" / "b" / "c" / "d" / "e" / "f"
```

**Encoding considerations**: percent-encoding is not used (the syntax restricts characters to ASCII hex). `graph://` URIs are case-sensitive; hex digits MUST be lowercase.

**Security considerations**: a `graph://` URI is a commitment to a specific triple set. Possession of the URI does not imply possession of the underlying graph; resolution of a `graph://` URI to its triples is application-defined (snapshot transport, peer-to-peer fetch, or local lookup) and is out of scope for the URI scheme itself.

**Interoperability**: two implementations of this specification MUST compute the same `graph://` URI for the same triple set, by construction of [§5.2](#52-content-hash-computation).

---

## 12. Examples

### 12.1 Creating a Graph and Adding Triples

```javascript
const calendar = await navigator.graph.create({ displayName: "My Calendar" });

const iri0 = calendar.iri;    // "graph://e3b0c4..." — the empty-graph IRI
console.log(calendar.did);    // null

await calendar.addTriple(new Triple(
  "urn:event:1",
  "https://schema.org/name",
  new LiteralValue("Coffee with Alice"),
));

console.log(calendar.iri !== iri0);   // true — IRI advanced
```

### 12.2 Reading Triple Provenance

```javascript
const triples = await calendar.queryTriples({ subject: "urn:event:1" });
for (const t of triples) {
  const [reifier] = await calendar.provenance(t);
  console.log(`${t.object.lexicalValue}  by ${reifier.author} at ${reifier.timestamp}`);
}
```

### 12.3 Holonic SPARQL Across Two Graphs

```javascript
const community = await navigator.graph.create({ displayName: "Acme" });
const channel   = await navigator.graph.create({ displayName: "#general" });

await community.addTriple(new Triple(
  "urn:community:acme",
  "urn:p:hasChannel",
  channel.iri,
));

await channel.addTriple(new Triple(
  "urn:msg:1",
  "urn:p:body",
  new LiteralValue("hello"),
));

const results = await community.querySparql(`
  SELECT ?msg ?body WHERE {
    <urn:community:acme> <urn:p:hasChannel> ?ch .
    GRAPH ?ch {
      ?msg <urn:p:body> ?body .
    }
  }
`, { namedGraphs: [channel] });
```

### 12.4 Snapshot, Sign, Transfer, Materialise

```javascript
// Agent A:
const snapshot = await calendar.getAsSnapshot({ signBy: "agent" });
// snapshot.format === "nquads-canonical"
// snapshot.graphIri === calendar.iri (at the moment of snapshotting)

// Transport `snapshot` to agent B (file, network, etc.).

// Agent B:
const mounted = await navigator.graph.fromSnapshot(snapshot);
// mounted.iri === snapshot.graphIri (bit-for-bit)
// mounted.trustLevel === "external"
```

### 12.5 Export for External Tooling

```javascript
// Lossy export for tools that don't understand RDF 1.2 reifiers.
const turtleExport = await calendar.getAsSnapshot({ format: "turtle", signBy: "agent" });

// turtleExport.data is human-readable Turtle of the data triples only.
// turtleExport CANNOT be passed to fromSnapshot(); attempting so rejects
// with "NotSupportedError".
```

### 12.6 Dissolving a Graph

```javascript
await calendar.dissolve();
// Local storage released. Subsequent operations on `calendar` reject.
await calendar.addTriple(/* ... */);  // → "InvalidStateError"
```

---

## 13. References

### 13.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC3986]** Berners-Lee, T., Fielding, R., and L. Masinter, "Uniform Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005. https://www.rfc-editor.org/rfc/rfc3986
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. https://www.rfc-editor.org/rfc/rfc3339
- **[RFC4122]** Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005. https://www.rfc-editor.org/rfc/rfc4122
- **[RFC7595]** Thaler, D., Hansen, T., and T. Hardie, "Guidelines and Registration Procedures for URI Schemes", BCP 35, RFC 7595, June 2015. https://www.rfc-editor.org/rfc/rfc7595
- **[WEBIDL]** Chen, E., "Web IDL Standard". https://webidl.spec.whatwg.org/
- **[DID-CORE]** Sporny, M., Guy, A., Sabadello, M., and D. Reed, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./01_decentralised-identity-web-platform.md).
- **[RDF12-CONCEPTS]** "RDF 1.2 Concepts and Abstract Syntax", W3C Working Draft. https://www.w3.org/TR/rdf12-concepts/
- **[RDF-CANON]** "RDF Dataset Canonicalization", W3C Recommendation, March 2025. https://www.w3.org/TR/rdf-canon/
- **[SPARQL12-QUERY]** "SPARQL 1.2 Query Language", W3C Working Draft. https://www.w3.org/TR/sparql12-query/
- **[N-TRIPLES]** "RDF 1.2 N-Triples", W3C Working Draft. https://www.w3.org/TR/rdf12-n-triples/
- **[N-QUADS]** "RDF 1.2 N-Quads", W3C Working Draft. https://www.w3.org/TR/rdf12-n-quads/
- **[STORAGE]** "Storage Standard". https://storage.spec.whatwg.org/
- **[INDEXEDDB]** "Indexed Database API 3.0", W3C Working Draft. https://www.w3.org/TR/IndexedDB/

### 13.2 Informative References

None.
