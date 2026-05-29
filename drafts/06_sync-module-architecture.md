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
6. [Module Lifecycle](#6-module-lifecycle)
7. [Module Capabilities](#7-module-capabilities)
8. [Security Considerations](#8-security-considerations)
9. [Privacy Considerations](#9-privacy-considerations)
10. [References](#10-references)

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

Module evolution (changing a graph's authoritative module) is *not* defined here — it is the fork operation in [[GROUP-IDENTITY]] §4.8, with constraint-kind compatibility checked at fork time ([§7.2](#72-manifest-format)).

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

1. The module sandbox ([§4](#4-module-concept), [§7](#7-module-capabilities)).
2. The module lifecycle ([§6](#6-module-lifecycle)).
3. The `GraphReader` and `GraphWriter` runtime handles ([§5.3](#53-graphreader--graphwriter)).
4. The user-consent flow ([§6.2](#62-user-consent)).

A **conforming sync module** MUST implement the `GraphSyncModule` interface ([§5](#5-graphsyncmodule-interface)) and declare its required capabilities in a manifest ([§7](#7-module-capabilities)).

---

## 3. Terminology

<dl>
<dt><dfn>Sync Module</dfn></dt>
<dd>A content-addressed WebAssembly bundle implementing the <code>GraphSyncModule</code> interface.</dd>

<dt><dfn>Content Hash</dfn></dt>
<dd>The SHA-256 hash of a module's WASM binary. The canonical identifier of a module.</dd>

<dt><dfn>Module Manifest</dfn></dt>
<dd>A document accompanying a module that declares its name, version, and required capabilities ([§7](#7-module-capabilities)).</dd>

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

**Instancing.** The runtime instantiates one module instance per `(content-hash, spaceUri)` pair. A space carrying multiple graphs is served by a single instance for all of them. An agent participating in multiple spaces with the same module hash runs multiple instances — one per space — each with its own `connect()`, peer set, and storage view. Module-private storage (`storage.module.*` per [§7](#7-module-capabilities)) is keyed by `(content-hash, graphDid)` and persists across user agent restart, independent of the instance lifecycle.

The module runs in a WebAssembly sandbox with capability-scoped permissions ([§7](#7-module-capabilities)). The module has NO access to: DOM, other graphs' data, the filesystem, arbitrary network endpoints (only those granted by capabilities), user data, cookies, local storage, or other sync modules.

### 4.5 Module Identity Is Bound to the DID

A graph's authoritative sync module is fixed at groupification (or at fork) and recorded as an immutable seed triple ([[GROUP-IDENTITY]] §4.5):

```turtle
<did:graph:abc...> <group://syncModule> "sha256-<wasm-hex>" .
```

The triple cannot be mutated by any governance write; the capability framework MUST reject such attempts ([[CAPABILITY-FRAMEWORK]] §10). A graph that needs a different module — for protocol upgrade, irreconcilable constraint-kind extension, or intentional schism — forks ([[GROUP-IDENTITY]] §4.8) to a new DID whose seed names the new module. The parent DID remains operational under its original module; subscribers MAY follow the fork or stay.

This design eliminates an in-place transition protocol entirely. There is no runtime module-swap, no in-flight diff handling, no `"module_pending"` state, no constraint-kind compatibility check at runtime — those concerns move to fork time, where the new DID's seed can be validated against the parent's state before the fork is committed ([[GROUP-IDENTITY]] §4.8.1 step 2).

Distribution endpoints for the module bundle are advertised by application-layer hints (e.g., on invitation links or in directory graphs); resolving them is the user agent's responsibility at first mount of a given DID, mediated by the consent flow in [§6.2](#62-user-consent).

---

## 5. GraphSyncModule Interface

### 5.1 Interface Definition

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

`GraphDiff`, `Peer`, `CapabilityProof`, and `SyncValidationResult` are defined in [[CONTEXT-SYNC]] §5.

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

- `network.connect(endpoint)` — opens a WebTransport or WebSocket session to a relay endpoint the module is capability-authorised to reach ([§7](#7-module-capabilities)).
- `network.peerConnect(remoteDid, protocol)` — initiates a peer-to-peer transport (e.g., WebRTC) for a peer in the module's space, gated by the `network.peer.<protocol>` capability.
- `network.fetch(url)` — issues an opaque, credential-free HTTP request to an authorised origin. No cookies, no `Authorization` headers, no caller-supplied credentials of any kind; responses are delivered as raw bytes with no caller-controlled metadata. The handle isolates the module from the user agent's ambient credential surface.

### 5.5 In-Module Validation

`validateDiff` and `validateReadAccess` execute *inside* the module sandbox. This is a deliberate design choice:

- **Equivalent trust surface.** The user has consented to install the module by its content hash; that consent already extends to every byte the module transports and every operation it performs against its authorised graphs. Moving validation host-side would not reduce the trust the user has extended — it would merely relocate where the trusted code runs. Validation correctness is bounded by the same audit-the-hash mechanism that bounds everything else the module does, in either case.
- **Composability.** Modules MAY implement custom constraint kinds (per [[CAPABILITY-FRAMEWORK]] §11) by embedding their own governance engine or extending a reference one. The module manifest ([§7.2](#72-manifest-format)) declares which constraint kinds the module supports, and the runtime gates module transitions ([§6.3](#63-module-transition)) against that list. Specialised modules — e.g., one with CRDT-aware merge constraints, or one with cryptographic privacy proofs unknown to the host — ship as drop-in replacements without modifying the user agent.
- **Locality with merge.** Merge logic is module-supplied; merge needs to know which diffs are valid to converge correctly. Co-locating validation with merge avoids a host↔module round-trip per diff and per merge candidate, and lets the module reason about validation outcomes when resolving concurrent writes.

The module's `validateDiff` and `validateReadAccess` MUST implement [[CAPABILITY-FRAMEWORK]] §7 over the constraint kinds the module declares in its manifest. A module that returns `accepted: true` without performing the requisite checks is non-conformant; the conformance mechanism is content-hash review, manifest inspection in the consent prompt ([§6.2](#62-user-consent)), and publisher-reputation visibility in the management UI ([§6.6](#66-management-ui)) — not runtime instrumentation. The runtime trusts the module's validate result.

---

## 6. Module Lifecycle

### 6.1 Installation

1. Fetch the WASM binary from a distribution endpoint.
2. Verify the SHA-256 content hash.
3. Fetch and parse the accompanying manifest ([§7.2](#72-manifest-format)). Extract `capabilitiesRequired` and `supportedConstraintKinds`.
4. Display the user consent prompt ([§6.2](#62-user-consent)).
5. On approval, store the module binary and manifest, register the module, and (if a graph is waiting) instantiate it per [§4.4](#44-module-execution-environment).

### 6.2 User Consent

Installing a sync module is privileged. The user agent MUST obtain explicit user consent:

1. Display a prompt identifying the content hash, the capabilities requested ([§7](#7-module-capabilities)), the graphs/spaces that will use the module, and the relay endpoints.
2. Require explicit "Allow" or "Deny".
3. The user agent SHOULD remember the decision for subsequent encounters with the same hash.

### 6.3 Module Evolution Is via Forking

There is no in-place module transition in this specification. A graph's module is bound to its DID's immutable seed ([§4.5](#45-module-identity-is-bound-to-the-did), [[GROUP-IDENTITY]] §4.5); a community that needs a different module forks ([[GROUP-IDENTITY]] §4.8) to a new DID. The fork operation is where the constraint-kind compatibility check happens ([[GROUP-IDENTITY]] §4.8.1 step 2): the new module's manifest's `supportedConstraintKinds` MUST be a superset of every constraint kind currently in force on the parent. The runtime never swaps the module on a live subscription; the subscriber's relationship to the parent ends (or continues, by choice) when they mount the child.

Mounting the child's DID for the first time follows the standard installation flow ([§6.1](#61-installation)): fetch, verify content hash, parse manifest, prompt for user consent, instantiate. The fork's `group://forkedFrom` triple is visible during materialisation, so the user agent MAY present the consent prompt with explicit lineage context ("This graph is a fork of `did:graph:abc...` — review the new module's capabilities below.").

### 6.4 Removal

The user MAY remove a module via the management UI. Removal:

1. Disconnects all spaces using the module.
2. Unmounts graphs that depended on the module (preserving the per-graph stores).
3. Removes the module binary and capability grants.

### 6.5 Suspension

The runtime MAY suspend a module under resource pressure. A suspended module retains its WASM linear memory and `storage.module.*` contents but stops receiving callbacks, processing diffs, and issuing outbound traffic. On resume, `init()` is *not* re-invoked; processing continues from the preserved state. The runtime MAY discard a suspended module's linear memory under heavier pressure, in which case resume requires a fresh `init()` and the module rebuilds working state from `storage.module.*`.

### 6.6 Management UI

The user agent SHOULD provide a management interface analogous to "Manage Extensions" — see installed modules, content hashes, statuses, which graphs/spaces use them, and resource consumption. Allow pause, resume, removal.

---

## 7. Module Capabilities

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
| `storage.module.<size>` | Persistent module-private storage up to `<size>` bytes; see [§7.1](#71-storage-lifecycle) |
| `signal.send` | Address signal envelopes to peers in the module's space |
| `signal.receive` | Receive signal envelopes addressed to the local DID |
| `time.wallclock` | Read the agent's wall-clock time. The runtime SHOULD coarsen the returned value (e.g., to 1-second resolution) as a fingerprinting countermeasure |
| `time.monotonic` | Read a monotonic timer (suitable for measuring durations, not for absolute time) |
| `random.csprng` | Draw bytes from a cryptographically-secure RNG |

The module's manifest ([§7.2](#72-manifest-format)) declares the capabilities it requires. The user consent prompt ([§6.2](#62-user-consent)) lists them.

### 7.1 Storage Lifecycle

Module-private storage (`storage.module.<size>`) is:

- Keyed by `(content-hash, graphDid)`. Different modules cannot share storage; the same module instantiated for different graphs has separate storage per graph.
- Persistent across user agent restart and module suspension ([§6.5](#65-suspension)).
- *Not* automatically migrated when a graph's module changes ([§6.3](#63-module-transition)). The previous module's storage is retained for a runtime-configurable grace period (recommended default: 30 days) so the user can revert; after the grace period the storage is purged. The user agent SHOULD expose preservation and purge controls in the management UI ([§6.6](#66-management-ui)).
- Subject to the declared size cap. Writes that would exceed the cap reject with a runtime-supplied error code; the module is expected to evict or compact its own working set.

### 7.2 Manifest Format

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

## 8. Security Considerations

### 8.1 Module Sandbox

Sync modules MUST run in the WebAssembly sandbox with only the capabilities they requested and the user granted.

### 8.2 Content-Hash Verification

The user agent MUST verify the SHA-256 content hash of every downloaded module before installation.

### 8.3 Capability Containment

A module's capability handles MUST be unforgeable; the module MUST NOT be able to manufacture references to graphs, endpoints, or storage outside its grant set.

### 8.4 Module Identity and Fork Authorisation

A graph's module is bound to its DID's immutable seed ([§4.5](#45-module-identity-is-bound-to-the-did), [[GROUP-IDENTITY]] §4.5); the capability framework MUST reject any write that mutates `<graphDid> group://syncModule` ([[CAPABILITY-FRAMEWORK]] §10). Module evolution is via forking ([[GROUP-IDENTITY]] §4.8): the fork is authorised by the parent's `forkGraph` action ([[CAPABILITY-FRAMEWORK]] §4.5.4), and the fork's seed — including the new module hash — is committed atomically in the child's bootstrap. The constraint-kind compatibility check ([[GROUP-IDENTITY]] §4.8.1 step 2) prevents a fork from naming a module that cannot evaluate the parent's active constraints. No out-of-band quorum, peer voting, or consensus protocol is involved.

### 8.5 Isolation Between Modules

Different installed modules MUST NOT share state. The runtime MUST NOT expose one module's internal state to another.

### 8.6 Governance Validation

A module's `validateDiff` and `validateReadAccess` MUST implement [[CAPABILITY-FRAMEWORK]] §7 over the constraint kinds declared in the module manifest ([§7.2](#72-manifest-format)). Validation runs in-module by design ([§5.5](#55-in-module-validation)); the conformance mechanism is content-hash review and manifest inspection at consent time, not runtime instrumentation.

### 8.7 Scoped Signing Surface

The `CryptoProvider` exposed to modules ([§5.4](#54-cryptoprovider--networkprovider)) signs only `commitId`s for the module's authorised graphs and signal envelopes for its space. A module cannot use the signing handle to produce a ZCAP delegation, an invocation, a verifiable credential, or any other authorisation artefact that would alter the user's authority footprint. The structured shapes the signer accepts are exhaustive.

---

## 9. Privacy Considerations

### 9.1 Module-Observable Metadata

A module sees: the `graphDid`s it is authorised for; the `Peer` records for those graphs; the contents of `GraphDiff`s for those graphs; signals exchanged in its sync space. The module does NOT see other graphs the agent has mounted, the user's identity beyond the supplied `localDid`, or any content outside its sync space.

### 9.2 Module-Private Storage Disclosure

Module-private storage (`storage.module.*`) is opaque to the user agent at content level but observable in size. Implementations SHOULD apply consistent encryption-at-rest.

### 9.3 Origin-Independence

Because modules execute outside the page realm, they MUST NOT be addressable from the page's `window`. The user agent MUST NOT expose module instances to page JavaScript.

---

## 10. References

### 10.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[WEBASSEMBLY]** "WebAssembly Core Specification", W3C Recommendation. https://www.w3.org/TR/wasm-core-2/
- **[CONTEXT-SYNC]** [Graph Synchronisation Protocol](./05_context-sync-protocol.md).
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./04_graph-capability-framework.md).
- **[GROUP-IDENTITY]** [Decentralised Group Identity](./03_decentralised-group-identity.md).

### 10.2 Informative References

None.
