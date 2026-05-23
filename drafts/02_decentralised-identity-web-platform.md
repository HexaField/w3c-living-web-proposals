# Decentralised Identity Integration for the Web Platform

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_decentralised-identity-web-platform.md
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_decentralised-identity-web-platform.md
**Editor:** [TBD]

---

## Abstract

This specification extends the Credential Management API to support **decentralised identifiers (DIDs)** as a first-class web platform primitive. Two DID methods are REQUIRED: `did:key` for individual agents (humans, software, AI agents) and `did:graph` for graphs (linked data contexts in the sense of [[PERSONAL-LINKED-DATA-GRAPHS]]). The DID document of a `did:graph` DID may carry multiple verification methods, partitioned into the W3C-defined capability sections (`verificationMethod`, `capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`); a signature produced by any current verification method in the appropriate section counts as a signature *by the DID*. This **DID-document delegate model** is the canonical mechanism for shared signing authority over a graph — multisig, threshold signatures, and aggregate-key schemes are explicit non-goals. The API is exposed on `navigator.credentials` and builds on the precedent of passkeys (WebAuthn).

---

## Status of This Document

This document is a **First Public Working Draft** published by the [TBD] Working Group. It is intended to become a W3C Recommendation.

Publication as a First Public Working Draft does not imply endorsement by W3C and its Members.

Feedback and comments are welcome. Please file issues on the GitHub repository.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [DID Credential Type](#3-did-credential-type)
4. [DID Methods](#4-did-methods)
5. [DID-Document Delegates](#5-did-document-delegates)
6. [Key Management](#6-key-management)
7. [Signing API](#7-signing-api)
8. [DID Resolution](#8-did-resolution)
9. [Permission Model](#9-permission-model)
10. [Security Considerations](#10-security-considerations)
11. [Privacy Considerations](#11-privacy-considerations)
12. [Examples](#12-examples)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 Motivation

Identity on the web is fundamentally server-dependent. Users authenticate to services using passwords, OAuth tokens, or federated identity providers — all of which require a trusted third party to vouch for the user's identity.

User agents have demonstrated that they can manage cryptographic keys on behalf of users. Passkeys (built on WebAuthn) store asymmetric key pairs in the OS keychain, protect them with biometrics, sync them across devices, and present user-friendly permission prompts. Over 13 billion accounts support passkeys as of 2025.

This specification applies the same architectural pattern to **decentralised identifiers (DIDs)** and extends it in a critical way that passkeys do not: identity is not only for *people*. A graph, a working group, a community, an AI agent, an organisation — all hold DIDs through the same API surface. The substrate does not distinguish between individual and collective identity at the data model level.

### 1.2 Two REQUIRED Methods

- **`did:key`** — for individual agents. The DID *is* the key; resolution is purely algorithmic.
- **`did:graph`** — for graphs. The DID identifies a linked data context (see [[PERSONAL-LINKED-DATA-GRAPHS]]), and the DID document lives as triples inside the context.

### 1.3 Shared Signing Authority — DID-Document Delegates

A central design question for collective identity: how does a community sign as itself when no single agent should hold its keys?

Existing approaches either pick one custodian (centralisation) or assemble a threshold-cryptography stack (multisig, Shamir, FROST, BLS). This specification takes a different path. The DID document of a `did:graph` DID lists multiple verification methods and partitions them into the W3C-defined capability sections:

- `verificationMethod` — the full set of methods associated with the DID.
- `capabilityInvocation` — methods that may act on capabilities the DID holds (sign as the DID for ZCAP invocation).
- `capabilityDelegation` — methods that may delegate the DID's capabilities further.
- `assertionMethod` — methods that may make assertions on behalf of the DID (sign snapshots, attest to graph state).
- `authentication` — methods that may authenticate as the DID.

**Any current method in the relevant capability section is sufficient to sign as the DID.** No M-of-N threshold, no key aggregation; verification is a single Ed25519 check against whichever method produced the signature. Adding, removing, or rotating a method is a governed operation against the DID document. For `did:graph` this is a ZCAP-controlled write to the graph's own triples (see [[GRAPH-GOVERNANCE]] §10).

This replaces multisig in this specification. Multisig answers "how do many agents jointly sign one message?"; delegates answer "who is currently authorised to sign as this DID?" The two are different questions, and the delegate answer composes naturally with the rest of the substrate (capability-governed evolution, no novel cryptography, standard DID Core semantics).

### 1.4 Use Cases

- **User-controlled identity.** A user creates a DID through the user agent, stored in the OS keychain alongside their passkeys.
- **Collective identity.** A team creates a `did:graph` for itself; multiple members are listed as `capabilityInvocation` delegates, and any one of them can sign as the team.
- **Content signing.** A user or a graph signs a document. Any party can verify the signature without contacting a server.
- **Cross-application identity.** A user uses the same DID across multiple applications.
- **Offline verification.** `did:key` resolution is purely algorithmic; `did:graph` resolution consults locally mounted contexts first.
- **AI agents.** An AI agent holds a `did:key` (or is listed as a delegate on a `did:graph`); the same signing API serves it as serves a human.

### 1.5 Relationship to Existing Specifications

This specification extends:

- **Credential Management API** [[CREDENTIAL-MANAGEMENT]].
- **DID Core** [[DID-CORE]] — DID data model, document structure, capability sections.
- **Web Crypto API** [[WEBCRYPTO]] — cryptographic primitives.
- **Ed25519** [[RFC8032]] — signing algorithm.

This specification is complemented by [[PERSONAL-LINKED-DATA-GRAPHS]] (which defines the graphs that `did:graph` identifies) and [[GRAPH-GOVERNANCE]] (which defines the ZCAP rules that govern changes to a `did:graph` DID document).

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming user agent MUST:

1. Implement the DIDCredential interface ([§3](#3-did-credential-type)).
2. Support the `did:key` and `did:graph` methods ([§4](#4-did-methods)).
3. Honour DID-document delegate semantics ([§5](#5-did-document-delegates)).
4. Implement the signing API ([§7](#7-signing-api)).
5. Implement the resolution algorithm ([§8](#8-did-resolution)).

A conforming user agent MAY implement additional DID methods via a pluggable resolver mechanism.

---

## 3. DID Credential Type

```webidl
[Exposed=Window, SecureContext]
interface DIDCredential : Credential {
  readonly attribute USVString did;
  readonly attribute USVString method;        // "key", "graph", or other
  readonly attribute DIDCredentialKind kind;  // "individual" or "graph"
  readonly attribute DOMString algorithm;
  readonly attribute DOMString displayName;
  readonly attribute DOMString createdAt;     // RFC 3339
  readonly attribute boolean isLocked;
  /** For did:graph: the specific verification method id whose key this credential holds. */
  readonly attribute USVString methodId;
};

enum DIDCredentialKind { "individual", "graph" };
```

The `type` attribute inherited from `Credential` MUST return `"did"`.

### 3.1 Creating a DID Credential

```webidl
partial dictionary CredentialCreationOptions {
  DIDCredentialCreationOptions did;
};

dictionary DIDCredentialCreationOptions {
  required DOMString displayName;
  DOMString method = "key";              // "key" → individual; "graph" → graph DID
  DOMString algorithm = "Ed25519";
  GraphDIDCreationOptions graphOptions;  // REQUIRED when method = "graph"
};

dictionary GraphDIDCreationOptions {
  USVString graphIri;                    // target graph IRI; if absent, mint a fresh one
  sequence<USVString> initialDelegates;  // DIDs to add as capabilityInvocation delegates
                                          // (in addition to the creator)
};
```

When `navigator.credentials.create({ did: options })` is called:

1. The user agent MUST verify the call is triggered by a user gesture. If not, reject with `"NotAllowedError"`.
2. The user agent MUST display a user-agent-mediated prompt naming the `method` and `displayName`. For `method = "graph"`, the prompt MUST make clear that the identity *belongs to a graph*, not to the user personally.
3. If the user consents:
   - For `method = "key"`: generate an Ed25519 keypair, derive a `did:key` URI ([§4.1](#41-didkey-method)), store the private key in platform secure storage ([§6.1](#61-key-storage)), and return a `DIDCredential` with `kind = "individual"`.
   - For `method = "graph"`: generate an Ed25519 keypair, derive a `did:graph` URI ([§4.2](#42-didgraph-method)), create the graph (or use the provided `graphIri`) with the initial DID document, store the private key in platform secure storage, write any `initialDelegates` to the DID document via the graph's governance, and return a `DIDCredential` with `kind = "graph"`.
4. If the user denies, reject with `"NotAllowedError"`.

### 3.2 Retrieving a DID Credential

```webidl
partial dictionary CredentialRequestOptions {
  DIDCredentialRequestOptions did;
};

dictionary DIDCredentialRequestOptions {
  BufferSource? challenge;
  DIDCredentialKind kind;     // filter: "individual" or "graph"
  USVString method;           // filter: "key", "graph", etc.
};
```

When the user has multiple credentials matching the filter, the user agent MUST present a credential picker. For a graph DID, the picker MUST indicate that selecting the credential will allow signing *on behalf of the graph*.

### 3.3 Supported Algorithms

Conforming user agents MUST support:

| Algorithm | Key Type | Multicodec | Reference |
|-----------|----------|------------|-----------|
| Ed25519 | OKP | `0xed01` | [[RFC8032]] |

User agents MAY support additional algorithms:

| Algorithm | Key Type | Multicodec | Reference |
|-----------|----------|------------|-----------|
| P-256 | EC | `0x1200` | [[RFC5480]] |
| secp256k1 | EC | `0xe701` | [[SEC2]] |

*Support for algorithms beyond Ed25519 is at risk.*

---

## 4. DID Methods

### 4.1 `did:key` Method

For individual agents. The DID encodes the public key directly per [[DID-KEY]]:

1. Generate an Ed25519 keypair.
2. Let *publicKeyBytes* = the 32-byte Ed25519 public key.
3. Let *multicodecBytes* = `0xed01` || *publicKeyBytes*.
4. Let *encoded* = `base58btc(multicodecBytes)`.
5. Let *did* = `"did:key:z"` || *encoded*.

Example: `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`

Resolution is algorithmic and produces the canonical DID document defined in [[DID-KEY]].

### 4.2 `did:graph` Method

For graphs. A `did:graph` DID identifies a context (see [[PERSONAL-LINKED-DATA-GRAPHS]]) and its DID document lives as triples inside that context.

#### 4.2.1 Identifier Format

The `did:graph` method-specific identifier uses the same multibase encoding as `did:key` — a multicodec-prefixed Ed25519 public key:

```
did:graph:z6Mkh...   ← initial pubkey, multibase Ed25519
```

The key generated at graph creation is the **initial key**: it becomes the first entry in the graph's DID document, and its holder is the first delegate in every capability section.

The identifier is single-key by construction. There is no multihash-of-keys, no aggregate key, no derived identifier. **Shared authority lives in the DID document, not in the identifier.**

#### 4.2.2 DID Document Storage

The DID document for a `did:graph` DID is composed from the following triples inside the context the DID identifies:

```turtle
# Inside graph://<did-fragment>
<did:graph:z6Mkh...>
  did://hasMethod              <did:graph:z6Mkh...#key-creator> ,
                               <did:graph:z6Mkh...#key-alice> ,
                               <did:graph:z6Mkh...#key-bob> ;
  did://capabilityInvocation   <did:graph:z6Mkh...#key-creator> ,
                               <did:graph:z6Mkh...#key-alice> ,
                               <did:graph:z6Mkh...#key-bob> ;
  did://capabilityDelegation   <did:graph:z6Mkh...#key-creator> ;
  did://assertionMethod        <did:graph:z6Mkh...#key-creator> ,
                               <did:graph:z6Mkh...#key-alice> ,
                               <did:graph:z6Mkh...#key-bob> .

<did:graph:z6Mkh...#key-creator>
  did://verificationMethod/type                "Ed25519VerificationKey2020" ;
  did://verificationMethod/controller          <did:graph:z6Mkh...> ;
  did://verificationMethod/publicKeyMultibase  "z6Mkh..." .

# (further #key-alice, #key-bob entries similar)
```

User agents MUST be able to project these triples into a standard JSON-LD DID document for compatibility with consumers expecting [[DID-CORE]] JSON-LD output.

#### 4.2.3 Document Updates

Adding, removing, or moving a method between capability sections of a `did:graph` DID document is a write to the underlying context and is therefore subject to that context's governance ([[GRAPH-GOVERNANCE]]). The canonical predicates for governed changes are:

- `did-document://add-method` — add a new `verificationMethod` entry.
- `did-document://remove-method` — remove an entry; cryptographically invalidates future signatures by that method.
- `did-document://grant-section` — add a method to a capability section.
- `did-document://revoke-section` — remove a method from a section without removing it from `verificationMethod`.

Each operation is a triple write authorised by a ZCAP whose resource is the graph DID. There is no separate "DID document update" wire format — the DID document *is* triples in the graph, and updating it is just authoring triples.

#### 4.2.4 Resolution

`did:graph` resolution ([§8](#8-did-resolution)) proceeds as follows:

1. If the context identified by the DID is locally mounted, project the DID-document triples into a DID document.
2. Otherwise, attempt to fetch a snapshot for the context via known sync spaces ([[P2P-GRAPH-SYNC]]), mount it read-only with `trustLevel: "external"`, and project the DID document from the mounted state.
3. If neither succeeds, resolution fails with `"NotFoundError"`.

Resolution never blocks on remote authority — there is no registrar, no ledger, no consensus dependency. The local mounts and sync-space memberships *are* the resolution domain.

#### 4.2.5 Deactivation

A `did:graph` DID is deactivated by writing `<did> did://deactivated true` into the context via the governance flow. Historical signatures remain verifiable against the DID document state at the time of signing.

### 4.3 Method Registry

Conforming user agents MUST support `did:key` and `did:graph`. User agents MAY support additional methods (`did:web`, `did:peer`, etc.) via a pluggable resolver mechanism.

```webidl
[Exposed=Window, SecureContext]
partial interface CredentialsContainer {
  [NewObject] Promise<DIDDocument> resolve(USVString did);
  [NewObject] Promise<sequence<DOMString>> supportedMethods();
};
```

*Support for DID methods beyond `did:key` and `did:graph` is at risk.*

---

## 5. DID-Document Delegates

This section is normative. It defines how multiple verification methods on a DID document are interpreted as a delegate set, and how shared signing authority is realised without multisig or threshold schemes.

### 5.1 Semantics

A DID document MAY list one or more methods in `verificationMethod`. The capability sections (`capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`) reference subsets of `verificationMethod`.

**A signature produced by any current method in the relevant capability section is a valid signature by the DID** for that purpose. Verification consists of:

1. Resolve the DID to its current DID document.
2. Identify the method referenced by the signature's `method` field.
3. Confirm the method is currently listed in the appropriate capability section for the signature's intended use.
4. Verify the signature against the method's public key using the method's algorithm.

There is no aggregation, no quorum check, no joint key. Each verification is a single algorithmic operation.

### 5.2 Non-Goals

The following are explicitly out of scope for this specification:

- **Multisignature (multisig) schemes.** This specification does not define joint signing, M-of-N approval, or signature aggregation.
- **Threshold cryptography.** Shamir, FROST, BLS-threshold, and similar schemes are not part of the substrate.
- **Multihash-of-keys identifiers.** The DID identifier is derived from a single Ed25519 public key (the initial key); shared authority is added to the DID document, not embedded in the identifier.

Implementations that need joint authorisation SHOULD layer it on top — for example, by requiring multiple authorised delegates to each independently sign a ZCAP that grants the actual action — but the substrate itself takes the position that **the delegate set is the answer to "who is currently authorised."**

### 5.3 Delegate Lifecycle

A delegate is added to a DID document by writing `verificationMethod` and capability-section triples authorised by a ZCAP. A delegate is removed by removing those triples, also under ZCAP control.

| Stage | Triggered by | Effect |
|---|---|---|
| **Add** | `did-document://add-method` + section grants | New method becomes a valid signer for the granted sections. |
| **Promote** | `did-document://grant-section` | Existing method gains additional sections. |
| **Demote** | `did-document://revoke-section` | Method loses a section but remains in `verificationMethod`. Historical signatures in the removed section remain verifiable. |
| **Remove** | `did-document://remove-method` | Method is removed entirely. Historical signatures remain verifiable against the document state at the time of signing. |
| **Rotate** | Remove + Add as one batch | The method's underlying key is replaced. |

For `did:key`, only `Add` (at creation) and `Remove` (via credential deletion) apply; `did:key` documents are immutable beyond their initial form.

### 5.4 Delegate API

The DIDCredential interface exposes delegate management for DIDs the user controls (either as the sole holder of the `did:key` private key, or as a current `capabilityDelegation` delegate on a `did:graph`).

```webidl
partial interface DIDCredential {
  [NewObject] Promise<sequence<DIDDocumentMethod>> delegates();
  [NewObject] Promise<undefined> addDelegate(
    DIDDocumentMethod method,
    sequence<DIDCapabilitySection> sections
  );
  [NewObject] Promise<undefined> removeDelegate(USVString methodId);
  [NewObject] Promise<undefined> grantSection(
    USVString methodId,
    DIDCapabilitySection section
  );
  [NewObject] Promise<undefined> revokeSection(
    USVString methodId,
    DIDCapabilitySection section
  );
};

dictionary DIDDocumentMethod {
  required USVString id;
  required DOMString type;
  required USVString controller;
  required USVString publicKeyMultibase;
};

enum DIDCapabilitySection {
  "capabilityInvocation",
  "capabilityDelegation",
  "assertionMethod",
  "authentication"
};
```

For a `did:graph` credential, `addDelegate()` translates into the corresponding `did-document://add-method` triple write against the graph and SHALL reject with `"NotAllowedError"` if the current DID does not hold a `capabilityDelegation` method permitting the change.

For a `did:key` credential, `delegates()` returns the single canonical method derived from the key; the other methods reject with `"NotSupportedError"`.

---

## 6. Key Management

### 6.1 Key Storage

Private keys associated with DIDCredentials MUST be stored using platform secure storage where available:

1. **Hardware security module** (Secure Enclave, TPM) — MUST be used when the platform supports hardware-backed Ed25519 storage.
2. **OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service API) — MUST be used when hardware storage is not available.
3. **Software keystore** — MAY be used as a fallback. Keys MUST be encrypted at rest using a key derived from user authentication (e.g., via Argon2id [[ARGON2]]).

Private keys MUST NOT be stored in IndexedDB, Web Storage, or any other web-accessible storage. Private keys MUST NOT be directly accessible to web content; all cryptographic operations MUST be performed by the user agent on behalf of the web application.

For `did:graph` credentials, the *private key the user controls* is the key for one verification method on the graph DID's document (typically the creator's method, or a method the user was added to). The user MAY hold delegate keys for multiple graph DIDs simultaneously; each is stored independently.

### 6.2 Key Backup

User agents MAY integrate DIDCredential key backup with platform credential synchronisation services. When supported:

- Key backup MUST be encrypted end-to-end.
- The user MUST be informed that their DID keys will be synchronised.
- The user MUST be able to opt out of key backup per credential.

*This feature is at risk.*

### 6.3 Key Lifecycle

#### 6.3.1 Generation

Key generation MUST use a cryptographically secure random number generator compliant with [[WEBCRYPTO]].

#### 6.3.2 Lock and Unlock

A DIDCredential MAY be locked. While locked, signing operations MUST be rejected with `"InvalidStateError"`.

```webidl
partial interface DIDCredential {
  Promise<undefined> lock();
  Promise<undefined> unlock();
};
```

`unlock()` MUST trigger a platform authentication prompt. `lock()` MUST immediately lock the credential.

#### 6.3.3 Revocation

For `did:key` credentials, the user MAY delete a DIDCredential. Deletion MUST remove the private key from storage. Deletion does not retroactively invalidate previously created signatures.

For `did:graph` credentials, the user holds a *delegate key* on the graph DID. Deleting the local credential prevents the user from signing as the graph going forward but does not affect other delegates. Removing the delegate's *entry* from the graph's DID document is a separate, governance-controlled operation ([§5.3](#53-delegate-lifecycle)).

---

## 7. Signing API

### 7.1 sign(data)

The signing API is exposed on `DIDCredential`. The same surface applies uniformly to `did:key` and `did:graph` credentials.

```webidl
[Exposed=Window, SecureContext]
partial interface DIDCredential {
  [NewObject] Promise<SignedContent> sign(any data);
  [NewObject] Promise<boolean> verify(SignedContent content);
  [NewObject] Promise<SignedContent> signGraph(USVString graphIri);
  [NewObject] Promise<SignedContent> signCapability(object zcap);
};
```

The `sign(data)` method MUST:

1. Verify the call is triggered by a user gesture.
2. Reject with `"InvalidStateError"` if the credential is locked.
3. Display a user-agent-mediated prompt indicating the requesting origin, the action, and — for `did:graph` credentials — that the signature will be *on behalf of the graph*.
4. Canonicalise `data` using JSON Canonicalization Scheme [[RFC8785]].
5. Compute the timestamp as the current time in RFC 3339 [[RFC3339]] format.
6. Compute `SHA-256(canonical(data) || timestamp)`.
7. Sign the hash with the credential's currently-held private key.
8. Return a `SignedContent` whose `author` is the credential's DID and whose `proof.method` is the verification method id used.

```webidl
[Exposed=(Window,Worker)]
interface SignedContent {
  readonly attribute USVString author;     // DID URI
  readonly attribute DOMString timestamp;  // RFC 3339
  readonly attribute any data;
  readonly attribute ContentProof proof;
};

[Exposed=(Window,Worker)]
interface ContentProof {
  readonly attribute USVString method;     // DID URI with fragment — the verification method
  readonly attribute USVString signature;  // multibase-encoded Ed25519 signature
  readonly attribute DOMString type;       // "Ed25519Signature2020" or similar
};
```

### 7.2 verify(signedContent)

The `verify()` method MUST:

1. Resolve `signedContent.author` to its DID document.
2. Locate the verification method referenced by `signedContent.proof.method`.
3. Canonicalise `signedContent.data` using [[RFC8785]].
4. Compute `SHA-256(canonical(data) || timestamp)`.
5. Verify the signature against the method's public key.
6. Return `true` if the signature is valid AND the method is currently listed in the appropriate capability section; `false` otherwise.

`verify()` MUST NOT require a user gesture and MUST NOT display a prompt.

### 7.3 signGraph(graphIri)

A convenience method that produces a signed assertion of a graph's current state. The signed payload is the graph's content hash and IRI; this is the canonical way to attest "I observed graph G at hash H at time T."

The method MUST:

1. Compute the graph's content hash via [[PERSONAL-LINKED-DATA-GRAPHS]] §`contentHash`.
2. Sign the structured payload `{ graphIri, contentHash }` using `sign()`.
3. Return the `SignedContent`.

When the credential's DID is the graph's own `did:graph:...`, the resulting signature has additional significance: it is the graph asserting its own state. This requires the credential to hold an `assertionMethod` delegate on the graph DID; if not, reject with `"NotAllowedError"`.

### 7.4 signCapability(zcap)

A convenience method that produces a signed ZCAP delegation. The method MUST:

1. Validate that `zcap` is a structurally valid ZCAP-LD document.
2. Confirm that the credential's DID is the `delegator` (for `did:key`) or that the credential holds a `capabilityDelegation` delegate on the `delegator` graph DID.
3. Sign the canonical form of the ZCAP.
4. Embed the proof and return the signed ZCAP as a `SignedContent`.

### 7.5 Signing Algorithm

The signing algorithm for Ed25519 is:

1. Let *canonical* = `JCS(data)` per [[RFC8785]].
2. Let *timestamp* = current UTC time in RFC 3339 format [[RFC3339]].
3. Let *message* = `SHA-256(canonical || timestamp)`, with *timestamp* encoded as UTF-8.
4. Let *signature* = `Ed25519-Sign(privateKey, message)` per [[RFC8032]].
5. Let *proof* = `{ method: <verificationMethodId>, signature: multibase(signature), type: "Ed25519Signature2020" }`.

---

## 8. DID Resolution

### 8.1 Resolution Algorithm

The user agent's `resolve(did)` method:

1. Parse the DID to extract its `method`.
2. Dispatch to the method-specific resolver:
   - `did:key` — derive the DID document algorithmically from the multibase-encoded key.
   - `did:graph` — see [§8.2](#82-didgraph-resolution).
   - Other methods — invoke the registered pluggable resolver, if any. If no resolver is registered, reject with `"NotSupportedError"`.

### 8.2 `did:graph` Resolution

1. If the context identified by the DID is locally mounted in any GraphStore (per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.4), query the context's triples for the canonical DID-document predicates ([§4.2.2](#422-did-document-storage)) and project them into a DID document.
2. Otherwise, attempt to fetch a snapshot for the context via known sync spaces ([[P2P-GRAPH-SYNC]]). On success:
   - Mount it read-only with `trustLevel: "external"`.
   - Project its DID-document triples into a DID document.
   - Cache the resolved document with a TTL derived from the snapshot's signed timestamp.
3. If neither step succeeds, reject with `"NotFoundError"`.

### 8.3 Resolution Trust Levels

A resolved DID document carries a `trustLevel` annotation describing the resolution path:

| `trustLevel` | Meaning |
|---|---|
| `"local"` | The context is locally mounted in `write` or `governance` mode. |
| `"mounted-read"` | The context is locally mounted in `read` mode. |
| `"external"` | The context was fetched specifically for resolution; the document is from an unmounted snapshot. |
| `"cached"` | The document was previously resolved and is still within its cache TTL. |

Verification calls SHOULD surface the `trustLevel` to the caller; security-sensitive operations SHOULD require at least `"mounted-read"`.

### 8.4 No Global Resolver

This specification deliberately does not define a global resolution infrastructure for `did:graph`. There is no registrar, no ledger, no public discovery service. The agent's local mounts and sync-space memberships *are* the resolution domain. Discovering a graph DID that the agent has never encountered is an out-of-band concern (invitation, link, side-channel) — analogous to how a user discovers a new website's URL.

---

## 9. Permission Model

### 9.1 DID Creation

Creating a new DIDCredential MUST require a user gesture and a user-agent-mediated prompt indicating the `method` and `kind` (and, for `did:graph`, the graph being brought into existence).

### 9.2 Signing

Signing data MUST require a user gesture and a user-agent-mediated prompt indicating the requesting origin. For `did:graph` credentials, the prompt MUST clearly indicate that the signature will be **on behalf of the graph**.

The user agent MAY allow the user to "remember" the signing permission for a specific origin. Remembered permissions MUST be revocable via user agent settings.

### 9.3 DID Disclosure

When an application requests the user's DID, the user agent MUST present an allow/deny prompt. The user MUST NOT be forced to disclose a DID.

### 9.4 Delegate Management

Operations that modify a DID document (`addDelegate`, `removeDelegate`, `grantSection`, `revokeSection`) MUST require a user gesture and a user-agent-mediated prompt describing the change. For `did:graph`, the prompt MUST identify the target graph and (if applicable) display the ZCAP under which the operation is authorised.

---

## 10. Security Considerations

### 10.1 Key Isolation

Private keys MUST be isolated from web content. The user agent MUST NOT expose private key material to JavaScript. All signing operations are mediated by the user agent.

### 10.2 Delegate Compromise

A compromised delegate of a `did:graph` DID can sign as the graph until removed from the DID document. Mitigations:

- The DID document SHOULD be reviewed regularly by holders of `capabilityDelegation` methods.
- Compromised delegates SHOULD be removed promptly via `removeDelegate()` or `revokeSection()`.
- Historical signatures by removed delegates remain verifiable; this is intentional (verification of past statements should not depend on current document state).

The DID-document-delegate model accepts a single-delegate compromise as a recoverable failure mode — comparable to a single-key compromise in `did:key`. Implementations that need stronger compromise resistance MAY layer joint-signing protocols on top, but the substrate does not require them.

### 10.3 Side-Channel Protection

User agents SHOULD implement constant-time signature verification to prevent timing side-channel attacks.

### 10.4 No Key Export by Default

Private keys MUST NOT be exportable by default. User agents MAY provide a key-export mechanism via user agent settings (not via API) for advanced users.

### 10.5 Replay Protection

Applications that use signed challenges MUST generate unique, unpredictable challenges. The specification does not enforce challenge uniqueness — this is the application's responsibility.

### 10.6 DID Document Integrity

For `did:graph`, the DID document is triple data in the underlying context. Its integrity depends on the context's own integrity (sync-layer governance, capability proofs, snapshot signatures). A user agent MUST refuse to honour signatures by methods listed in a DID document fetched from an `"external"` source if the source snapshot's authorship cannot be verified.

---

## 11. Privacy Considerations

### 11.1 Persistent Identifiers

A DID is a persistent, globally unique identifier. If a user presents the same DID to multiple origins, those origins can correlate the user's activity.

### 11.2 Per-Context Identity (Recommended Posture)

With contexts as the unit of coherence ([[PERSONAL-LINKED-DATA-GRAPHS]]), the recommended privacy posture is per-context identity: an agent uses a different `did:key` (or a different delegate key on a `did:graph`) in different contexts. The substrate makes this cheap — creating a DID is local and fast.

### 11.3 Multiple DIDs

User agents MUST allow users to create multiple DIDCredentials and SHOULD encourage using different DIDs for different contexts.

### 11.4 Ephemeral DIDs

User agents MAY support ephemeral DIDs — temporary identities created for a single session. *This feature is at risk.*

### 11.5 Origin Correlation

User agents MUST NOT reveal to a requesting origin which other origins the user has used a DID with.

### 11.6 Graph DID Privacy

A graph DID's document discloses the set of current delegates. If delegate keys are tied to individual identities, the DID document reveals *who can sign as the graph*. Communities that need delegate-set privacy SHOULD use rotated, single-use delegate keys (not tied to individuals' long-term DIDs) and treat the DID document as public.

---

## 12. Examples

### 12.1 Creating an Individual DID

```javascript
const me = await navigator.credentials.create({
  did: { method: "key", displayName: "My Identity" }
});
console.log(me.did);    // "did:key:z6Mk..."
console.log(me.kind);   // "individual"
```

### 12.2 Creating a Graph DID

```javascript
// Create a graph DID for an "Engineering" working group.
// The current user becomes the first delegate; named DIDs are added immediately
// so the group can speak as itself without solo dependency on the creator.
const team = await navigator.credentials.create({
  did: {
    method: "graph",
    displayName: "Engineering",
    graphOptions: {
      initialDelegates: ["did:key:z6MkAlice...", "did:key:z6MkBob..."]
    }
  }
});
console.log(team.did);   // "did:graph:z6Mkh..."
console.log(team.kind);  // "graph"
```

### 12.3 Signing as the Graph

```javascript
// Any current capabilityInvocation delegate can sign as the team.
const announcement = await team.sign({ type: "Release", version: "1.0" });
console.log(announcement.author);            // team.did
console.log(announcement.proof.method);      // "did:graph:z6Mkh...#key-alice"

// Verification.
const ok = await team.verify(announcement);
```

### 12.4 Managing Delegates

```javascript
const current = await team.delegates();

await team.addDelegate(
  {
    id: `${team.did}#key-charlie`,
    type: "Ed25519VerificationKey2020",
    controller: team.did,
    publicKeyMultibase: "z6MkCharlie..."
  },
  ["capabilityInvocation", "assertionMethod"]
);

await team.removeDelegate("did:graph:z6Mkh...#key-charlie");
```

### 12.5 Signing a Graph Snapshot

```javascript
const sig = await team.signGraph("graph://abc...");
console.log(sig.data);
// { graphIri: "graph://abc...", contentHash: "sha256-..." }
```

### 12.6 Signing a ZCAP

```javascript
const zcap = await team.signCapability({
  parentCapability: rootCap.id,
  delegatee: "did:key:z6MkContractor...",
  actions: ["createLink"],
  resource: "did:graph:z6MkChannel...",
  caveats: [
    { type: "expiry", expiresAt: "2027-01-01T00:00:00Z" },
    { type: "predicate", allowed: ["msg://has_message"] }
  ]
});
```

### 12.7 Resolving Any DID

```javascript
const doc = await navigator.credentials.resolve("did:graph:z6Mkh...");
console.log(doc.verificationMethod);
console.log(doc.capabilityInvocation);
console.log(doc.trustLevel);   // "local" | "mounted-read" | "external" | "cached"
```

---

## 13. References

### 13.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002.
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017.
- **[RFC8785]** Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020.
- **[DID-CORE]** "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/
- **[DID-KEY]** "did:key Method Specification". https://w3c-ccg.github.io/did-method-key/
- **[CREDENTIAL-MANAGEMENT]** "Credential Management Level 1", W3C Working Draft. https://www.w3.org/TR/credential-management-1/
- **[WEBCRYPTO]** "Web Cryptography API", W3C Recommendation, 26 January 2017. https://www.w3.org/TR/WebCryptoAPI/
- **[WEBIDL]** "Web IDL Standard". https://webidl.spec.whatwg.org/
- **[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./01_personal-linked-data-graphs.md) (companion specification).

### 13.2 Informative References

- **[P2P-GRAPH-SYNC]** [Peer-to-Peer Context Synchronisation Protocol](./03_p2p-graph-sync.md) (companion specification).
- **[GRAPH-GOVERNANCE]** [Graph Governance](./05_graph-governance.md) (companion specification).
- **[RFC5480]** Turner, S. et al., "Elliptic Curve Cryptography Subject Public Key Information", RFC 5480, March 2009.
- **[SEC2]** Certicom Research, "SEC 2: Recommended Elliptic Curve Domain Parameters", 2010.
- **[ARGON2]** Biryukov, A., Dinu, D., and D. Khovratovich, "Argon2: the memory-hard function for password hashing and other applications", 2015.
- **[ZCAP-LD]** "Authorization Capabilities for Linked Data". https://w3c-ccg.github.io/zcap-spec/
