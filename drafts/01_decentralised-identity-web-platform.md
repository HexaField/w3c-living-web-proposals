# Decentralised Identity Integration for the Web Platform

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_decentralised-identity-web-platform.md
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_decentralised-identity-web-platform.md
**Editor:** [TBD]

---

## Abstract

This specification extends the Credential Management API to support **decentralised identifiers (DIDs)** as a first-class web platform primitive. One DID method is REQUIRED: `did:key` for individual identities. The API is exposed on `navigator.credentials` and builds on the precedent of passkeys (WebAuthn): private keys live in platform secure storage, signing is user-agent-mediated, and the credential surface is method-agnostic so that additional DID methods can be plugged in by other specifications. The specification also defines a uniform signing surface (`sign` / `verify` / `signCapability`) and a resolution dispatcher that delegates to method-specific resolvers. A separate specification ([[GROUP-IDENTITY]]) defines `did:graph` for graph-backed collective identity and the DID-document delegate model that gives a graph shared signing authority; this specification's surface is the entry point such methods plug into.

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
5. [Key Management](#5-key-management)
6. [Signing API](#6-signing-api)
7. [DID Resolution](#7-did-resolution)
8. [Permission Model](#8-permission-model)
9. [Security Considerations](#9-security-considerations)
10. [Privacy Considerations](#10-privacy-considerations)
11. [Examples](#11-examples)
12. [References](#12-references)

---

## 1. Introduction

### 1.1 Motivation

Identity on the web is fundamentally server-dependent. Users authenticate to services using passwords, OAuth tokens, or federated identity providers — all of which require a trusted third party to vouch for the user's identity.

User agents have demonstrated that they can manage cryptographic keys on behalf of users. Passkeys (built on WebAuthn) store asymmetric key pairs in the OS keychain, protect them with biometrics, sync them across devices, and present user-friendly permission prompts. Over 13 billion accounts support passkeys as of 2025.

This specification applies the same architectural pattern to **decentralised identifiers (DIDs)**. The substrate is intentionally narrow: a credential type for DIDs, one REQUIRED method (`did:key`), uniform signing and resolution surfaces, and an extension point for other DID methods. Collective identity, shared signing authority, and graph-backed DIDs are layered on top by [[GROUP-IDENTITY]].

### 1.2 Scope

In scope:

- A `DIDCredential` interface and its lifecycle on `navigator.credentials`.
- The `did:key` method, REQUIRED for conforming user agents.
- A uniform `sign` / `verify` / `signCapability` API on `DIDCredential`.
- A `resolve(did)` dispatcher with a pluggable method-resolver registry.
- Permission, key management, security, and privacy requirements applicable to any DID-backed credential.

Out of scope (defined by other specifications):

- The `did:graph` method and DID-document delegate semantics — defined in [[GROUP-IDENTITY]].
- Collective identity, participation, and group conventions — defined in [[GROUP-IDENTITY]].
- Verifiable Credentials — defined in [[VC-DATA-MODEL-2.0]].

### 1.3 Use Cases

- **User-controlled identity.** An identity is created through the user agent, stored in the OS keychain alongside passkeys.
- **Content signing.** An identity signs a document. Any party can verify the signature without contacting a server.
- **Cross-application identity.** The same DID is used across multiple applications.
- **Offline verification.** `did:key` resolution is purely algorithmic; no network round-trip is required.
- **Plug-in methods.** Other specifications register additional DID methods (e.g., `did:graph` via [[GROUP-IDENTITY]], or `did:web`, `did:peer`) through the resolver-registry extension point.

### 1.4 Relationship to Other Specifications

- **Credential Management API** [[CREDENTIAL-MANAGEMENT]] — extended by this specification.
- **DID Core** [[DID-CORE]] — DID data model and document structure.
- **Web Crypto API** [[WEBCRYPTO]] — cryptographic primitives.
- **Ed25519** [[RFC8032]] — REQUIRED signing algorithm.
- [[GROUP-IDENTITY]] defines `did:graph`, DID-document delegates, and the collective-identity layer that plugs into this specification's resolver registry and `DIDCredential` surface.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming user agent MUST:

1. Implement the `DIDCredential` interface ([§3](#3-did-credential-type)).
2. Support the `did:key` method ([§4.1](#41-didkey-method)).
3. Implement the signing API ([§6](#6-signing-api)) for `did:key` credentials.
4. Implement the resolution dispatcher ([§7](#7-did-resolution)) including algorithmic `did:key` resolution.
5. Expose the resolver-registry extension point ([§4.2](#42-method-registry)) so that other specifications MAY register additional DID methods.

A conforming user agent MAY implement additional DID methods either natively or by accepting registrations into the resolver registry. Implementations of `did:graph` and the DID-document delegate model SHOULD follow [[GROUP-IDENTITY]].

---

## 3. DID Credential Type

```webidl
[Exposed=Window, SecureContext]
interface DIDCredential : Credential {
  readonly attribute USVString did;
  readonly attribute USVString method;        // "key", or any other registered method
  readonly attribute DOMString algorithm;
  readonly attribute DOMString displayName;
  readonly attribute DOMString createdAt;     // RFC 3339
  readonly attribute boolean isLocked;
};
```

The `type` attribute inherited from `Credential` MUST return `"did"`.

`DIDCredential` is the substrate type. Specifications that define additional DID methods MAY extend it via WebIDL `partial interface DIDCredential { ... }` to add method-specific attributes (for example, [[GROUP-IDENTITY]] adds the `methodId` of the verification method whose key the credential holds for a `did:graph` DID).

### 3.1 Creating a DID Credential

```webidl
partial dictionary CredentialCreationOptions {
  DIDCredentialCreationOptions did;
};

dictionary DIDCredentialCreationOptions {
  required DOMString displayName;
  DOMString method = "key";              // "key" by default; other values dispatch to registered methods
  DOMString algorithm = "Ed25519";
};
```

When `navigator.credentials.create({ did: options })` is called:

1. The user agent MUST verify the call is triggered by a user gesture. If not, reject with `"NotAllowedError"`.
2. The user agent MUST display a user-agent-mediated prompt naming the `method` and `displayName`.
3. If `method` is `"key"`: generate an Ed25519 keypair, derive a `did:key` URI ([§4.1](#41-didkey-method)), store the private key in platform secure storage ([§5.1](#51-key-storage)), and return a `DIDCredential` whose `method` is `"key"`.
4. If `method` is any other value, the user agent dispatches to the resolver-registry entry that registered creation handling for that method ([§4.2](#42-method-registry)). If no handler is registered, reject with `"NotSupportedError"`.
5. If the user denies, reject with `"NotAllowedError"`.

Specifications that register additional methods MAY extend `DIDCredentialCreationOptions` with method-specific dictionaries via `partial dictionary`.

### 3.2 Retrieving a DID Credential

```webidl
partial dictionary CredentialRequestOptions {
  DIDCredentialRequestOptions did;
};

dictionary DIDCredentialRequestOptions {
  BufferSource? challenge;
  USVString method;           // filter: "key", or any other registered method
};
```

When the user has multiple credentials matching the filter, the user agent MUST present a credential picker.

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

For individual identities. The DID encodes the public key directly per [[DID-KEY]]:

1. Generate an Ed25519 keypair.
2. Let *publicKeyBytes* = the 32-byte Ed25519 public key.
3. Let *multicodecBytes* = `0xed01` || *publicKeyBytes*.
4. Let *encoded* = `base58btc(multicodecBytes)`.
5. Let *did* = `"did:key:z"` || *encoded*.

Example: `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`

Resolution is algorithmic and produces the canonical DID document defined in [[DID-KEY]]. The document lists a single verification method derived from the encoded key.

### 4.2 Method Registry

Conforming user agents MUST support `did:key`. User agents MUST expose a pluggable resolver mechanism through which other specifications and applications can register additional DID methods (for example, `did:graph` via [[GROUP-IDENTITY]], or `did:web`, `did:peer`).

```webidl
[Exposed=Window, SecureContext]
partial interface CredentialsContainer {
  [NewObject] Promise<DIDDocument> resolve(USVString did);
  [NewObject] Promise<sequence<DOMString>> supportedMethods();
};
```

The shape of a method registration (creation handler, resolution handler, optional credential-type extensions) is implementation-defined but MUST cover:

- Construction of a `DIDCredential` from the method-specific creation options (invoked from [§3.1](#31-creating-a-did-credential) step 4).
- Resolution of a DID of the registered method to a [[DID-CORE]] DID document (invoked from [§7.1](#71-resolution-algorithm)).
- Optional method-specific extensions to the `DIDCredential` interface and to permission prompts.

*Support for DID methods beyond `did:key` is at risk.*

---

## 5. Key Management

### 5.1 Key Storage

Private keys associated with `DIDCredential`s MUST be stored using platform secure storage where available:

1. **Hardware security module** (Secure Enclave, TPM) — MUST be used when the platform supports hardware-backed Ed25519 storage.
2. **OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service API) — MUST be used when hardware storage is not available.
3. **Software keystore** — MAY be used as a fallback. Keys MUST be encrypted at rest using a key derived from user authentication (e.g., via Argon2id [[ARGON2]]).

Private keys MUST NOT be stored in IndexedDB, Web Storage, or any other web-accessible storage. Private keys MUST NOT be directly accessible to web content; all cryptographic operations MUST be performed by the user agent on behalf of the web application.

### 5.2 Key Backup

User agents MAY integrate `DIDCredential` key backup with platform credential synchronisation services. When supported:

- Key backup MUST be encrypted end-to-end.
- The user MUST be informed that their DID keys will be synchronised.
- The user MUST be able to opt out of key backup per credential.

*This feature is at risk.*

### 5.3 Key Lifecycle

#### 5.3.1 Generation

Key generation MUST use a cryptographically secure random number generator compliant with [[WEBCRYPTO]].

#### 5.3.2 Lock and Unlock

A `DIDCredential` MAY be locked. While locked, signing operations MUST be rejected with `"InvalidStateError"`.

```webidl
partial interface DIDCredential {
  Promise<undefined> lock();
  Promise<undefined> unlock();
};
```

`unlock()` MUST trigger a platform authentication prompt. `lock()` MUST immediately lock the credential.

#### 5.3.3 Revocation

The user MAY delete a `DIDCredential`. Deletion MUST remove the private key from storage. Deletion does not retroactively invalidate previously created signatures.

Methods that bind a credential to externally-stored DID state (for example, `did:graph` credentials, whose DID document lives in a graph — see [[GROUP-IDENTITY]]) MAY define additional revocation semantics in their respective specifications.

---

## 6. Signing API

### 6.1 sign(data)

The signing API is exposed on `DIDCredential` and is method-agnostic.

```webidl
[Exposed=Window, SecureContext]
partial interface DIDCredential {
  [NewObject] Promise<SignedContent> sign(any data);
  [NewObject] Promise<boolean> verify(SignedContent content);
  [NewObject] Promise<SignedContent> signCapability(object zcap);
};
```

The `sign(data)` method MUST:

1. Verify the call is triggered by a user gesture.
2. Reject with `"InvalidStateError"` if the credential is locked.
3. Display a user-agent-mediated prompt indicating the requesting origin and the action. Method-specific specifications MAY require additional prompt content (for example, [[GROUP-IDENTITY]] requires that signing prompts for a `did:graph` credential indicate the signature is *on behalf of the graph*).
4. Canonicalise `data` using JSON Canonicalization Scheme [[RFC8785]].
5. Compute the timestamp as the current time in RFC 3339 [[RFC3339]] format.
6. Compute `SHA-256(canonical(data) || timestamp)`.
7. Sign the hash with the credential's currently-held private key.
8. Return a `SignedContent` whose `author` is the credential's DID and whose `proof.method` is the verification method identifier used.

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
  readonly attribute USVString method;     // DID URI; for did:key the DID itself plus the canonical fragment
  readonly attribute USVString signature;  // multibase-encoded Ed25519 signature
  readonly attribute DOMString type;       // "Ed25519Signature2020" or similar
};
```

### 6.2 verify(signedContent)

The `verify()` method MUST:

1. Resolve `signedContent.author` to its DID document via [§7](#7-did-resolution).
2. Locate the verification method referenced by `signedContent.proof.method`.
3. Canonicalise `signedContent.data` using [[RFC8785]].
4. Compute `SHA-256(canonical(data) || timestamp)`.
5. Verify the signature against the method's public key.
6. Return `true` if the signature is valid AND the method is currently authorised by the DID document for the signature's intended use. Method-specific authorisation rules (e.g., DID-document capability-section membership for `did:graph`) are defined by the method's specification.

`verify()` MUST NOT require a user gesture and MUST NOT display a prompt.

### 6.3 signCapability(zcap)

A convenience method that produces a signed ZCAP delegation. The method MUST:

1. Validate that `zcap` is a structurally valid [[ZCAP-LD]] document.
2. Confirm that the credential is authorised to act as the ZCAP's `delegator`. For a `did:key` credential, this means the credential's DID equals the `delegator`. For DIDs defined by other specifications, the method's specification MUST define the authorisation rule (for example, [[GROUP-IDENTITY]] requires the credential to hold a current `capabilityDelegation` delegate on the `delegator` graph DID).
3. Sign the canonical form of the ZCAP.
4. Embed the proof and return the signed ZCAP as a `SignedContent`.

### 6.4 Signing Algorithm

The signing algorithm for Ed25519 is:

1. Let *canonical* = `JCS(data)` per [[RFC8785]].
2. Let *timestamp* = current UTC time in RFC 3339 format [[RFC3339]].
3. Let *message* = `SHA-256(canonical || timestamp)`, with *timestamp* encoded as UTF-8.
4. Let *signature* = `Ed25519-Sign(privateKey, message)` per [[RFC8032]].
5. Let *proof* = `{ method: <verificationMethodId>, signature: multibase(signature), type: "Ed25519Signature2020" }`.

---

## 7. DID Resolution

### 7.1 Resolution Algorithm

The user agent's `resolve(did)` method:

1. Parse the DID to extract its `method`.
2. Dispatch to the method-specific resolver:
   - `did:key` — derive the DID document algorithmically from the multibase-encoded key per [[DID-KEY]].
   - Other methods — invoke the registered resolver from the registry ([§4.2](#42-method-registry)). If no resolver is registered, reject with `"NotSupportedError"`.

A resolved DID document is a [[DID-CORE]] DID document, augmented with the `trustLevel` annotation in [§7.2](#72-resolution-trust-levels).

### 7.2 Resolution Trust Levels

A resolved DID document carries a `trustLevel` annotation describing the resolution path. The set of values is method-agnostic; method-specific specifications MAY refine when each level applies.

| `trustLevel` | Meaning |
|---|---|
| `"local"` | The DID's state is fully resolvable from local, authoritative storage (for `did:key`, all resolutions are `"local"`). |
| `"mounted-read"` | The DID's state is resolved from a locally mounted read-only source (for example, a context mounted in `read` mode). |
| `"external"` | The DID's state was fetched specifically for resolution and is not otherwise present locally. |
| `"cached"` | The document was previously resolved and is still within its cache TTL. |

Verification calls SHOULD surface the `trustLevel` to the caller; security-sensitive operations SHOULD require at least `"mounted-read"`.

### 7.3 No Global Resolver

This specification does not define a global resolution infrastructure. There is no registrar, no ledger, no public discovery service maintained by the user agent. `did:key` resolution is algorithmic and requires no infrastructure; resolution for other methods is the responsibility of their respective specifications. Discovering a DID that the agent has never encountered is an out-of-band concern (invitation, link, side-channel) — analogous to how a user discovers a new website's URL.

---

## 8. Permission Model

### 8.1 DID Creation

Creating a new `DIDCredential` MUST require a user gesture and a user-agent-mediated prompt indicating the `method`. Method-specific specifications MAY require additional prompt content.

### 8.2 Signing

Signing data MUST require a user gesture and a user-agent-mediated prompt indicating the requesting origin.

The user agent MAY allow the user to "remember" the signing permission for a specific origin. Remembered permissions MUST be revocable via user agent settings.

### 8.3 DID Disclosure

When an application requests the user's DID, the user agent MUST present an allow/deny prompt. The user MUST NOT be forced to disclose a DID.

---

## 9. Security Considerations

### 9.1 Key Isolation

Private keys MUST be isolated from web content. The user agent MUST NOT expose private key material to JavaScript. All signing operations are mediated by the user agent.

### 9.2 Side-Channel Protection

User agents SHOULD implement constant-time signature verification to prevent timing side-channel attacks.

### 9.3 No Key Export by Default

Private keys MUST NOT be exportable by default. User agents MAY provide a key-export mechanism via user agent settings (not via API) for advanced users.

### 9.4 Replay Protection

Applications that use signed challenges MUST generate unique, unpredictable challenges. The specification does not enforce challenge uniqueness — this is the application's responsibility.

### 9.5 Method-Specific Considerations

Methods registered through [§4.2](#42-method-registry) MAY introduce additional attack surface (network reachability, document tampering, delegate compromise). Their respective specifications MUST address those considerations. In particular, [[GROUP-IDENTITY]] addresses the integrity of DID documents stored in graphs and the lifecycle of compromised DID-document delegates.

---

## 10. Privacy Considerations

### 10.1 Persistent Identifiers

A DID is a persistent, globally unique identifier. If a user presents the same DID to multiple origins, those origins can correlate the user's activity.

### 10.2 Multiple DIDs

User agents MUST allow users to create multiple `DIDCredential`s and SHOULD encourage using different DIDs for different applications and contexts.

### 10.3 Ephemeral DIDs

User agents MAY support ephemeral DIDs — temporary identities created for a single session. *This feature is at risk.*

### 10.4 Origin Correlation

User agents MUST NOT reveal to a requesting origin which other origins the user has used a DID with.

### 10.5 Method-Specific Considerations

Methods that bind a DID to externally-visible state (for example, `did:graph` DID documents being readable from a graph) introduce additional privacy considerations defined by their respective specifications. See [[GROUP-IDENTITY]] for `did:graph`.

---

## 11. Examples

### 11.1 Creating an Individual DID

```javascript
const me = await navigator.credentials.create({
  did: { method: "key", displayName: "My Identity" }
});
console.log(me.did);    // "did:key:z6Mk..."
console.log(me.method); // "key"
```

### 11.2 Signing and Verifying

```javascript
const announcement = await me.sign({ type: "Note", body: "Hello" });
console.log(announcement.author);          // me.did
console.log(announcement.proof.method);    // "did:key:z6Mk...#z6Mk..." (canonical fragment)

const ok = await me.verify(announcement);  // true
```

### 11.3 Resolving Any DID

```javascript
const doc = await navigator.credentials.resolve("did:key:z6Mk...");
console.log(doc.verificationMethod);
console.log(doc.trustLevel);   // "local" for did:key
```

### 11.4 Signing a ZCAP

```javascript
const zcap = await me.signCapability({
  parentCapability: rootCap.id,
  delegatee: "did:key:z6MkContractor...",
  actions: ["createLink"],
  resource: "did:graph:z6MkChannel...",
  caveats: [
    { type: "expiry", expiresAt: "2027-01-01T00:00:00Z" }
  ]
});
```

---

## 12. References

### 12.1 Normative References

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
- **[ZCAP-LD]** "Authorization Capabilities for Linked Data". https://w3c-ccg.github.io/zcap-spec/

### 12.2 Informative References

- **[GROUP-IDENTITY]** [Decentralised Group Identity](./10_decentralised-group-identity.md) — defines `did:graph`, DID-document delegates, and the collective-identity layer.
- **[VC-DATA-MODEL-2.0]** "Verifiable Credentials Data Model v2.0", W3C Recommendation. https://www.w3.org/TR/vc-data-model-2.0/
- **[RFC5480]** Turner, S. et al., "Elliptic Curve Cryptography Subject Public Key Information", RFC 5480, March 2009.
- **[SEC2]** Certicom Research, "SEC 2: Recommended Elliptic Curve Domain Parameters", 2010.
- **[ARGON2]** Biryukov, A., Dinu, D., and D. Khovratovich, "Argon2: the memory-hard function for password hashing and other applications", 2015.
