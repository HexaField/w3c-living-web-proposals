# Governance Constraint Vocabulary

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a normative vocabulary of **constraint kinds** and **caveat types** that plug into the [[CAPABILITY-FRAMEWORK]]. Where the framework defines the capability-chain mechanism, enforcement modes, scope resolution, and the meta-structure of caveats (with `expiry` as the only built-in caveat type), this specification defines *what other constraints and caveats exist* and *how they are evaluated*. It covers:

- **Constraint kinds** that plug in via `ConstraintKindHandler`: **temporal** (rate limits and intervals), **content** (length, blocked patterns, URL/domain/media-type policy), and **credential** (Verifiable-Credential requirements per [[VC-DATA-MODEL-2.0]]).
- **Caveat types** that plug in via `CaveatHandler`: **predicate**, **property**, **subject**, **object**, **rateLimit**, **cardinality**, **authorOnly**, **shape**, **content**, and **credential**.

Each kind and type defines its predicates / value shape, its plug-in handler, and its evaluation algorithm. The vocabulary is open-ended: applications MAY define additional kinds and types via the plug-in mechanism in [[CAPABILITY-FRAMEWORK]] §9.3.

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
7. [Caveat Vocabulary](#7-caveat-vocabulary)
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

A conforming **governance engine** that supports this vocabulary MUST register handlers for the constraint kinds `"credential"`, `"temporal"`, and `"content"` per the framework's plug-in mechanism ([[CAPABILITY-FRAMEWORK]] §9.3), AND MUST register `CaveatHandler` plug-ins for each caveat type defined in [§7](#7-caveat-vocabulary).

A conforming **application** MAY define additional constraint kinds and caveat types; the engine handles them via the same plug-in mechanism.

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

**Input:** A triple, the author's DID, the scope chain, the authoritative timestamp (per [[CONTEXT-SYNC]] §14.5).

**Algorithm:**

1. **Collect temporal constraints** with `constraint_kind = "temporal"`. If none, return ACCEPT.

2. **Timestamp plausibility.** Apply the checks in [§5.3](#53-timestamp-plausibility) to the diff carrying the triple. If any check fails, REJECT (the timestamp is not admissible as the basis for temporal evaluation).

3. **For each constraint:**
   1. **Predicate match.** If `temporal_applies_to_predicates` is set and the triple's predicate is not listed, skip.
   2. **Query recent triples** by the same author within scope.
   3. **Interval check.** If `temporal_min_interval_seconds` is set, find the most recent matching triple and compute elapsed time. If too short, REJECT.
   4. **Window count check.** If `temporal_max_count_per_window` is set, count matching triples in the sliding window. If at or above max, REJECT.

4. All passed → ACCEPT.

### 5.3 Timestamp Plausibility

Temporal constraints are evaluated against the timestamp carried by the diff that introduces a triple ([[CONTEXT-SYNC]] §5.1, §14.5). That timestamp is **self-reported by the committing agent**. In a peer-to-peer system with no trusted clock, a malicious committer can forge a diff timestamp — backdating to evade a `temporal_min_interval_seconds` gate, or future-dating to slide out of a `temporal_max_count_per_window` window. Before a receiving peer accepts a diff's `timestamp` as authoritative for temporal-constraint evaluation, it MUST apply all of the following checks. Any failure means the timestamp is inadmissible and temporal evaluation for that diff MUST fail (REJECT); this is a fail-closed check consistent with [[CONTEXT-SYNC]] §9.3.

Let `t = diff.timestamp` (RFC 3339), `deps = diff.dependencies` (the diff's causal parents — the DAG heads it names per [[CONTEXT-SYNC]] §5.2.1), and `now` = the receiving peer's local wall-clock time.

1. **Future bound.** REJECT if `t` is more than **300 seconds (5 minutes)** ahead of `now` — i.e. if `t − now > 300s`. This bounds clock skew between honest peers while denying a committer the ability to future-date a diff far enough to escape a sliding window. The bound is a fixed protocol constant, not configurable, so that every honest peer computes the same admissibility verdict for a given diff. (No lower bound on `t − now` is imposed here; a diff may legitimately arrive long after it was committed. Backdating is constrained instead by causal monotonicity below.)

2. **Causal monotonicity.** REJECT if `t` is earlier than the maximum timestamp among the diff's declared causal parents:

   ```
   REJECT if  t < max( parent.timestamp  for parent in resolve(deps) )
   ```

   A diff MUST NOT claim a timestamp earlier than any diff it declares as a dependency. A diff that purports to predate its own causal parents is rejected. Because `dependencies` is bound into `revision` and thus into the signed `commitId` ([[CONTEXT-SYNC]] §5.2.2), a committer cannot rewrite the parent set to escape this check without invalidating the signature. This yields a **tamper-evident partial order over the dependency DAG even in the absence of a trusted clock**: timestamps must increase monotonically along every causal path. (Parents named in `deps` that are not yet present locally are resolved per [[CONTEXT-SYNC]] §9.2.1 step 5 / [[DEFAULT-SYNC-MODULE]] §8.2 before this check completes; a diff whose parents cannot be resolved is deferred, not accepted.)

3. **Per-author monotonicity within a chain.** REJECT if `t` is earlier than the timestamp of the most recent prior diff by the **same author** on any causal path leading to this diff. Successive diffs from a single author along a causal chain MUST have non-decreasing timestamps. This is strictly stronger than causal monotonicity along same-author edges: it prevents an author from interleaving a backdated diff between two of their own causally-ordered diffs even where the immediate parent belongs to a different author. Implementations evaluate it by walking back through `deps` (transitively, bounded by locally-retained history) and taking the maximum timestamp among diffs whose `author` equals `diff.author`.

**Necessary but not sufficient.** These checks constrain *cross-diff* ordering; they do not pin an absolute time. A committer can still lie **within the future-bound skew window** (up to 300 s ahead of an honest receiver) and can choose any timestamp that respects the monotonicity constraints relative to the diffs it declares as parents. Temporal constraints are therefore **best-effort under adversarial conditions**: a determined committer retains a bounded degree of freedom to shade a single timestamp. What the causal-ordering checks *do* guarantee is that **backdating across the dependency graph is detectable** — any attempt to insert a diff whose timestamp violates the partial order induced by `dependencies` is rejected by every honest peer, deterministically, and (per check 2) cannot be concealed by rewriting the parent set without breaking the diff's signature. Communities requiring hard temporal bounds under adversarial membership MUST additionally coordinate at the sync layer (cf. the eventual-consistency caveats on `rateLimit`/`cardinality` in [§7.5](#75-ratelimit)–[§7.6](#76-cardinality)).

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

Constraint-bound content checks (above) restrict the *content* of triple objects across the graph the constraint is bound to. For per-delegation conditions (e.g., "this contractor's writes must additionally satisfy this SPARQL ASK"), see the `content` caveat in [§7.9](#79-content).

---

## 7. Caveat Vocabulary

This section defines the standard caveat types — caveats that attach to specific ZCAP delegations and narrow the conditions under which the capability may be exercised. Each is registered with the governance engine as a `CaveatHandler` per [[CAPABILITY-FRAMEWORK]] §9.3. Caveat composition with the framework's immutable-attenuation rule is unchanged: a child delegation MAY add caveats from this vocabulary, MUST NOT modify or remove parent caveats.

### 7.1 Caveat Applicability to Non-Triple Operations

Each caveat below carries an applicability flag (`appliesToNonTripleOps`) used by the engine when authorising non-triple operations such as `mountContext` ([[CAPABILITY-FRAMEWORK]] §7.1).

| Caveat type | Applies to non-triple ops? | Rationale |
|---|---|---|
| `predicate` | No | Requires the triple's predicate. |
| `property` | No | Requires the triple's predicate. |
| `subject` | No | Requires the triple's subject. |
| `object` | No | Requires the triple's object. |
| `shape` | No | Requires the triple's subject + sibling triples. |
| `content` | No | Requires the triple's object content. |
| `rateLimit` | Yes | Context-only (author, action, window). |
| `cardinality` | Yes | Context-only (delegation usage counter). |
| `authorOnly` | Yes | Context-only (compares authors). |
| `credential` | Yes | Context-only (author's credentials). |

### 7.2 `predicate`

```json
{ "type": "predicate", "value": { "allowed": ["<uri>", ...], "denied": ["<uri>", ...] } }
```

Both `allowed` and `denied` are OPTIONAL arrays. Composition is **deny-wins-within-caveat**:

1. If `denied` is present and contains the triple's predicate, REJECT.
2. Else if `allowed` is present and non-empty and does NOT contain the triple's predicate, REJECT.
3. Else ACCEPT.

### 7.3 `property`

```json
{ "type": "property", "value": { "allowed": ["<uri>", ...], "denied": ["<uri>", ...] } }
```

Identical evaluation to `predicate` but applied at the property-path level for use with [[SHAPE-VALIDATION]] shape definitions. When combined with `shape`, narrows authority to specific properties of the shape: `shape` alone authorises any property of the shape; `shape` + `property` authorises only the listed properties of the shape.

### 7.4 `subject` and `object`

```json
{ "type": "subject", "value": { "pattern": "<glob>" } }
{ "type": "object",  "value": { "pattern": "<glob>" } }
```

Glob match against the triple's subject IRI / object lexical form. `*` matches any sequence; all other characters match literally. REJECT if the pattern does not match.

### 7.5 `rateLimit`

```json
{ "type": "rateLimit", "value": { "maxPerWindow": <int>, "windowSeconds": <int> } }
```

Sliding-window rate limit keyed by `(zcap.id, author)`. The engine counts uses of the capability by the author within the trailing window and REJECTs when `maxPerWindow` is exceeded.

**Eventual-consistency caveat.** Per [[CAPABILITY-FRAMEWORK]] §13.11, `rateLimit` is best-effort under concurrent writes from multiple peers — each peer evaluates against its local-state counter only. Communities that require strict bounds MUST pair this with a coordination mechanism at the sync layer.

### 7.6 `cardinality`

```json
{ "type": "cardinality", "value": { "max": <int> } }
```

Lifetime usage cap, keyed by `(zcap.id, author)`. REJECT after `max` uses.

**Eventual-consistency caveat.** Same as `rateLimit` (§7.5): under concurrent writes, the engine can only enforce against local-state counters; convergent over-use is possible and MUST be coordinated at the sync layer if strict bounds are needed.

### 7.7 `authorOnly`

```json
{ "type": "authorOnly", "value": {} }
```

The operation MUST be authored by the same agent who created the triple's *subject* (the agent whose authorship is recorded on the subject's first introducing triple). REJECT otherwise. Use case: "only the author of a message may edit it." For operations against a subject that has no prior author of record, the caveat MUST ACCEPT (there is no other-author to compare against).

### 7.8 `shape`

```json
{ "type": "shape", "value": { "shapeIri": "<URI of a registered shape>" } }
```

The authorised triple MUST conform to a SHACL shape registered in the writing graph or a graph reachable via the participation chain, per [[SHAPE-VALIDATION]]. (Shape resolution can walk participation links for content-discovery purposes; this is a content-layer concern handled by the shape validation layer, distinct from the per-graph governance validation in [[CAPABILITY-FRAMEWORK]] §6.)

**Evaluation algorithm.** For each triple under the caveat's authority:

1. Resolve the shape via [[SHAPE-VALIDATION]] §7 (cross-graph resolution).
2. Treat the triple's subject as the candidate node.
3. Evaluate the shape's property definitions against the candidate node and all sibling triples in the same `GraphDiff`.
4. Return ACCEPT iff the candidate conforms; REJECT otherwise.

### 7.9 `content`

```json
{ "type": "content", "value": { "sparql": "ASK { ... }" } }
```

A SPARQL `ASK` query evaluated against an in-memory model containing the triple and its reifier. The substring `$this` in the query is substituted with the triple's subject IRI. REJECT unless the query returns `true`. Per [§9.4](#94-sparql-query-cost-content-caveat), implementations MUST cap query cost and treat exceeded caps as REJECT.

### 7.10 `credential`

```json
{ "type": "credential", "value": { "requires": [{ "type": "<vc-type>", "issuerPattern": "<glob>"? }, ...] } }
```

The operation's author MUST present a Verifiable Credential matching every entry in `requires`. The credentials are supplied via the `presentations` field of the sync-protocol `CapabilityProofInput` ([[CONTEXT-SYNC]] §5.3) when delivered across the network, or via the author's `governance://has_credential` triples when evaluated against local state. Verification follows §4.2 of this spec, applied to each required type.

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

Temporal enforcement depends on the diff timestamp designated authoritative by the sync protocol ([[CONTEXT-SYNC]] §14.5). That timestamp is self-reported by the committing agent; before relying on it, a receiving peer MUST apply the plausibility checks in [§5.3](#53-timestamp-plausibility) (future bound, causal monotonicity over `dependencies`, and per-author monotonicity). Those checks make backdating across the dependency graph detectable but cannot eliminate a bounded within-skew lie; temporal constraints are best-effort under adversarial conditions accordingly.

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
<dd><a href="./04_graph-capability-framework.md">Graph Capability Framework</a>.</dd>

<dt>[SHAPE-VALIDATION]</dt>
<dd><a href="./07_dynamic-graph-shape-validation.md">Dynamic Graph Shape Validation</a>.</dd>
</dl>

### 12.2 Informative References

<dl>
<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="./02_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>.</dd>

<dt>[CONTEXT-SYNC]</dt>
<dd><a href="./05_context-sync-protocol.md">Graph Synchronisation Protocol</a>.</dd>

<dt>[DEFAULT-SYNC-MODULE]</dt>
<dd><a href="./09_default-sync-module.md">Default Sync Module</a>.</dd>

<dt>[SHACL]</dt>
<dd>Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, July 2017. https://www.w3.org/TR/shacl/</dd>
</dl>
