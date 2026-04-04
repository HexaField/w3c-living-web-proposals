# Graph Governance: Constraint Enforcement for Shared Linked Data Graphs

**W3C Draft Community Group Report**

**Latest published version:** This document

**Editors:**

- [Editor Name], [Affiliation]

**Abstract:**

This specification defines a framework for expressing and enforcing governance rules over shared linked data graphs. Governance rules are themselves graph data — triples with well-known predicates that constrain who can add triples, how often, with what content, and under what identity requirements. Enforcement happens at the sync protocol layer, making governance consensus-enforced across all peers. This specification builds on W3C ZCAP-LD [[ZCAP-LD]] for capability delegation, W3C Verifiable Credentials [[VC-DATA-MODEL-2.0]] for identity attestation, and W3C SHACL [[SHACL]] for schema validation.

**Status of This Document:**

This is a draft community group report. It has no official standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Data Model](#4-data-model)
5. [Scope Resolution Algorithm](#5-scope-resolution-algorithm)
6. [ZCAP Verification Algorithm](#6-zcap-verification-algorithm)
7. [Temporal Verification Algorithm](#7-temporal-verification-algorithm)
8. [Content Verification Algorithm](#8-content-verification-algorithm)
9. [Governance Engine API](#9-governance-engine-api)
10. [Integration with Sync Protocol](#10-integration-with-sync-protocol)
11. [Rule Evolution](#11-rule-evolution)
12. [Security Considerations](#12-security-considerations)
13. [Privacy Considerations](#13-privacy-considerations)
14. [Examples](#14-examples)
15. [Full Predicate Reference Table](#15-full-predicate-reference-table)
16. [References](#16-references)

---

## 1. Introduction

### 1.1 Motivation

Shared linked data graphs — graphs where multiple autonomous agents contribute triples via a peer-to-peer sync protocol — face a fundamental governance problem: without enforceable rules, any agent with sync access can add any triple. There is no inherent mechanism to restrict who may contribute, what content is acceptable, how frequently contributions may occur, or what identity attestations are required.

Application-layer enforcement is insufficient. In a decentralised architecture, applications (user interfaces, scripts, autonomous agents) are swappable by design. An application that refuses to display certain triples or blocks certain actions provides no guarantee — another application can bypass those restrictions entirely. The application layer is not a sovereignty boundary.

The sync protocol is the sovereignty boundary. It is the one component that all peers in a shared graph MUST agree on and execute. Triples that fail sync-layer validation are rejected before entering the network. No peer accepts them, regardless of which application submitted them. This makes the sync protocol the correct enforcement point for governance rules.

This specification defines a governance framework where:

- **Rules are data, not code.** Governance rules are expressed as triples with well-known predicates in the `governance://` namespace. They are stored in the same graph they govern and propagate via the same sync protocol as content.
- **Enforcement is ontology-agnostic.** The governance engine does not understand what entities represent (messages, documents, tasks, social posts). It understands constraint predicates and checks them generically against incoming triples.
- **Scope inheritance** allows constraints to cascade down entity hierarchies. A constraint on a parent entity applies to all descendants unless overridden by a more-specific constraint.
- **Consensus enforcement** means that every peer evaluates the same rules against the same data and arrives at the same validation result. No peer can selectively ignore governance.

### 1.2 Design Principles

1. **Ontology-agnostic:** Constraints reference predicates and entity addresses, never application-specific entity names or types. The governance engine operates on the graph's structural properties.
2. **Rules as data:** Governance rules are triples. Adding, modifying, or removing rules is done by adding, modifying, or removing triples — using the same sync protocol as content. No code deployment, software update, or migration is required.
3. **Scope inheritance:** Constraints attached to an entity apply to that entity and all its descendants in the graph hierarchy. This allows broad policies at the root and targeted overrides deeper in the tree.
4. **Consensus-enforced:** The sync protocol's validation callback evaluates constraints. All peers run the same logic on the same data, producing deterministic accept/reject decisions.
5. **Fail-closed:** When in doubt — unresolvable content, unavailable credential services, ambiguous constraint state — the governance engine SHOULD reject rather than accept.

### 1.3 Use Cases

**Community moderation.** A shared graph serving as a community forum can enforce role-based permissions (who may post), rate limits (slow mode), content policies (no external URLs, maximum message length), and identity requirements (proof of humanity). These rules are defined by community administrators as graph data and enforced identically by all peers.

**Collaborative workspaces.** A shared graph used for collaborative document editing can restrict which agents may modify which sections, require specific credentials for access, and rate-limit bulk operations to prevent accidental flooding.

**Peer-to-peer social networks.** Shared graphs backing social applications can prevent spam through temporal constraints, restrict content types through content policies, and require identity attestations through credential requirements — all without a central server making trust decisions.

**Multi-agent systems.** Shared graphs where both human and AI agents participate can enforce governance over AI agent behaviour — rate-limiting automated contributions, requiring capability tokens for specific actions, and restricting content patterns.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]].

A conforming **governance engine** is a software component that implements the algorithms in Sections 5 through 8 and exposes the API defined in Section 9.

A conforming **sync protocol** is a peer-to-peer graph synchronisation protocol that calls a conforming governance engine's `validate()` method before accepting any incoming triple, as specified in Section 10.

A conforming **application** is a user-facing or programmatic interface that MAY call the governance engine's query methods to determine allowed actions, but MUST NOT be relied upon as an enforcement point.

---

## 3. Terminology

<dl>

<dt>Semantic Triple</dt>
<dd>A directed, labelled relationship consisting of a source (subject), predicate (label), and target (object). The fundamental unit of data in a linked data graph.</dd>

<dt>Constraint</dt>
<dd>A set of triples with well-known <code>governance://</code> predicates that defines a governance rule. Constraints are classified by kind: capability, temporal, content, or credential.</dd>

<dt>Constraint Binding</dt>
<dd>A triple linking a constraint to the entity it governs: <code>&lt;entity&gt; -[governance://has_constraint]→ &lt;constraint&gt;</code>.</dd>

<dt>Scope Chain</dt>
<dd>The ordered list of ancestors of a triple's source, obtained by walking <code>has_child</code> relationships in reverse from the source up to the graph root. Constraints attached at any level in the scope chain apply to the triple.</dd>

<dt>Root Authority</dt>
<dd>The agent who created the shared graph. The root authority holds implicit capability over all predicates and all scopes. The root authority's decentralised identifier is stored in the graph metadata.</dd>

<dt>Capability</dt>
<dd>An authorization token, conforming to [[ZCAP-LD]], that grants a specific agent permission to create triples with specific predicates within a specific scope. Capabilities are delegatable, revocable, and cryptographically verifiable.</dd>

<dt>Credential Requirement</dt>
<dd>A constraint that requires triple authors to hold a specific type of Verifiable Credential [[VC-DATA-MODEL-2.0]] before their triples are accepted in a given scope.</dd>

<dt>Temporal Constraint</dt>
<dd>A constraint that limits the rate at which an agent can create matching triples within a scope — expressed as minimum intervals between triples and/or maximum counts within sliding time windows.</dd>

<dt>Content Constraint</dt>
<dd>A constraint that validates the content of a triple's target — checking text length, blocked patterns, URL policies, and media type restrictions.</dd>

<dt>Governance Engine</dt>
<dd>A software component that evaluates incoming triples against all constraints in scope and returns a validation result. Conforming implementations MUST implement the algorithms in Sections 5–8.</dd>

<dt>Validation Result</dt>
<dd>The output of a governance engine evaluation: either acceptance or rejection, with the rejecting constraint identified.</dd>

<dt>Graph Root</dt>
<dd>The top-level entity in a shared graph's entity hierarchy. Constraints attached to the graph root apply to all triples in the graph.</dd>

<dt>Entity Hierarchy</dt>
<dd>The tree structure of entities in a graph, defined by <code>has_child</code> predicates. An entity's children are all entities for which a triple <code>&lt;parent&gt; -[has_child]→ &lt;child&gt;</code> exists.</dd>

</dl>

---

## 4. Data Model

This section defines the complete set of `governance://` predicates used to express governance rules as graph data. All predicates use string literal targets unless otherwise noted.

### 4.1 Constraint Base Type

Every constraint instance MUST have the following triples:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ <kind>
```

Where `<kind>` is one of the following string literals:

| Kind | Description |
|------|-------------|
| `"capability"` | Requires authorization tokens (ZCAPs) for triple creation |
| `"temporal"` | Rate-limits triple creation by time intervals or counts |
| `"content"` | Validates the content of triple targets |
| `"credential"` | Requires Verifiable Credentials from triple authors |

The optional predicate `governance://constraint_scope` specifies the entity this constraint applies to. If absent, the scope is inferred as the entity to which the constraint is bound (the source of the `governance://has_constraint` triple).

### 4.2 Constraint Binding

A constraint is attached to the entity it governs via:

```
<entity> -[governance://has_constraint]→ <constraint-id>
```

This triple is called a **constraint binding**. An entity MAY have zero or more constraint bindings. Multiple constraints of different kinds MAY be bound to the same entity.

**Scope inheritance.** Constraints inherit down the entity hierarchy. A constraint bound to an entity applies to that entity and all its descendants (determined by walking `has_child` predicates). For example:

```
Graph Root
  └── governance://has_constraint → [credential requirement: proof of humanity]
  └── Entity A
        └── governance://has_constraint → [temporal: 30s cooldown]
        └── Entity B
              └── governance://has_constraint → [content: no external URLs]
```

In this hierarchy:
- Triples under **Entity B** are subject to all three constraints: the credential requirement (inherited from root), the temporal constraint (inherited from Entity A), and the content constraint (directly bound).
- Triples under **Entity A** (but not under B) are subject to the credential requirement and the temporal constraint.
- Triples at the **Graph Root** are subject only to the credential requirement.

**Override semantics.** When a constraint of the same `constraint_kind` exists at multiple levels in the scope chain, the most-specific constraint (closest to the triple's source in the hierarchy) replaces — does not supplement — the less-specific constraint of the same kind. Constraints of different kinds always accumulate.

### 4.3 Capability Constraints (ZCAP-based)

A capability constraint requires triple authors to hold valid Authorization Capabilities [[ZCAP-LD]] before their triples are accepted.

#### 4.3.1 Constraint Definition

A capability constraint instance MUST include:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "capability"
<constraint-id> -[governance://capability_enforcement]→ <enforcement-level>
```

Where `<enforcement-level>` is one of:

| Value | Meaning |
|-------|---------|
| `"required"` | All triples under this scope MUST be authorized by a valid ZCAP |
| `"optional"` | ZCAPs are checked only if present; triples without ZCAPs are accepted. Used for grant-additional-permissions patterns. |

The optional predicate:

```
<constraint-id> -[governance://capability_predicates]→ <comma-separated predicate URIs>
```

Restricts which predicates require capability verification. If absent or empty, all predicates under the scope require verification.

#### 4.3.2 ZCAP Document Structure

Authorization capabilities are stored as JSON-LD documents conforming to [[ZCAP-LD]], with the following structure:

```json
{
  "@context": [
    "https://w3id.org/zcap/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "urn:uuid:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "invoker": "did:key:z6MkAgent...",
  "parentCapability": "urn:uuid:parent-cap-id",
  "capability": {
    "predicates": [
      "app://body",
      "app://reaction"
    ],
    "scope": {
      "within": "<entity-address>",
      "graph": "<shared-graph-identifier>"
    }
  },
  "expires": "2026-07-01T00:00:00Z",
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-04-03T00:00:00Z",
    "verificationMethod": "did:key:z6MkIssuer...#key-1",
    "proofPurpose": "capabilityDelegation",
    "proofValue": "z..."
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | URN UUID | REQUIRED | Unique identifier for this capability |
| `invoker` | DID [[DID-CORE]] | REQUIRED | The agent authorized to exercise this capability |
| `parentCapability` | URN UUID or `null` | REQUIRED | Identifier of the parent capability in the delegation chain. `null` for capabilities issued directly by the root authority. |
| `capability.predicates` | Array of URI strings | REQUIRED | Predicate URIs this capability authorizes. An empty array covers no predicates. |
| `capability.scope.within` | URI or `null` | OPTIONAL | Entity address defining the scope subtree. `null` means the entire shared graph. |
| `capability.scope.graph` | URI | REQUIRED | Identifier of the shared graph this capability applies to |
| `expires` | [[RFC3339]] timestamp or `null` | OPTIONAL | Expiration time. `null` means no expiry. |
| `proof` | Object | REQUIRED | Cryptographic proof from the issuer, conforming to [[VC-DATA-MODEL-2.0]] proof format |

#### 4.3.3 Delegation

Capabilities support delegation chains. An agent holding a valid capability MAY delegate a subset of that capability to another agent by issuing a new ZCAP where:

- `parentCapability` references the delegator's capability `id`
- `capability.predicates` is a subset of the parent's predicates (attenuation)
- `capability.scope.within` is equal to or a descendant of the parent's scope
- `proof` is signed by the delegator (the `invoker` of the parent capability)

Delegation chains MUST NOT exceed a depth of 10. Implementations MUST reject capabilities with deeper chains.

#### 4.3.4 Capability Storage

Capabilities are stored as content-addressed expressions in the graph and linked to agents via:

```
<agent-did> -[governance://has_zcap]→ <capability-expression-address>
```

#### 4.3.5 Revocation

Any agent who issued or delegated a capability MAY revoke it by adding:

```
<revoking-agent-did> -[governance://revokes_capability]→ <zcap-id>
```

Where `<zcap-id>` is the `id` field of the capability being revoked. A revocation is valid if the revoking agent is:

- The `invoker` of the revoked capability's `parentCapability`, OR
- The root authority of the shared graph

Revocation of a capability invalidates the entire delegation chain below it. If capability C was delegated to produce capability D, revoking C also invalidates D.

Revocation triples propagate via the sync protocol like any other triple. There is an inherent propagation delay — see [Section 12](#12-security-considerations).

### 4.4 Credential Requirements

A credential constraint requires triple authors to hold specific Verifiable Credentials [[VC-DATA-MODEL-2.0]].

Required triples on the constraint instance:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "credential"
<constraint-id> -[governance://requires_credential_type]→ <type-name>
```

Where `<type-name>` is the VC `type` field value to match (e.g., `"ProofOfHumanity"`, `"CommunityMembership"`).

Optional triples:

```
<constraint-id> -[governance://credential_issuer_pattern]→ <did-pattern>
```

A glob-style pattern for acceptable issuer DIDs (e.g., `"did:web:greencheck.io"`, `"did:key:*"`). If absent, any issuer is accepted.

```
<constraint-id> -[governance://credential_min_age_hours]→ <integer>
```

Minimum age of the credential in hours since its `issuanceDate`. Prevents freshly-minted credentials from satisfying the requirement. Default: `0` (no age check).

**Credential storage convention.** Agents store their Verifiable Credentials as content-addressed expressions and reference them via:

```
<agent-did> -[governance://has_credential]→ <credential-expression-address>
```

The governance engine resolves the expression to read the VC document and performs the following checks:

1. The VC's `type` array contains `<type-name>`
2. The VC's `issuer` matches `<did-pattern>` (if specified)
3. The VC's `issuanceDate` is at least `<credential_min_age_hours>` hours ago
4. The VC's `credentialSubject` matches the triple author's DID
5. The VC's `proof` is cryptographically valid
6. The VC has not expired (if `expirationDate` is present)

### 4.5 Temporal Constraints

A temporal constraint limits the rate at which an agent can create matching triples within a scope.

Required triples on the constraint instance:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "temporal"
```

At least one of the following MUST be present; otherwise the constraint is a no-op and SHOULD be ignored:

```
<constraint-id> -[governance://temporal_min_interval_seconds]→ <integer>
```

Minimum seconds between consecutive matching triples by the same author. If the elapsed time since the author's last matching triple is less than this value, the incoming triple is rejected.

```
<constraint-id> -[governance://temporal_max_count_per_window]→ <integer>
```

Maximum number of matching triples by the same author within a sliding time window. If the count equals or exceeds this value, the incoming triple is rejected.

```
<constraint-id> -[governance://temporal_window_seconds]→ <integer>
```

Duration of the sliding time window in seconds. Default: `60`. Used only when `temporal_max_count_per_window` is specified.

```
<constraint-id> -[governance://temporal_applies_to_predicates]→ <comma-separated URIs>
```

Restricts this temporal constraint to triples with the listed predicates. If absent or empty, the constraint applies to all predicates within scope.

### 4.6 Content Constraints

A content constraint validates the textual or media content of triple targets.

Required triples on the constraint instance:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "content"
```

Optional triples:

```
<constraint-id> -[governance://content_applies_to_predicates]→ <comma-separated URIs>
```

Restricts this content constraint to triples with the listed predicates. If absent or empty, the constraint applies to all predicates within scope.

```
<constraint-id> -[governance://content_blocked_patterns]→ <pipe-separated regex patterns>
```

Case-insensitive regular expression patterns. If any pattern matches the resolved text content of the triple's target, the triple is rejected. Patterns are separated by the pipe character (`|`). Implementations MUST support ECMAScript regular expression syntax [[ECMA-262]].

```
<constraint-id> -[governance://content_allow_urls]→ <boolean>
```

Whether URLs are permitted in text content. Values: `"true"` or `"false"`. Default: `"true"`.

```
<constraint-id> -[governance://content_allowed_domains]→ <comma-separated domains>
```

If URLs are allowed, restrict permitted URLs to those whose domain matches one of the listed domains. If absent or empty, all domains are permitted. This predicate has no effect if `content_allow_urls` is `"false"`.

```
<constraint-id> -[governance://content_allow_media_types]→ <comma-separated MIME patterns>
```

Glob-style MIME type patterns for acceptable media attachments (e.g., `"image/*"`, `"text/plain"`). If absent or empty, all media types are permitted. If specified, only targets whose media type matches at least one pattern are accepted.

```
<constraint-id> -[governance://content_max_length]→ <integer>
```

Maximum character count of resolved text content. If the triple's target resolves to text exceeding this length, the triple is rejected.

**Target resolution.** If the triple's target is a literal string, it is used directly. If it is a content-addressed expression, the governance engine MUST resolve it to obtain text content and/or media type before evaluation.

### 4.7 Default Capability

A **default capability** defines the authorization tokens that are automatically issued to agents joining the shared graph. It is not a constraint but a template stored in the graph.

```
<default-cap-id> -[governance://entry_type]→ governance://default_capability
<default-cap-id> -[governance://default_capability_predicates]→ <comma-separated URIs>
<default-cap-id> -[governance://default_capability_scope]→ <scope-entity-address>
```

| Predicate | Description |
|-----------|-------------|
| `governance://default_capability_predicates` | Predicate URIs that new agents receive capability for |
| `governance://default_capability_scope` | Entity address defining the scope of the auto-issued capability. Typically the graph root. |

When an agent joins a shared graph, the graph creator (or an agent with delegation authority) SHOULD issue a ZCAP matching each `DefaultCapability` template. The governance engine does not perform issuance — it reads these templates so that join-flow implementations know what capabilities to issue.

### 4.8 Revocation List

Revocations are stored as triples in the graph:

```
<revoking-agent-did> -[governance://revokes_capability]→ <zcap-id>
```

These triples propagate via the sync protocol like any other triple. The set of all `governance://revokes_capability` triples in a shared graph constitutes the **revocation list**.

Conforming governance engines MUST check the revocation list during every capability verification (see [Section 6](#6-zcap-verification-algorithm)). Specifically:

1. Before accepting a capability, the engine MUST query whether any `governance://revokes_capability` triple targets that capability's `id`.
2. If a valid revocation exists (issued by an authorized revoker — see [Section 4.3.5](#435-revocation)), the capability MUST be treated as invalid.
3. This check MUST be performed for every capability in the delegation chain, not only the leaf capability.

Implementations MUST NOT cache revocation status indefinitely. The revocation list is mutable graph data; caching strategies MUST account for newly-arriving revocation triples.

---

## 5. Scope Resolution Algorithm

This section defines how the governance engine determines which constraints apply to an incoming triple.

### 5.1 Ancestry Resolution

Given an incoming triple `(source, predicate, target)` authored by `agent`:

1. Let *current* be the triple's `source`.
2. Let *ancestry* be an ordered list initialized with `[current]`.
3. Let *visited* be a set initialized with `{current}`.
4. LOOP:
   1. Query the graph for all triples where `predicate` is `has_child` and `target` is *current*. (That is: find all entities that declare *current* as a child.)
   2. If no results are found, exit the loop. (*current* is either the graph root or an orphan.)
   3. Let *parent* be the `source` of the first matching triple.
   4. If *visited* contains *parent*, exit the loop. (Cycle detected.)
   5. Add *parent* to *visited*.
   6. Append *parent* to *ancestry*.
   7. Set *current* to *parent*.
5. Return *ancestry*.

Implementations MUST enforce a maximum ancestry depth of 100. If the ancestry exceeds 100 levels, the implementation MUST truncate at 100 and log a warning.

### 5.2 Constraint Collection

Given *ancestry* from Step 5.1:

1. Let *constraints* be an empty list.
2. For each entity in *ancestry*, at index *depth* (0 = most specific, i.e., the triple's source):
   1. Query the graph for all triples where `source` is the entity and `predicate` is `governance://has_constraint`.
   2. For each matching triple, resolve the `target` to a constraint instance by reading its `governance://` predicates.
   3. Add each resolved constraint to *constraints*, tagged with *depth*.
3. Return *constraints*.

### 5.3 Precedence Rules

When multiple constraints of the same `constraint_kind` exist at different depths:

- **Most-specific-scope wins.** A constraint at depth 0 (directly on the triple's source) takes priority over one at depth 3 (ancestor). The more-specific constraint replaces the less-specific constraint of the same kind.
- **Deny-wins at same depth.** If two constraints at the same depth would produce conflicting results (one accepts, one rejects), rejection wins.
- **Different kinds accumulate.** A capability constraint and a temporal constraint at the same depth are both evaluated. Only constraints of the same kind trigger override semantics.

### 5.4 Caching

Implementations SHOULD cache scope chains (ancestry lists) and invalidate them when `has_child` or `governance://has_constraint` triples are added or removed. Scope chain computation involves repeated graph traversal, and caching significantly improves validation throughput.

---

## 6. ZCAP Verification Algorithm

This section defines how the governance engine verifies capability constraints for an incoming triple.

**Input:** A triple `(source, predicate, target)`, the author's DID, the scope chain (from Section 5), and the graph state.

**Algorithm:**

1. **Extract predicate.** Let *pred* be the triple's `predicate`. If *pred* is absent (untyped triple), return ACCEPT. Untyped triples are not subject to capability constraints.

2. **Collect capability constraints.** From the constraints collected in Section 5.2, select those with `constraint_kind` = `"capability"` and `capability_enforcement` = `"required"`. If none exist, return ACCEPT.

3. **Check predicate scope.** For each capability constraint, check whether *pred* is covered:
   1. If the constraint specifies `governance://capability_predicates`, check whether *pred* is in the comma-separated list.
   2. If the constraint does not specify `governance://capability_predicates` (or the list is empty), all predicates are covered.
   3. If *pred* is not covered by any capability constraint, return ACCEPT.

4. **Check root authority.** If the author's DID matches the graph's root authority, return ACCEPT. The root authority has implicit capability over all predicates and scopes.

5. **Find author's capabilities.** Query the graph for all triples where `source` is the author's DID and `predicate` is `governance://has_zcap`. Resolve each `target` to a ZCAP document.

6. **Evaluate each capability.** For each resolved ZCAP document:
   1. **Predicate match:** Check that *pred* is in `capability.predicates`. If not, skip this ZCAP.
   2. **Scope match:** If `capability.scope.within` is set, check that the referenced entity appears in the scope chain (ancestry). If not, skip this ZCAP. If `capability.scope.within` is `null`, scope matches (entire graph).
   3. **Expiry check:** If `expires` is set and the current authoritative timestamp exceeds `expires`, skip this ZCAP.
   4. **Revocation check:** Query the graph for triples with `predicate` = `governance://revokes_capability` and `target` = this ZCAP's `id`. If a valid revocation exists (from an authorized revoker per Section 4.3.5), skip this ZCAP.
   5. **Chain verification:** Walk the delegation chain:
      1. Let *current_zcap* be this ZCAP.
      2. Let *chain_depth* = 0.
      3. LOOP:
         1. If *chain_depth* > 10, chain is too deep — skip this ZCAP.
         2. Verify *current_zcap*'s `proof` signature against the public key derived from the `proof.verificationMethod` DID. If invalid, skip this ZCAP.
         3. If `parentCapability` is `null`:
            - The proof signer MUST be the root authority. If not, skip this ZCAP.
            - Chain is valid. Proceed to step 6.6.
         4. Resolve `parentCapability` to a ZCAP document.
         5. **Attenuation check:** *current_zcap*'s `capability.predicates` MUST be a subset of the parent's. *current_zcap*'s `capability.scope.within` MUST be equal to or a descendant of the parent's scope.
         6. **Delegator check:** The proof signer of *current_zcap* MUST be the `invoker` of the parent capability.
         7. **Revocation check on parent:** Check the parent ZCAP against the revocation list. If revoked, skip this ZCAP.
         8. Set *current_zcap* to the parent. Increment *chain_depth*.
   6. If chain verification succeeded, return ACCEPT.

7. **No valid capability found.** Return REJECT with:
   - `rejectedBy`: the constraint ID
   - `module`: `"capability"`
   - `reason`: `"No valid capability for predicate <pred> in scope"`

---

## 7. Temporal Verification Algorithm

This section defines how the governance engine enforces temporal constraints for an incoming triple.

**Input:** A triple `(source, predicate, target)`, the author's DID, the scope chain (from Section 5), the authoritative timestamp of the incoming triple, and the graph state.

**Algorithm:**

1. **Collect temporal constraints.** From the constraints collected in Section 5.2, select those with `constraint_kind` = `"temporal"`. If none exist, return ACCEPT.

2. **For each temporal constraint:**
   1. **Predicate match.** If `governance://temporal_applies_to_predicates` is specified and non-empty, check whether the triple's `predicate` is in the list. If not, skip this constraint.
   2. **Query recent triples.** Scan the graph for triples by the same author within the constraint's scope that match the applicable predicates. These are triples where:
      - The `source` is within the scope subtree (is the constraint's scope entity or a descendant)
      - The `predicate` matches the constraint's `applies_to_predicates` (or any predicate if not specified)
      - The author matches the incoming triple's author
   3. **Interval check.** If `governance://temporal_min_interval_seconds` is specified:
      1. Find the most recent matching triple's timestamp.
      2. Compute *elapsed* = incoming triple's timestamp − last matching triple's timestamp (in seconds).
      3. If *elapsed* < `temporal_min_interval_seconds`, return REJECT with:
         - `rejectedBy`: the constraint ID
         - `module`: `"temporal"`
         - `reason`: `"Rate limit: wait <remaining>s"`
   4. **Window count check.** If `governance://temporal_max_count_per_window` is specified:
      1. Let *window* = `governance://temporal_window_seconds` (default: 60).
      2. Count matching triples within the time range `[incoming_timestamp − window, incoming_timestamp]`.
      3. If *count* ≥ `temporal_max_count_per_window`, return REJECT with:
         - `rejectedBy`: the constraint ID
         - `module`: `"temporal"`
         - `reason`: `"Rate limit: <max> per <window>s exceeded"`

3. **All temporal constraints passed.** Return ACCEPT.

---

## 8. Content Verification Algorithm

This section defines how the governance engine enforces content constraints for an incoming triple.

**Input:** A triple `(source, predicate, target)`, the scope chain (from Section 5), and the graph state.

**Algorithm:**

1. **Collect content constraints.** From the constraints collected in Section 5.2, select those with `constraint_kind` = `"content"`. If none exist, return ACCEPT.

2. **For each content constraint:**
   1. **Predicate match.** If `governance://content_applies_to_predicates` is specified and non-empty, check whether the triple's `predicate` is in the list. If not, skip this constraint.
   2. **Resolve target.** Resolve the triple's `target` to its content:
      - If the target is a literal string, use it as text content with no media type.
      - If the target is a content-addressed expression, resolve it to obtain text content and/or media type.
      - If the target cannot be resolved (unavailable content store), the engine SHOULD reject the triple (fail-closed). See [Section 12](#12-security-considerations).
   3. **Length check.** If `governance://content_max_length` is specified and the resolved text content exceeds that character count, return REJECT with:
      - `rejectedBy`: the constraint ID
      - `module`: `"content"`
      - `reason`: `"Content exceeds maximum length of <max> characters"`
   4. **Blocked patterns check.** If `governance://content_blocked_patterns` is specified, test each regex pattern against the resolved text content. If any pattern matches, return REJECT with:
      - `rejectedBy`: the constraint ID
      - `module`: `"content"`
      - `reason`: `"Content matches blocked pattern"`
   5. **URL policy check.** If `governance://content_allow_urls` is `"false"`, scan the text content for URLs. If any URL is found, return REJECT with:
      - `rejectedBy`: the constraint ID
      - `module`: `"content"`
      - `reason`: `"URLs are not permitted"`
   6. **Domain whitelist check.** If `governance://content_allow_urls` is `"true"` (or absent) and `governance://content_allowed_domains` is specified and non-empty, extract all URLs from the text content and verify that each URL's domain appears in the allowed domains list. If any URL's domain is not in the list, return REJECT with:
      - `rejectedBy`: the constraint ID
      - `module`: `"content"`
      - `reason`: `"URL domain <domain> is not in the allowed list"`
   7. **Media type check.** If `governance://content_allow_media_types` is specified and non-empty, and the resolved content has a media type, check that the media type matches at least one glob pattern. If no pattern matches, return REJECT with:
      - `rejectedBy`: the constraint ID
      - `module`: `"content"`
      - `reason`: `"Media type <type> is not permitted"`

3. **All content constraints passed.** Return ACCEPT.

---

## 9. Governance API on SharedGraph

Governance methods are exposed directly on the `SharedGraph` interface, rather than as a separate namespace. This keeps governance tightly coupled to the shared graph it governs.

```webidl
[Exposed=Window,Worker]
partial interface SharedGraph {
  [NewObject] Promise<ValidationResult> canAddTriple(SemanticTriple triple);
  [NewObject] Promise<sequence<GraphConstraint>> constraintsFor(USVString entityAddress);
  [NewObject] Promise<sequence<CapabilityInfo>> myCapabilities();
};

dictionary ValidationResult {
  required boolean allowed;
  USVString? module;
  USVString? reason;
};

dictionary GraphConstraint {
  required USVString id;
  required USVString kind;
  required USVString scope;
  unsigned long depth;
  record<USVString, USVString> properties;
};

dictionary CapabilityInfo {
  required USVString id;
  required sequence<USVString> predicates;
  USVString? scope;
  DOMString? expires;
};
```

### 9.1 `canAddTriple()`

Evaluates whether the current user's identity would be permitted to add the given triple, based on all governance constraints in scope. Implementations MUST execute the algorithms defined in Sections 5 through 8 in the following order:

1. **Scope resolution** (Section 5)
2. **Capability verification** (Section 6)
3. **Credential verification** (Section 4.4)
4. **Temporal verification** (Section 7)
5. **Content verification** (Section 8)

Execution MUST stop at the first rejection. If all checks pass, the result is `{ allowed: true }`. If rejected, the result includes `module` and `reason` identifying which constraint rejected the triple.

**Execution order rationale.** Capability and credential checks are evaluated first because they are structurally cheap (lookup and signature verification). Temporal checks require scanning recent triples. Content checks may require expression resolution. Ordering from cheapest to most expensive minimises wasted computation on triples that would be rejected early.

### 9.2 `constraintsFor()`

Returns all constraints that apply to a given entity address, including inherited constraints from ancestors. Applications MAY use this method to determine and display which actions are permitted for a given entity.

### 9.3 `myCapabilities()`

Returns all valid, non-revoked, non-expired capabilities held by the current user for this shared graph. Applications MAY use this method for UI state management (e.g., enabling or disabling action buttons).

---

## 10. Integration with Sync Protocol

This section defines how the governance engine integrates with the peer-to-peer graph sync protocol defined in [[P2P-GRAPH-SYNC]].

### 10.1 Sync-Layer Enforcement (Normative)

A conforming sync protocol MUST evaluate governance constraints for every incoming triple before accepting it into the local graph replica. Specifically:

1. When a peer receives a triple from the network (via gossip, direct sync, or any other transport mechanism), the sync protocol MUST evaluate the triple against all governance constraints before committing.
2. If the evaluation returns `{ allowed: false }`, the triple MUST be rejected. It MUST NOT be stored in the local graph replica and MUST NOT be forwarded to other peers.
3. If the evaluation returns `{ allowed: true }`, the triple MAY be accepted and committed.

This ensures that all peers enforce the same governance rules. A triple rejected by one honest peer will be rejected by all honest peers, because all peers evaluate the same constraints against the same graph state.

### 10.2 Pre-Validation (Informative)

The runtime MAY evaluate governance constraints before submitting a triple to the sync protocol. This provides immediate feedback to the user or application without waiting for sync-layer round-trip. Pre-validation is not authoritative — the sync layer performs the definitive check.

### 10.3 Application Queries (Informative)

Applications MAY call `constraintsFor()` and `myCapabilities()` to adapt their user interface to the current governance state. For example, an application might:

- Disable a "send message" button if the user lacks the required capability
- Display a countdown timer based on temporal constraints
- Show which content types are permitted in a given context

Application-layer enforcement is cosmetic. It improves user experience but MUST NOT be relied upon for security.

---

## 11. Rule Evolution

Governance rules are graph data. They are created, modified, and removed by adding and removing triples — using the same sync protocol and the same validation pipeline as content triples.

### 11.1 Adding a Rule

To add a governance rule, an authorized agent creates a constraint instance (a set of triples with `governance://` predicates) and binds it to an entity via a `governance://has_constraint` triple. The constraint triples propagate via sync, and all peers enforce the new rule upon receipt.

### 11.2 Modifying a Rule

To modify a governance rule, an authorized agent removes the existing constraint triples and adds new ones. Implementations SHOULD treat this as an atomic update if the sync protocol supports batched triple operations.

### 11.3 Removing a Rule

To remove a governance rule, an authorized agent removes the `governance://has_constraint` binding triple. The constraint instance becomes unbound and has no effect. Optionally, the constraint instance's own triples may also be removed.

### 11.4 Propagation

Constraint changes propagate via the sync protocol like any other triple. There is an inherent propagation delay between when a constraint is changed and when all peers have received and applied the change. During this window, peers may temporarily enforce different rule sets. This is an expected property of eventually-consistent systems and does not compromise security — each peer enforces the rules it has received.

### 11.5 No Restart Required

Because governance rules are data interpreted at runtime, no software update, process restart, or migration is required when rules change. The governance engine reads constraints from the graph on every validation (or on change notification via `reload()`).

---

## 12. Security Considerations

### 12.1 Cryptographic Verification

ZCAP chain verification MUST validate all signatures cryptographically. Implementations MUST NOT accept capabilities with invalid, missing, or unverifiable signatures. The `proof.verificationMethod` DID MUST be resolvable, and the public key MUST be used to verify the `proof.proofValue`.

### 12.2 Revocation Freshness

Revocation checking MUST be performed on every validation invocation. Implementations MUST NOT cache "not revoked" status indefinitely. The revocation list is mutable graph data that can change at any time. Implementations MAY cache revocation status for short periods (seconds) to improve throughput, but MUST invalidate the cache when new `governance://revokes_capability` triples are received.

### 12.3 Revocation Propagation Delay

Revocation triples propagate via the sync protocol and are subject to network latency. Between the time a capability is revoked and the time all peers receive the revocation triple, some peers may still accept triples authorized by the revoked capability. This is an inherent property of eventually-consistent systems. Implementations SHOULD minimise this window by prioritising governance-related triples in sync.

### 12.4 Content Resolution Availability

Content verification (Section 8) may require resolving content-addressed expressions to obtain text content or media types. If the content store is unavailable or slow, the governance engine SHOULD reject the triple rather than accept it (fail-closed). Implementations MAY define a timeout for content resolution, after which rejection occurs.

### 12.5 Constraint Flooding

A malicious agent with permission to create constraint triples could flood the graph with a large number of constraints, causing the governance engine to perform excessive computation on every validation. Implementations SHOULD limit the number of constraints evaluated per validation invocation. A RECOMMENDED limit is 1000 constraints per scope chain. Implementations SHOULD log a warning when this limit is approached.

### 12.6 Authoritative Timestamps

Temporal constraint enforcement depends on triple timestamps. Timestamps MUST come from the sync protocol's authoritative source (e.g., the authenticated timestamp assigned by the sync layer), NOT from the triple author's self-reported timestamp. If the sync protocol does not provide authoritative timestamps, temporal constraints cannot be reliably enforced, and implementations SHOULD disable them with a warning.

### 12.7 Regex Denial of Service

Content constraints support regular expression patterns for blocked content. Maliciously crafted regex patterns can cause catastrophic backtracking. Implementations MUST enforce a timeout on regex evaluation (RECOMMENDED: 10 milliseconds per pattern) and MUST reject the pattern (not the triple) if the timeout is exceeded.

### 12.8 Governance Bootstrap

When a shared graph is first created, no governance constraints exist. The root authority SHOULD add initial constraints (default capabilities, baseline policies) before inviting other agents. Until constraints are established, the graph is open — any agent with sync access can add any triple.

---

## 13. Privacy Considerations

### 13.1 Rule Transparency

All governance rules are visible to all peers in the shared graph. There are no hidden rules. This is a design choice: agents can verify that they are subject to the same rules as all other agents, and can inspect rules before joining a shared graph. However, this means that governance policies (content restrictions, credential requirements, rate limits) are public knowledge.

### 13.2 Capability Visibility

ZCAP capabilities are stored as graph data (linked from agent DIDs via `governance://has_zcap`). This reveals which agents hold which permissions, enabling potential profiling of agent roles and authority levels. Implementations MAY explore zero-knowledge proof techniques for capability verification to mitigate this, but such techniques are out of scope for this specification.

### 13.3 Credential Exposure

Credential requirements reveal what identity attestations agents hold. When a constraint requires a "ProofOfHumanity" credential, all agents in the graph can observe which agents have linked such credentials. This is inherent to the credential-checking model and cannot be avoided without zero-knowledge credential verification schemes.

### 13.4 Activity Tracking

Temporal constraint enforcement requires the governance engine to scan recent triples by a specific author within a scope. This means the engine necessarily tracks per-agent activity patterns (frequency, timing, predicates used). While this information is already present in the graph (all triples are visible to all peers), temporal enforcement makes it operationally salient. Implementations SHOULD minimise retention of derived temporal state beyond what is needed for validation.

---

## 14. Examples

### 14.1 Example 1: Creating a Capability-Gated Entity

An administrator creates an entity where only agents with a valid ZCAP can add triples.

**Step 1: Create the capability constraint.**

```
<urn:constraint:cap-gate-1> -[governance://entry_type]→ governance://constraint
<urn:constraint:cap-gate-1> -[governance://constraint_kind]→ "capability"
<urn:constraint:cap-gate-1> -[governance://capability_enforcement]→ "required"
```

**Step 2: Bind the constraint to the entity.**

```
<urn:entity:announcements> -[governance://has_constraint]→ <urn:constraint:cap-gate-1>
```

**Step 3: Issue a ZCAP to an authorized agent.**

```json
{
  "@context": ["https://w3id.org/zcap/v1", "https://w3id.org/security/suites/ed25519-2020/v1"],
  "id": "urn:uuid:zcap-announce-1",
  "invoker": "did:key:z6MkAuthorizedAgent",
  "parentCapability": null,
  "capability": {
    "predicates": ["app://body", "app://entry_type"],
    "scope": {
      "within": "urn:entity:announcements",
      "graph": "urn:graph:community-1"
    }
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-04-01T00:00:00Z",
    "verificationMethod": "did:key:z6MkRootAuthority#key-1",
    "proofPurpose": "capabilityDelegation",
    "proofValue": "z3FXQqFk..."
  }
}
```

**Step 4: Link the ZCAP to the agent.**

```
<did:key:z6MkAuthorizedAgent> -[governance://has_zcap]→ <expression://zcap-announce-1>
```

**Result:** Only `did:key:z6MkAuthorizedAgent` (and the root authority) can create triples with predicates `app://body` or `app://entry_type` under `urn:entity:announcements`. All other agents' triples are rejected by the governance engine at the sync layer.

### 14.2 Example 2: Adding a Rate Limit (30-Second Cooldown)

An administrator adds a temporal constraint to slow down contributions.

**Step 1: Create the temporal constraint.**

```
<urn:constraint:slow-mode-1> -[governance://entry_type]→ governance://constraint
<urn:constraint:slow-mode-1> -[governance://constraint_kind]→ "temporal"
<urn:constraint:slow-mode-1> -[governance://temporal_min_interval_seconds]→ "30"
<urn:constraint:slow-mode-1> -[governance://temporal_applies_to_predicates]→ "app://body"
```

**Step 2: Bind the constraint to the entity.**

```
<urn:entity:general-discussion> -[governance://has_constraint]→ <urn:constraint:slow-mode-1>
```

**Result:** Any agent who creates a triple with predicate `app://body` under `urn:entity:general-discussion` must wait at least 30 seconds before creating another such triple. Triples with other predicates (e.g., `app://reaction`) are unaffected.

### 14.3 Example 3: Adding a Content Policy (No External URLs, Max 2000 Characters)

An administrator restricts content in a specific entity scope.

**Step 1: Create the content constraint.**

```
<urn:constraint:content-policy-1> -[governance://entry_type]→ governance://constraint
<urn:constraint:content-policy-1> -[governance://constraint_kind]→ "content"
<urn:constraint:content-policy-1> -[governance://content_applies_to_predicates]→ "app://body"
<urn:constraint:content-policy-1> -[governance://content_allow_urls]→ "false"
<urn:constraint:content-policy-1> -[governance://content_max_length]→ "2000"
```

**Step 2: Bind the constraint to the entity.**

```
<urn:entity:text-only-channel> -[governance://has_constraint]→ <urn:constraint:content-policy-1>
```

**Result:** Triples with predicate `app://body` under `urn:entity:text-only-channel` are rejected if their target text contains any URL or exceeds 2000 characters.

### 14.4 Example 4: Requiring a Credential to Participate (Proof of Humanity)

An administrator requires all contributors to hold a "ProofOfHumanity" Verifiable Credential.

**Step 1: Create the credential constraint.**

```
<urn:constraint:humanity-1> -[governance://entry_type]→ governance://constraint
<urn:constraint:humanity-1> -[governance://constraint_kind]→ "credential"
<urn:constraint:humanity-1> -[governance://requires_credential_type]→ "ProofOfHumanity"
<urn:constraint:humanity-1> -[governance://credential_issuer_pattern]→ "did:web:humancheck.org"
<urn:constraint:humanity-1> -[governance://credential_min_age_hours]→ "24"
```

**Step 2: Bind the constraint to the graph root.**

```
<urn:entity:graph-root> -[governance://has_constraint]→ <urn:constraint:humanity-1>
```

**Result:** Every triple in the entire graph is subject to this credential requirement (scope inheritance from root). An agent must hold a `ProofOfHumanity` credential issued by `did:web:humancheck.org` at least 24 hours ago, and the credential's `credentialSubject` must match the agent's DID. Agents without a matching credential have all their triples rejected.

### 14.5 Example 5: Delegating Capabilities (Admin → Moderator → Member)

The root authority creates a hierarchy of delegated capabilities.

**Step 1: Root authority issues admin ZCAP.**

```json
{
  "id": "urn:uuid:zcap-admin",
  "invoker": "did:key:z6MkAdmin",
  "parentCapability": null,
  "capability": {
    "predicates": ["app://body", "app://reaction", "app://entry_type", "governance://has_constraint", "governance://revokes_capability"],
    "scope": { "within": null, "graph": "urn:graph:community-1" }
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "verificationMethod": "did:key:z6MkRootAuthority#key-1",
    "proofPurpose": "capabilityDelegation",
    "proofValue": "z..."
  }
}
```

**Step 2: Admin delegates moderator ZCAP (attenuated — fewer predicates).**

```json
{
  "id": "urn:uuid:zcap-moderator",
  "invoker": "did:key:z6MkModerator",
  "parentCapability": "urn:uuid:zcap-admin",
  "capability": {
    "predicates": ["app://body", "app://reaction", "app://entry_type"],
    "scope": { "within": null, "graph": "urn:graph:community-1" }
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "verificationMethod": "did:key:z6MkAdmin#key-1",
    "proofPurpose": "capabilityDelegation",
    "proofValue": "z..."
  }
}
```

**Step 3: Moderator delegates member ZCAP (attenuated — scoped to one entity).**

```json
{
  "id": "urn:uuid:zcap-member",
  "invoker": "did:key:z6MkMember",
  "parentCapability": "urn:uuid:zcap-moderator",
  "capability": {
    "predicates": ["app://body", "app://reaction"],
    "scope": { "within": "urn:entity:general-discussion", "graph": "urn:graph:community-1" }
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "verificationMethod": "did:key:z6MkModerator#key-1",
    "proofPurpose": "capabilityDelegation",
    "proofValue": "z..."
  }
}
```

**Result:** The delegation chain is: Root → Admin → Moderator → Member. Each step attenuates capabilities. The admin can manage governance rules. The moderator can post content graph-wide but cannot manage governance. The member can only post content (`app://body`, `app://reaction`) under `urn:entity:general-discussion`.

### 14.6 Example 6: Revoking a Capability (Ban)

An admin revokes a member's capability, effectively banning them from contributing.

**Step 1: Add a revocation triple.**

```
<did:key:z6MkAdmin> -[governance://revokes_capability]→ "urn:uuid:zcap-member"
```

**Result:** The ZCAP `urn:uuid:zcap-member` is revoked. The governance engine detects the revocation triple during capability verification (Section 6, step 6.4) and rejects all triples from `did:key:z6MkMember` that rely on this capability. If the member had delegated capabilities to others (e.g., sub-members), those delegated capabilities are also invalidated because the chain verification (Section 6, step 6.5) walks the full delegation chain and checks revocation at every level.

The revocation propagates via sync. Once all peers receive the revocation triple, the ban is enforced network-wide.

---

## 15. Full Predicate Reference Table

The following table lists every predicate defined in this specification.

| Predicate | Target Type | Description | Cardinality | Section |
|-----------|-------------|-------------|-------------|---------|
| `governance://entry_type` | URI (`governance://constraint` or `governance://default_capability`) | Type discriminator for governance instances | Exactly 1 per instance | 4.1, 4.7 |
| `governance://constraint_kind` | String literal: `"capability"` \| `"temporal"` \| `"content"` \| `"credential"` | Classifies the constraint by enforcement module | Exactly 1 per constraint | 4.1 |
| `governance://constraint_scope` | URI (entity address) | Explicit scope for the constraint. Overrides inferred scope from binding. | 0 or 1 | 4.1 |
| `governance://has_constraint` | URI (constraint instance address) | Binds a constraint to an entity. Source is the governed entity. | 0 or many per entity | 4.2 |
| `governance://capability_enforcement` | String literal: `"required"` \| `"optional"` | Whether ZCAP is required for triples under this scope | Exactly 1 per capability constraint | 4.3.1 |
| `governance://capability_predicates` | Comma-separated predicate URIs | Predicates that require capability verification | 0 or 1 | 4.3.1 |
| `governance://has_zcap` | URI (capability expression address) | Links an agent DID to a capability they hold. Source is agent DID. | 0 or many per agent | 4.3.4 |
| `governance://revokes_capability` | URI (ZCAP `id` field, e.g., `urn:uuid:...`) | Revokes a specific capability. Source is the revoking agent DID. | 0 or many | 4.3.5, 4.8 |
| `governance://requires_credential_type` | String literal (VC type name) | Required Verifiable Credential type | Exactly 1 per credential constraint | 4.4 |
| `governance://credential_issuer_pattern` | String literal (DID glob pattern) | Acceptable issuer DID pattern | 0 or 1 | 4.4 |
| `governance://credential_min_age_hours` | Integer literal | Minimum credential age in hours | 0 or 1 (default: 0) | 4.4 |
| `governance://has_credential` | URI (credential expression address) | Links an agent DID to a Verifiable Credential. Source is agent DID. | 0 or many per agent | 4.4 |
| `governance://temporal_min_interval_seconds` | Integer literal | Minimum seconds between matching triples by same author | 0 or 1 | 4.5 |
| `governance://temporal_max_count_per_window` | Integer literal | Maximum matching triples per window per author | 0 or 1 | 4.5 |
| `governance://temporal_window_seconds` | Integer literal | Sliding window duration in seconds | 0 or 1 (default: 60) | 4.5 |
| `governance://temporal_applies_to_predicates` | Comma-separated predicate URIs | Predicates subject to this temporal constraint | 0 or 1 (default: all) | 4.5 |
| `governance://content_applies_to_predicates` | Comma-separated predicate URIs | Predicates subject to this content constraint | 0 or 1 (default: all) | 4.6 |
| `governance://content_blocked_patterns` | Pipe-separated regex patterns | Text patterns that cause rejection | 0 or 1 | 4.6 |
| `governance://content_allow_urls` | String literal: `"true"` \| `"false"` | Whether URLs are permitted in text content | 0 or 1 (default: `"true"`) | 4.6 |
| `governance://content_allowed_domains` | Comma-separated domain names | Permitted URL domains (whitelist) | 0 or 1 | 4.6 |
| `governance://content_allow_media_types` | Comma-separated MIME glob patterns | Permitted media types for expression targets | 0 or 1 | 4.6 |
| `governance://content_max_length` | Integer literal | Maximum character count of text content | 0 or 1 | 4.6 |
| `governance://default_capability_predicates` | Comma-separated predicate URIs | Predicates granted to new agents by default | Exactly 1 per default capability | 4.7 |
| `governance://default_capability_scope` | URI (entity address) | Scope for auto-issued capabilities | Exactly 1 per default capability | 4.7 |

---

## 16. References

### 16.1 Normative References

<dl>

<dt>[RFC2119]</dt>
<dd>Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. URL: https://www.rfc-editor.org/rfc/rfc2119</dd>

<dt>[RFC3339]</dt>
<dd>Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. URL: https://www.rfc-editor.org/rfc/rfc3339</dd>

<dt>[ZCAP-LD]</dt>
<dd>Longley, D., Sporny, M., and C. Webber, "Authorization Capabilities for Linked Data", W3C Community Group Report. URL: https://w3c-ccg.github.io/zcap-spec/</dd>

<dt>[VC-DATA-MODEL-2.0]</dt>
<dd>Sporny, M., et al., "Verifiable Credentials Data Model v2.0", W3C Recommendation, March 2025. URL: https://www.w3.org/TR/vc-data-model-2.0/</dd>

<dt>[DID-CORE]</dt>
<dd>Sporny, M., et al., "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. URL: https://www.w3.org/TR/did-core/</dd>

<dt>[SHACL]</dt>
<dd>Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, July 2017. URL: https://www.w3.org/TR/shacl/</dd>

<dt>[ECMA-262]</dt>
<dd>Ecma International, "ECMAScript® Language Specification". URL: https://tc39.es/ecma262/</dd>

</dl>

### 16.2 Informative References

<dl>

<dt>[PERSONAL-GRAPH]</dt>
<dd><a href="https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>. Draft. (Companion specification defining the personal graph data model.)</dd>

<dt>[P2P-GRAPH-SYNC]</dt>
<dd><a href="https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/03_p2p-graph-sync.md">Peer-to-Peer Graph Synchronisation Protocol</a>. Draft. (Companion specification defining the sync protocol that enforces governance rules.)</dd>

</dl>
