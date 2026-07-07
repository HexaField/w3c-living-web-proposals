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
   - 6.1 [Peer–Relay Protocol](#61-peerrelay-protocol)
   - 6.2 [Open vs Encrypted Spaces](#62-open-vs-encrypted-spaces)
   - 6.3 [Group Key Management for Encrypted Spaces (MLS)](#63-group-key-management-for-encrypted-spaces-mls)
     - 6.3.1 [Overview and Design Goals](#631-overview-and-design-goals)
     - 6.3.2 [Cipher Suite](#632-cipher-suite)
     - 6.3.3 [Deriving the HPKE Identity Key from the did:key](#633-deriving-the-hpke-identity-key-from-the-didkey)
     - 6.3.4 [Leaf Credentials and DID Binding](#634-leaf-credentials-and-did-binding)
     - 6.3.5 [KeyPackages](#635-keypackages)
     - 6.3.6 [Group Creation](#636-group-creation)
     - 6.3.7 [Adding a Member](#637-adding-a-member)
     - 6.3.8 [Removing a Member](#638-removing-a-member)
     - 6.3.9 [Epoch Key Schedule and Wire-Frame Key Derivation](#639-epoch-key-schedule-and-wire-frame-key-derivation)
     - 6.3.10 [Message Encryption](#6310-message-encryption)
     - 6.3.11 [Relay Objects and Trust Boundary](#6311-relay-objects-and-trust-boundary)
     - 6.3.12 [Rotation Policy](#6312-rotation-policy)
     - 6.3.13 [Interoperability and Conformance](#6313-interoperability-and-conformance)
   - 6.4 [Multiple Relays](#64-multiple-relays)
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
<dd>A WebTransport server that forwards wire frames between peers in a sync space. Has no authority over graph data.</dd>

<dt>Open Space</dt>
<dd>A sync space in which message bodies are in clear text on the relay. The relay can read them but cannot author or reject.</dd>

<dt>Encrypted Space</dt>
<dd>A sync space in which message bodies are end-to-end encrypted between peers; the relay sees only ciphertext and (DID, sessionId) routing metadata.</dd>

<dt>OR-Set</dt>
<dd>An Observed-Remove Set CRDT — the merge primitive used by this module for triples within a graph.</dd>

<dt>Promotion</dt>
<dd>The operation by which a graph's diff chain is rolled into a single addressable snapshot, after which the prior chain MAY be garbage-collected.</dd>
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
| `graph.read` | Reading per-graph triples for `requestSync`, snapshot generation, and `validate()` |
| `graph.write` | Applying received `GraphDiff`s to the per-graph store |
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
| **Snapshot promotion** | Every `N` diffs per graph (default 1000, configurable) ([§9](#9-snapshot-promotion)). |
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

`payload` is a CBOR-encoded `GraphDiff` ([[CONTEXT-SYNC]] §5.1).

### 5.3 PULL

```
{
  "graphDid":       "<group-did>",
  "fromRevision":   "..." | null,
  "authorDid":      "<did:key:...>",          // requesting agent's DID
  "capabilityProof": <CapabilityProof CBOR>   // OPTIONAL; see below
}
```

`authorDid` identifies the requesting agent. Each peer that receives a PULL MUST authorise it via the `validateReadAccess` operation defined in [[CONTEXT-SYNC]] §9.2.2, passing `action = "mountContext"`:

- If the target graph carries no capability constraint covering `mountContext`, the request is accepted unconditionally and `capabilityProof` MAY be omitted.
- Otherwise the recipient MUST require a valid `capabilityProof` for `mountContext`; if absent or invalid, the recipient MUST NOT respond with a SNAPSHOT or any DIFFs for this graph to this requester. It MAY respond with a PULL_DENIED message (§5.4.1) for diagnostics.

On success the recipient responds with a `SNAPSHOT` (if `fromRevision` is `null` or unknown) or a sequence of `DIFF` messages.

### 5.4 SNAPSHOT

```
{ "graphDid": "<group-did>", "snapshot": <GraphSnapshot CBOR> }
```

The `snapshot` is the graph snapshot as defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §5.

#### 5.4.1 PULL_DENIED

```
{
  "graphDid":       "<group-did>",
  "reason":         "mountContext_required" | "mountContext_invalid"
                  | "credential_required"   | "rate_limited"  | <impl-defined>,
  "constraintId":   "<urn:c:...>"           // OPTIONAL; the constraint that rejected
}
```

A peer MAY send `PULL_DENIED` after rejecting a `PULL` to inform the requester why. This is best-effort diagnostics; recipients of `PULL_DENIED` MUST NOT treat it as an authoritative statement about the graph's policy (other peers may have different local state) and MUST NOT loop trying alternative proofs without user gesture.

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

A relay is a WebTransport server that forwards messages between peers in a space. The relay maintains per-space membership lists, forwards messages to subscribed peers, and has NO authority over graph data — it cannot inspect encrypted message bodies, cannot reject or modify diffs.

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

A space's mode is fixed at publication and carried in the `PublishedGraph` alongside `spaceUri`. A conforming module MUST refuse to send cleartext wire-frame bodies into a space published as encrypted, and MUST refuse to join an encrypted space for which it cannot establish the group secret ([§6.3](#63-group-key-management-for-encrypted-spaces-mls)).

Encrypted spaces require a group-key-agreement mechanism among space members. The default module uses the Messaging Layer Security (MLS) protocol [[RFC9420]], profiled as specified in [§6.3](#63-group-key-management-for-encrypted-spaces-mls). This section is **normative and complete**: an independent implementation of [§6.3](#63-group-key-management-for-encrypted-spaces-mls) interoperates with any other conforming implementation over the same relay. There is no "implementation-defined" latitude for the ceremony; every choice MLS leaves open is pinned below.

### 6.3 Group Key Management for Encrypted Spaces (MLS)

This section is normative. It defines the complete group-key-agreement ceremony for encrypted spaces. Conforming modules that participate in an encrypted space MUST implement it exactly as specified. Where a step is fully defined by [[RFC9420]], this section cites the exact clause and states the profile choice; it does not restate the MLS algorithm.

#### 6.3.1 Overview and Design Goals

Each encrypted space is backed by exactly one MLS group. The MLS group provides a continuously-updated shared secret (the *epoch secret*) known only to current members. From that secret the module derives the symmetric key that encrypts wire-frame bodies ([§5.1](#51-message-frame)). The security rationale for the ceremony below follows the MLS architecture [[RFC9750]]. MLS gives the module, without further design:

- **Confidentiality** — only current members hold the epoch secret.
- **Forward secrecy** — a member removed at epoch *n* cannot derive the epoch secret for any epoch > *n* ([§6.3.8](#638-removing-a-member)), because the removing Commit injects fresh key material the removed member never sees.
- **Post-compromise security** — a member whose leaf key is later rotated (via an Update proposal or a Commit that replaces its leaf) heals the group forward from a key compromise, per [[RFC9420]] §2.2.
- **Authenticated membership** — every leaf carries a credential bound to a `did:key` ([§6.3.4](#634-leaf-credentials-and-did-binding)), so group membership is cryptographically tied to DID identity.

The relay is a dumb store-and-forward broker for MLS objects and ciphertext ([§6.3.11](#6311-relay-objects-and-trust-boundary)). It never holds a private key, an epoch secret, or any plaintext.

The MLS group identifier (`GroupContext.group_id`, [[RFC9420]] §8.1) MUST equal the 32-byte SHA-256 digest whose lowercase hex form is the authority component of the space's `space://<sha256-hex>` URI ([[CONTEXT-SYNC]] §7.3). This binds the group one-to-one to the sync space with no additional negotiation: any agent that knows the `spaceUri` knows the `group_id`.

#### 6.3.2 Cipher Suite

The default module MUST use exactly one MLS cipher suite for encrypted spaces:

```
MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519   (value 0x0001, [[RFC9420]] §17.1)
```

This pins every primitive:

| Role | Primitive | Reference |
|---|---|---|
| HPKE KEM | DHKEM(X25519, HKDF-SHA256) (`0x0020`) | [[RFC9180]] §7.1 |
| HPKE KDF | HKDF-SHA256 (`0x0001`) | [[RFC9180]] §7.2 |
| HPKE AEAD (MLS objects) | AES-128-GCM (`0x0001`) | [[RFC9180]] §7.3 |
| MLS hash / KDF | SHA-256 / HKDF-SHA256 | [[RFC9420]] §5.2 |
| MLS signature | Ed25519 | [[RFC8032]] |
| Wire-frame AEAD ([§6.3.10](#6310-message-encryption)) | AES-128-GCM | [[RFC9420]] §5.3, NIST SP 800-38D |

Ed25519 is chosen so the MLS signature key is the agent's existing `did:key` signing key ([[DECENTRALISED-IDENTITY]] §3.3) with no new key type. X25519 is chosen so the HPKE key can be derived from that same Ed25519 key ([§6.3.3](#633-deriving-the-hpke-identity-key-from-the-didkey)).

A module receiving an MLS object whose cipher suite is not `0x0001` MUST reject it. Negotiation of alternative suites is out of scope for the default module; a non-default module ([[SYNC-MODULE]] §7) MAY define others, but it is then a different module with a different content hash and does not interoperate with the default module in the same space.

#### 6.3.3 Deriving the HPKE Identity Key from the did:key

An agent's `did:key` encodes an Ed25519 public key ([[DECENTRALISED-IDENTITY]] §4.1, multicodec `0xed01`). The cipher suite's KEM needs an X25519 key. The module MUST derive the X25519 keypair deterministically from the Ed25519 keypair so no second published key is required:

1. Let `(ed_sk, ed_pk)` be the agent's Ed25519 private/public key.
2. **X25519 private scalar.** Compute `h = SHA-512(ed_sk)`; take the low 32 bytes `h[0..32)`; clamp per [[RFC7748]] §5 (clear bits 0,1,2 of `h[0]`; clear bit 7 and set bit 6 of `h[31]`). The result is the X25519 private scalar `x_sk`. This is the standard Ed25519→X25519 private-key conversion.
3. **X25519 public key.** Compute `x_pk = X25519(x_sk, 9)` (scalar multiplication of the clamped scalar by the Curve25519 base point `u = 9`), per [[RFC7748]] §6.1. Implementations MAY instead convert `ed_pk` directly via the Edwards-to-Montgomery map `u = (1 + y) / (1 − y) mod p` ([[RFC7748]] §4.1); both yield the identical `x_pk`.

`x_pk` is the HPKE public key placed in the leaf's `encryption_key` and in KeyPackages ([§6.3.5](#635-keypackages)). Because the derivation is deterministic and standard, any member can independently check that a leaf's `encryption_key` matches the `did:key` in that leaf's credential ([§6.3.4](#634-leaf-credentials-and-did-binding), check 4) — a leaf whose `encryption_key` is not the correct derived `x_pk` for its credential DID MUST be rejected.

> NOTE: This reuse of one keypair for signing (Ed25519) and key agreement (X25519) is the same construction used by the `did:key` X25519 key-agreement derivation and is safe here because the two algorithms operate in disjoint domains (EdDSA over the twisted Edwards curve vs. X25519 over the birationally-equivalent Montgomery curve). The signature key material is the MLS *signature_key*; the derived X25519 key is the MLS *encryption_key*. They are never used interchangeably.

#### 6.3.4 Leaf Credentials and DID Binding

Every MLS leaf node ([[RFC9420]] §7.2) MUST carry a credential of type `basic` (`BasicCredential`, [[RFC9420]] §5.3.1) whose `identity` field is the UTF-8 bytes of the agent's `did:key` URI (e.g. `did:key:z6Mk…`).

Binding rules — a module processing any leaf (in a KeyPackage, a Welcome, a Commit's `path`, or an Add) MUST verify all of:

1. The credential is a `BasicCredential`; its `identity` is a syntactically valid `did:key` URI ([[DID-KEY]]).
2. The leaf's `signature_key` (the MLS Ed25519 signature public key) equals the Ed25519 public key that the `did:key` decodes to ([[DECENTRALISED-IDENTITY]] §4.1: strip the `0xed01` multicodec prefix from the base58btc-decoded key material). This ties the MLS signing identity to the DID with no separate certificate.
3. The `LeafNodeTBS` signature ([[RFC9420]] §7.2) verifies under that `signature_key`.
4. The leaf's `encryption_key` equals the X25519 key derived from the same `did:key` per [§6.3.3](#633-deriving-the-hpke-identity-key-from-the-didkey).

A leaf failing any check MUST be rejected: the module MUST NOT process a Welcome, apply a Commit, or accept an Add that introduces such a leaf. Because check 2 makes the MLS signature key identical to the DID key, an authenticated MLS message from a leaf is, transitively, an authenticated statement by that DID — no additional application-layer signature over MLS traffic is required for authorship of encrypted wire frames.

`capabilities` ([[RFC9420]] §7.2) MUST advertise support for cipher suite `0x0001`, protocol version `mls10` (`0x0001`), the `basic` credential type, and no non-default extensions beyond those named in [§6.3.5](#635-keypackages). `leaf_node_source` is `key_package` in a KeyPackage, `commit` when installed by a Commit path, and `update` when installed by an Update proposal, exactly as [[RFC9420]] §7.2 requires.

#### 6.3.5 KeyPackages

To be addable to a group, an agent MUST publish at least one MLS `KeyPackage` ([[RFC9420]] §10) to the relay.

**Format.** A KeyPackage for the default module MUST:

- use `version = mls10` (`0x0001`) and `cipher_suite = 0x0001`;
- carry a `LeafNode` with `leaf_node_source = key_package` satisfying [§6.3.4](#634-leaf-credentials-and-did-binding);
- include the `lifetime` extension ([[RFC9420]] §7.2, §10) in the LeafNode with `not_before` = issuance time and `not_after` = `not_before + 604800` seconds (7 days) by default. A module MUST reject a KeyPackage whose `lifetime` is not currently valid (now < `not_before` or now ≥ `not_after`).
- set `init_key` to a freshly generated X25519 public key used solely for the Welcome that adds this KeyPackage (the HPKE `init_key`, [[RFC9420]] §10). The corresponding init private key is retained by the publisher until the KeyPackage is consumed or expires, then destroyed.
- carry no extensions other than `lifetime` (REQUIRED) and, OPTIONALLY, `application_id`; unknown extensions MUST be absent.
- be signed with the agent's Ed25519 `did:key` private key (the `KeyPackageTBS` signature, [[RFC9420]] §10).

**Publication location.** KeyPackages are relay objects keyed by DID:

```
peer  → relay: PUBLISH_KEYPACKAGE { spaceUri, did, keyPackageRef, keyPackage }
peer  → relay: CLAIM_KEYPACKAGE   { spaceUri, did }          // adder fetches one
relay → peer:  KEYPACKAGE         { spaceUri, did, keyPackage } | KEYPACKAGE_NONE
```

- `keyPackageRef` is the `KeyPackageRef` ([[RFC9420]] §5.2: `RefHash("MLS 1.0 KeyPackage Reference", KeyPackage)`), used for deduplication and for the `removed`/`add` bookkeeping.
- The relay stores a set of currently-valid KeyPackages per `(spaceUri, did)`. A KeyPackage is **single-use**: on `CLAIM_KEYPACKAGE`, the relay returns one KeyPackage and MUST delete it (last-resort behaviour below). This preserves the MLS guarantee that an `init_key` is used at most once.
- **Last-resort KeyPackage.** To avoid a member being un-addable when its single-use packages are exhausted, an agent MAY additionally publish one KeyPackage carrying the `last_resort` marker (advertised via the `application_id` extension value `"last-resort"` for the default module). The relay MUST NOT delete a last-resort KeyPackage on claim; it returns it only when no single-use KeyPackage remains. Reuse of a last-resort `init_key` weakens forward secrecy for the single Welcome that consumes it and MUST be minimised by prompt replenishment.

**Lifetime and rotation.** Each agent MUST keep at least one currently-valid KeyPackage published per encrypted space it wishes to be reachable in. A module SHOULD replenish so that at least `4` unexpired single-use KeyPackages are available at all times, and MUST publish fresh KeyPackages before existing ones expire (default validity 7 days ⇒ republish at latest every 6 days). Private keys for expired or consumed KeyPackages MUST be destroyed.

#### 6.3.6 Group Creation

The founding member (the first agent to join the encrypted space — normally the space publisher) initialises the MLS group:

1. Generate (or load) the agent's Ed25519 `did:key` and derive its X25519 key ([§6.3.3](#633-deriving-the-hpke-identity-key-from-the-didkey)).
2. Construct the founder's own LeafNode with `leaf_node_source = key_package` satisfying [§6.3.4](#634-leaf-credentials-and-did-binding).
3. Initialise the group at epoch 0 per [[RFC9420]] §11 with:
   - `group_id` = the 32-byte SHA-256 space digest ([§6.3.1](#631-overview-and-design-goals)) — **not** a random value; MLS's usual "fresh random group_id" guidance is overridden here so the group is addressable from the `spaceUri`.
   - `cipher_suite` = `0x0001`.
   - `version` = `mls10`.
   - `extensions` = the `required_capabilities` group-context extension ([[RFC9420]] §11.1) requiring cipher suite `0x0001`, credential type `basic`, and protocol version `mls10`; plus a `ratchet_tree` group-info extension when publishing GroupInfo ([§6.3.7](#637-adding-a-member)). No `external_pub` extension is published unless external commits are enabled (they are not, by default; see below).
   - The founding `tree` is a single leaf (the founder). The epoch-0 `confirmed_transcript_hash` and `interim_transcript_hash` are computed per [[RFC9420]] §8.2 from the empty initial state.
4. Derive the epoch-0 key schedule ([[RFC9420]] §8) from the initial `init_secret` (a fresh random 32 bytes, since there is no prior epoch) and an all-zero `commit_secret`/`psk_secret`. The founder now holds `epoch_secret` for epoch 0, from which wire-frame keys are derived ([§6.3.9](#639-epoch-key-schedule-and-wire-frame-key-derivation)).

A single-member group is valid: the founder can begin writing encrypted frames immediately (though it is talking only to itself until a second member is added). External commits and external initialisation ([[RFC9420]] §12.4.3.2) are **disabled** in the default profile — every member joins via a Welcome ([§6.3.7](#637-adding-a-member)). A module MUST NOT publish an `external_pub` extension and MUST reject an incoming external Commit.

#### 6.3.7 Adding a Member

To add agent *B* (identified by `did_B`), an existing member *A* performs the MLS Add + Commit flow ([[RFC9420]] §12.1.1, §12.4):

1. *A* obtains *B*'s KeyPackage via `CLAIM_KEYPACKAGE { spaceUri, did: did_B }` ([§6.3.5](#635-keypackages)) and verifies it (KeyPackage signature, lifetime, and the leaf checks of [§6.3.4](#634-leaf-credentials-and-did-binding)). If the relay returns `KEYPACKAGE_NONE`, *B* cannot be added until it publishes one; *A* MAY notify *B* out of band via a SIGNAL ([§5.5](#55-signal)).
2. *A* constructs an `Add` proposal referencing *B*'s KeyPackage ([[RFC9420]] §12.1.1).
3. *A* constructs a `Commit` covering that Add ([[RFC9420]] §12.4). Because the Add changes membership, *A*'s Commit MUST include a fresh `UpdatePath` (populate the direct path with new node secrets, [[RFC9420]] §12.4.1) so the new epoch secret is not derivable by anyone outside the new member set. The Commit advances the group from epoch *n* to *n+1*.
4. *A* produces:
   - a `Welcome` message ([[RFC9420]] §12.4.3.1) encrypted to *B*'s KeyPackage `init_key` via HPKE, carrying the `GroupInfo` (including the `ratchet_tree` extension so *B* can build the tree) and the `path_secret` *B* needs;
   - the `Commit` itself, as an MLSMessage, for delivery to the existing members.
5. *A* sends both to the relay:

```
peer  → relay: SEND_COMMIT  { spaceUri, epoch: n, commit }          // fan-out to members
peer  → relay: SEND_WELCOME { spaceUri, toDid: did_B, welcome }     // stored for B
```

6. Existing members receive the `Commit` via `DELIVER`, verify it (transcript hash, sender leaf signature per [§6.3.4](#634-leaf-credentials-and-did-binding)), and merge it, advancing to epoch *n+1* and deriving the new `epoch_secret` per [[RFC9420]] §8, §12.4.2.
7. *B* joins:
   - fetches its Welcome via `CLAIM_WELCOME { spaceUri, did: did_B }`;
   - decrypts it with the init private key it retained for the claimed KeyPackage ([§6.3.5](#635-keypackages));
   - processes the `GroupInfo` and `ratchet_tree` to reconstruct group state at epoch *n+1*, verifying **every** leaf credential in the tree against its DID ([§6.3.4](#634-leaf-credentials-and-did-binding)) and checking the `GroupInfo` signature and `confirmation_tag` per [[RFC9420]] §12.4.3.1;
   - MUST verify that the reconstructed `group_id` equals the SHA-256 digest of its own `spaceUri` ([§6.3.1](#631-overview-and-design-goals)); a mismatch means the Welcome is for a different space and MUST be rejected;
   - derives `epoch_secret` for epoch *n+1*, and thereafter the wire-frame keys ([§6.3.9](#639-epoch-key-schedule-and-wire-frame-key-derivation)).

After step 7, *B* destroys the consumed KeyPackage's init private key and SHOULD publish a replacement KeyPackage ([§6.3.5](#635-keypackages)). *B* MAY issue a catch-up `PULL` ([§5.3](#53-pull)) to obtain graph history now that it can decrypt space traffic.

Only current members may add members: a module MUST reject a Commit whose sender leaf is not a current member of the ratchet tree. Read-side governance for the *graph* still applies independently ([§10.2](#102-behaviour-validatereadaccess)) — MLS membership grants the ability to decrypt space traffic; it does not by itself grant a capability the graph's governance requires.

#### 6.3.8 Removing a Member

To remove agent *R*, an existing member *A* performs the Remove + Commit flow ([[RFC9420]] §12.1.3, §12.4), which MANDATORILY rotates the group key:

1. *A* constructs a `Remove` proposal naming *R*'s leaf index ([[RFC9420]] §12.1.3).
2. *A* constructs a `Commit` covering that Remove. The Commit MUST include a fresh `UpdatePath` populating the sender's direct path with new secrets ([[RFC9420]] §12.4.1). This is what enforces forward secrecy: the new epoch's secrets derive from key material sealed only to the leaves that remain, so *R* — whose leaf is blanked by the Remove — cannot compute the epoch *n+1* `epoch_secret` even though it observed the ciphertext of the Commit. The Commit advances epoch *n* → *n+1*.
3. *A* sends the Commit:

```
peer → relay: SEND_COMMIT { spaceUri, epoch: n, commit }
```

There is **no** Welcome (nobody is joining).
4. Remaining members verify and merge the Commit, advancing to epoch *n+1* and deriving the new `epoch_secret`. All wire-frame keys are re-derived from the new epoch ([§6.3.9](#639-epoch-key-schedule-and-wire-frame-key-derivation)); frames encrypted under epoch *n+1* are undecryptable by *R*.
5. Frames still in flight that were encrypted under epoch ≤ *n* remain readable by *R* if it captured them — MLS provides forward secrecy for **future** epochs, not retroactive secrecy for messages *R* legitimately held keys for. Implementations needing to limit exposure of in-flight epoch-*n* traffic SHOULD keep epoch lifetimes short ([§6.3.12](#6312-rotation-policy)).

Key rotation on removal is **MUST**, and is automatic: it is a property of the Remove-carrying Commit's mandatory `UpdatePath`, not a separate step a module could skip. A module MUST NOT implement removal by any mechanism that leaves the epoch secret unchanged.

If the removed member *R* was the relay-side "committer of record" for KeyPackage bookkeeping, no special action is needed: the relay holds no group secret and KeyPackage storage is per-DID and independent of group membership.

#### 6.3.9 Epoch Key Schedule and Wire-Frame Key Derivation

At each epoch the module holds the MLS `epoch_secret` ([[RFC9420]] §8). The default module derives its wire-frame encryption material from the MLS *exporter*, **not** by reusing MLS application-message keys, so that wire-frame encryption is cleanly layered on top of MLS and does not consume MLS's own `MLSCiphertext` key schedule.

For the current epoch, define the 32-byte **space traffic secret**:

```
space_traffic_secret =
    MLS-Exporter("lw-sync space frame", spaceUri_bytes, 32)
```

where `MLS-Exporter(label, context, length)` is the exporter of [[RFC9420]] §8.5 (`MLS-Exporter(Label, Context, Length) = ExpandWithLabel(exporter_secret, Label, Hash(Context), Length)`), `exporter_secret` is the current epoch's exporter secret, and `spaceUri_bytes` is the UTF-8 encoding of the full `space://…` URI. The exporter is epoch-specific, so `space_traffic_secret` changes on every epoch advance automatically.

From `space_traffic_secret`, derive the AEAD key and base nonce using HKDF-SHA256 [[RFC5869]] with MLS's labelled expansion ([[RFC9420]] §5.2 `ExpandWithLabel`):

```
frame_key   = ExpandWithLabel(space_traffic_secret, "key",   "", 16)   // AES-128 key
frame_nonce = ExpandWithLabel(space_traffic_secret, "nonce", "", 12)   // 96-bit base nonce
```

`frame_key`/`frame_nonce` are held only in memory, are re-derived on each epoch change, and MUST be zeroised when the epoch is superseded.

Senders maintain a per-epoch monotonic 96-bit frame counter `seq`, starting at 0 for each new epoch and never repeating within an epoch. (An epoch's key is abandoned long before `seq` could wrap; a module MUST force an epoch advance — an Update Commit — before `seq` would exceed 2⁴⁸ within one epoch.)

#### 6.3.10 Message Encryption

A wire frame ([§5.1](#51-message-frame)) in an encrypted space is transmitted as an **encrypted envelope**. The `type`, `spaceUri`, `from`, and `to` routing fields remain in cleartext CBOR (the relay needs them to route; they are the "(DID, sessionId) routing metadata" of [§6.2](#62-open-vs-encrypted-spaces)). The `payload` — the DIFF / SNAPSHOT / SIGNAL / etc. body defined in [§5.2](#52-diff)–[§5.7](#57-peer_hello--peer_bye) — is encrypted:

```
{
  "type": "DIFF" | "SNAPSHOT" | "SIGNAL" | ...,
  "spaceUri": "space://...",
  "from": { "did": "did:key:...", "sessionId": "..." },
  "to":   { ... } | null,
  "enc": {
    "epoch": <uint>,            // MLS epoch that keys this frame
    "seq":   <uint>,            // sender's per-epoch frame counter (§6.3.9)
    "ct":    <bstr>             // AEAD ciphertext (includes the 16-byte tag)
  }
}
```

The ciphertext is produced with AES-128-GCM ([[RFC9420]] §5.3 AEAD; NIST SP 800-38D) as:

1. **Plaintext** `P` = the CBOR serialisation of the item that would occupy the cleartext frame's `payload` field ([§5.1](#51-message-frame)) — a CBOR-encoded `GraphDiff` for DIFF, a `GraphSnapshot` map for SNAPSHOT, a CBOR byte string wrapping the opaque bytes for SIGNAL, and so on for each type of [§5.2](#52-diff)–[§5.7](#57-peer_hello--peer_bye). In the encrypted envelope the cleartext `payload` field is absent; its content travels only inside `enc.ct`.
2. **Key** = `frame_key` for `epoch` ([§6.3.9](#639-epoch-key-schedule-and-wire-frame-key-derivation)).
3. **Nonce** `N` = `frame_nonce XOR I2OSP(seq, 12)` — the 96-bit base nonce XORed with the big-endian 96-bit `seq` (the standard MLS/HPKE per-message nonce construction, [[RFC9420]] §5.3, [[RFC9180]] §5.2). Because `frame_nonce` is epoch-unique and `seq` is unique within an epoch, `(key, nonce)` pairs never repeat.
4. **Associated data** `A` = the deterministic CBOR encoding of the routing header
   `[ type, spaceUri, from.did, from.sessionId, (to==null ? null : [to.did, to.sessionId]), epoch, seq ]`.
   Binding the routing metadata and `(epoch, seq)` as AEAD associated data prevents a relay or attacker from re-routing, re-labelling, or replaying a frame under a different header without detection.
5. `ct` = `AES-128-GCM-Seal(frame_key, N, A, P)`.

**Decryption.** A receiver:

1. reads `enc.epoch`; if it is the current epoch or a still-retained recent epoch, selects the matching `frame_key`/`frame_nonce`; if the epoch is unknown (a Commit not yet processed), the receiver MUST buffer the frame, process outstanding Commits, then retry; if the epoch is older than the receiver's retention window, the frame is dropped.
2. recomputes `N` and `A` as above from the received header,
3. computes `P = AES-128-GCM-Open(frame_key, N, A, enc.ct)`; on AEAD failure the frame MUST be discarded (it is forged, corrupted, or mis-routed),
4. CBOR-decodes `P` to recover the body and dispatches it exactly as the cleartext body would be in an open space ([§5](#5-wire-protocol)), including the per-diff signature and capability checks of [§10](#10-validate-implementation). MLS confidentiality does not replace those application-layer authorisation checks; it only ensures the body was authored by a group member and not read by the relay.

Epoch retention: a receiver SHOULD retain the previous epoch's `frame_key` for a short grace window (RECOMMENDED 60 seconds, or until the first frame at the new epoch is received from every known peer, whichever is sooner) to decrypt in-flight frames that crossed an epoch boundary, then zeroise it.

#### 6.3.11 Relay Objects and Trust Boundary

For encrypted spaces the relay stores and forwards exactly these object classes, and **nothing else about the group**:

| Object | Keyed by | Relay may read | Relay may forge |
|---|---|---|---|
| `KeyPackage` | `(spaceUri, did)` | public leaf + init keys, DID | No — signed by DID ([§6.3.5](#635-keypackages)) |
| `Welcome` | `(spaceUri, toDid)` | HPKE ciphertext only | No — decryptable only by the target init key |
| `Commit` (MLSMessage) | `(spaceUri, epoch)` | public MLS framing | No — signed by sender leaf; changes verified by members |
| Encrypted wire frame | `(spaceUri, to?)` | routing header only ([§6.3.10](#6310-message-encryption)) | No — AEAD tag binds header + body |

The trust boundary is explicit and MUST hold:

- The relay MUST NOT be sent, and cannot derive, any private key, `init_secret`, `commit_secret`, `epoch_secret`, `exporter_secret`, `space_traffic_secret`, `frame_key`, or plaintext body. All of these exist only inside members' user agents.
- The relay MAY observe: which DIDs publish KeyPackages, which DID a Welcome is addressed to, the epoch counter of Commits and frames, message sizes, and timing. This is the same "(DID, sessionId) routing metadata" exposure already stated in [§12.1](#121-routing-metadata-disclosure); MLS does not reduce it.
- A malicious relay can **deny service** (drop or withhold objects), **reorder within the limits MLS tolerates**, or **equivocate** by showing different members different Commits — but the last is detected: MLS's `confirmation_tag` and transcript hash ([[RFC9420]] §8.2) mean members who processed divergent histories derive different epoch secrets and fail to decrypt each other's frames, surfacing the split rather than silently forking a shared key. A module SHOULD treat sustained decryption failure across the group after a Commit as a possible relay-equivocation signal and surface it as a sync-state diagnostic.
- The relay MUST NOT be able to add or remove members: Add/Remove take effect only through a member-signed Commit that other members verify ([§6.3.7](#637-adding-a-member), [§6.3.8](#638-removing-a-member)). A relay-injected Commit fails leaf-signature verification ([§6.3.4](#634-leaf-credentials-and-did-binding)) and MUST be rejected.

#### 6.3.12 Rotation Policy

- **On member removal — MUST.** Every member removal rotates the epoch key, enforced automatically by the mandatory `UpdatePath` in the Remove-carrying Commit ([§6.3.8](#638-removing-a-member)). A module MUST NOT skip or defer this.
- **On member addition — MUST.** The Add-carrying Commit likewise carries a fresh `UpdatePath` ([§6.3.7](#637-adding-a-member)), so a joining member never learns any prior epoch's secret (pre-join forward secrecy).
- **Periodic rotation — SHOULD.** Independently of membership change, each member SHOULD periodically advance the epoch by committing an `Update` proposal that rotates its own leaf key ([[RFC9420]] §12.1.2, §12.4), giving post-compromise security. RECOMMENDED epoch lifetime is **24 hours** of wall-clock time or **10,000 wire frames** at the current epoch, whichever comes first; on reaching either bound a member SHOULD issue an Update Commit. To avoid every member committing at once, a member SHOULD jitter its periodic Update by a random fraction of the epoch lifetime and SHOULD suppress its own Update if it has already observed an epoch advance within the current window.
- **Forced rotation.** A module MUST force an epoch advance before the per-epoch frame counter `seq` could exceed 2⁴⁸ ([§6.3.9](#639-epoch-key-schedule-and-wire-frame-key-derivation)).
- **Key hygiene.** On every epoch advance, superseded `epoch_secret`, `exporter_secret`, `space_traffic_secret`, `frame_key`, and `frame_nonce` MUST be zeroised after the retention grace window ([§6.3.10](#6310-message-encryption)).

#### 6.3.13 Interoperability and Conformance

A module claiming conformance to encrypted spaces MUST:

1. Implement MLS [[RFC9420]] protocol version `mls10` with cipher suite `0x0001` and no other ([§6.3.2](#632-cipher-suite)).
2. Derive `group_id` from `spaceUri` per [§6.3.1](#631-overview-and-design-goals).
3. Bind every leaf to a `did:key` per [§6.3.4](#634-leaf-credentials-and-did-binding) and reject non-conforming leaves.
4. Publish, claim, and consume KeyPackages, Welcomes, and Commits through the relay objects of [§6.3.5](#635-keypackages), [§6.3.7](#637-adding-a-member), [§6.3.8](#638-removing-a-member), and [§6.3.11](#6311-relay-objects-and-trust-boundary).
5. Derive wire-frame keys via the MLS exporter per [§6.3.9](#639-epoch-key-schedule-and-wire-frame-key-derivation) and encrypt bodies per [§6.3.10](#6310-message-encryption).
6. Rotate keys per [§6.3.12](#6312-rotation-policy).

Two independent implementations that each satisfy the above can create a group, add and remove each other, and exchange encrypted DIFF/SNAPSHOT/SIGNAL frames without any additional agreement. No step of the ceremony is left to implementation discretion: every point at which [[RFC9420]] admits a choice is pinned by this section.

### 6.4 Multiple Relays

A space MAY list multiple relays. Peers connect to one and the relay network gossips messages between relays. Peers MAY connect to multiple relays for redundancy. In encrypted spaces, gossiped objects are the same opaque KeyPackages, Welcomes, Commits, and ciphertext frames of [§6.3.11](#6311-relay-objects-and-trust-boundary); a relay in the gossip mesh gains no additional plaintext or key access by relaying on another relay's behalf.

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

The default module uses an Observed-Remove Set (OR-Set) CRDT for triples within a graph.

- **Add**: A triple add carries a unique add-tag (the diff's revision).
- **Remove**: A triple remove carries the set of add-tags being removed.
- **Merge**: A triple is in the set iff at least one add-tag exists that has not yet been removed.

This is commutative, associative, and idempotent — diffs can be applied in any order and produce convergent state.

### 8.2 Causal Dependencies

Each diff lists its `dependencies` — every DAG head observable in the same graph's chain at commit time (per [[CONTEXT-SYNC]] §5.2.1). Peers MUST apply all named dependencies before the diff itself. If a dependency is missing locally, the receiver requests it via `PULL` ([§5.3](#53-pull)).

A diff with `|dependencies| > 1` is an **implicit merge**: it concedes the named branches into a single successor. The OR-Set tags accumulated across all merged branches remain valid — the merge diff does not invalidate them, it only marks them as having been observed together by the committer. There is no separate merge-diff format in this module.

A diff with `|dependencies| = 0` is a **chain root**: only legal as either the first diff after a `SNAPSHOT` ([§9](#9-snapshot-promotion)) or the very first diff for a graph. Receivers MUST reject a chain-root diff whose `graphDid` already has unrelated diffs locally — this is a probable signal of a fork attempt or corrupted state.

### 8.3 Reifier Convergence

Reifiers (the triples carrying provenance for data triples) follow the same OR-Set semantics. A reifier and its data triple are added together in a single `GraphDiff`; the runtime treats them atomically.

### 8.4 Concurrent State Transitions

Two agents firing the same flow transition concurrently produce two `flow://state` add-triples. The runtime detects this (same instance, same from-state, different reifier hashes) and applies a deterministic tie-break: lexicographically smaller reifier hash wins; the losing diff's actions are rolled back at evaluation time.

---

## 9. Snapshot Promotion

This section is normative.

### 9.1 Why Promote

Diff chains grow unboundedly. New peers subscribing would have to download all history. To bound this, the module promotes diff chains to snapshots at thresholds.

### 9.2 Threshold

The default module promotes when a graph's diff chain since the last snapshot reaches a configured length (default: 1000 diffs).

The threshold MUST be documented by the module — receiving peers need to know how far back they MAY need to request snapshots.

### 9.3 Promotion Algorithm

1. The committing module decides to promote (typically the agent who authored the threshold-crossing diff).
2. The module calls `getAsSnapshot()` on the graph ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.4) requesting `signBy: "both"`. The default `"nquads-canonical"` format is RECOMMENDED for SNAPSHOT messages: it is the most compact RDF 1.2 serialisation defined and lets recipients verify the IRI invariant by a single SHA-256 over `snapshot.data` without parsing.
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

The snapshot's signature(s) are produced via [[PERSONAL-LINKED-DATA-GRAPHS]] §5.4 (`signBy: "both"`):

- The snapshotter signs ("agent X observed graph G at hash H at time T").
- A graph-DID `assertionMethod` delegate signs ("graph G asserts H at T"), if available.

Receiving peers verify both signatures. Snapshots without at least one valid signature MUST be rejected.

---

## 10. validate() Implementation

### 10.1 Behaviour (`validateDiff`)

The default module's `validateDiff(graphDid, diff, author, graphState)` implements the diff-side contract in [[CONTEXT-SYNC]] §9.2.1 by invoking the [[CAPABILITY-FRAMEWORK]] engine through the runtime:

1. **Bundle signature.** Recompute `commitId` per [[CONTEXT-SYNC]] §5.2.2 from `diff`'s received fields and verify `diff.signature` against it using the resolved author key (the author's `did:key` public bytes, or a current `capabilityDelegation` verification method on the author's DID document for graph-DID authors). On any mismatch return `{ accepted: false, reason: "signature_invalid" }`.
2. **Dependencies.** Validate `diff.dependencies` per [§8.2](#82-causal-dependencies). If any named dependency is missing locally, the module requests it via `PULL` ([§5.3](#53-pull)) and defers the diff until the dependency arrives.
3. Resolve the `graphDid`'s governance engine via the `graphState` `GraphReader` handle.
4. For each triple in `diff.additions` and `diff.removals`:
   1. Construct a `TripleInput` carrying the triple, the `author`, the diff's `timestamp`, and the resolved capability chain from `diff.capabilityProof`.
   2. Call the engine's `validate(triple, ctx)`.
   3. If the result is `{ allowed: false, ... }`, return `{ accepted: false, constraintKind: <result.constraintKind>, constraintId: <result.rejectedBy>, reason: <result.reason> }`.
5. Otherwise, return `{ accepted: true }`.

The engine internally applies the capability-chain verification ([[CAPABILITY-FRAMEWORK]] §7), caveat evaluation ([[CAPABILITY-FRAMEWORK]] §9), and all registered constraint-kind plug-ins ([[CONSTRAINT-VOCABULARY]]).

### 10.2 Behaviour (`validateReadAccess`)

The default module's `validateReadAccess(graphDid, authorDid, capabilityProof?, graphState)` implements the read-side contract in [[CONTEXT-SYNC]] §9.2.2. It MUST be called by the receiving peer **before** serving a `SNAPSHOT` or any `DIFF` for `graphDid` in response to a `PULL` from `authorDid`:

1. Resolve the `graphDid`'s governance engine via `graphState`.
2. Determine whether the graph carries a capability constraint covering `mountContext` (i.e., a constraint with `constraint_kind = "capability"` and either no `capability_predicates` restriction or the action `"mountContext"` in scope per [[CAPABILITY-FRAMEWORK]] §7.1). If none, return `{ accepted: true }` — read access is unrestricted.
3. Otherwise, invoke the engine's `validate({ author: authorDid, capabilityProof, ... }, { action: "mountContext" })` ([[CAPABILITY-FRAMEWORK]] §7 with the explicit action override per §7.1).
4. Return `{ accepted: true }` or `{ accepted: false, constraintKind, constraintId, reason }`.

On rejection the peer:
- MUST NOT respond with `SNAPSHOT` or any `DIFF` for `graphDid` to `authorDid`.
- MUST NOT forward subsequent diffs for `graphDid` to `authorDid` until the requester presents a valid proof (a fresh PULL with a stronger proof MAY succeed).
- MAY respond with `PULL_DENIED` ([§5.4.1](#541-pull_denied)) for diagnostics.

### 10.3 Enforcement Mode

The module MUST read the graph's current `governance://enforcement_mode` via `graphState` before each validation pass and route accordingly per [[CONTEXT-SYNC]] §9.4. Note that `mountContext` constraints apply in all modes — Open mode disables capability checks only for *writes*; read-access constraints still apply.

### 10.4 Rejection Handling

Per [[CONTEXT-SYNC]] §9.3, rejected diffs MUST NOT be stored or forwarded. Per [§10.2](#102-behaviour-validatereadaccess) above, snapshots and diffs MUST NOT be served to peers whose read-access requests fail validation.

---

## 11. Security Considerations

### 11.1 Relay Trust Model

Relays are message brokers, not authorities. They cannot author diffs, cannot reject diffs, cannot read message content (in encrypted spaces). They can observe (DID, sessionId) routing metadata, and they can rate-limit and refuse service.

### 11.2 Group Key Management (Encrypted Spaces)

Encrypted spaces use MLS [[RFC9420]] as specified in [§6.3](#63-group-key-management-for-encrypted-spaces-mls). The MLS `epoch_secret` and everything derived from it (`exporter_secret`, `space_traffic_secret`, `frame_key`, `frame_nonce`) are sensitive material that MUST NOT leave the member's user agent and MUST be zeroised on epoch supersession ([§6.3.12](#6312-rotation-policy)). Implementations MUST rotate the group key on member removal — enforced by the mandatory `UpdatePath` in the Remove-carrying Commit ([§6.3.8](#638-removing-a-member)) — and SHOULD rotate periodically ([§6.3.12](#6312-rotation-policy)) for post-compromise security. Forward secrecy against removed members is a structural property of MLS ([§6.3.1](#631-overview-and-design-goals)): a member removed at epoch *n* cannot derive any epoch secret > *n*. Note that forward secrecy is prospective only — an ex-member retains whatever epoch-≤*n* frames it captured while a legitimate member.

The reuse of one Ed25519 `did:key` for both the MLS signature key and (via the standard birational map, [§6.3.3](#633-deriving-the-hpke-identity-key-from-the-didkey)) the X25519 HPKE key confines identity to a single keypair; it is safe because the signature and key-agreement operations occupy disjoint cryptographic domains and the derived keys are never interchanged.

### 11.3 Snapshot Trust

Snapshots arriving from the network MUST be signed ([§9.5](#95-snapshot-signature)). Receiving peers MUST verify both the snapshot's signatures and that the recomputed content hash matches the embedded hash before mounting.

### 11.4 Replay Attacks

`GraphDiff.revision` is content-addressed, so replaying a previously-applied diff is a no-op (already in the OR-Set per [§8.1](#81-or-set-crdt)).

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

Snapshot promotion announces "agent X took a snapshot of graph G at time T". This is signed and intentionally publicly verifiable; it is not a privacy leak under the design but is worth noting for use cases where snapshot authorship should be limited.

---

## 13. References

### 13.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[RFC5869]** Krawczyk, H. and P. Eronen, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)", RFC 5869, May 2010.
- **[RFC7748]** Langley, A., Hamburg, M., and S. Turner, "Elliptic Curves for Security", RFC 7748, January 2016.
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017.
- **[RFC9180]** Barnes, R., Bhargavan, K., Lipp, B., and C. Wood, "Hybrid Public Key Encryption", RFC 9180, February 2022.
- **[RFC9420]** Barnes, R., Beurdouche, B., Robert, R., Millican, J., Omara, E., and K. Cohn-Gordon, "The Messaging Layer Security (MLS) Protocol", RFC 9420, July 2023.
- **[WEBTRANSPORT]** "WebTransport", W3C Working Draft. https://www.w3.org/TR/webtransport/
- **[DID-KEY]** "did:key Method Specification". https://w3c-ccg.github.io/did-method-key/
- **[DECENTRALISED-IDENTITY]** [Decentralised Identity Web Platform](./01_decentralised-identity-web-platform.md).
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).
- **[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./04_graph-capability-framework.md).
- **[CONTEXT-SYNC]** [Graph Synchronisation Protocol](./05_context-sync-protocol.md).
- **[SYNC-MODULE]** [Sync Module Architecture](./06_sync-module-architecture.md).
- **[CONSTRAINT-VOCABULARY]** [Governance Constraint Vocabulary](./08_governance-constraint-vocabulary.md).

### 13.2 Informative References

- **[RFC9750]** Beurdouche, B., Rescorla, E., Omara, E., Inguva, S., and A. Duric, "The Messaging Layer Security (MLS) Architecture", RFC 9750, March 2025.
