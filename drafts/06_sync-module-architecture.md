# Sync Module Architecture

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines the architecture for pluggable, content-addressed **sync modules** that implement the [[CONTEXT-SYNC]] protocol. A sync module is a WebAssembly bundle conforming to the `GraphSyncModule` interface defined here; the module supplies transport, merge logic, peer discovery, and governance-validation behaviour for one or more sync spaces. Modules execute in a capability-scoped sandbox managed by the user agent, isolated from the page realm and from each other. This specification defines the module interface, the capability vocabulary that gates module access to runtime resources, the lifecycle (installation, update, suspension, removal), and the user-consent model. Any specific built-in default module is out of scope here.

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

No single sync strategy is optimal for all use cases. A collaborative editor needs different merge semantics than a social feed. Rather than prescribing one approach, [[CONTEXT-SYNC]] is implemented over a **pluggable sync module architecture** — each sync space specifies the WebAssembly module that handles its gossip.

This specification defines the module interface and execution environment. Conforming user agents MUST ship at least one built-in default module that satisfies this interface (the specific default module is out of scope here). Communities MAY install additional modules to implement custom transports, merge algorithms, or peer-discovery mechanisms.

### 1.2 Scope

This specification defines:

- The `GraphSyncModule` interface that all sync modules implement.
- The `ModuleConfig`, `GraphReader`, and `GraphWriter` types passed to modules.
- The capability vocabulary that gates module access to runtime resources.
- The installation, update, suspension, and removal lifecycle.
- The user-consent model for installing modules.

### 1.3 Relationship to Other Specifications

- [[CONTEXT-SYNC]] defines the protocol that modules implement.
- [[PERSONAL-LINKED-DATA-GRAPHS]] defines the Graph and Triple types passed across the module boundary.
- [[CAPABILITY-FRAMEWORK]] defines the governance engine that a module's `validate()` invokes.
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

A **sync module** is a content-addressed WebAssembly bundle implementing the `GraphSyncModule` interface ([§5](#5-graphsyncmodule-interface)). Each sync space ([[CONTEXT-SYNC]] §7) specifies the module that handles its gossip:

- All peers in a space MUST run the same module (verified by content hash).
- A peer running a different module is effectively participating in a different space.

The module determines transport, merge strategy, peer discovery, and governance validation (the module's `validate()` calls into the runtime's [[CAPABILITY-FRAMEWORK]] engine).

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

The module runs in a WebAssembly sandbox with capability-scoped permissions ([§7](#7-module-capabilities)). The module has NO access to: DOM, other graphs' data, the filesystem, arbitrary network endpoints (only those granted by capabilities), user data, cookies, local storage, or other sync modules.

### 4.5 Module Availability and Upgrade

The sync space's metadata SHOULD include multiple content-addressable locations for the module. If the primary location is unavailable, the user agent MUST attempt alternates before reporting failure.

When a space's module is updated (new content hash), existing peers MUST be notified by the running module. Peers MUST NOT apply the update until a quorum (>50% of known peers) has acknowledged availability. Peers on different modules MUST NOT exchange diffs during transition.

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
  USVString commit(USVString graphDid, GraphDiff diff);   // returns the diff's revision
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
  // graphs in one space can route to the correct governance engine.
  SyncValidationResult validate(USVString graphDid, GraphDiff diff,
                                USVString author, GraphReader graphState);
};

callback RemoteDiffCallback = SyncValidationResult (USVString graphDid, GraphDiff diff);
callback SignalCallback = undefined (USVString remoteDid, bytes payload);
```

`GraphDiff`, `Peer`, and `SyncValidationResult` are defined in [[CONTEXT-SYNC]] §5.

Modules MAY treat multiple graphs as a single causal stream within one space (Unified topology) but MUST keep per-graph capability checks.

### 5.2 ModuleConfig

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

Crypto and network access are mediated handles, not direct capabilities. The runtime exposes:

- `crypto.sign(data)` / `crypto.verify(signed)` — signing uses the local agent's DID key without exposing key material to the module.
- `network.connect(endpoint)` — opens a WebTransport/WebSocket session to an endpoint **that the module is capability-authorised to reach** ([§7](#7-module-capabilities)).

---

## 6. Module Lifecycle

### 6.1 Installation

1. Fetch the WASM binary from a distribution endpoint.
2. Verify the SHA-256 content hash.
3. Parse the manifest and extract requested capabilities.
4. Display the user consent prompt ([§6.2](#62-user-consent)).
5. On approval, store the module, register it, and (if a graph is waiting) initialise it.

### 6.2 User Consent

Installing a sync module is privileged. The user agent MUST obtain explicit user consent:

1. Display a prompt identifying the content hash, the capabilities requested ([§7](#7-module-capabilities)), the graphs/spaces that will use the module, and the relay endpoints.
2. Require explicit "Allow" or "Deny".
3. The user agent SHOULD remember the decision for subsequent encounters with the same hash.

### 6.3 Update

When a space announces a new module hash, the runtime:

1. Quorums the announcement (>50% of known peers acknowledge).
2. Downloads, verifies, and prompts for consent on the new module.
3. Transitions: old module's `shutdown()`, then new module's `init()` + `connect()`.

### 6.4 Removal

The user MAY remove a module via the management UI. Removal:

1. Disconnects all spaces using the module.
2. Unmounts graphs that depended on the module (preserving the per-graph stores).
3. Removes the module binary and capability grants.

### 6.5 Suspension

The runtime MAY suspend a module under resource pressure. Suspended modules retain state but stop processing diffs until resumed.

### 6.6 Management UI

The user agent SHOULD provide a management interface analogous to "Manage Extensions" — see installed modules, content hashes, statuses, which graphs/spaces use them, and resource consumption. Allow pause, resume, removal.

---

## 7. Module Capabilities

The sandbox grants modules a fixed set of capability handles. Modules may not synthesise new capabilities at runtime.

| Capability | Permits |
|---|---|
| `graph.read` | Read triples from the graphs the module serves |
| `graph.write` | Apply ContextDiffs to the graphs the module serves |
| `crypto.sign` | Sign data with the local agent's DID key (via runtime mediation; no key material exposed) |
| `crypto.verify` | Verify signatures |
| `network.relay.<endpoint>` | Open WebTransport/WebSocket to a specific relay endpoint |
| `network.peer.<protocol>` | Use WebRTC or other peer-to-peer transports |
| `network.fetch.<origin>` | HTTP fetch to a specific origin (typically for module-distribution endpoints) |
| `storage.module.<size>` | Persistent module-private storage up to a size limit |

The module's manifest declares the capabilities it requires. The user consent prompt ([§6.2](#62-user-consent)) lists them.

---

## 8. Security Considerations

### 8.1 Module Sandbox

Sync modules MUST run in the WebAssembly sandbox with only the capabilities they requested and the user granted.

### 8.2 Content-Hash Verification

The user agent MUST verify the SHA-256 content hash of every downloaded module before installation.

### 8.3 Capability Containment

A module's capability handles MUST be unforgeable; the module MUST NOT be able to manufacture references to graphs, endpoints, or storage outside its grant set.

### 8.4 Module Update Quorum

Module updates MUST require quorum (>50% of known peers acknowledge module availability) before transition.

### 8.5 Isolation Between Modules

Different installed modules MUST NOT share state. The runtime MUST NOT expose one module's internal state to another.

### 8.6 Governance Validation

A module's `validate()` is normatively required to invoke the [[CAPABILITY-FRAMEWORK]] engine for every incoming diff. A module that bypasses this MUST be considered non-conformant.

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

### 10.2 Informative References

None.
