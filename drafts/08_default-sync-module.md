# Default Sync Module

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines the **default sync module** that conforming user agents MUST ship for the [[CONTEXT-SYNC]] protocol. The module implements the `GraphSyncModule` interface defined in [[SYNC-MODULE]] using:

- **WebTransport** [[WEBTRANSPORT]] to a configurable relay for transport.
- A **CBOR-encoded wire protocol** with a small frame vocabulary.
- A **dumb-pipe relay protocol** with subscribe/send/deliver semantics, in both open-text and end-to-end-encrypted modes.
- **Relay-mediated peer discovery** with WebRTC NAT traversal (STUN/ICE/TURN) for direct peer-to-peer transports.
- **OR-Set CRDT merge semantics** that preserve eventual consistency under arbitrary peer ordering.
- **Snapshot promotion** at a configured diff-chain length (default 1000).
- A `validate()` implementation that invokes [[CAPABILITY-FRAMEWORK]] and [[CONSTRAINT-VOCABULARY]] for governance enforcement.

The default module is identifiable by a stable content hash. The user agent treats it specially: pre-installed, no installation prompt.

---

## Status of This Document

This is a draft Community Group Report. It has no official W3C standing and is subject to change.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Module Specification](#4-module-specification)
5. [Wire Protocol](#5-wire-protocol)
6. [Relay Protocol](#6-relay-protocol)
7. [Peer Discovery and NAT Traversal](#7-peer-discovery-and-nat-traversal)
8. [Merge Semantics](#8-merge-semantics)
9. [Snapshot Promotion](#9-snapshot-promotion)
10. [validate() Implementation](#10-validate-implementation)
11. [Security Considerations](#11-security-considerations)
12. [Privacy Considerations](#12-privacy-considerations)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 Motivation

[[CONTEXT-SYNC]] defines the abstract protocol; [[SYNC-MODULE]] defines the WebAssembly module interface. For interoperability, every conforming user agent MUST ship a specific default module that any other conforming user agent can recognise and join into a sync space with. This specification defines that module.

### 1.2 Scope

This specification defines, for the default module:

- The module identity (stable content hash) and special handling by the user agent.
- The wire-frame format and message types (DIFF, PULL, SNAPSHOT, SIGNAL, MODULE_UPDATE, PEER_HELLO, PEER_BYE).
- The relay protocol — peer-to-relay framing, authentication, multi-relay gossip.
- Peer discovery and WebRTC NAT traversal.
- The OR-Set CRDT merge algorithm, including causal-dependency handling and concurrent-write tie-breaking.
- The snapshot-promotion contract.
- How `validate()` calls into [[CAPABILITY-FRAMEWORK]].

### 1.3 Relationship to Other Specifications

- [[CONTEXT-SYNC]] is the protocol this module implements.
- [[SYNC-MODULE]] defines the module interface and lifecycle this module conforms to.
- [[CAPABILITY-FRAMEWORK]] is the governance engine that `validate()` invokes.
- [[CONSTRAINT-VOCABULARY]] supplies the constraint kinds that `validate()` invokes.
- [[PERSONAL-LINKED-DATA-GRAPHS]] supplies the `GraphSnapshot` format used by SNAPSHOT messages.
- [[WEBTRANSPORT]] is the underlying transport.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A **conforming user agent** under [[CONTEXT-SYNC]] §2 MUST ship a default sync module implementing this specification. The module:

1. MUST conform to the `GraphSyncModule` interface defined in [[SYNC-MODULE]] §5.
2. MUST implement the wire protocol in [§5](#5-wire-protocol).
3. MUST implement the relay protocol in [§6](#6-relay-protocol).
4. MUST implement OR-Set merge semantics per [§8](#8-merge-semantics).
5. MUST implement snapshot promotion per [§9](#9-snapshot-promotion).
6. MUST invoke [[CAPABILITY-FRAMEWORK]] from `validate()` per [§10](#10-validate-implementation).

A **conforming relay** MUST implement the peer-relay protocol in [§6.1](#61-peerrelay-protocol).

---

## 3. Terminology

<dl>
<dt>Default Module</dt>
<dd>The sync module specified by this document, shipped by every conforming user agent under [[CONTEXT-SYNC]] §2.</dd>

<dt>Wire Frame</dt>
<dd>A CBOR-encoded message exchanged between peers via the relay or directly. See [§5](#5-wire-protocol).</dd>

<dt>Relay</dt>
<dd>A WebTransport server that forwards wire frames between peers in a sync space. Has no authority over context data.</dd>

<dt>Open Space</dt>
<dd>A sync space in which message bodies are in clear text on the relay. The relay can read them but cannot author or reject.</dd>

<dt>Encrypted Space</dt>
<dd>A sync space in which message bodies are end-to-end encrypted between peers; the relay sees only ciphertext and (DID, sessionId) routing metadata.</dd>

<dt>OR-Set</dt>
<dd>An Observed-Remove Set CRDT — the merge primitive used by this module for triples within a context.</dd>

<dt>Promotion</dt>
<dd>The operation by which a context's diff chain is rolled into a single addressable snapshot, after which the prior chain MAY be garbage-collected.</dd>
</dl>

---

## 4. Module Specification

### 4.1 Module Identity

The default module has a stable content hash that uniquely identifies this version of the module:

```
contentHash = sha256-<hex-of-WASM-binary>
```

The user agent ships the WASM binary as a built-in resource, pre-installed at first use of `navigator.graph`. No user consent prompt is required for the default module ([[SYNC-MODULE]] §6.2 requires consent for modules in general; the default is the standing exception).

### 4.2 Capability Manifest

The default module declares the following [[SYNC-MODULE]] §7 capabilities:

| Capability | Used For |
|---|---|
| `graph.read` | Reading per-context triples for `requestSync`, snapshot generation, and `validate()` |
| `graph.write` | Applying received `ContextDiff`s to the per-context store |
| `crypto.sign` | Signing wire frames with the local agent's `did:key` |
| `crypto.verify` | Verifying signatures on inbound frames |
| `network.relay.<endpoint>` | Opening WebTransport sessions to the configured relays |
| `network.peer.webrtc` | WebRTC for direct peer-to-peer transports (with STUN/TURN) |
| `storage.module.<size>` | Per-space session state (pending diffs, peer lists, dedup caches) |

### 4.3 Module Behaviour Summary

| Surface | Behaviour |
|---|---|
| **Transport** | WebTransport [[WEBTRANSPORT]] to a configurable relay; direct WebRTC where available. |
| **Merge** | OR-Set CRDT ([§8](#8-merge-semantics)). |
| **Peer discovery** | Relay-mediated ([§7.1](#71-relaymediated-discovery)). |
| **Snapshot promotion** | Every `N` diffs per context (default 1000, configurable) ([§9](#9-snapshot-promotion)). |
| **Validation** | Calls the runtime's [[CAPABILITY-FRAMEWORK]] engine ([§10](#10-validate-implementation)). |

---

## 5. Wire Protocol

### 5.1 Message Frame

All messages are CBOR-encoded with a common envelope:

```
{
  "type": "DIFF" | "PULL" | "SNAPSHOT" | "SIGNAL" | "MODULE_UPDATE" | "PEER_HELLO" | "PEER_BYE",
  "spaceUri": "space://...",
  "from": { "did": "did:key:...", "sessionId": "..." },
  "to":   { "did": "did:key:...", "sessionId": "..." } | null,    // null = broadcast within space
  "payload": <type-specific>
}
```

### 5.2 DIFF

`payload` is a CBOR-encoded `ContextDiff` ([[CONTEXT-SYNC]] §5.1).

### 5.3 PULL

```
{ "graphDid": "did:graph:...", "fromRevision": "..." | null }
```

The recipient responds with a `SNAPSHOT` (if `fromRevision` is `null` or unknown) or a sequence of `DIFF` messages.

### 5.4 SNAPSHOT

```
{ "graphDid": "did:graph:...", "snapshot": <GraphSnapshot CBOR> }
```

The `snapshot` is the context snapshot as defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.

### 5.5 SIGNAL

`payload` is opaque bytes for application use (forwarded to the runtime's `onsignal` event per [[CONTEXT-SYNC]] §11).

### 5.6 MODULE_UPDATE

```
{ "newHash": "sha256-...", "spaceUri": "space://...", "distributionUrls": [...] }
```

Triggers the module-update flow in [[SYNC-MODULE]] §6.3.

### 5.7 PEER_HELLO / PEER_BYE

```
{ "peer": Peer }
```

Announces presence/departure in the space.

---

## 6. Relay Protocol

A relay is a WebTransport server that forwards messages between peers in a space. The relay maintains per-space membership lists, forwards messages to subscribed peers, and has NO authority over context data — it cannot inspect encrypted message bodies, cannot reject or modify diffs.

### 6.1 Peer–Relay Protocol

Peers establish a WebTransport session to the relay. After session establishment:

```
peer → relay: SUBSCRIBE { spaceUri }
peer → relay: SEND { spaceUri, frame }
relay → peer: DELIVER { spaceUri, frame }
peer → relay: UNSUBSCRIBE { spaceUri }
```

The relay enforces:

- **Authentication.** Each peer presents a signed `did:key` proof of identity on session establishment.
- **Rate limiting** per peer.
- **Maximum message size.**

The relay does NOT enforce governance — that is the receiving peer's job ([[CAPABILITY-FRAMEWORK]] and [§10](#10-validate-implementation)).

### 6.2 Open vs Encrypted Spaces

The default module supports two relay modes:

- **Open space**: Messages are in clear text on the relay (the relay can read them, but cannot author or reject).
- **Encrypted space**: Messages are end-to-end encrypted between peers; the relay sees only ciphertext and the (DID, sessionId) routing metadata.

Encrypted spaces require a key-distribution mechanism among space members. The default module implements a TreeKEM-style group key (the specific KEM ceremony is out of scope here; implementations MAY substitute alternative mechanisms provided they produce compatible per-space group keys).

### 6.3 Multiple Relays

A space MAY list multiple relays. Peers connect to one and the relay network gossips messages between relays. Peers MAY connect to multiple relays for redundancy.

---

## 7. Peer Discovery and NAT Traversal

### 7.1 Relay-Mediated Discovery

The default module discovers peers via the relay:

- On `SUBSCRIBE`, the relay returns the current member list.
- Subsequent `PEER_HELLO` / `PEER_BYE` messages keep peers' views current.

### 7.2 NAT Traversal

For peer-to-peer transports (WebRTC, QUIC), the default module uses standard NAT traversal:

- **STUN**: For symmetric NAT detection.
- **ICE**: For candidate gathering.
- **TURN**: For relay fallback when peer-to-peer fails.

The signalling channel for ICE candidate exchange is the relay (via SIGNAL messages, [§5.5](#55-signal)).

### 7.3 Custom Discovery

Other (non-default) modules MAY implement DHT-based, mDNS-based, or other discovery. Their capability grants (`network.peer.*`) gate which mechanisms they may use. See [[SYNC-MODULE]] §7.

---

## 8. Merge Semantics

### 8.1 OR-Set CRDT

The default module uses an Observed-Remove Set (OR-Set) CRDT for triples within a context.

- **Add**: A triple add carries a unique add-tag (the diff's revision).
- **Remove**: A triple remove carries the set of add-tags being removed.
- **Merge**: A triple is in the set iff at least one add-tag exists that has not yet been removed.

This is commutative, associative, and idempotent — diffs can be applied in any order and produce convergent state.

### 8.2 Causal Dependencies

Each diff lists its `dependencies` — prior revisions in the same context's chain that this diff was authored on top of. Peers MUST apply dependencies before the diff itself. If a dependency is missing, request it via `PULL` ([§5.3](#53-pull)).

### 8.3 Reifier Convergence

Reifiers (the triples carrying provenance for data triples) follow the same OR-Set semantics. A reifier and its data triple are added together in a single `ContextDiff`; the runtime treats them atomically.

### 8.4 Concurrent State Transitions

Two agents firing the same flow transition concurrently produce two `flow://state` add-triples. The runtime detects this (same instance, same from-state, different reifier hashes) and applies a deterministic tie-break: lexicographically smaller reifier hash wins; the losing diff's actions are rolled back at evaluation time.

---

## 9. Snapshot Promotion

This section is normative.

### 9.1 Why Promote

Diff chains grow unboundedly. New peers subscribing would have to download all history. To bound this, the module promotes diff chains to snapshots at thresholds.

### 9.2 Threshold

The default module promotes when a context's diff chain since the last snapshot reaches a configured length (default: 1000 diffs).

The threshold MUST be documented by the module — receiving peers need to know how far back they MAY need to request snapshots.

### 9.3 Promotion Algorithm

1. The committing module decides to promote (typically the agent who authored the threshold-crossing diff).
2. The module calls `getAsSnapshot()` on the context ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.2) requesting `signBy: "both"`.
3. The module commits a special `SNAPSHOT` diff into the space carrying the snapshot. The diff's `dependencies` includes all previously-unsnapshotted diffs.
4. Receiving peers apply the snapshot, mark the prior chain as superseded, and discard older diffs from local cache after a grace period.

### 9.4 Snapshot Pulls

A new peer arriving with no prior state requests the latest snapshot:

```
peer → space: PULL { graphDid, fromRevision: null }
respondent → peer: SNAPSHOT { graphDid, snapshot }
respondent → peer: DIFF, DIFF, ... (diffs after the snapshot)
```

The respondent is any peer with the snapshot locally — typically the agent who committed the snapshot, but any subscribed peer suffices.

### 9.5 Snapshot Signature

The snapshot's signature(s) are produced via [[PERSONAL-LINKED-DATA-GRAPHS]] §5.2:

- The snapshotter signs ("agent X observed graph G at hash H at time T").
- A graph-DID `assertionMethod` delegate signs ("graph G asserts H at T"), if available.

Receiving peers verify both signatures. Snapshots without at least one valid signature MUST be rejected.

---

## 10. validate() Implementation

### 10.1 Behaviour

The default module's `validate(graphDid, diff, author, graphState)` implements the contract in [[CONTEXT-SYNC]] §9.2 by invoking the [[CAPABILITY-FRAMEWORK]] engine through the runtime:

1. Resolve the `graphDid`'s governance engine via the `graphState` `GraphReader` handle.
2. For each triple in `diff.additions` and `diff.removals`:
   1. Construct a `TripleInput` carrying the triple, the `author`, the diff's `timestamp`, and the resolved capability chain from `diff.capabilityProof`.
   2. Call the engine's `validate(triple, ctx)`.
   3. If the result is `{ allowed: false, ... }`, return `{ accepted: false, module: <result.module>, constraintId: <result.rejectedBy>, reason: <result.reason> }`.
3. Otherwise, return `{ accepted: true }`.

The engine internally applies the capability-chain verification ([[CAPABILITY-FRAMEWORK]] §7), caveat evaluation ([[CAPABILITY-FRAMEWORK]] §9), and all registered constraint-kind plug-ins ([[CONSTRAINT-VOCABULARY]]).

### 10.2 Enforcement Mode

The module MUST read the context's current `governance://enforcement_mode` via `graphState` before each validation pass and route accordingly per [[CONTEXT-SYNC]] §9.4.

### 10.3 Rejection Handling

Per [[CONTEXT-SYNC]] §9.3, rejected diffs MUST NOT be stored or forwarded.

---

## 11. Security Considerations

### 11.1 Relay Trust Model

Relays are message brokers, not authorities. They cannot author diffs, cannot reject diffs, cannot read message content (in encrypted spaces). They can observe (DID, sessionId) routing metadata, and they can rate-limit and refuse service.

### 11.2 Group Key Distribution (Encrypted Spaces)

The TreeKEM-style group key for encrypted spaces is sensitive material. Implementations MUST rotate the group key on member removal and SHOULD rotate on regular intervals.

### 11.3 Snapshot Trust

Snapshots arriving from the network MUST be signed ([§9.5](#95-snapshot-signature)). Receiving peers MUST verify both the snapshot's signatures and that the recomputed content hash matches the embedded hash before mounting.

### 11.4 Replay Attacks

`ContextDiff.revision` is content-addressed, so replaying a previously-applied diff is a no-op (already in the OR-Set per [§8.1](#81-or-set-crdt)).

### 11.5 Wire-Frame Forgery

All wire frames except SIGNAL carry author DIDs. Receiving peers MUST validate that the frame is consistent with the asserted author — for DIFF frames via the embedded reifier signatures, for PEER_HELLO/PEER_BYE via the session-level authentication ([§6.1](#61-peerrelay-protocol)).

---

## 12. Privacy Considerations

### 12.1 Routing-Metadata Disclosure

In encrypted spaces, the relay learns (DID, sessionId) tuples for routing. Encrypted spaces do NOT hide *who* is participating, only *what* they exchange.

### 12.2 Peer-List Disclosure

The `PEER_HELLO`/`PEER_BYE` exchanges reveal who is online in the space to every other space member. Communities that need stronger membership privacy SHOULD use [[CONTEXT-SYNC]]'s Fully Partitioned topology.

### 12.3 STUN/TURN Server Disclosure

WebRTC NAT traversal contacts STUN/TURN servers. The operators of those servers can observe connection metadata for participating peers.

### 12.4 Snapshot-Promotion Disclosure

Snapshot promotion announces "agent X took a snapshot of context G at time T". This is signed and intentionally publicly verifiable; it is not a privacy leak under the design but is worth noting for use cases where snapshot authorship should be limited.

---

## 13. References

### 13.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[WEBTRANSPORT]** "WebTransport", W3C Working Draft. https://www.w3.org/TR/webtransport/
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./03_graph-capability-framework.md).
- **[CONTEXT-SYNC]** [Context Synchronisation Protocol](./04_context-sync-protocol.md).
- **[SYNC-MODULE]** [Sync Module Architecture](./05_sync-module-architecture.md).
- **[CONSTRAINT-VOCABULARY]** [Governance Constraint Vocabulary](./07_governance-constraint-vocabulary.md).

### 13.2 Informative References

- **[GRAPH-FLOWS]** [Graph Flows](./09_graph-flows.md).
