# Personal Linked Data Graphs

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md  
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md  
**Editor:** [TBD]  
**This version:** Draft, 4 April 2026

---

## Abstract

This specification defines a client-side API for creating, querying, and managing personal linked data graphs. A PersonalGraph is a local-first, user-controlled semantic triple store accessible to web applications. It supports RDF-compatible triples, SPARQL queries, SHACL-based shape validation, and event-driven observation of graph changes. The API is exposed on the `navigator.semanticWeb.graphs` namespace and provides web applications with structured, persistent, queryable semantic storage under user control.

---

## Status of This Document

This section describes the status of this document at the time of its publication.

This document is a **First Public Working Draft** published by the [TBD] Working Group. It is intended to become a W3C Recommendation.

Publication as a First Public Working Draft does not imply endorsement by W3C and its Members. This is a draft document and may be updated, replaced, or obsoleted by other documents at any time. It is inappropriate to cite this document as other than work in progress.

Feedback and comments on this specification are welcome. Please file issues at [TBD].

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Data Model](#3-data-model)
4. [API](#4-api)
5. [Shape System (SHACL Extension)](#5-shape-system-shacl-extension)
6. [Storage](#6-storage)
7. [Security Considerations](#7-security-considerations)
8. [Privacy Considerations](#8-privacy-considerations)
9. [Examples](#9-examples)
10. [References](#10-references)

---

## 1. Introduction

### 1.1 Motivation

The web platform provides several client-side storage mechanisms — cookies, Web Storage, IndexedDB, the Origin Private File System — yet none offer **semantic structure**. Applications store opaque blobs and key-value pairs with no interoperability, no queryability across applications, and no user-meaningful data model.

Meanwhile, users generate vast amounts of structured personal data — notes, bookmarks, contacts, health records, financial transactions, creative works — that is locked inside proprietary application silos. There is no browser-native mechanism for users to maintain a **personal knowledge graph** that they own, that persists across applications, and that applications can read and write with semantic precision.

This specification addresses that gap by defining a **PersonalGraph** API: a local-first, user-controlled semantic triple store built into the web platform. PersonalGraphs store RDF-compatible triples, support SPARQL queries, validate data against SHACL shapes, and emit events when data changes — enabling a new class of interoperable, offline-capable, user-centric web applications.

### 1.2 Use Cases

- **Personal knowledge management.** A user maintains a personal graph of notes, references, and connections. Multiple web applications (a note-taking app, a reference manager, a mind-mapping tool) read and write to the same graph.
- **Local-first applications.** Applications that work offline by default, storing all data in the user's personal graph, with optional synchronisation to remote services.
- **Cross-application data sharing.** A calendar application writes events as triples; a task manager reads them. Both applications use the same graph with agreed-upon vocabularies.
- **Offline-capable semantic data.** A researcher collects structured annotations on academic papers, queryable via SPARQL, available without network connectivity.

### 1.3 Relationship to Existing Specifications

This specification builds on:
- **RDF 1.2** [[RDF12-CONCEPTS]] for the triple data model
- **SPARQL 1.2** [[SPARQL12-QUERY]] for query semantics
- **SHACL** [[SHACL]] for shape-based validation
- **DID Core** [[DID-CORE]] for author identification in signed triples
- **Web IDL** [[WEBIDL]] for API surface definition

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]] and [[RFC8174]] when, and only when, they appear in ALL CAPITALS, as shown here.

A conforming user agent MUST implement all non-optional features of this specification. A conforming user agent MAY implement features marked "This feature is at risk."

---

## 3. Data Model

### 3.1 SemanticTriple

A **SemanticTriple** represents a single assertion: a directed relationship between a source and a target, optionally qualified by a predicate.

- The `source` attribute MUST be a valid URI [[RFC3986]].
- The `target` attribute MUST be a valid URI [[RFC3986]] or a literal string value. When the target represents an entity, it SHOULD be a URI.
- The `predicate` attribute is OPTIONAL. When present, it MUST be a valid URI [[RFC3986]].

[NOTE: The optionality of predicate diverges from strict RDF, where predicate is required. This is a pragmatic choice — many graph operations create simple associations without a named relationship. Implementations that need strict RDF compatibility SHOULD always include a predicate. This design decision requires further community discussion.]

```webidl
[Exposed=(Window,Worker)]
interface SemanticTriple {
  constructor(USVString source, USVString target, optional USVString? predicate = null);
  readonly attribute USVString source;
  readonly attribute USVString target;
  readonly attribute USVString? predicate;
};
```

### 3.2 SignedTriple

A **SignedTriple** is a SemanticTriple with cryptographic provenance. It records the author (as a DID URI), a timestamp, and a cryptographic proof.

- The `author` attribute MUST be a valid DID URI [[DID-CORE]].
- The `timestamp` attribute MUST be an RFC 3339 [[RFC3339]] datetime string.
- The `proof` attribute contains the signing key URI and the signature value.

```webidl
[Exposed=(Window,Worker)]
interface ContentProof {
  readonly attribute USVString key;        // DID URI of signing key
  readonly attribute USVString signature;  // hex-encoded signature
};

[Exposed=(Window,Worker)]
interface SignedTriple {
  readonly attribute SemanticTriple data;
  readonly attribute USVString author;     // DID URI
  readonly attribute DOMString timestamp;  // RFC 3339
  readonly attribute ContentProof proof;
};
```

The signature MUST be computed over `SHA-256(canonical(data) || timestamp)` where `canonical()` applies JSON Canonicalization Scheme [[RFC8785]]. The signing algorithm MUST be Ed25519 [[RFC8032]].

### 3.3 PersonalGraph

A **PersonalGraph** is a named, persistent collection of signed triples identified by a UUID [[RFC4122]]. Each PersonalGraph belongs to a single origin by default, but MAY be shared across origins via explicit user consent (see [§6 Storage](#6-storage)).

A PersonalGraph has the following observable states:
- `"private"` — the graph exists only locally and is not synchronised.
- `"syncing"` — the graph is in the process of synchronising with external sources.
- `"synced"` — the graph has completed synchronisation.
- `"error"` — the graph encountered a synchronisation error.

[NOTE: The sync states anticipate a future Shared Graphs specification. For this specification, all graphs are in the `"private"` state. This feature is at risk.]

### 3.4 TripleQuery

A **TripleQuery** is a dictionary used to filter triples by their properties, temporal range, or count.

```webidl
dictionary TripleQuery {
  USVString? source;
  USVString? target;
  USVString? predicate;
  DOMString? fromDate;    // RFC 3339 — inclusive lower bound
  DOMString? untilDate;   // RFC 3339 — exclusive upper bound
  unsigned long? limit;
};
```

When multiple fields are specified, they are combined with logical AND. A `null` or absent field matches any value. If `limit` is specified, the user agent MUST return at most that many results, ordered by timestamp descending.

---

## 4. API

### 4.1 PersonalGraphManager

The **PersonalGraphManager** interface provides methods for creating, listing, retrieving, and removing personal graphs. It is accessed via `navigator.semanticWeb.graphs`.

```webidl
[Exposed=Window, SecureContext]
partial interface Navigator {
  [SameObject] readonly attribute SemanticWeb semanticWeb;
};

[Exposed=Window, SecureContext]
interface SemanticWeb {
  [SameObject] readonly attribute PersonalGraphManager graphs;
};

[Exposed=Window, SecureContext]
interface PersonalGraphManager {
  [NewObject] Promise<PersonalGraph> create(optional DOMString name);
  [NewObject] Promise<sequence<PersonalGraph>> list();
  [NewObject] Promise<PersonalGraph?> get(USVString uuid);
  [NewObject] Promise<boolean> remove(USVString uuid);
};
```

The `create()` method MUST generate a new UUID [[RFC4122]] for the graph. If `name` is provided, it MUST be stored as a human-readable label. The method MUST return a new PersonalGraph that is immediately persistent.

The `remove()` method MUST permanently delete all triples and metadata associated with the graph. Implementations SHOULD prompt the user for confirmation before deletion. The method returns `true` if the graph existed and was removed, `false` otherwise.

### 4.2 PersonalGraph Interface

```webidl
[Exposed=(Window,Worker), SecureContext]
interface PersonalGraph : EventTarget {
  readonly attribute USVString uuid;
  readonly attribute DOMString? name;
  readonly attribute GraphSyncState state;

  // Triple operations
  [NewObject] Promise<SignedTriple> addTriple(SemanticTriple triple);
  [NewObject] Promise<sequence<SignedTriple>> addTriples(sequence<SemanticTriple> triples);
  [NewObject] Promise<boolean> removeTriple(SignedTriple triple);
  [NewObject] Promise<sequence<SignedTriple>> queryTriples(TripleQuery query);
  [NewObject] Promise<SparqlResult> querySparql(USVString sparql);
  [NewObject] Promise<sequence<SignedTriple>> snapshot();

  // Shape operations
  Promise<undefined> addShape(USVString name, USVString shaclJson);
  [NewObject] Promise<sequence<USVString>> getShapeInstances(USVString shapeName);
  [NewObject] Promise<USVString> createShapeInstance(USVString shapeName, object data);
  [NewObject] Promise<object> getShapeInstanceData(USVString shapeName, USVString instanceUri);

  // Events
  attribute EventHandler ontripleadded;
  attribute EventHandler ontripleremoved;
};

enum GraphSyncState { "private", "syncing", "synced", "error" };
```

#### 4.2.1 addTriple(triple)

The `addTriple()` method MUST:
1. Sign the triple using the current user's active DID identity (see [[DECENTRALISED-IDENTITY]]).
2. Validate the triple against any registered shapes (see [§5 Shape System](#5-shape-system-shacl-extension)).
3. Persist the signed triple to storage.
4. Fire a `tripleadded` event with the signed triple.
5. Return the resulting SignedTriple.

If no active identity is available, the method MUST reject with an `"InvalidStateError"` DOMException.

#### 4.2.2 addTriples(triples)

The `addTriples()` method behaves as a batch version of `addTriple()`. All triples MUST be signed and validated. If any triple fails validation, the entire batch MUST be rejected and no triples are persisted. This provides atomic batch semantics.

#### 4.2.3 removeTriple(triple)

The `removeTriple()` method MUST remove the specified signed triple from the graph and fire a `tripleremoved` event. Returns `true` if the triple was found and removed, `false` otherwise.

[NOTE: Whether removing a triple requires the remover to be the original author is an open question. Some use cases require graph owners to remove any triple; others require only the author to remove their own triples. This needs further discussion.]

#### 4.2.4 queryTriples(query)

The `queryTriples()` method MUST return all signed triples matching the given TripleQuery, ordered by timestamp descending.

#### 4.2.5 querySparql(sparql)

The `querySparql()` method MUST execute a SPARQL 1.2 [[SPARQL12-QUERY]] SELECT or CONSTRUCT query against the graph's triples and return the result.

*This feature is at risk.* Full SPARQL support is a substantial implementation burden. Conforming user agents MAY implement a subset of SPARQL limited to basic graph patterns (BGPs), FILTER, OPTIONAL, and LIMIT.

#### 4.2.6 snapshot()

The `snapshot()` method MUST return all signed triples currently in the graph, as an ordered sequence by timestamp ascending.

### 4.3 SemanticTriple Interface

Defined in [§3.1](#31-semantictriple).

### 4.4 SignedTriple Interface

Defined in [§3.2](#32-signedtriple).

### 4.5 TripleQuery Dictionary

Defined in [§3.4](#34-triplequery).

### 4.6 SparqlResult Interface

```webidl
[Exposed=(Window,Worker)]
interface SparqlResult {
  readonly attribute USVString type;    // "bindings" or "graph"
  readonly attribute FrozenArray<object> bindings;  // for SELECT queries
  readonly attribute FrozenArray<SemanticTriple>? triples;  // for CONSTRUCT queries
};
```

For SELECT queries, `type` is `"bindings"` and `bindings` contains an array of objects where each key is a variable name and each value is the bound URI or literal. For CONSTRUCT queries, `type` is `"graph"` and `triples` contains the constructed triples.

---

## 5. Shape System (SHACL Extension)

### 5.1 Shape Registration

Shapes are registered on a PersonalGraph using the `addShape(name, shaclJson)` method. The `name` parameter is a unique identifier for the shape within the graph. The `shaclJson` parameter MUST be a valid JSON-LD serialisation of a SHACL [[SHACL]] NodeShape.

The shape definition includes standard SHACL property constraints (datatype, minCount, maxCount, pattern, etc.) plus the action semantics defined in this section.

When a shape is registered, the user agent MUST validate its structure. If the SHACL JSON is malformed, the method MUST reject with a `"SyntaxError"` DOMException.

### 5.2 Action Semantics

Shapes in this specification extend SHACL with **action semantics** that define how shapes map to triple operations. This enables higher-level object-like interaction with the graph while preserving the underlying triple model.

#### 5.2.1 Constructors

A shape MAY define a `constructor` action that specifies which triples to create when a new instance of the shape is created. The constructor maps named parameters to triple patterns.

```json
{
  "@type": "sh:NodeShape",
  "sh:targetClass": "ex:Task",
  "x:actions": {
    "constructor": [
      { "predicate": "rdf:type", "value": "ex:Task" },
      { "predicate": "ex:title", "parameter": "title" },
      { "predicate": "ex:status", "value": "ex:Open" }
    ]
  }
}
```

[NOTE: The `x:actions` namespace for action semantics is provisional. This extension to SHACL needs a formal namespace and community review.]

#### 5.2.2 Setters

A shape MAY define `setter` actions for individual properties. A setter specifies the predicate to update and the replacement behaviour (replace existing triple with same source and predicate).

#### 5.2.3 Collections

A shape MAY define `collection` actions for multi-valued properties. A collection specifies:
- `add` — create a new triple with the given predicate and target
- `remove` — remove the triple with the given predicate and target

### 5.3 Shape Instances

#### 5.3.1 createShapeInstance(shapeName, data)

The `createShapeInstance()` method MUST:
1. Look up the registered shape by name.
2. Execute the shape's constructor action, mapping `data` properties to constructor parameters.
3. Create the resulting triples via `addTriples()`.
4. Return the URI of the newly created instance.

If any required parameter is missing or any constraint is violated, the method MUST reject with a `"ConstraintError"` DOMException.

#### 5.3.2 getShapeInstances(shapeName)

The `getShapeInstances()` method MUST return the URIs of all entities in the graph that conform to the named shape's target class and property constraints.

#### 5.3.3 getShapeInstanceData(shapeName, instanceUri)

The `getShapeInstanceData()` method MUST return a plain JavaScript object whose properties correspond to the shape's property paths, with values populated from the graph's triples for the given instance URI.

---

## 6. Storage

### 6.1 Persistence

PersonalGraph data MUST persist across browsing sessions. Implementations SHOULD use the Origin Private File System (OPFS) [[FS]] or IndexedDB [[INDEXEDDB]] as the backing store.

Graph data MUST survive normal browser restarts. Graph data SHOULD survive "clear browsing data" only if the user explicitly opts to preserve it (analogous to persistent storage via `navigator.storage.persist()`).

### 6.2 Origin Isolation

By default, a PersonalGraph is scoped to its creating origin. Scripts from other origins MUST NOT access the graph.

### 6.3 Cross-Origin Sharing

A user MAY grant another origin read or write access to a PersonalGraph. Cross-origin sharing MUST require an explicit user gesture and a browser-mediated permission prompt.

*This feature is at risk.* The cross-origin sharing model requires careful design to prevent confused-deputy attacks and data exfiltration.

```webidl
partial interface PersonalGraph {
  [NewObject] Promise<undefined> grantAccess(USVString origin, GraphAccessLevel level);
  [NewObject] Promise<undefined> revokeAccess(USVString origin);
};

enum GraphAccessLevel { "read", "readwrite" };
```

---

## 7. Security Considerations

### 7.1 Origin Isolation

PersonalGraphs MUST be isolated by origin, consistent with the web's same-origin policy. A graph created by `https://example.com` MUST NOT be accessible to `https://other.com` without explicit cross-origin grant.

### 7.2 Triple Signing

All triples stored in a PersonalGraph are signed by the authoring identity. This provides:
- **Integrity** — triples cannot be tampered with after creation without invalidating the signature.
- **Non-repudiation** — the author of a triple is cryptographically verifiable.
- **Provenance** — applications can determine the origin of any piece of data.

User agents SHOULD verify triple signatures on read and flag any triples with invalid signatures.

### 7.3 Shape Validation

Shape validation prevents applications from writing malformed data. When shapes are registered, all new triples created via shape instances MUST conform to the shape constraints. This provides a defence against data corruption by malicious or buggy applications.

### 7.4 Storage Quotas

User agents MUST apply storage quotas to PersonalGraphs consistent with existing storage quota mechanisms [[STORAGE]]. Implementations SHOULD provide the user with visibility into per-origin graph storage usage.

---

## 8. Privacy Considerations

### 8.1 Local-First Architecture

PersonalGraphs are local-first by design. No data leaves the user's device unless the user explicitly shares a graph or grants cross-origin access. This provides strong privacy guarantees by default.

### 8.2 Cross-Origin Sharing

Cross-origin sharing is strictly opt-in. The user agent MUST present a clear permission prompt identifying the requesting origin, the target graph, and the requested access level (read or readwrite).

### 8.3 DID Fingerprinting

Signed triples contain DID URIs that are persistent identifiers. If a user uses the same DID across multiple origins, those origins could correlate the user's activity. User agents SHOULD allow users to create per-origin DIDs to mitigate this risk.

### 8.4 Graph Metadata

Even without accessing triple content, the existence, name, and size of personal graphs could reveal information. The `list()` method MUST only return graphs created by the calling origin (or explicitly shared with it).

---

## 9. Examples

### 9.1 Creating a Graph and Adding Triples

```javascript
// Create a personal graph
const graph = await navigator.semanticWeb.graphs.create("My Knowledge Base");

// Add a triple
const triple = new SemanticTriple(
  "https://example.com/notes/1",
  "https://example.com/topics/web-standards",
  "https://schema.org/about"
);
const signed = await graph.addTriple(triple);
console.log(signed.author);    // "did:key:z6Mk..."
console.log(signed.timestamp); // "2026-04-04T00:08:00Z"
```

### 9.2 Querying Triples

```javascript
// Find all triples about a specific topic
const results = await graph.queryTriples({
  target: "https://example.com/topics/web-standards"
});

for (const triple of results) {
  console.log(`${triple.data.source} —[${triple.data.predicate}]→ ${triple.data.target}`);
}

// SPARQL query
const sparql = await graph.querySparql(`
  SELECT ?note ?topic WHERE {
    ?note <https://schema.org/about> ?topic .
  } LIMIT 10
`);

for (const binding of sparql.bindings) {
  console.log(`Note: ${binding.note}, Topic: ${binding.topic}`);
}
```

### 9.3 Defining and Using a Shape

```javascript
// Register a Task shape
await graph.addShape("Task", JSON.stringify({
  "@type": "sh:NodeShape",
  "sh:targetClass": "https://example.com/vocab/Task",
  "sh:property": [
    {
      "sh:path": "https://example.com/vocab/title",
      "sh:datatype": "xsd:string",
      "sh:minCount": 1,
      "sh:maxCount": 1
    },
    {
      "sh:path": "https://example.com/vocab/status",
      "sh:in": ["open", "in-progress", "done"],
      "sh:minCount": 1
    }
  ],
  "x:actions": {
    "constructor": [
      { "predicate": "rdf:type", "value": "https://example.com/vocab/Task" },
      { "predicate": "https://example.com/vocab/title", "parameter": "title" },
      { "predicate": "https://example.com/vocab/status", "value": "open" }
    ]
  }
}));

// Create a task instance
const taskUri = await graph.createShapeInstance("Task", {
  title: "Write W3C specification"
});

// Retrieve task data
const taskData = await graph.getShapeInstanceData("Task", taskUri);
console.log(taskData.title);  // "Write W3C specification"
console.log(taskData.status); // "open"

// List all tasks
const allTasks = await graph.getShapeInstances("Task");
console.log(`${allTasks.length} tasks in graph`);
```

### 9.4 Observing Graph Changes

```javascript
const graph = await navigator.semanticWeb.graphs.get("some-uuid");

graph.ontripleadded = (event) => {
  const triple = event.triple;
  console.log(`New triple by ${triple.author}: ${triple.data.source} → ${triple.data.target}`);
};

graph.ontripleremoved = (event) => {
  console.log(`Triple removed: ${event.triple.data.source} → ${event.triple.data.target}`);
};
```

---

## 10. References

### 10.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC3986]** Berners-Lee, T., Fielding, R., and L. Masinter, "Uniform Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005. https://www.rfc-editor.org/rfc/rfc3986
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. https://www.rfc-editor.org/rfc/rfc3339
- **[RFC4122]** Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005. https://www.rfc-editor.org/rfc/rfc4122
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017. https://www.rfc-editor.org/rfc/rfc8032
- **[RFC8785]** Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. https://www.rfc-editor.org/rfc/rfc8785
- **[WEBIDL]** Chen, E., "Web IDL Standard". https://webidl.spec.whatwg.org/
- **[DID-CORE]** Sporny, M., Guy, A., Sabadello, M., and D. Reed, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/

### 10.2 Informative References

- **[RDF12-CONCEPTS]** Schreiber, G. and Y. Raimond, "RDF 1.2 Concepts and Abstract Syntax", W3C Working Draft. https://www.w3.org/TR/rdf12-concepts/
- **[SPARQL12-QUERY]** Harris, S. and A. Seaborne, "SPARQL 1.2 Query Language", W3C Working Draft. https://www.w3.org/TR/sparql12-query/
- **[SHACL]** Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, 20 July 2017. https://www.w3.org/TR/shacl/
- **[INDEXEDDB]** Alabbas, A. and J. Bell, "Indexed Database API 3.0", W3C Working Draft. https://www.w3.org/TR/IndexedDB/
- **[FS]** "File System Standard". https://fs.spec.whatwg.org/
- **[STORAGE]** "Storage Standard". https://storage.spec.whatwg.org/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_decentralised-identity-web-platform.md) (companion specification).
