# Governance Constraint Vocabulary

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a normative vocabulary of **constraint kinds** that plug into the [[CAPABILITY-FRAMEWORK]]. Where the framework defines the capability-chain mechanism, enforcement modes, scope resolution, and the meta-structure of caveats, this specification defines *what specific constraints exist* and *how they are evaluated*: **temporal** (rate limits and intervals), **content** (length, blocked patterns, URL/domain/media-type policy), **credential** (Verifiable-Credential requirements per [[VC-DATA-MODEL-2.0]]), and the **shape** and **content** caveat types that integrate with [[SHAPE-VALIDATION]]. Each constraint kind defines its predicates, its plug-in handler, and its evaluation algorithm. The vocabulary is open-ended: applications MAY define additional kinds via the plug-in mechanism in [[CAPABILITY-FRAMEWORK]] §9.4.

---

## Status of This Document

This document is a draft Community Group Report. It has no official W3C standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Credential Constraints](#4-credential-constraints)
5. [Temporal Constraints](#5-temporal-constraints)
6. [Content Constraints](#6-content-constraints)
7. [Shape Caveat](#7-shape-caveat)
8. [Examples](#8-examples)
9. [Security Considerations](#9-security-considerations)
10. [Privacy Considerations](#10-privacy-considerations)
11. [Predicate Reference Table](#11-predicate-reference-table)
12. [References](#12-references)

---

## 1. Introduction

### 1.1 Motivation

[[CAPABILITY-FRAMEWORK]] defines a deliberately minimal core: capability chains, attenuation, caveat composition, enforcement modes. The vocabulary of what kinds of constraint can exist — temporal rate limits, content policies, credential requirements, shape conformance — is extensible.

This specification supplies the standard vocabulary that conforming user agents MUST recognise. Each kind is a plug-in handler ([[CAPABILITY-FRAMEWORK]] §9.4) registered against the engine: when the engine encounters a constraint of a known kind, it dispatches to the corresponding handler defined here.

### 1.2 Relationship to Other Specifications

This specification depends on:

- [[CAPABILITY-FRAMEWORK]] — defines the framework into which these constraint kinds plug.
- [[PERSONAL-LINKED-DATA-GRAPHS]] — defines the Graph whose triples are constrained.
- [[SHAPE-VALIDATION]] — supplies SHACL shape evaluation for the `shape` caveat in [§7](#7-shape-caveat).
- [[VC-DATA-MODEL-2.0]] — supplies the credential format that credential constraints validate against.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming **governance engine** that supports this vocabulary MUST register handlers for the constraint kinds `"credential"`, `"temporal"`, and `"content"` per the framework's plug-in mechanism ([[CAPABILITY-FRAMEWORK]] §9.4), and MUST handle the caveat types `shape` and `content` per [§7](#7-shape-caveat) and [§6.3](#63-content-caveat-evaluation).

A conforming **application** MAY define additional constraint kinds; the engine handles them via the same plug-in mechanism.

---

## 3. Terminology

<dl>
<dt>Constraint Kind</dt>
<dd>A category of governance rule, identified by the string value of <code>governance://constraint_kind</code>. This specification defines the kinds <code>"credential"</code>, <code>"temporal"</code>, and <code>"content"</code>.</dd>

<dt>Credential Constraint</dt>
<dd>A constraint that requires triple authors to hold a specific type of Verifiable Credential [[VC-DATA-MODEL-2.0]].</dd>

<dt>Temporal Constraint</dt>
<dd>A constraint that limits the rate at which an agent can create matching triples.</dd>

<dt>Content Constraint</dt>
<dd>A constraint that validates the content of a triple's object — length, blocked patterns, URL policy, and similar.</dd>

<dt>Shape Caveat</dt>
<dd>A ZCAP caveat (<code>type: "shape"</code>) that requires the authorised triples to conform to a registered SHACL shape ([[SHAPE-VALIDATION]]).</dd>
</dl>

---

## 4. Credential Constraints

### 4.1 Constraint Definition

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "credential"
<constraint-id> -[governance://requires_credential_type]→ <type-name>
```

Optional:

```
<constraint-id> -[governance://credential_issuer_pattern]→ <did-pattern>
<constraint-id> -[governance://credential_min_age_hours]→ <integer>
```

**Credential storage convention.** Agents store VCs as content-addressed expressions referenced via `<agent-did> -[governance://has_credential]→ <credential-expression-address>`. The engine resolves and verifies the VC.

### 4.2 Credential Verification Algorithm

**Input:** A triple, the author's DID, the scope chain, the graph state.

**Algorithm:**

1. **Collect credential constraints** in scope (from [[CAPABILITY-FRAMEWORK]] §6.2). If none, return ACCEPT.
2. **For each constraint:**
   1. Query `<author> -[governance://has_credential]→ ?addr` for the author.
   2. For each `?addr`, resolve to a Verifiable Credential per [[VC-DATA-MODEL-2.0]].
   3. **Type match.** Skip credentials whose `type` does not include the required `<type-name>`.
   4. **Issuer match.** If `credential_issuer_pattern` is set, skip credentials whose `issuer` does not match the glob.
   5. **Freshness.** If `credential_min_age_hours` is set, require the credential's `issuanceDate` to be at least `min_age_hours` in the past.
   6. **Signature verification.** Verify the credential's proof per [[VC-DATA-MODEL-2.0]].
   7. **Revocation check.** If the credential carries a `credentialStatus`, verify it is not revoked. On resolution failure, REJECT (fail-closed).
3. If any constraint had zero matching credentials, REJECT.
4. Otherwise, return ACCEPT.

---

## 5. Temporal Constraints

### 5.1 Constraint Definition

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "temporal"
```

At least one of:

```
<constraint-id> -[governance://temporal_min_interval_seconds]→ <integer>
<constraint-id> -[governance://temporal_max_count_per_window]→ <integer>
```

Optional:

```
<constraint-id> -[governance://temporal_window_seconds]→ <integer>          # default: 60
<constraint-id> -[governance://temporal_applies_to_predicates]→ <comma-separated URIs>
```

### 5.2 Temporal Verification Algorithm

**Input:** A triple, the author's DID, the scope chain, the authoritative timestamp (per [[CONTEXT-SYNC]] §12.5).

**Algorithm:**

1. **Collect temporal constraints** with `constraint_kind = "temporal"`. If none, return ACCEPT.

2. **For each constraint:**
   1. **Predicate match.** If `temporal_applies_to_predicates` is set and the triple's predicate is not listed, skip.
   2. **Query recent triples** by the same author within scope.
   3. **Interval check.** If `temporal_min_interval_seconds` is set, find the most recent matching triple and compute elapsed time. If too short, REJECT.
   4. **Window count check.** If `temporal_max_count_per_window` is set, count matching triples in the sliding window. If at or above max, REJECT.

3. All passed → ACCEPT.

---

## 6. Content Constraints

### 6.1 Constraint Definition

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "content"
```

Optional:

```
<constraint-id> -[governance://content_applies_to_predicates]→ <comma-separated URIs>
<constraint-id> -[governance://content_blocked_patterns]→ <pipe-separated regex patterns>
<constraint-id> -[governance://content_allow_urls]→ <boolean>
<constraint-id> -[governance://content_allowed_domains]→ <comma-separated domains>
<constraint-id> -[governance://content_allow_media_types]→ <comma-separated MIME patterns>
<constraint-id> -[governance://content_max_length]→ <integer>
```

### 6.2 Content Verification Algorithm

**Input:** A triple, the scope chain, the graph state.

**Algorithm:**

1. **Collect content constraints**. If none, return ACCEPT.

2. **For each constraint:**
   1. **Predicate match.**
   2. **Resolve object** to text content (literal directly, or by resolving a content-addressed expression — fail-closed on resolution error).
   3. **Length check.** REJECT if exceeds `content_max_length`.
   4. **Blocked patterns.** REJECT if any regex matches.
   5. **URL policy.** REJECT if `content_allow_urls = "false"` and content contains URLs.
   6. **Domain whitelist.** REJECT if any URL's domain is not in `content_allowed_domains`.
   7. **Media type.** REJECT if media type does not match any glob.

3. All passed → ACCEPT.

### 6.3 `content` Caveat Evaluation

In addition to constraint-bound content checks, [[CAPABILITY-FRAMEWORK]] §9.4 admits caveats of type `content` whose `value` is `{ "sparql": "ASK { ... }" }`. The handler:

1. Builds an in-memory model containing the triple and its reifier.
2. Substitutes `$this` in the SPARQL query for the triple's subject IRI.
3. Executes the `ASK` query against the model.
4. Returns ACCEPT iff the query returns `true`. Fail-closed on any query error.

---

## 7. Shape Caveat

A caveat of type `shape` requires the authorised triple to conform to a registered SHACL shape ([[SHAPE-VALIDATION]]).

### 7.1 Caveat Format

```json
{ "type": "shape", "value": { "shapeIri": "<URI of a registered shape>" } }
```

The shape MUST be registered in the writing graph (or a parent graph reachable via `context://participates_in`) per [[SHAPE-VALIDATION]].

### 7.2 Evaluation Algorithm

For each triple under the caveat's authority:

1. Resolve the shape via [[SHAPE-VALIDATION]] §7 (cross-graph resolution).
2. Treat the triple's subject as the candidate node.
3. Evaluate the shape's property definitions against the candidate node and all sibling triples in the same `GraphDiff`.
4. Return ACCEPT iff the candidate conforms; REJECT otherwise.

### 7.3 Relationship to `property` Caveat

The `property` caveat ([[CAPABILITY-FRAMEWORK]] §9.2) restricts which property paths a delegation can write. When combined with `shape`, it narrows the shape further to specific properties:

- `shape` alone — "any property of this shape."
- `shape` + `property` — "this property of this shape."

---

## 8. Examples

### 8.1 Rate Limit (Slow Mode)

```javascript
const slowMode = `urn:constraint:slow-${crypto.randomUUID()}`;
await general.addTriple({
  subject: slowMode, predicate: "governance://entry_type", object: "governance://constraint"
});
await general.addTriple({
  subject: slowMode, predicate: "governance://constraint_kind", object: "temporal"
});
await general.addTriple({
  subject: slowMode, predicate: "governance://temporal_min_interval_seconds", object: "30"
});
await general.addTriple({
  subject: slowMode, predicate: "governance://temporal_applies_to_predicates", object: "msg://body"
});
await general.addTriple({
  subject: general.did, predicate: "governance://has_constraint", object: slowMode
});
```

### 8.2 Credential Requirement (Proof of Humanity)

```javascript
const humanity = `urn:constraint:hum-${crypto.randomUUID()}`;
await community.addTriple({
  subject: humanity, predicate: "governance://entry_type", object: "governance://constraint"
});
await community.addTriple({
  subject: humanity, predicate: "governance://constraint_kind", object: "credential"
});
await community.addTriple({
  subject: humanity, predicate: "governance://requires_credential_type", object: "ProofOfHumanity"
});
await community.addTriple({
  subject: humanity, predicate: "governance://credential_issuer_pattern", object: "did:web:humancheck.org"
});
await community.addTriple({
  subject: community.did, predicate: "governance://has_constraint", object: humanity
});
// Applies transitively: every child graph inherits this requirement because
// they participate_in community.
```

### 8.3 Content Constraint (No URLs in Messages)

```javascript
const noUrls = `urn:constraint:nourls-${crypto.randomUUID()}`;
await general.addTriple({
  subject: noUrls, predicate: "governance://entry_type", object: "governance://constraint"
});
await general.addTriple({
  subject: noUrls, predicate: "governance://constraint_kind", object: "content"
});
await general.addTriple({
  subject: noUrls, predicate: "governance://content_applies_to_predicates", object: "msg://body"
});
await general.addTriple({
  subject: noUrls, predicate: "governance://content_allow_urls", object: "false"
});
await general.addTriple({
  subject: general.did, predicate: "governance://has_constraint", object: noUrls
});
```

### 8.4 Capability with a Shape Caveat

```javascript
// "This contractor can only write Messages (per MessageShape), with body
//  predicate only, no more than 50 per hour, for the next 30 days."
const contractorCap = await creator.signCapability({
  parentCapability: rootCap.id,
  invoker: "did:key:z6MkContractor...",
  actions: ["createLink"],
  resource: general.did,
  caveats: [
    { type: "expiry",    value: { expiresAt: "2026-06-22T00:00:00Z" }},
    { type: "shape",     value: { shapeIri: "msg://MessageShape" }},
    { type: "predicate", value: { allowed: ["msg://body"] }},
    { type: "rateLimit", value: { maxPerWindow: 50, windowSeconds: 3600 }}
  ]
});
```

---

## 9. Security Considerations

### 9.1 Authoritative Timestamps

Temporal enforcement depends on timestamps from the sync protocol's authoritative source ([[CONTEXT-SYNC]] §12.5), NOT triple-author self-reported timestamps.

### 9.2 Content Resolution Availability

If content resolution is unavailable, REJECT the triple (fail-closed).

### 9.3 Regex Denial of Service

Implementations MUST timeout regex evaluation (RECOMMENDED: 10ms per pattern). A pattern that does not complete within the limit MUST be treated as a REJECT.

### 9.4 SPARQL Query Cost (content caveat)

`content` caveats run a SPARQL ASK on every matching triple. Implementations MUST cap query cost (CPU and memory) and MUST treat exceeded caps as REJECT.

### 9.5 Credential Revocation Freshness

Credential status checks SHOULD be performed on every validation. Caching is permitted for short periods but MUST invalidate on new revocation indications.

### 9.6 Shape Caveat Resolution

If the shape referenced by a `shape` caveat is not resolvable (e.g., not registered in the writing graph or any reachable parent), the caveat MUST evaluate to REJECT (fail-closed).

---

## 10. Privacy Considerations

### 10.1 Credential Exposure

Credential requirements reveal what identity attestations agents hold. Agents SHOULD use the minimum-disclosure credential variant when one is available (selective disclosure, zero-knowledge proofs per [[VC-DATA-MODEL-2.0]]).

### 10.2 Activity Tracking

Temporal enforcement requires the engine to scan recent triples by a specific author. This implies the engine retains per-author indices that could be queried for activity profiling.

### 10.3 Content Inspection

`content` caveats and content constraints inspect triple objects. In encrypted spaces, this requires the validating peer to have the cleartext content — which is already a prerequisite for accepting the triple. There is no additional disclosure.

---

## 11. Predicate Reference Table

| Predicate | Target Type | Description |
|---|---|---|
| `governance://requires_credential_type` | String literal | VC type name |
| `governance://credential_issuer_pattern` | String literal | Issuer DID glob |
| `governance://credential_min_age_hours` | Integer | Minimum credential age |
| `governance://has_credential` | URI | Links agent DID to held VC |
| `governance://temporal_min_interval_seconds` | Integer | Min interval between matching writes |
| `governance://temporal_max_count_per_window` | Integer | Max matching writes per window |
| `governance://temporal_window_seconds` | Integer | Window duration (default 60) |
| `governance://temporal_applies_to_predicates` | Comma-separated URIs | Scope of temporal constraint |
| `governance://content_applies_to_predicates` | Comma-separated URIs | Scope of content constraint |
| `governance://content_blocked_patterns` | Pipe-separated regex | Blocked patterns |
| `governance://content_allow_urls` | Boolean string | Whether URLs are permitted |
| `governance://content_allowed_domains` | Comma-separated domains | URL whitelist |
| `governance://content_allow_media_types` | Comma-separated MIME globs | Permitted media types |
| `governance://content_max_length` | Integer | Max character count |

---

## 12. References

### 12.1 Normative References

<dl>
<dt>[RFC2119]</dt>
<dd>Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.</dd>

<dt>[RFC8174]</dt>
<dd>Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.</dd>

<dt>[VC-DATA-MODEL-2.0]</dt>
<dd>Sporny, M., et al., "Verifiable Credentials Data Model v2.0", W3C Recommendation. https://www.w3.org/TR/vc-data-model-2.0/</dd>

<dt>[CAPABILITY-FRAMEWORK]</dt>
<dd><a href="./03_graph-capability-framework.md">Graph Capability Framework</a>.</dd>

<dt>[SHAPE-VALIDATION]</dt>
<dd><a href="./06_dynamic-graph-shape-validation.md">Dynamic Graph Shape Validation</a>.</dd>
</dl>

### 12.2 Informative References

<dl>
<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="./02_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>.</dd>

<dt>[CONTEXT-SYNC]</dt>
<dd><a href="./04_context-sync-protocol.md">Graph Synchronisation Protocol</a>.</dd>

<dt>[SHACL]</dt>
<dd>Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, July 2017. https://www.w3.org/TR/shacl/</dd>
</dl>
