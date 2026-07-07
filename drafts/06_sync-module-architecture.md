# Sync Module Architecture

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines the architecture for pluggable, content-addressed **sync modules** that implement the [[CONTEXT-SYNC]] protocol. A sync module is a WebAssembly bundle conforming to the `GraphSyncModule` interface defined here; the module supplies transport, merge logic, peer discovery, and governance validation for the graphs it serves. Modules execute in a capability-scoped sandbox managed by the user agent, isolated from the page realm and from each other. A graph's authoritative module hash is bound into its DID's immutable seed ([[GROUP-IDENTITY]] §4.5); module evolution is not an in-place transition but a fork to a new DID ([[GROUP-IDENTITY]] §4.8). This specification defines the module interface, the capability vocabulary that gates module access to runtime resources, the in-module validation contract, the installation/suspension/removal lifecycle, and the user-consent model. Any specific built-in default module is out of scope here.

---

## Status of This Document

This is a draft Community Group Report. It has no official W3C standing and is subject to change.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Module Concept](#4-module-concept)
5. [GraphSyncModule Interface](#5-graphsyncmodule-interface)
6. [Normative WIT Definition](#6-normative-wit-definition)
7. [Module Lifecycle](#7-module-lifecycle)
8. [Module Capabilities](#8-module-capabilities)
9. [Security Considerations](#9-security-considerations)
10. [Privacy Considerations](#10-privacy-considerations)
11. [References](#11-references)

---

## 1. Introduction

### 1.1 Motivation

No single sync strategy is optimal for all use cases. A collaborative editor needs different merge semantics than a social feed. Rather than prescribing one approach, [[CONTEXT-SYNC]] is implemented over a **pluggable sync module architecture** — each graph's authoritative module hash is bound into its DID's seed ([[GROUP-IDENTITY]] §4.5), and module evolution proceeds by forking ([[GROUP-IDENTITY]] §4.8) to a new DID rather than by in-place mutation.

This specification defines the module interface and execution environment. Conforming user agents MUST ship at least one built-in default module that satisfies this interface (the specific default module is out of scope here). Communities MAY install additional modules to implement custom transports, merge algorithms, peer-discovery mechanisms, or custom constraint kinds for governance.

### 1.2 Scope

This specification defines:

- The `GraphSyncModule` interface that all sync modules implement.
- The `ModuleConfig`, `GraphReader`, `GraphWriter`, `CryptoProvider`, and `NetworkProvider` types passed to modules.
- The capability vocabulary that gates module access to runtime resources.
- The in-module validation contract.
- The installation, suspension, and removal lifecycle.
- The user-consent model for installing modules.

Module evolution (changing a graph's authoritative module) is *not* defined here — it is the fork operation in [[GROUP-IDENTITY]] §4.8, with constraint-kind compatibility checked at fork time ([§8.2](#82-manifest-format)).

### 1.3 Relationship to Other Specifications

- [[CONTEXT-SYNC]] defines the protocol that modules implement.
- [[PERSONAL-LINKED-DATA-GRAPHS]] defines the Graph and Triple types passed across the module boundary.
- [[CAPABILITY-FRAMEWORK]] defines the validation algorithm a module's `validateDiff` and `validateReadAccess` implement ([§5.5](#55-in-module-validation)).
- [[WEBASSEMBLY]] is the execution environment for modules.

The specific built-in default module that ships with conforming user agents is out of scope for this specification.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A **conforming user agent** MUST implement:

1. The module sandbox ([§4](#4-module-concept), [§8](#8-module-capabilities)).
2. The module lifecycle ([§7](#7-module-lifecycle)).
3. The `GraphReader` and `GraphWriter` runtime handles ([§5.3](#53-graphreader--graphwriter)).
4. The user-consent flow ([§7.2](#72-user-consent)).

A **conforming sync module** MUST implement the `GraphSyncModule` interface ([§5](#5-graphsyncmodule-interface)) and declare its required capabilities in a manifest ([§8](#8-module-capabilities)).

---

## 3. Terminology

<dl>
<dt><dfn>Sync Module</dfn></dt>
<dd>A content-addressed WebAssembly bundle implementing the <code>GraphSyncModule</code> interface.</dd>

<dt><dfn>Content Hash</dfn></dt>
<dd>The SHA-256 hash of a module's WASM binary. The canonical identifier of a module.</dd>

<dt><dfn>Module Manifest</dfn></dt>
<dd>A document accompanying a module that declares its name, version, and required capabilities ([§8](#8-module-capabilities)).</dd>

<dt><dfn>Module-Managed Execution Environment</dfn></dt>
<dd>The user-agent-managed sandbox in which modules execute. Isolated from the page realm, from other modules, and from arbitrary network/storage access.</dd>

<dt><dfn>Capability Handle</dfn></dt>
<dd>An opaque token granting a module access to a specific runtime resource (a graph's triples, a relay endpoint, a crypto operation, etc.). Capability handles are minted by the user agent at module initialisation and cannot be forged or extended by the module.</dd>
</dl>

---

## 4. Module Concept

### 4.1 What a Module Is

A **sync module** is a content-addressed WebAssembly bundle implementing the `GraphSyncModule` interface ([§5](#5-graphsyncmodule-interface)). The graph identifies its authoritative module via the `group://syncModule` triple in its DID seed ([[GROUP-IDENTITY]] §4.5); all peers serving the graph MUST run a module with the matching content hash. Because the seed is immutable, the module hash is fixed for the life of the graph DID — module evolution proceeds by forking ([[GROUP-IDENTITY]] §4.8) to a new DID, not by in-place change. Wire-and-semantics-compatible reimplementations under different content hashes are out of scope: byte-equal content hash is the simplest sufficient guarantee of behavioural equivalence.

The module determines transport, merge strategy, peer discovery, and governance validation ([§5.5](#55-in-module-validation)).

### 4.2 Content Addressing

Modules are identified by SHA-256 of their WASM binary:

```
content-hash = "sha256-" + hex(SHA-256(wasm-binary))
```

The user agent MUST verify the content hash of any downloaded module before installation.

### 4.3 Module Distribution

Modules MAY be distributed via HTTPS endpoints, content-addressed networks, sync-space metadata (e.g., a relay's well-known path), or out-of-band transfer.

If a module cannot be retrieved, the relevant operation in [[CONTEXT-SYNC]] MUST reject with `"NetworkError"`.

### 4.4 Module Execution Environment

Modules execute in a **user-agent-managed execution environment** outside the page realm:

- Modules persist across tab navigations and user agent restarts.
- Modules are not tied to any origin.
- Multiple pages from different origins can interact with the same graph through the same module instance.

**Instancing.** The runtime instantiates one module instance per `(content-hash, spaceUri)` pair. A space carrying multiple graphs is served by a single instance for all of them. An agent participating in multiple spaces with the same module hash runs multiple instances — one per space — each with its own `connect()`, peer set, and storage view. Module-private storage (`storage.module.*` per [§8](#8-module-capabilities)) is keyed by `(content-hash, graphDid)` and persists across user agent restart, independent of the instance lifecycle.

The module runs in a WebAssembly sandbox with capability-scoped permissions ([§8](#8-module-capabilities)). The module has NO access to: DOM, other graphs' data, the filesystem, arbitrary network endpoints (only those granted by capabilities), user data, cookies, local storage, or other sync modules.

### 4.5 Module Identity Is Bound to the DID

A graph's authoritative sync module is fixed at groupification (or at fork) and recorded as an immutable seed triple ([[GROUP-IDENTITY]] §4.5):

```turtle
<did:graph:abc...> <group://syncModule> "sha256-<wasm-hex>" .
```

The triple cannot be mutated by any governance write; the capability framework MUST reject such attempts ([[CAPABILITY-FRAMEWORK]] §10). A graph that needs a different module — for protocol upgrade, irreconcilable constraint-kind extension, or intentional schism — forks ([[GROUP-IDENTITY]] §4.8) to a new DID whose seed names the new module. The parent DID remains operational under its original module; subscribers MAY follow the fork or stay.

This design eliminates an in-place transition protocol entirely. There is no runtime module-swap, no in-flight diff handling, no `"module_pending"` state, no constraint-kind compatibility check at runtime — those concerns move to fork time, where the new DID's seed can be validated against the parent's state before the fork is committed ([[GROUP-IDENTITY]] §4.8.1 step 2).

Distribution endpoints for the module bundle are advertised by application-layer hints (e.g., on invitation links or in directory graphs); resolving them is the user agent's responsibility at first mount of a given DID, mediated by the consent flow in [§7.2](#72-user-consent).

---

## 5. GraphSyncModule Interface

### 5.1 Interface Definition

The `GraphSyncModule` interface defines the contract that all sync modules implement. The WebIDL below is **illustrative** — it presents the interface in the notation used throughout this specification family for readability. The **normative** binding contract is the WebAssembly Interface Types (WIT) definition in [§6](#6-normative-wit-definition); a module is instantiated as a WebAssembly component whose exports and imports are exactly those declared by that WIT `world`. Where this WebIDL and the WIT differ in detail, the WIT governs ([§6.1](#61-idl-to-wit-mapping)).

```webidl
// Conceptual interface (ILLUSTRATIVE). The normative binding is the WIT
// `world graph-sync-module` in §6; see §6.1 for the IDL↔WIT mapping.

interface GraphSyncModule {
  // Lifecycle
  undefined init(ModuleConfig config);
  undefined shutdown();

  // Transport (per space)
  undefined connect(USVString spaceUri, USVString localDid);
  undefined disconnect();

  // Sync (per graph)
  undefined commit(USVString graphDid, GraphDiff diff);
  undefined onRemoteDiff(RemoteDiffCallback callback);
  undefined requestSync(USVString graphDid, USVString fromRevision);

  // Peer management
  sequence<Peer> peers();
  sequence<Peer> onlinePeers();
  sequence<Peer> discoverPeers(USVString spaceUri);

  // Signalling
  undefined sendSignal(USVString remoteDid, bytes payload);
  undefined onSignal(SignalCallback callback);

  // Governance validation — runs in-module by design (§5.5). The runtime
  // invokes these per [[CONTEXT-SYNC]] §9.2; the module's implementation
  // is what makes accept/reject decisions.
  SyncValidationResult validateDiff(USVString graphDid, GraphDiff diff, USVString author);
  SyncValidationResult validateReadAccess(USVString graphDid, USVString authorDid, CapabilityProof? proof);
};

callback RemoteDiffCallback = undefined (USVString graphDid, GraphDiff diff, SyncValidationResult result);
callback SignalCallback = undefined (USVString remoteDid, bytes payload);
```

`GraphDiff`, `Peer`, `CapabilityProof`, and `SyncValidationResult` are defined in [[CONTEXT-SYNC]] §5. Their normative WIT record/variant forms — the shapes actually marshalled across the component boundary — are given in [§6](#6-normative-wit-definition).

**`commit` and `validate*` return values.** `commit()` returns no value; the diff's `revision` and `commitId` are content-hashes computed deterministically per [[CONTEXT-SYNC]] §5.2.2 and not subject to module choice. `validateDiff` and `validateReadAccess` return the module's authoritative accept/reject; the runtime treats their result as the validation outcome and does not double-check ([§5.5](#55-in-module-validation)).

**`onRemoteDiff` semantics.** The module validates each incoming diff internally (via its own `validateDiff`) before invoking the runtime callback with `(graphDid, diff, result)`. The runtime uses `result` to fire `ondiff` events ([[CONTEXT-SYNC]] §6.3), update sync state, and decide whether to surface the diff to applications. The module is also free to apply accepted diffs directly through `GraphWriter.apply()`; the runtime treats `apply()` as idempotent for diffs with matching `commitId`.

**Multiple graphs per space.** Modules MAY multiplex multiple graphs onto a single transport stream within one space for connection efficiency (e.g., Unified topology). Each graph's diff chain and per-graph capability checks remain independent ([[CONTEXT-SYNC]] §7.6); a `GraphDiff.dependencies` value references revisions in the same graph only, and the module's `validateDiff` is invoked per `(graphDid, diff)`.

### 5.2 ModuleConfig

```webidl
dictionary ModuleConfig {
  USVString spaceUri;
  USVString localDid;
  GraphWriter graphWriter;
  GraphReader graphReader;
  CryptoProvider crypto;
  NetworkProvider network;
  /** WASM linear-memory ceiling, in bytes. The runtime MAY trap on overrun. */
  unsigned long long maxMemoryBytes;
  /** Per-entry-point wall-clock budget, in milliseconds. Entries that exceed
   *  it are terminated and the calling operation rejects. Applies uniformly
   *  to validateDiff, validateReadAccess, commit, and inbound diff handling. */
  unsigned long executionBudgetMs;
};
```

### 5.3 GraphReader & GraphWriter

The runtime provides capability handles giving the module scoped read/write access **per graph**:

```webidl
interface GraphReader {
  Promise<sequence<Triple>> queryTriples(USVString graphDid, TripleQuery query);
  Promise<SparqlResult> querySparql(USVString graphDid, USVString sparql);
  Promise<sequence<Triple>> snapshot(USVString graphDid);
};

interface GraphWriter {
  Promise<undefined> apply(USVString graphDid, GraphDiff diff);
};
```

The module MUST pass `graphDid` on every read/write to scope the operation. The runtime rejects requests for graphs the module is not authorised for.

### 5.4 CryptoProvider & NetworkProvider

Crypto and network access are mediated handles, not direct capabilities; key material never enters the WASM linear memory.

**CryptoProvider.** The runtime exposes a *scoped* signing surface — the module cannot use the agent's DID key to sign arbitrary bytes:

- `crypto.signCommit(graphDid, commitId)` — produces a signature over `commitId` ([[CONTEXT-SYNC]] §5.2.2) for a graph the module is authorised to serve. The runtime verifies that `commitId` corresponds to a diff the module has just constructed via `commit()` and that `graphDid` is in the module's authorised set; otherwise the call rejects.
- `crypto.signSignal(spaceUri, remoteDid, payload)` — produces a signal-envelope signature bound to `(localDid, remoteDid, spaceUri, payload)`. Used only for signalling authentication.
- `crypto.verify(signed, publicKey)` — pure verification; no key material involved.

The structured shapes the signer accepts are exhaustive. A module cannot produce a ZCAP delegation, an invocation, a verifiable credential, or any other authorisation artefact via the crypto handle; those operations are performed by the user agent or by code in the page realm holding the relevant capability.

**NetworkProvider.**

- `network.connect(endpoint)` — opens a WebTransport or WebSocket session to a relay endpoint the module is capability-authorised to reach ([§8](#8-module-capabilities)).
- `network.peerConnect(remoteDid, protocol)` — initiates a peer-to-peer transport (e.g., WebRTC) for a peer in the module's space, gated by the `network.peer.<protocol>` capability.
- `network.fetch(url)` — issues an opaque, credential-free HTTP request to an authorised origin. No cookies, no `Authorization` headers, no caller-supplied credentials of any kind; responses are delivered as raw bytes with no caller-controlled metadata. The handle isolates the module from the user agent's ambient credential surface.

### 5.5 In-Module Validation

`validateDiff` and `validateReadAccess` execute *inside* the module sandbox. This is a deliberate design choice:

- **Equivalent trust surface.** The user has consented to install the module by its content hash; that consent already extends to every byte the module transports and every operation it performs against its authorised graphs. Moving validation host-side would not reduce the trust the user has extended — it would merely relocate where the trusted code runs. Validation correctness is bounded by the same audit-the-hash mechanism that bounds everything else the module does, in either case.
- **Composability.** Modules MAY implement custom constraint kinds (per [[CAPABILITY-FRAMEWORK]] §11) by embedding their own governance engine or extending a reference one. The module manifest ([§8.2](#82-manifest-format)) declares which constraint kinds the module supports, and the runtime gates module transitions ([§7.3](#73-module-evolution-is-via-forking)) against that list. Specialised modules — e.g., one with CRDT-aware merge constraints, or one with cryptographic privacy proofs unknown to the host — ship as drop-in replacements without modifying the user agent.
- **Locality with merge.** Merge logic is module-supplied; merge needs to know which diffs are valid to converge correctly. Co-locating validation with merge avoids a host↔module round-trip per diff and per merge candidate, and lets the module reason about validation outcomes when resolving concurrent writes.

The module's `validateDiff` and `validateReadAccess` MUST implement [[CAPABILITY-FRAMEWORK]] §7 over the constraint kinds the module declares in its manifest. A module that returns `accepted: true` without performing the requisite checks is non-conformant; the conformance mechanism is content-hash review, manifest inspection in the consent prompt ([§7.2](#72-user-consent)), and publisher-reputation visibility in the management UI ([§7.6](#76-management-ui)) — not runtime instrumentation. The runtime trusts the module's validate result.

---

## 6. Normative WIT Definition

This section is **normative**. The WebIDL in [§5](#5-graphsyncmodule-interface) is illustrative; this WIT ([[WIT]]) is the binding contract. A conforming sync module ([§2](#2-conformance)) MUST be a [[WASM-COMPONENT-MODEL]] component that satisfies the `world graph-sync-module` defined here: it MUST export the `living-web:sync/module` and `living-web:sync/inbound` interfaces, and it MAY import only the interfaces this world declares. A conforming user agent MUST instantiate modules against this world and MUST provide every imported interface. The interface identifier namespace is `living-web:sync@0.1.0`.

All types marshalled across the component boundary are defined in the `living-web:sync/types` interface below; the record and variant shapes there are the canonical wire forms of the WebIDL dictionaries and interfaces referenced in [§5](#5-graphsyncmodule-interface) and [[CONTEXT-SYNC]] §5. Byte strings use `list<u8>`; DIDs, IRIs, revisions, and content hashes are `string` (UTF-8, per the Component Model canonical ABI). Timestamps are RFC 3339 `string`s to preserve exact wire fidelity with [[CONTEXT-SYNC]] §5.2.2.

### 6.1 IDL-to-WIT Mapping

The WebIDL in [§5](#5-graphsyncmodule-interface) is retained for readability and cross-specification consistency; it is **illustrative only**. This §6 WIT is **normative**: it is the actual binding a module author compiles against and a runtime hosts. Where the two disagree, the WIT governs. The mapping is:

| WebIDL construct ([§5](#5-graphsyncmodule-interface)) | Normative WIT construct (§6) | Notes |
|---|---|---|
| `interface GraphSyncModule` | exported `interface module` in `world graph-sync-module` | Module *exports*; the runtime imports them. |
| `dictionary ModuleConfig` | `record module-config` | `graphWriter`/`graphReader`/`crypto`/`network` fields are **not** carried in the record — they are the imported host interfaces the runtime provides at instantiation (see below). `maxMemoryBytes`/`executionBudgetMs` are runtime-enforced limits mirrored into the record for the module's visibility. |
| `interface GraphReader` | imported `interface host-graph`, `resource graph-reader` | Host-owned resource handle. Capability-scoped per [§8](#8-module-capabilities) (`graph.read`). |
| `interface GraphWriter` | imported `interface host-graph`, `resource graph-writer` | Host-owned resource handle (`graph.write`). |
| `CryptoProvider` ([§5.4](#54-cryptoprovider--networkprovider)) | imported `interface host-crypto` | Scoped signer; key material never crosses the boundary. |
| `NetworkProvider` ([§5.4](#54-cryptoprovider--networkprovider)) | imported `interface host-network`, `resource network-connection`, `resource peer-connection` | Connections are host-owned resources. |
| `callback RemoteDiffCallback` | exported `handle-remote-diff` in `interface inbound` | A WIT `func` cannot be passed as a parameter; the "register a callback" pattern (`onRemoteDiff`) is modelled as a **module export the runtime calls**. `onRemoteDiff(cb)`/`onSignal(cb)` therefore have no WIT analogue as methods — registration is implicit in the module exporting the handler. |
| `callback SignalCallback` | exported `handle-signal` in `interface inbound` | Same inversion as above. |
| `GraphDiff` interface | `record graph-diff` | Immutable value record; `revision`/`commitId`/`signature` are content-hashes/signatures the module MUST NOT recompute ([[CONTEXT-SYNC]] §5.2.2). |
| `Peer` dictionary | `record peer` | |
| `CapabilityProof` interface | `record capability-proof` | `presentations` (opaque VC objects in [[CONTEXT-SYNC]] §5.3) are carried as `list<string>` of JSON-serialised [[VC-DATA-MODEL-2.0]] VerifiablePresentations. |
| `SyncValidationResult` dictionary | `record sync-validation-result` | |
| `Triple` / `LiteralValue` | `record triple` / `variant term` | Per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.1. |
| `SparqlResult` | `string` (SPARQL 1.1 Query Results JSON) | Carried as a JSON document string; the module parses it. |
| WebIDL `Promise<T>` on host imports | synchronous `func(...) -> result<T, ...>` | See the async model in [§6.2](#62-asynchronous-operations). |

The `graphWriter`, `graphReader`, `crypto`, and `network` members of `ModuleConfig` in the WebIDL are, in the WIT, the **imported host interfaces** — the runtime satisfies them at component instantiation rather than passing them as `init` arguments. The module obtains the concrete capability-scoped handles (`graph-reader`, `graph-writer`, `crypto-provider`, `network-provider`) by calling the imported constructors during `init`, which is why `module-config` carries the module's `space-uri`/`local-did`/limits but not the provider handles themselves.

### 6.2 Asynchronous Operations

Several operations are asynchronous in the WebIDL ([§5](#5-graphsyncmodule-interface)): the `GraphReader`/`GraphWriter` methods return `Promise`, and transport/signalling operations complete out-of-band. This specification pins the async model as follows, and MUST be implemented as stated:

1. **Host imports are synchronous at the canonical ABI.** The host surfaces follow WASI's capability-oriented import conventions ([[WASI]]): every imported host function ([§6.3](#63-the-wit)) is a plain `func` returning `result<T, host-error>`. Under the [[WASM-COMPONENT-MODEL]] canonical ABI, a call into a host import may suspend the calling task; the host resumes it when the underlying I/O (a graph read, a `network.fetch`, a relay send) completes. From the module's source-language perspective the call is an ordinary blocking call — bindings generators surface it as `async` in host languages that have async, and as a blocking call otherwise. No `future`/`stream` types appear in the exported surface, so the world is instantiable on any runtime implementing the stable synchronous canonical ABI; it does **not** require the asynchronous ABI ([[WASM-COMPONENT-MODEL]] "async" feature) to be present.

2. **Module-to-runtime events are runtime-initiated calls into module exports.** A WIT function cannot be passed as a value, so the WebIDL "register a callback" methods (`onRemoteDiff`, `onSignal`) have no method form. Instead the module *exports* `handle-remote-diff` and `handle-signal` in the `inbound` interface, and the runtime calls them when a remote diff or signal arrives. This inverts the registration but preserves the semantics of [§5.1](#51-interface-definition): the module still validates each inbound diff internally before the runtime observes the result (the runtime reads the `sync-validation-result` the module returns from `handle-remote-diff`).

3. **`execution-budget-ms` bounds every module-export call.** The runtime MUST terminate any call into a module export (`init`, `commit`, `validate-diff`, `validate-read-access`, `handle-remote-diff`, `handle-signal`, `request-sync`) that exceeds the budget in `module-config` ([§5.2](#52-moduleconfig)), and the corresponding host-side operation MUST reject. Budget enforcement is a host-side watchdog on the component task, not a WIT-expressible construct.

4. **Forward compatibility.** When the asynchronous canonical ABI stabilises, a future minor version of this world MAY re-type the long-latency host imports (`fetch`, `send`, `pull`-style reads) as `func(...) -> future<result<...>>` and the streaming diff-delivery path as `stream<graph-diff>`, without changing the record/variant vocabulary in [§6.3](#63-the-wit). Modules compiled against `@0.1.0` remain loadable under the compatibility rules of [[WASM-COMPONENT-MODEL]] semantic-version resolution; a runtime advertising only `@0.1.0` MUST reject a module requiring a later async-typed revision.

### 6.3 The WIT

```wit
package living-web:sync@0.1.0;

/// The world every conforming sync module ([§4](#4-module-concept)) satisfies.
/// The module is a WebAssembly component: it *exports* `module` and `inbound`
/// (the runtime calls into them) and *imports* the capability-scoped host
/// interfaces (the module calls out to them). A conforming user agent MUST
/// provide every import; a module MUST import no interface not listed here.
world graph-sync-module {
  // ---- Host imports: capability-scoped runtime surfaces (§5.3, §5.4, §8) ----
  import host-graph;
  import host-crypto;
  import host-network;
  import host-clock;
  import host-random;
  import host-storage;
  import host-log;

  // ---- Module exports: the GraphSyncModule contract (§5.1) ----
  export module;
  export inbound;
}

// =====================================================================
// Shared types — canonical wire forms of the WebIDL in §5 and
// [[CONTEXT-SYNC]] §5. Imported by every other interface in this package.
// =====================================================================
interface types {
  // ---- RDF term and triple (PERSONAL-LINKED-DATA-GRAPHS §3.1) ----

  /// An RDF 1.2 literal value. `datatype` is an XSD (or other) datatype IRI;
  /// it defaults, on the wire, to `xsd:string` when the producer omits it.
  /// `language` is a BCP-47 tag and is only meaningful for `rdf:langString`.
  record literal-value {
    lexical-value: string,
    datatype: string,
    language: option<string>,
  }

  /// The object of a triple is either an IRI/blank-node (`iri`) or a literal.
  variant term {
    iri(string),
    literal(literal-value),
  }

  /// A single RDF triple. `subject` and `predicate` are IRIs (predicate is
  /// REQUIRED and MUST be a URI); `object` is a `term`. Per-triple provenance
  /// travels as separate reifier triples within `additions`/`removals`
  /// (PERSONAL-LINKED-DATA-GRAPHS §3.2), so no provenance fields appear here.
  record triple {
    subject: string,
    predicate: string,
    object: term,
  }

  /// Query filter for `host-graph.graph-reader.query-triples` — mirrors the
  /// WebIDL `TripleQuery`. All present fields combine with logical AND.
  record triple-query {
    subject: option<string>,
    predicate: option<string>,
    object: option<term>,
    author: option<string>,      // matches reifier prov://author
    from-date: option<string>,   // RFC 3339; reifier timestamp >=
    until-date: option<string>,  // RFC 3339; reifier timestamp <
    offset: option<u32>,
    limit: option<u32>,
  }

  // ---- CapabilityProof ([[CONTEXT-SYNC]] §5.3) ----

  /// Ordered leaf→root ZCAP chain plus the material a receiving peer needs to
  /// re-evaluate caveats. `presentations` are JSON-serialised
  /// [[VC-DATA-MODEL-2.0]] VerifiablePresentations consumed by `credential`
  /// caveats; empty when none apply.
  record capability-proof {
    chain: list<string>,             // content-addressed ZCAP ids, leaf → root
    caveats-satisfied: list<string>, // audit trail, not a trust shortcut
    has-content-caveats: bool,       // optimisation hint
    presentations: list<string>,     // JSON VerifiablePresentation documents
  }

  // ---- GraphDiff ([[CONTEXT-SYNC]] §5.1) ----

  /// A unit of change to one graph. Immutable once `commit-id` is computed.
  /// `revision`, `commit-id`, and `signature` are content-hashes/signatures
  /// per [[CONTEXT-SYNC]] §5.2.2 and MUST NOT be recomputed by the module on
  /// rebroadcast. `dependencies` are this graph's DAG heads at commit time
  /// (§5.2.1 of [[CONTEXT-SYNC]]); an empty list is a chain root.
  record graph-diff {
    graph-did: string,
    revision: string,                    // sha256 hex — triple-set identity
    commit-id: string,                   // sha256 hex — full commit identity
    additions: list<triple>,
    removals: list<triple>,
    dependencies: list<string>,          // revisions in THIS graph only
    capability-proof: option<capability-proof>,
    author: string,                      // did:key:… (committing agent)
    timestamp: string,                   // RFC 3339; authoritative commit time
    diffs-since-snapshot: u32,
    signature: string,                   // bundle signature over commit-id
  }

  // ---- Peer ([[CONTEXT-SYNC]] §5.4) ----

  /// A peer session. Peers are equal iff `(did, session-id)` match; a single
  /// agent may hold several concurrent sessions. `public-key` MUST be absent
  /// for `did:key` peers and is a routing hint otherwise (never a trust
  /// anchor). `last-seen` is milliseconds since the Unix epoch.
  record peer {
    did: string,
    session-id: string,          // 128+ bits of ephemeral randomness
    public-key: option<string>,  // multibase; omitted for did:key
    device-label: option<string>,
    last-seen: option<u64>,      // ms since Unix epoch
    online: bool,
  }

  // ---- Validation result ([[CONTEXT-SYNC]] §5.6) ----

  /// The module's authoritative accept/reject for a diff or read request.
  /// `constraint-kind` is "capability" or any plug-in kind the module's
  /// manifest declares ([§8.2](#82-manifest-format)).
  record sync-validation-result {
    accepted: bool,
    constraint-kind: option<string>,
    constraint-id: option<string>,
    reason: option<string>,
  }

  // ---- ModuleConfig (§5.2) ----

  /// Passed to `module.init`. The graph-writer / graph-reader / crypto /
  /// network members of the WebIDL `ModuleConfig` are NOT here: they are the
  /// imported host interfaces the runtime provides at instantiation (§6.1).
  /// This record carries only scalar configuration and the runtime-enforced
  /// resource limits, surfaced so the module can self-regulate.
  record module-config {
    space-uri: string,
    local-did: string,
    max-memory-bytes: u64,       // WASM linear-memory ceiling; runtime MAY trap
    execution-budget-ms: u32,    // per-export wall-clock budget (§6.2 item 3)
  }

  // ---- Errors ----

  /// Error raised by any imported host function. Capability, scope, and
  /// resource-limit failures are all reported here; the module cannot forge
  /// its way past a `not-authorised` (§8.3).
  variant host-error {
    /// The module asked for a graph/endpoint/handle outside its grant set.
    not-authorised(string),
    /// The `graph-did` (or space) is not in the module's authorised set.
    unknown-scope(string),
    /// A declared limit was exceeded (e.g. `storage.module.<size>` cap, §8.1).
    quota-exceeded(string),
    /// Transport/relay/fetch failure. Maps to [[CONTEXT-SYNC]] "NetworkError".
    network-error(string),
    /// The scoped signer refused the requested shape (§5.4, §9.7).
    signing-refused(string),
    /// Malformed argument (bad IRI, bad SPARQL, non-UTF-8 payload, …).
    invalid-argument(string),
    /// Operation exceeded `execution-budget-ms` and was terminated (§6.2).
    budget-exceeded,
    /// Catch-all internal host failure.
    internal(string),
  }
}

// =====================================================================
// Host import: capability-scoped graph read/write (§5.3).
// `graph.read` and `graph.write` capabilities (§8) gate the resources.
// =====================================================================
interface host-graph {
  use types.{triple, triple-query, graph-diff, host-error};

  /// Capability-scoped read handle. The runtime mints one per module; every
  /// method takes `graph-did` so the runtime can reject reads for graphs the
  /// module is not authorised to serve.
  resource graph-reader {
    /// Structured triple query. Returns data triples (not reifier triples),
    /// per PERSONAL-LINKED-DATA-GRAPHS §3.5.
    query-triples: func(graph-did: string, query: triple-query)
      -> result<list<triple>, host-error>;

    /// SPARQL query over the graph. Result is a SPARQL 1.1 Query Results JSON
    /// document (SELECT/ASK) or an RDF serialisation (CONSTRUCT/DESCRIBE),
    /// as a UTF-8 string the module parses.
    query-sparql: func(graph-did: string, sparql: string)
      -> result<string, host-error>;

    /// Full current data-triple set of the graph (its snapshot).
    snapshot: func(graph-did: string) -> result<list<triple>, host-error>;
  }

  /// Capability-scoped write handle. `apply` is idempotent for a diff whose
  /// `commit-id` already exists in the per-graph store (§5.1 of this spec).
  resource graph-writer {
    apply: func(graph-did: string, diff: graph-diff) -> result<_, host-error>;
  }

  /// Mint the module's read handle. Called by the module during `init`.
  /// The runtime scopes the returned resource to the module's authorised set.
  reader: func() -> graph-reader;

  /// Mint the module's write handle. Called by the module during `init`.
  writer: func() -> graph-writer;
}

// =====================================================================
// Host import: scoped crypto (§5.4). Key material never enters module
// linear memory; the signer accepts only the exhaustive shapes below.
// =====================================================================
interface host-crypto {
  use types.{host-error};

  /// A signed blob: the signature bytes plus the verification method that
  /// produced them (a DID URL). `verify` consumes this shape.
  record signed {
    signature: list<u8>,
    verification-method: string,   // DID URL of the signing key
  }

  resource crypto-provider {
    /// Sign a graph's `commit-id` (§5.2.2 of [[CONTEXT-SYNC]]). The runtime
    /// verifies `commit-id` corresponds to a diff the module just built via
    /// `module.commit` and that `graph-did` is authorised; else
    /// `signing-refused`. Requires `crypto.commit-sign` (§8).
    sign-commit: func(graph-did: string, commit-id: string)
      -> result<signed, host-error>;

    /// Sign a signal envelope, bound to (local-did, remote-did, space-uri,
    /// payload). Requires `crypto.signal-sign` (§8). Used only for signalling
    /// authentication — cannot be repurposed for authorisation artefacts.
    sign-signal: func(space-uri: string, remote-did: string, payload: list<u8>)
      -> result<signed, host-error>;

    /// Pure verification: no key material involved. `public-key` is a
    /// multibase-encoded key or DID URL. Requires `crypto.verify` (§8).
    verify: func(message: list<u8>, signature: signed, public-key: string)
      -> result<bool, host-error>;
  }

  /// Mint the module's scoped signer. Called during `init`.
  provider: func() -> crypto-provider;
}

// =====================================================================
// Host import: mediated network (§5.4). Endpoints/protocols/origins are
// gated by network.* capabilities (§8). Connections are host resources.
// =====================================================================
interface host-network {
  use types.{host-error};

  /// The wire protocol requested for a relay connection.
  enum relay-protocol {
    web-transport,
    web-socket,
  }

  /// An open relay or peer transport. The module reads/writes framed messages;
  /// framing above the byte stream is the module's protocol ([[CONTEXT-SYNC]]
  /// is module-neutral). Dropping the resource closes the connection.
  resource network-connection {
    /// Send one message frame. Rejects with `network-error` if the peer/relay
    /// is unreachable.
    send: func(message: list<u8>) -> result<_, host-error>;

    /// Receive the next message frame. Blocks (per §6.2) until a frame is
    /// available; returns `none` when the connection has closed cleanly.
    receive: func() -> result<option<list<u8>>, host-error>;

    /// True while the underlying transport is open.
    is-open: func() -> bool;

    /// Close the connection explicitly (also happens on resource drop).
    close: func();
  }

  /// A peer-to-peer transport session (e.g. WebRTC data channel). Same
  /// message-framing contract as `network-connection`.
  resource peer-connection {
    remote-did: func() -> string;
    send: func(message: list<u8>) -> result<_, host-error>;
    receive: func() -> result<option<list<u8>>, host-error>;
    is-open: func() -> bool;
    close: func();
  }

  resource network-provider {
    /// Open a relay session to an endpoint authorised by
    /// `network.relay.<endpoint>` (§8). `endpoint` is a wss:// or https://
    /// URL matching a granted capability.
    connect: func(endpoint: string, protocol: relay-protocol)
      -> result<network-connection, host-error>;

    /// Initiate a P2P transport to a peer in the module's space, gated by
    /// `network.peer.<protocol>` (§8). `protocol` is a runtime-bound
    /// identifier ("webrtc", "webtransport-p2p", …).
    peer-connect: func(remote-did: string, protocol: string)
      -> result<peer-connection, host-error>;

    /// Opaque, credential-free HTTP GET to an origin authorised by
    /// `network.fetch.<origin>` (§8). No cookies, no Authorization header, no
    /// caller-supplied credentials; the response is raw bytes only. Typically
    /// used to retrieve a module-distribution artefact.
    fetch: func(url: string) -> result<list<u8>, host-error>;
  }

  /// Mint the module's network handle. Called during `init`.
  provider: func() -> network-provider;
}

// =====================================================================
// Host import: time (§8 — time.wallclock / time.monotonic).
// =====================================================================
interface host-clock {
  /// Wall-clock time in milliseconds since the Unix epoch. The runtime SHOULD
  /// coarsen the value (e.g. 1 s resolution) as a fingerprinting
  /// countermeasure. Requires `time.wallclock` (§8).
  now-wallclock-ms: func() -> u64;

  /// Monotonic timer in nanoseconds, suitable for measuring durations only
  /// (no defined epoch, never goes backwards). Requires `time.monotonic`.
  now-monotonic-ns: func() -> u64;
}

// =====================================================================
// Host import: cryptographically-secure randomness (§8 — random.csprng).
// =====================================================================
interface host-random {
  /// Fill a buffer of `len` bytes from a CSPRNG. Requires `random.csprng`.
  get-random-bytes: func(len: u32) -> list<u8>;
}

// =====================================================================
// Host import: module-private persistent storage (§7.1, §8 —
// storage.module.<size>). Keyed by (content-hash, graph-did); opaque to the
// user agent at content level; subject to the declared size cap.
// =====================================================================
interface host-storage {
  use types.{host-error};

  /// Read a value by key for `graph-did`'s store. `none` if absent.
  get: func(graph-did: string, key: string)
    -> result<option<list<u8>>, host-error>;

  /// Write a value. Rejects with `quota-exceeded` if the write would exceed
  /// the declared `storage.module.<size>` cap (§8.1); the module is expected
  /// to evict/compact its own working set.
  set: func(graph-did: string, key: string, value: list<u8>)
    -> result<_, host-error>;

  /// Delete a key. No error if the key was absent.
  delete: func(graph-did: string, key: string) -> result<_, host-error>;

  /// Enumerate keys (optionally by prefix) in `graph-did`'s store.
  list-keys: func(graph-did: string, prefix: option<string>)
    -> result<list<string>, host-error>;
}

// =====================================================================
// Host import: diagnostic logging. Content-level opaque to peers; the
// runtime MAY surface it in the management UI (§7.6). No capability gate.
// =====================================================================
interface host-log {
  enum level { trace, debug, info, warn, error }
  log: func(lvl: level, message: string);
}

// =====================================================================
// Module export: the GraphSyncModule contract (§5.1). The runtime calls
// these; `execution-budget-ms` (§6.2 item 3) bounds every call.
// =====================================================================
interface module {
  use types.{module-config, graph-diff, peer, capability-proof,
             sync-validation-result, host-error};

  // ---- Lifecycle ----

  /// One-time initialisation. The module obtains its capability-scoped
  /// handles by calling the imported `host-*.provider`/`reader`/`writer`
  /// constructors here. NOT re-invoked on resume from suspension unless the
  /// runtime discarded linear memory (§7.5).
  init: func(config: module-config) -> result<_, host-error>;

  /// Release all handles and stop work. After `shutdown` the component
  /// instance is discarded.
  shutdown: func();

  // ---- Transport (per space) ----

  /// Establish presence in the space for `local-did`. Idempotent per instance.
  connect: func(space-uri: string, local-did: string)
    -> result<_, host-error>;

  /// Tear down the space connection (peers, transports). Storage is retained.
  disconnect: func() -> result<_, host-error>;

  // ---- Sync (per graph) ----

  /// Package and commit a diff to the space for `graph-did`. `revision`,
  /// `commit-id`, and `signature` in the returned diff are computed
  /// deterministically ([[CONTEXT-SYNC]] §5.2.2) and MUST match on every peer;
  /// the module MUST NOT choose them.
  commit: func(graph-did: string, diff: graph-diff)
    -> result<_, host-error>;

  /// Request a catch-up pull for `graph-did` starting after `from-revision`
  /// (empty string = from the current snapshot). Diffs arrive asynchronously
  /// via `inbound.handle-remote-diff` (§6.2 item 2).
  request-sync: func(graph-did: string, from-revision: string)
    -> result<_, host-error>;

  // ---- Peer management ----

  /// All peers known for the module's space (online and offline).
  peers: func() -> list<peer>;

  /// The subset of `peers` currently online.
  online-peers: func() -> list<peer>;

  /// Actively discover peers for `space-uri` (may perform network I/O; blocks
  /// per §6.2). Returns the peers found.
  discover-peers: func(space-uri: string) -> result<list<peer>, host-error>;

  // ---- Signalling ----

  /// Address a signal envelope to `remote-did` in the module's space.
  /// Requires `signal.send` (§8). Inbound signals arrive via
  /// `inbound.handle-signal`.
  send-signal: func(remote-did: string, payload: list<u8>)
    -> result<_, host-error>;

  // ---- Governance validation (runs in-module by design — §5.5) ----

  /// Validate an incoming diff for `graph-did`, authored by `author`, per
  /// [[CONTEXT-SYNC]] §9.2.1 and [[CAPABILITY-FRAMEWORK]] §7 over the
  /// constraint kinds the module's manifest declares. The module reads
  /// whatever local graph state it needs through its `graph-reader` import —
  /// the "graphState" argument of [[CONTEXT-SYNC]] §9.2.1 is that ambient
  /// capability, not a marshalled parameter. The runtime treats the returned
  /// result as authoritative and does not double-check (§5.5).
  validate-diff: func(graph-did: string, diff: graph-diff, author: string)
    -> result<sync-validation-result, host-error>;

  /// Validate a read-mount / snapshot-pull request per [[CONTEXT-SYNC]]
  /// §9.2.2. `proof` is absent for unrestricted-read graphs.
  validate-read-access: func(graph-did: string,
                             author-did: string,
                             proof: option<capability-proof>)
    -> result<sync-validation-result, host-error>;
}

// =====================================================================
// Module export: runtime-initiated inbound handlers (§6.2 item 2). These
// are the WIT form of the WebIDL `onRemoteDiff` / `onSignal` callback
// registrations — the module exports the handler and the runtime calls it.
// =====================================================================
interface inbound {
  use types.{graph-diff, sync-validation-result};

  /// The runtime delivers each inbound diff here. The module MUST validate it
  /// internally (via its own `validate-diff` logic) and return the result;
  /// the runtime uses the result to fire `ondiff` events ([[CONTEXT-SYNC]]
  /// §6.3) and update sync state. The module MAY also have applied the diff
  /// via `host-graph.graph-writer.apply` before returning; `apply` is
  /// idempotent for a matching `commit-id`.
  handle-remote-diff: func(graph-did: string, diff: graph-diff)
    -> sync-validation-result;

  /// The runtime delivers each inbound signal envelope here. `payload` is the
  /// raw signal bytes addressed to the local DID (requires the peer had
  /// `signal.send`; local receipt requires `signal.receive`, §8).
  handle-signal: func(remote-did: string, payload: list<u8>);
}
```

### 6.4 Conformance of the Binding

A module component MUST:

1. Export exactly the `module` and `inbound` interfaces of `world graph-sync-module`, with every function present and typed as above. A missing or mistyped export makes the module non-conformant and the runtime MUST refuse to instantiate it.
2. Import no interface outside the seven `host-*` interfaces this world declares. A module whose component imports any other interface (e.g. `wasi:filesystem`, `wasi:sockets`, a raw clock) MUST be rejected at instantiation — this is the component-level expression of the sandbox in [§4.4](#44-module-execution-environment) and [§9.1](#91-module-sandbox).
3. Treat every `result<_, host-error>` faithfully: a `host-error` from an imported function is the runtime denying or failing a capability-scoped operation ([§9.3](#93-capability-containment)); the module MUST NOT retry in a way that attempts to escalate scope.

A runtime MUST provide every imported interface, MUST enforce the capability grants of [§8](#8-module-capabilities) behind those imports (returning `not-authorised`/`unknown-scope` rather than performing out-of-scope work), and MUST enforce `execution-budget-ms` ([§6.2](#62-asynchronous-operations) item 3) and `max-memory-bytes` independently of any value the module reads from `module-config`.

---

## 7. Module Lifecycle

### 7.1 Installation

1. Fetch the WASM binary from a distribution endpoint.
2. Verify the SHA-256 content hash.
3. Fetch and parse the accompanying manifest ([§8.2](#82-manifest-format)). Extract `capabilitiesRequired` and `supportedConstraintKinds`.
4. Display the user consent prompt ([§7.2](#72-user-consent)).
5. On approval, store the module binary and manifest, register the module, and (if a graph is waiting) instantiate it per [§4.4](#44-module-execution-environment).

### 7.2 User Consent

Installing a sync module is privileged. The user agent MUST obtain explicit user consent:

1. Display a prompt identifying the content hash, the capabilities requested ([§8](#8-module-capabilities)), the graphs/spaces that will use the module, and the relay endpoints.
2. Require explicit "Allow" or "Deny".
3. The user agent SHOULD remember the decision for subsequent encounters with the same hash.

### 7.3 Module Evolution Is via Forking

There is no in-place module transition in this specification. A graph's module is bound to its DID's immutable seed ([§4.5](#45-module-identity-is-bound-to-the-did), [[GROUP-IDENTITY]] §4.5); a community that needs a different module forks ([[GROUP-IDENTITY]] §4.8) to a new DID. The fork operation is where the constraint-kind compatibility check happens ([[GROUP-IDENTITY]] §4.8.1 step 2): the new module's manifest's `supportedConstraintKinds` MUST be a superset of every constraint kind currently in force on the parent. The runtime never swaps the module on a live subscription; the subscriber's relationship to the parent ends (or continues, by choice) when they mount the child.

Mounting the child's DID for the first time follows the standard installation flow ([§7.1](#71-installation)): fetch, verify content hash, parse manifest, prompt for user consent, instantiate. The fork's `group://forkedFrom` triple is visible during materialisation, so the user agent MAY present the consent prompt with explicit lineage context ("This graph is a fork of `did:graph:abc...` — review the new module's capabilities below.").

### 7.4 Removal

The user MAY remove a module via the management UI. Removal:

1. Disconnects all spaces using the module.
2. Unmounts graphs that depended on the module (preserving the per-graph stores).
3. Removes the module binary and capability grants.

### 7.5 Suspension

The runtime MAY suspend a module under resource pressure. A suspended module retains its WASM linear memory and `storage.module.*` contents but stops receiving callbacks, processing diffs, and issuing outbound traffic. On resume, `init()` is *not* re-invoked; processing continues from the preserved state. The runtime MAY discard a suspended module's linear memory under heavier pressure, in which case resume requires a fresh `init()` and the module rebuilds working state from `storage.module.*`.

### 7.6 Management UI

The user agent SHOULD provide a management interface analogous to "Manage Extensions" — see installed modules, content hashes, statuses, which graphs/spaces use them, and resource consumption. Allow pause, resume, removal.

---

## 8. Module Capabilities

The sandbox grants modules a fixed set of capability handles. Modules cannot synthesise new capabilities at runtime.

| Capability | Permits |
|---|---|
| `graph.read` | Read triples from the graphs the module serves |
| `graph.write` | Apply GraphDiffs to the graphs the module serves |
| `crypto.commit-sign` | Produce commit-bundle signatures for the module's graphs ([§5.4](#54-cryptoprovider--networkprovider)) |
| `crypto.signal-sign` | Produce signal-envelope signatures within the module's space |
| `crypto.verify` | Verify signatures (pure; no key material involved) |
| `network.relay.<endpoint>` | Open WebTransport/WebSocket to a specific relay endpoint |
| `network.peer.<protocol>` | Use a specific peer-to-peer transport (`webrtc`, `webtransport-p2p`, …); the protocol identifier is bound by the runtime |
| `network.fetch.<origin>` | Opaque, credential-free HTTP fetch to a specific origin (typically for module-distribution endpoints) |
| `storage.module.<size>` | Persistent module-private storage up to `<size>` bytes; see [§8.1](#81-storage-lifecycle) |
| `signal.send` | Address signal envelopes to peers in the module's space |
| `signal.receive` | Receive signal envelopes addressed to the local DID |
| `time.wallclock` | Read the agent's wall-clock time. The runtime SHOULD coarsen the returned value (e.g., to 1-second resolution) as a fingerprinting countermeasure |
| `time.monotonic` | Read a monotonic timer (suitable for measuring durations, not for absolute time) |
| `random.csprng` | Draw bytes from a cryptographically-secure RNG |

The module's manifest ([§8.2](#82-manifest-format)) declares the capabilities it requires. The user consent prompt ([§7.2](#72-user-consent)) lists them.

### 8.1 Storage Lifecycle

Module-private storage (`storage.module.<size>`) is:

- Keyed by `(content-hash, graphDid)`. Different modules cannot share storage; the same module instantiated for different graphs has separate storage per graph.
- Persistent across user agent restart and module suspension ([§7.5](#75-suspension)).
- *Not* automatically migrated when a graph's module changes ([§7.3](#73-module-evolution-is-via-forking)). The previous module's storage is retained for a runtime-configurable grace period (recommended default: 30 days) so the user can revert; after the grace period the storage is purged. The user agent SHOULD expose preservation and purge controls in the management UI ([§7.6](#76-management-ui)).
- Subject to the declared size cap. Writes that would exceed the cap reject with a runtime-supplied error code; the module is expected to evict or compact its own working set.

### 8.2 Manifest Format

A module's manifest is a JSON document delivered alongside the WASM binary at the distribution endpoint. The manifest's content hash is *not* the module's content hash — the module hash binds the WASM binary alone — but the manifest MUST embed the WASM hash in its `wasmContentHash` field so the binding is mutually verifiable.

```json
{
  "name": "Example Sync Module",
  "version": "1.0.0",
  "wasmContentHash": "sha256-<hex>",
  "publisher": "did:key:z6Mk...",
  "supportedConstraintKinds": ["capability", "temporal", "content", "credential"],
  "capabilitiesRequired": [
    "graph.read",
    "graph.write",
    "crypto.commit-sign",
    "crypto.verify",
    "network.relay.wss://relay.example.org/",
    "storage.module.10485760",
    "time.monotonic",
    "random.csprng"
  ],
  "description": "Reference broadcast module."
}
```

Required fields: `name`, `version`, `wasmContentHash`, `supportedConstraintKinds`, `capabilitiesRequired`. Optional: `publisher`, `description`, additional implementation-defined metadata.

`supportedConstraintKinds` is consulted at fork time ([[GROUP-IDENTITY]] §4.8.1 step 2): a fork whose new module does not declare every constraint kind currently in force on the parent is rejected before the fork is committed. Because the module hash is then bound into the new DID's immutable seed, the check is a one-time precondition rather than an ongoing runtime concern.

Manifests MAY be signed by the publisher (via a detached signature accompanying the manifest at distribution). Signature verification is advisory unless the user has pinned a trusted publisher key in the management UI; the authoritative trust anchor is the WASM content hash plus the user's consent decision.

---

## 9. Security Considerations

### 9.1 Module Sandbox

Sync modules MUST run in the WebAssembly sandbox with only the capabilities they requested and the user granted.

### 9.2 Content-Hash Verification

The user agent MUST verify the SHA-256 content hash of every downloaded module before installation.

### 9.3 Capability Containment

A module's capability handles MUST be unforgeable; the module MUST NOT be able to manufacture references to graphs, endpoints, or storage outside its grant set.

### 9.4 Module Identity and Fork Authorisation

A graph's module is bound to its DID's immutable seed ([§4.5](#45-module-identity-is-bound-to-the-did), [[GROUP-IDENTITY]] §4.5); the capability framework MUST reject any write that mutates `<graphDid> group://syncModule` ([[CAPABILITY-FRAMEWORK]] §10). Module evolution is via forking ([[GROUP-IDENTITY]] §4.8): the fork is authorised by the parent's `forkGraph` action ([[CAPABILITY-FRAMEWORK]] §4.5.4), and the fork's seed — including the new module hash — is committed atomically in the child's bootstrap. The constraint-kind compatibility check ([[GROUP-IDENTITY]] §4.8.1 step 2) prevents a fork from naming a module that cannot evaluate the parent's active constraints. No out-of-band quorum, peer voting, or consensus protocol is involved.

### 9.5 Isolation Between Modules

Different installed modules MUST NOT share state. The runtime MUST NOT expose one module's internal state to another.

### 9.6 Governance Validation

A module's `validateDiff` and `validateReadAccess` MUST implement [[CAPABILITY-FRAMEWORK]] §7 over the constraint kinds declared in the module manifest ([§8.2](#82-manifest-format)). Validation runs in-module by design ([§5.5](#55-in-module-validation)); the conformance mechanism is content-hash review and manifest inspection at consent time, not runtime instrumentation.

### 9.7 Scoped Signing Surface

The `CryptoProvider` exposed to modules ([§5.4](#54-cryptoprovider--networkprovider)) signs only `commitId`s for the module's authorised graphs and signal envelopes for its space. A module cannot use the signing handle to produce a ZCAP delegation, an invocation, a verifiable credential, or any other authorisation artefact that would alter the user's authority footprint. The structured shapes the signer accepts are exhaustive.

---

## 10. Privacy Considerations

### 10.1 Module-Observable Metadata

A module sees: the `graphDid`s it is authorised for; the `Peer` records for those graphs; the contents of `GraphDiff`s for those graphs; signals exchanged in its sync space. The module does NOT see other graphs the agent has mounted, the user's identity beyond the supplied `localDid`, or any content outside its sync space.

### 10.2 Module-Private Storage Disclosure

Module-private storage (`storage.module.*`) is opaque to the user agent at content level but observable in size. Implementations SHOULD apply consistent encryption-at-rest.

### 10.3 Origin-Independence

Because modules execute outside the page realm, they MUST NOT be addressable from the page's `window`. The user agent MUST NOT expose module instances to page JavaScript.

---

## 11. References

### 11.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[WEBASSEMBLY]** "WebAssembly Core Specification", W3C Recommendation. https://www.w3.org/TR/wasm-core-2/
- **[CONTEXT-SYNC]** [Graph Synchronisation Protocol](./05_context-sync-protocol.md).
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./04_graph-capability-framework.md).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./03_decentralised-group-identity.md).

### 11.2 Informative References

- **[WASM-COMPONENT-MODEL]** "WebAssembly Component Model", WebAssembly Community Group. Design and specification of components, worlds, the canonical ABI, and the async model. https://github.com/WebAssembly/component-model
- **[WIT]** "WIT (WebAssembly Interface Type) Format", WebAssembly Community Group. The interface-definition language used in [§6](#6-normative-wit-definition). https://github.com/WebAssembly/component-model/blob/main/design/mvp/WIT.md
- **[WASI]** "WebAssembly System Interface", WebAssembly Community Group. The capability-oriented interface conventions referenced by the async model in [§6.2](#62-asynchronous-operations). https://github.com/WebAssembly/WASI
- **[VC-DATA-MODEL-2.0]** "Verifiable Credentials Data Model v2.0", W3C. The VerifiablePresentation form carried by `capability-proof.presentations` in [§6.3](#63-the-wit). https://www.w3.org/TR/vc-data-model-2.0/
