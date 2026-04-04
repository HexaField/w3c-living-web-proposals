# Decentralised Identity Integration for the Web Platform

**W3C First Public Working Draft**

**Latest published version:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_decentralised-identity-web-platform.md  
**Editor's Draft:** https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/02_decentralised-identity-web-platform.md  
**Editor:** [TBD]  
**This version:** Draft, 4 April 2026

---

## Abstract

This specification extends the Credential Management API to support decentralised identifiers (DIDs) with Ed25519 key pairs. It defines methods for generating, storing, and using `did:key` identities for signing and verifying web content, with integration into the browser's credential management and secure key storage. The specification builds on the precedent established by passkeys (WebAuthn) to bring user-controlled cryptographic identity to the web platform.

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
3. [DID Credential Type](#3-did-credential-type)
4. [Key Management](#4-key-management)
5. [Signing API](#5-signing-api)
6. [DID Document](#6-did-document)
7. [Permission Model](#7-permission-model)
8. [Security Considerations](#8-security-considerations)
9. [Privacy Considerations](#9-privacy-considerations)
10. [Examples](#10-examples)
11. [References](#11-references)

---

## 1. Introduction

### 1.1 Motivation

Identity on the web is fundamentally server-dependent. Users authenticate to services using passwords, OAuth tokens, or federated identity providers — all of which require a trusted third party to vouch for the user's identity. If the server goes down, the account is deleted, or the provider changes its terms, the user loses their identity and all associated data.

Meanwhile, the web platform has demonstrated that browsers **can** manage cryptographic keys on behalf of users. Passkeys (built on WebAuthn and the Credential Management API) store asymmetric key pairs in the OS keychain, protect them with biometrics, sync them across devices, and present user-friendly permission prompts. Over 13 billion accounts support passkeys as of 2025.

This specification applies the same architectural pattern to **decentralised identifiers (DIDs)**. Rather than authenticating to a specific server, a user generates a DID — a globally unique, self-certifying identifier backed by an Ed25519 key pair. The browser manages the key, the user controls the identity, and no server is required.

### 1.2 Use Cases

- **User-controlled identity.** A user creates a DID in the browser, stored in the OS keychain alongside their passkeys. Web applications can request the user's DID to identify them without any server-side account.
- **Content signing.** A user signs a document, message, or data structure with their DID. Any party can verify the signature without contacting a server.
- **Cross-application identity.** A user uses the same DID across multiple web applications. Each application recognises the user by their DID without a shared authentication server.
- **Offline verification.** Signed content can be verified without network access because `did:key` resolution is purely algorithmic.

### 1.3 Relationship to Existing Specifications

This specification extends:
- **Credential Management API** [[CREDENTIAL-MANAGEMENT]] for credential creation and retrieval
- **DID Core** [[DID-CORE]] for the DID data model
- **Web Crypto API** [[WEBCRYPTO]] for cryptographic primitives
- **Ed25519** [[RFC8032]] for the signing algorithm

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]] and [[RFC8174]] when, and only when, they appear in ALL CAPITALS, as shown here.

A conforming user agent MUST implement all non-optional features of this specification. A conforming user agent MAY implement features marked "This feature is at risk."

---

## 3. DID Credential Type

### 3.1 DIDCredential Interface

The **DIDCredential** interface extends the `Credential` interface [[CREDENTIAL-MANAGEMENT]] with properties specific to decentralised identifiers.

```webidl
[Exposed=Window, SecureContext]
interface DIDCredential : Credential {
  readonly attribute USVString did;
  readonly attribute DOMString algorithm;
  readonly attribute DOMString displayName;
  readonly attribute DOMString createdAt;    // RFC 3339
  readonly attribute boolean isLocked;
};
```

- The `did` attribute MUST contain a valid DID URI [[DID-CORE]] in the `did:key` method.
- The `algorithm` attribute MUST contain the algorithm identifier used for the key pair (e.g., `"Ed25519"`).
- The `displayName` attribute contains a user-provided label for the identity.
- The `createdAt` attribute MUST be an RFC 3339 [[RFC3339]] timestamp of when the credential was created.
- The `isLocked` attribute indicates whether the private key is currently locked (requiring unlock before signing).

The `type` attribute inherited from `Credential` MUST return `"did"`.

### 3.2 Creating a DID Credential

A DIDCredential is created via the standard `navigator.credentials.create()` method with a `did` options key.

```webidl
partial dictionary CredentialCreationOptions {
  DIDCredentialCreationOptions did;
};

dictionary DIDCredentialCreationOptions {
  required DOMString displayName;
  DOMString algorithm = "Ed25519";
};
```

When `navigator.credentials.create({ did: options })` is called, the user agent MUST:

1. Verify that the call is triggered by a user gesture. If not, reject with a `"NotAllowedError"` DOMException.
2. Display a browser-mediated prompt informing the user that a new decentralised identity will be created, showing the `displayName`.
3. If the user consents, generate a new Ed25519 key pair.
4. Derive the `did:key` URI from the public key (see [§6.1](#61-did-key-method)).
5. Store the key pair in platform secure storage (see [§4.1](#41-key-storage)).
6. Return a `DIDCredential` with the generated DID, algorithm, display name, and creation timestamp.
7. If the user denies, reject with a `"NotAllowedError"` DOMException.

### 3.3 Retrieving a DID Credential

An existing DIDCredential is retrieved via `navigator.credentials.get()` with a `did` options key. This serves as both credential retrieval and a signing challenge.

```webidl
partial dictionary CredentialRequestOptions {
  DIDCredentialRequestOptions did;
};

dictionary DIDCredentialRequestOptions {
  BufferSource? challenge;
};
```

When `navigator.credentials.get({ did: options })` is called, the user agent MUST:

1. Verify that the call is triggered by a user gesture.
2. Display a browser-mediated prompt showing the requesting origin and asking the user to select a DID identity.
3. If a `challenge` is provided, sign the challenge with the selected identity's private key and include the signature in the response.
4. Return the selected `DIDCredential`.

If the user has multiple DID credentials, the browser MUST present a credential picker (analogous to the passkey picker).

### 3.4 Supported Algorithms

Conforming user agents MUST support:

| Algorithm | Key Type | Multicodec | Reference |
|-----------|----------|------------|-----------|
| Ed25519 | OKP (Ed25519) | `0xed01` | [[RFC8032]] |

User agents MAY support additional algorithms:

| Algorithm | Key Type | Multicodec | Reference |
|-----------|----------|------------|-----------|
| P-256 | EC (P-256) | `0x1200` | [[RFC5480]] |
| secp256k1 | EC (secp256k1) | `0xe701` | [[SEC2]] |

*Support for algorithms beyond Ed25519 is at risk.*

---

## 4. Key Management

### 4.1 Key Storage

Private keys associated with DIDCredentials MUST be stored using platform secure storage mechanisms where available. The following storage backends are defined in order of preference:

1. **Hardware security module** (Secure Enclave, TPM) — MUST be used when the platform supports hardware-backed key storage for Ed25519.
2. **OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service API) — MUST be used when hardware storage is not available.
3. **Software keystore** — MAY be used as a fallback when neither hardware nor OS keychain storage is available. Keys MUST be encrypted at rest using a key derived from user authentication (e.g., via Argon2id [[ARGON2]]).

Private keys MUST NOT be stored in IndexedDB, Web Storage, or any other web-accessible storage mechanism.

Private keys MUST NOT be directly accessible to web content. All cryptographic operations MUST be performed by the user agent on behalf of the web application.

### 4.2 Key Backup

User agents MAY integrate DIDCredential key backup with platform credential synchronisation services (e.g., iCloud Keychain, Google Password Manager). When supported:

- Key backup MUST be encrypted end-to-end.
- The user MUST be informed that their DID keys will be synchronised.
- The user MUST be able to opt out of key backup per credential.

*This feature is at risk.* Platform credential sync services may not support custom credential types.

### 4.3 Key Lifecycle

#### 4.3.1 Generation

Key generation MUST use a cryptographically secure random number generator compliant with [[WEBCRYPTO]].

#### 4.3.2 Lock and Unlock

A DIDCredential MAY be locked with a passphrase or biometric. While locked, signing operations MUST be rejected with an `"InvalidStateError"` DOMException.

```webidl
partial interface DIDCredential {
  Promise<undefined> lock();
  Promise<undefined> unlock();
};
```

The `unlock()` method MUST trigger a platform authentication prompt (biometric, passphrase, or device PIN). The `lock()` method MUST immediately lock the credential.

#### 4.3.3 Revocation

[NOTE: DID revocation for `did:key` is an open problem since `did:key` has no updateable state. Revocation would need an external revocation list or a move to a DID method that supports updates (e.g., `did:web`, `did:peer`). This section requires further work.]

Users MUST be able to delete a DIDCredential from the browser. Deletion MUST remove the private key from storage. Deletion does not retroactively invalidate previously created signatures.

---

## 5. Signing API

### 5.1 sign(data)

The signing API is exposed as methods on the `DIDCredential` interface itself. This keeps signing tightly bound to the credential object, consistent with how WebAuthn credentials work.

```webidl
[Exposed=Window, SecureContext]
partial interface DIDCredential {
  [NewObject] Promise<SignedContent> sign(any data);
  [NewObject] Promise<boolean> verify(SignedContent content);
};
```

The `sign(data)` method MUST:

1. Verify that the call is triggered by a user gesture.
2. If no active identity is set, prompt the user to select one.
3. Display a browser-mediated prompt: "*[origin]* wants to sign data with your identity. [Allow] [Deny]".
4. Canonicalise `data` using JSON Canonicalization Scheme [[RFC8785]].
5. Compute the timestamp as the current time in RFC 3339 [[RFC3339]] format.
6. Compute `SHA-256(canonical(data) || timestamp)`.
7. Sign the hash with the selected identity's Ed25519 private key.
8. Return a `SignedContent` object.

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
  readonly attribute USVString key;        // DID URI of the signing key
  readonly attribute USVString signature;  // hex-encoded Ed25519 signature
};
```

### 5.2 verify(signedContent)

The `verify()` method MUST:

1. Resolve the `author` DID to extract the public key (see [§6](#6-did-document)).
2. Canonicalise `signedContent.data` using [[RFC8785]].
3. Compute `SHA-256(canonical(data) || signedContent.timestamp)`.
4. Verify the Ed25519 signature using the resolved public key.
5. Return `true` if the signature is valid, `false` otherwise.

The `verify()` method MUST NOT require a user gesture and MUST NOT display a prompt. Verification is a passive, non-privileged operation.

### 5.3 Signing Algorithm

The signing algorithm is:

1. Let *canonical* = `JCS(data)` where JCS is JSON Canonicalization Scheme [[RFC8785]].
2. Let *timestamp* = current UTC time formatted as RFC 3339 [[RFC3339]].
3. Let *message* = `SHA-256(canonical || timestamp)` where `||` denotes byte concatenation, with *timestamp* encoded as UTF-8.
4. Let *signature* = `Ed25519-Sign(privateKey, message)` per [[RFC8032]].
5. Let *proof* = `{ key: did, signature: hex(signature) }`.

### 5.4 Canonicalisation

Data MUST be canonicalised before signing using JSON Canonicalization Scheme (JCS) [[RFC8785]]. JCS provides deterministic serialisation of JSON values, ensuring that semantically equivalent data produces identical byte sequences.

If `data` is not a JSON-compatible value (i.e., it contains undefined, functions, symbols, or circular references), the `sign()` method MUST reject with a `"DataCloneError"` DOMException.

---

## 6. DID Document

### 6.1 `did:key` Method

This specification uses the `did:key` method for DID generation. The encoding follows [[DID-KEY]]:

1. Generate an Ed25519 key pair.
2. Let *publicKeyBytes* = the 32-byte Ed25519 public key.
3. Let *multicodecBytes* = `0xed01` (Ed25519 multicodec prefix) || *publicKeyBytes*.
4. Let *encoded* = `base58btc(multicodecBytes)`.
5. Let *did* = `"did:key:z"` || *encoded*.

Example: `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`

### 6.2 DID Document Resolution

Conforming user agents MUST be able to resolve `did:key` URIs natively by deriving the DID Document from the DID string itself. No network request is required.

The resolved DID Document for a `did:key` Ed25519 identity MUST conform to the following structure:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "did:key:z6Mk...",
  "verificationMethod": [{
    "id": "did:key:z6Mk...#z6Mk...",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:key:z6Mk...",
    "publicKeyMultibase": "z6Mk..."
  }],
  "authentication": ["did:key:z6Mk...#z6Mk..."],
  "assertionMethod": ["did:key:z6Mk...#z6Mk..."]
}
```

User agents MAY support resolution of other DID methods via a pluggable resolver mechanism.

*Support for DID methods beyond `did:key` is at risk.*

---

## 7. Permission Model

### 7.1 DID Creation

Creating a new DIDCredential MUST require:
1. A **user gesture** (click, tap, keyboard event). Programmatic creation without user interaction MUST be rejected.
2. A **browser-mediated prompt** clearly indicating that a new persistent identity is being created.

The prompt SHOULD display the `displayName` and the requesting origin.

### 7.2 Signing

Signing data with a DIDCredential MUST require:
1. A **user gesture**.
2. A **browser-mediated prompt** indicating the requesting origin and the action ("sign data with your identity").

The user agent MAY allow the user to "remember" the signing permission for a specific origin. Remembered permissions MUST be revocable via browser settings.

[NOTE: The granularity of "remember" — per-origin, per-session, or permanent — needs further discussion. Permanent signing permission is powerful and potentially dangerous.]

### 7.3 DID Disclosure

When a web application requests the user's DID (via `navigator.credentials.get()`), the user agent MUST present a prompt allowing the user to:
- **Allow** — disclose the selected DID to the requesting origin.
- **Deny** — refuse disclosure; the application receives a rejection.

The user MUST NOT be forced to disclose a DID. Applications MUST handle denial gracefully.

---

## 8. Security Considerations

### 8.1 Key Isolation

Private keys MUST be isolated from web content. The user agent MUST NOT expose private key material to JavaScript. All signing operations are mediated by the browser.

Private keys for different origins MUST be stored independently. A compromise of one origin's access MUST NOT expose keys used with other origins.

[NOTE: Unlike passkeys which are typically per-origin, a DID is a universal identifier. The same DID may be used across multiple origins. Key isolation here means that the *access grants* are per-origin — an origin cannot sign without the user's per-origin consent — but the underlying key may be the same.]

### 8.2 Side-Channel Protection

User agents SHOULD implement constant-time signature verification to prevent timing side-channel attacks. User agents SHOULD NOT expose detailed timing information about signing operations to web content.

### 8.3 No Key Export by Default

Private keys MUST NOT be exportable by default. User agents MAY provide a key export mechanism in browser settings (not via API) for advanced users who need to migrate keys between browsers.

[NOTE: Key portability vs. security is a fundamental tension. Passkeys addressed this via platform sync. DIDs may need a similar approach. This section requires further work.]

### 8.4 Replay Protection

Applications that use signed challenges (via `navigator.credentials.get({ did: { challenge } })`) MUST generate unique, unpredictable challenges to prevent replay attacks. The specification does not enforce challenge uniqueness — this is the application's responsibility.

---

## 9. Privacy Considerations

### 9.1 Persistent Identifiers

A DID is a persistent, globally unique identifier. If a user presents the same DID to multiple origins, those origins can correlate the user's activity. This is a significant privacy risk.

### 9.2 Multiple DIDs

User agents SHOULD allow users to create multiple DIDCredentials. Users SHOULD be encouraged to use different DIDs for different contexts (e.g., work, personal, anonymous).

User agents MAY present a DID picker that helps users select the appropriate identity for each origin, similar to how password managers suggest different credentials per site.

### 9.3 Ephemeral DIDs

User agents MAY support ephemeral DIDs — temporary identities created for a single session or interaction that are automatically deleted afterwards.

*This feature is at risk.*

### 9.4 Origin Correlation

User agents MUST NOT reveal to a requesting origin which other origins the user has used a DID with. The credential picker MUST NOT display origin-specific usage history to the web page.

---

## 10. Examples

### 10.1 Creating a Decentralised Identity

```javascript
// Create a new DID identity
const credential = await navigator.credentials.create({
  did: {
    displayName: "My Personal Identity",
    algorithm: "Ed25519"
  }
});
// Browser shows: "Create a new decentralised identity? [Create] [Cancel]"

console.log(credential.did);         // "did:key:z6MkhaXgBZD..."
console.log(credential.algorithm);   // "Ed25519"
console.log(credential.displayName); // "My Personal Identity"
console.log(credential.createdAt);   // "2026-04-04T00:08:00Z"
```

### 10.2 Signing and Verifying Data

```javascript
// Get active identity
const credential = await navigator.credentials.get({ did: {} });

// Sign arbitrary data
const signed = await credential.sign({
  type: "message",
  content: "Hello, decentralised web!",
  recipient: "did:key:z6MkotherDID..."
});
// Browser shows: "example.com wants to sign data with your identity. [Allow] [Deny]"

console.log(signed.author);           // "did:key:z6Mk..."
console.log(signed.timestamp);        // "2026-04-04T00:08:15Z"
console.log(signed.proof.signature);  // "a3b4c5d6..."

// Verify the signature (no prompt needed)
const isValid = await credential.verify(signed);
console.log(isValid); // true
```

### 10.3 Identity Challenge-Response Authentication

```javascript
// Server sends a challenge
const challenge = new Uint8Array(32);
crypto.getRandomValues(challenge);

// Client retrieves DID credential with signed challenge
const credential = await navigator.credentials.get({
  did: { challenge: challenge }
});
// Browser shows: "example.com wants to verify your identity. [Allow] [Deny]"

// Send credential.did and the signed challenge to server
// Server verifies signature using the DID's public key
const response = await fetch("/auth", {
  method: "POST",
  body: JSON.stringify({
    did: credential.did,
    challenge: btoa(String.fromCharCode(...challenge)),
    // signed challenge included in credential
  })
});
```

### 10.4 Checking Active Identity

```javascript
// Check if user has an active identity
const active = await navigator.credentials.get({ did: {} });

if (active) {
  console.log(`Signed in as ${active.displayName} (${active.did})`);
} else {
  console.log("No active identity — prompt user to create or select one");
}
```

---

## 11. References

### 11.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. https://www.rfc-editor.org/rfc/rfc3339
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017. https://www.rfc-editor.org/rfc/rfc8032
- **[RFC8785]** Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. https://www.rfc-editor.org/rfc/rfc8785
- **[DID-CORE]** Sporny, M., Guy, A., Sabadello, M., and D. Reed, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/
- **[DID-KEY]** "did:key Method Specification". https://w3c-ccg.github.io/did-method-key/
- **[CREDENTIAL-MANAGEMENT]** West, M., "Credential Management Level 1", W3C Working Draft. https://www.w3.org/TR/credential-management-1/
- **[WEBCRYPTO]** Watson, M., "Web Cryptography API", W3C Recommendation, 26 January 2017. https://www.w3.org/TR/WebCryptoAPI/
- **[WEBIDL]** Chen, E., "Web IDL Standard". https://webidl.spec.whatwg.org/

### 11.2 Informative References

- **[RFC5480]** Turner, S. et al., "Elliptic Curve Cryptography Subject Public Key Information", RFC 5480, March 2009. https://www.rfc-editor.org/rfc/rfc5480
- **[SEC2]** Certicom Research, "SEC 2: Recommended Elliptic Curve Domain Parameters", 2010. https://www.secg.org/sec2-v2.pdf
- **[ARGON2]** Biryukov, A., Dinu, D., and D. Khovratovich, "Argon2: the memory-hard function for password hashing and other applications", 2015.
- **[WEBAUTHN]** Balfanz, D. et al., "Web Authentication: An API for accessing Public Key Credentials", W3C Recommendation. https://www.w3.org/TR/webauthn-3/
