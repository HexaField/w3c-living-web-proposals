# Graph Governance: Constraint Enforcement for Linked Data Contexts

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a framework for expressing and enforcing governance rules over linked data contexts. A **context** is a named graph identified by a `did:graph:...` DID (see [[PERSONAL-LINKED-DATA-GRAPHS]]). Governance rules are themselves graph data — triples with well-known `governance://` predicates that constrain who can add triples, how often, with what content, and under what identity requirements. ZCAPs target context DIDs as their resource; capability chains trace to each context's **own root capability** (constitutionalised at context creation). No principal sits above the structure — authority is the accumulated history of delegations made by participants. Three explicit **enforcement modes** (Open / Announced / Enforced) let communities crystallise governance gradually. This specification builds on W3C ZCAP-LD [[ZCAP-LD]], W3C Verifiable Credentials [[VC-DATA-MODEL-2.0]], W3C SHACL [[SHACL]] (via [[SHAPE-VALIDATION]]), and the DID-document delegate model in [[DECENTRALISED-IDENTITY]].

---

## Status of This Document

This document is a draft Community Group Report. It has no official W3C standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Data Model](#4-data-model)
5. [Enforcement Modes](#5-enforcement-modes)
6. [Scope Resolution (Context Nesting)](#6-scope-resolution-context-nesting)
7. [ZCAP Verification Algorithm](#7-zcap-verification-algorithm)
8. [Capability Attenuation](#8-capability-attenuation)
9. [Caveat Vocabulary](#9-caveat-vocabulary)
10. [Governance of DID-Document Delegates](#10-governance-of-did-document-delegates)
11. [Temporal Verification Algorithm](#11-temporal-verification-algorithm)
12. [Content Verification Algorithm](#12-content-verification-algorithm)
13. [Governance API on Context](#13-governance-api-on-context)
14. [Integration with Sync Protocol](#14-integration-with-sync-protocol)
15. [Rule Evolution](#15-rule-evolution)
16. [Security Considerations](#16-security-considerations)
17. [Privacy Considerations](#17-privacy-considerations)
18. [Examples](#18-examples)
19. [Predicate Reference Table](#19-predicate-reference-table)
20. [References](#20-references)

---

## 1. Introduction

### 1.1 Motivation

Contexts face a fundamental governance problem: without enforceable rules, any agent with sync access can add any triple. There is no inherent mechanism to restrict who may contribute, what content is acceptable, how frequently contributions may occur, or what identity attestations are required.

Application-layer enforcement is insufficient. Applications are swappable by design; an application that refuses to display certain triples provides no guarantee — another application can bypass the restrictions. **The application layer is not an authorisation boundary.**

**The sync protocol is the authorisation boundary.** Triples that fail sync-layer validation are rejected before entering the network. No peer accepts them, regardless of which application submitted them. This makes the sync protocol the correct enforcement point for governance rules.

### 1.2 Authority Is Constituted, Not Granted

When a context comes into existence, a single **root capability** is minted as a ZCAP, signed by the creator using their `did:key` (or, for a context created within a parent context, signed by a `capabilityDelegation` delegate of the parent's `did:graph`).

From that moment, the structure of who-can-do-what is the accumulated history of delegations made by participants according to the governance rules they themselves defined. No principal sits above the structure. The creator initially holds the root capability and MAY delegate or rotate it — but as soon as they delegate it, others have equal standing under the new rules. Authority is **constituted**, not granted.

### 1.3 ZCAPs Target Graph DIDs

The critical architectural decision: **a `did:graph:...` is the canonical resource of a ZCAP**. A capability that grants "createLink in `did:graph:abc...`" is portable across every GraphStore and every agent that mounts that context — because the context itself is canonically identified.

### 1.4 Enforcement Modes

Communities crystallise governance over time, not all at once. This specification defines three explicit enforcement modes ([§5](#5-enforcement-modes)):

| Mode | Behaviour |
|---|---|
| **Open** | No ZCAP checking. Anyone with sync access can write. The default for fresh contexts. |
| **Announced** | ZCAPs are stored and verifiable, but not enforced. Provides an audit trail. |
| **Enforced** | ZCAP verification is mandatory on every write. No valid capability chain → write rejected. |

### 1.5 Design Principles

1. **Ontology-agnostic.** Constraints reference predicates and DIDs, never application-specific entity names. The engine operates on structural properties.
2. **Rules as data.** Governance rules are triples. Modifying rules uses the same sync protocol as content.
3. **Context nesting.** Constraints attached to a parent context apply to child contexts that declare `context://participates_in <parent>`. Participation is declared from below; no parent can override a child's local rules.
4. **Consensus-enforced.** All peers run the same logic on the same data, producing deterministic accept/reject decisions.
5. **Fail-closed.** When in doubt — unresolvable content, unavailable credential services, ambiguous constraint state — the engine SHOULD reject.
6. **Constitutionalisation.** Each constituent context's root capability is bootstrapped from its creating context's delegation but becomes the new context's own root. The creating context cannot reach into the new context's governance after bootstrap.

### 1.6 Use Cases

- **Community moderation.** Role-based permissions, rate limits, content policies, identity requirements — defined as graph data, enforced identically by all peers.
- **Collaborative workspaces.** Multiple agents collaborate on a document context with section-level capabilities and shape-conformance caveats.
- **Peer-to-peer social.** Spam prevention via temporal constraints, content restrictions via content policies, identity attestations via credential requirements — no central server.
- **Multi-agent systems.** Contexts where both human and AI agents participate enforce governance over AI behaviour — rate-limiting, capability tokens, content patterns.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming **governance engine** is a software component that implements the algorithms in Sections [§6](#6-scope-resolution-context-nesting) through [§12](#12-content-verification-algorithm), supports all three enforcement modes ([§5](#5-enforcement-modes)), and exposes the API defined in [§13](#13-governance-api-on-context).

A conforming **sync protocol** is a peer-to-peer graph synchronisation protocol that calls a conforming governance engine's `validate()` method before accepting any incoming triple ([§14](#14-integration-with-sync-protocol)).

A conforming **application** MAY call the governance engine's query methods to determine allowed actions, but MUST NOT be relied upon as an enforcement point.

---

## 3. Terminology

<dl>

<dt>Context</dt>
<dd>A named graph identified by a <code>did:graph:...</code> DID. The unit of governance. See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt>Triple</dt>
<dd>A directed, labelled relationship (source, predicate, target). See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.1.</dd>

<dt>Constraint</dt>
<dd>A set of triples with <code>governance://</code> predicates defining a governance rule. Classified by kind: capability, temporal, content, or credential.</dd>

<dt>Constraint Binding</dt>
<dd>A triple linking a constraint to the context it governs: <code>&lt;context-did&gt; -[governance://has_constraint]→ &lt;constraint&gt;</code>.</dd>

<dt>Scope Chain</dt>
<dd>The ordered list of contexts an incoming write traverses: the target context plus its ancestors discovered by walking <code>context://participates_in</code> links upward.</dd>

<dt>Root Capability</dt>
<dd>The ZCAP minted when a context comes into existence. Initially held by the creator; delegatable like any other ZCAP.</dd>

<dt>Bootstrap Constitutionalisation</dt>
<dd>The process by which a child context's root capability is delegated from its creating context's delegation. Once written into the child's graph, the bootstrap becomes the child's own root. The creating context cannot subsequently modify the child's internal governance.</dd>

<dt>Capability</dt>
<dd>An authorisation token conforming to [[ZCAP-LD]] that grants a specific agent (or a graph DID) permission to perform specific actions on a specific resource (a context DID). Delegatable, attenuable, revocable, cryptographically verifiable.</dd>

<dt>Caveat</dt>
<dd>A constraint that narrows a ZCAP. Each delegation in a chain MAY add caveats but MUST NOT remove them. See [§9](#9-caveat-vocabulary).</dd>

<dt>Enforcement Mode</dt>
<dd>One of Open, Announced, or Enforced. A property of a context governing how the engine treats capability checks.</dd>

<dt>Credential Requirement</dt>
<dd>A constraint that requires triple authors to hold a specific type of Verifiable Credential [[VC-DATA-MODEL-2.0]].</dd>

<dt>Temporal Constraint</dt>
<dd>A constraint that limits the rate at which an agent can create matching triples.</dd>

<dt>Content Constraint</dt>
<dd>A constraint that validates the content of a triple's target.</dd>

<dt>Governance Engine</dt>
<dd>A software component that evaluates incoming triples against all constraints in scope and returns a validation result.</dd>

<dt>Validation Result</dt>
<dd>The output of a governance engine evaluation: ACCEPT or REJECT, with the rejecting constraint identified.</dd>

</dl>

---

## 4. Data Model

This section defines the `governance://` predicates used to express governance rules as graph data. All predicates use string-literal targets unless otherwise noted.

### 4.1 Constraint Base Type

Every constraint instance MUST have:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ <kind>
```

Where `<kind>` is one of:

| Kind | Description |
|---|---|
| `"capability"` | Requires ZCAPs for triple creation |
| `"temporal"` | Rate-limits triple creation |
| `"content"` | Validates the content of triple targets |
| `"credential"` | Requires Verifiable Credentials from triple authors |

The optional `governance://constraint_scope` specifies the context this constraint applies to. If absent, the scope is the context to which the constraint is bound.

### 4.2 Constraint Binding

A constraint is attached to a context via:

```
<context-did> -[governance://has_constraint]→ <constraint-id>
```

A context MAY have zero or more constraint bindings.

**Context-nesting scope inheritance.** Constraints inherit *upward* via `context://participates_in` links — a triple in child context C is also subject to constraints on every parent context P where `C -[context://participates_in]→ P`. This walks upward from C toward parents, not downward from a containing entity.

```
Parent Context P
  └── governance://has_constraint → [credential requirement: proof of humanity]

Child Context C  (declares context://participates_in → P, inside C's graph)
  └── governance://has_constraint → [temporal: 30s cooldown]
  └── writes here are subject to BOTH constraints
```

**Override semantics.** When constraints of the same `constraint_kind` exist at multiple levels in the scope chain, the most-specific constraint (closest to the writing context) **replaces** the less-specific one of the same kind. Constraints of different kinds always accumulate.

A parent cannot reach into a child's graph to modify the child's constraints. Once the child is bootstrapped, it owns its own rules. Parent constraints inherit; they do not override.

### 4.3 Governance Bootstrap (Root Capability)

When a context is created, a **root capability** is minted as a ZCAP. The capability is signed:

- By the creator's `did:key` if the context is created standalone.
- By a `capabilityDelegation` delegate of the creating context's `did:graph` if the context is created as a participant of a parent.

The root capability is recorded in the new context as:

```
<context-did> -[governance://root_capability]→ <cap-id>

<cap-id> rdf://type           zcap://Delegation ;
         zcap://parent        zcap://BootstrapRoot ;
         zcap://invoker       <did:key:creator> ;
         zcap://actions       "createLink", "removeLink", "updateSHACL", "updateGovernance" ;
         zcap://resource      <context-did> ;
         zcap://proof         "<signature>" ;
         zcap://created       "2026-05-23T00:00:00Z"^^xsd:dateTime .
```

The root capability is constitutionalised — the bootstrap delegation becomes the new context's own root. The creating context cannot subsequently modify the new context's governance. Delegations from the new context's root MAY further evolve independently.

### 4.4 Governance Constraint Conflicts

When concurrent governance mutations create contradictory constraints, the constraint with the most specific scope takes precedence ([§6](#6-scope-resolution-context-nesting)). If scopes are equal, the constraint added by the higher-authority agent takes precedence (lower ZCAP delegation depth). If authority is equal, the constraint with the lexicographically greater constraint ID persists.

### 4.5 Capability Constraints (ZCAP-based)

A capability constraint requires triple authors to hold valid ZCAPs [[ZCAP-LD]].

#### 4.5.1 Constraint Definition

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "capability"
<constraint-id> -[governance://capability_enforcement]→ <enforcement-level>
```

Where `<enforcement-level>` is one of:

| Value | Meaning |
|---|---|
| `"required"` | All triples under this scope MUST be authorised by a valid ZCAP |
| `"optional"` | ZCAPs are checked only if present; absent-ZCAP triples are accepted |

Optional:

```
<constraint-id> -[governance://capability_predicates]→ <comma-separated predicate URIs>
```

Restricts which predicates require capability verification. If absent or empty, all predicates within scope require verification.

#### 4.5.2 ZCAP Document Structure

Authorisation capabilities are stored as JSON-LD documents conforming to [[ZCAP-LD]]:

```json
{
  "@context": [
    "https://w3id.org/zcap/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "urn:uuid:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "invoker": "did:key:z6MkAgent...",
  "parentCapability": "urn:uuid:parent-cap-id",
  "actions": ["createLink", "removeLink"],
  "resource": "did:graph:z6MkChannelGeneral...",
  "caveats": [
    { "type": "expiry", "value": { "expiresAt": "2027-01-01T00:00:00Z" } },
    { "type": "predicate", "value": { "allowed": ["msg://has_message"] } },
    { "type": "rateLimit", "value": { "maxPerWindow": 100, "windowSeconds": 3600 } }
  ],
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-05-23T00:00:00Z",
    "verificationMethod": "did:key:z6MkIssuer...#key-1",
    "proofPurpose": "capabilityDelegation",
    "proofValue": "z..."
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | URN UUID | REQUIRED | Unique identifier |
| `invoker` | DID | REQUIRED | The agent (or graph DID) authorised to exercise this capability |
| `parentCapability` | URN UUID or `null` | REQUIRED | Identifier of the parent capability. `null` for the root capability. |
| `actions` | Array of strings | REQUIRED | Actions this capability authorises ([§4.5.3](#453-actions)). |
| `resource` | URI | REQUIRED | The context's `did:graph:...`. |
| `caveats` | Array of caveat objects | OPTIONAL | Fine-grained constraints ([§9](#9-caveat-vocabulary)). |
| `proof` | Object | REQUIRED | Cryptographic proof signed by the delegator. The delegator MUST be the `invoker` of the parent capability (or the holder of a `capabilityDelegation` delegate key on the parent invoker's DID document if the parent invoker is a graph DID). |

#### 4.5.3 Actions

Standard actions:

| Action | Meaning |
|---|---|
| `createLink` | Author a new triple in the context |
| `removeLink` | Remove an existing triple |
| `updateProperty` | Modify a scalar property of a ShapeInstance |
| `updateSHACL` | Register or modify shapes ([[SHAPE-VALIDATION]]) |
| `updateGovernance` | Add/remove governance constraints |
| `updateFlow` | Register or modify flows ([[GRAPH-FLOWS]]) |
| `updateDIDDocument` | Add/remove DID-document delegates ([§10](#10-governance-of-did-document-delegates)) |
| `mountContext` | Mount the context (used to gate read access) |
| `delegateCapability` | Issue new delegations from this capability |

Applications MAY define additional action names. The governance engine SHOULD treat unknown actions conservatively (require explicit capability).

#### 4.5.4 Capability Storage

Capabilities are stored as content-addressed expressions in the context they apply to:

```
<agent-did> -[governance://has_zcap]→ <capability-expression-address>
```

#### 4.5.5 Revocation

Any agent who issued a capability MAY revoke it by adding:

```
<revoking-agent-did> -[governance://revokes_capability]→ <zcap-id>
```

Revocation is valid if the revoking agent is:

- The `invoker` of the revoked capability's `parentCapability` (or a `capabilityDelegation` delegate of that invoker, if the invoker is a graph DID), OR
- The current root-capability holder for the context.

Revoking C invalidates the entire delegation chain rooted at C.

### 4.6 Credential Requirements

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

### 4.7 Temporal Constraints

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

### 4.8 Content Constraints

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

### 4.9 Default Capability

A **default capability** template — the ZCAP automatically issued to agents joining a context:

```
<default-cap-id> -[governance://entry_type]→ governance://default_capability
<default-cap-id> -[governance://default_capability_actions]→ <comma-separated actions>
<default-cap-id> -[governance://default_capability_caveats]→ <JSON array of caveat objects>
```

When an agent joins, a runtime SHOULD issue a ZCAP matching the default template. The engine does not perform issuance — it reads templates so join-flow implementations know what to issue.

### 4.10 Revocation List

Revocations are stored as triples:

```
<revoking-agent-did> -[governance://revokes_capability]→ <zcap-id>
```

Conforming engines MUST check the revocation list during every capability verification (every level of the chain). Engines MUST NOT cache revocation status indefinitely.

---

## 5. Enforcement Modes

This section is normative.

### 5.1 The Three Modes

A context's enforcement mode is recorded as:

```
<context-did> -[governance://enforcement_mode]→ "open" | "announced" | "enforced"
```

If absent, the default is `"open"`.

| Mode | Capability Check | Audit Trail | Use For |
|---|---|---|---|
| **Open** | No ZCAP checking. All writes accepted (subject to other constraints). | None | New contexts, prototyping, low-trust environments. |
| **Announced** | ZCAPs are stored and verifiable, but not enforced. | Yes — every write is annotated with the capability chain that *would* have authorised it (or "anonymous" if none). | Transitioning into enforcement; testing rules. |
| **Enforced** | ZCAP verification is mandatory. Writes without a valid chain are rejected. | Yes | Mature governance — production communities. |

### 5.2 Mode Transitions

A context can move between modes via writing the `governance://enforcement_mode` triple. The write itself is subject to governance: it requires an `updateGovernance` capability on the context. The mode change takes effect for all subsequent writes.

The recommended progression is **Open → Announced → Enforced**.

### 5.3 Mode-Agnostic Constraints

Non-capability constraints (temporal, content, credential) apply in **all three modes**. The enforcement mode only governs whether *capability* checks are advisory or mandatory.

### 5.4 Caveats and Enforcement Mode

In Announced mode, caveats are checked and the result is recorded but never causes rejection. In Enforced mode, caveat violations reject the write.

---

## 6. Scope Resolution (Context Nesting)

This section defines how the governance engine determines which constraints apply to an incoming write.

### 6.1 Ancestry Resolution

Given an incoming triple authored by `agent` to be written in `context`:

1. Let *current* = `context`.
2. Let *ancestry* = ordered list initialised with `[current]`.
3. Let *visited* = set initialised with `{current}`.
4. LOOP:
   1. Query *current*'s graph for triples `<current> -[context://participates_in]→ ?parent`.
   2. If no results, exit (root or unparented).
   3. For each *parent*:
      - Verify mutual acceptance: the parent's governance MUST contain `<parent> -[context://accepts_participation]→ <current>` signed by a `capabilityDelegation` delegate of the parent. If absent, ignore the participation claim.
      - If *parent* is in *visited*, skip (cycle).
      - Add *parent* to *visited* and *ancestry*. Set *current* = *parent*. Continue.
5. Return *ancestry*.

Implementations MUST enforce a maximum ancestry depth of 100.

**Why participation is mutually declared.** A child unilaterally claiming participation in any parent would allow inheritance hijacking — a malicious child could declare participation in a high-trust parent to claim its credentials. The parent's mutual `accepts_participation` link prevents this.

### 6.2 Constraint Collection

Given *ancestry*:

1. Let *constraints* = empty list.
2. For each context in *ancestry*, at index *depth* (0 = the write's context):
   1. Query that context's graph for `<context> -[governance://has_constraint]→ ?c`.
   2. Resolve each `?c` to a constraint instance, tag with *depth*, add to *constraints*.
3. Return *constraints*.

### 6.3 Precedence Rules

- **Most-specific-context wins.** A constraint at depth 0 takes priority over one at depth 3 — for constraints of the same kind, the more specific replaces the less specific.
- **Deny-wins at same depth.** Conflicts at the same depth resolve to rejection.
- **Different kinds accumulate.** Capability + temporal at the same depth are both evaluated.

### 6.4 Caching

Implementations SHOULD cache ancestry chains and invalidate when participation links or constraint bindings change.

---

## 7. ZCAP Verification Algorithm

**Input:** A triple, the author's DID, the scope chain, the graph state, the enforcement mode.

**Algorithm:**

1. **Mode check.** If enforcement mode is `"open"`, return ACCEPT. If `"announced"`, perform verification, record the result, but return ACCEPT regardless.

2. **Extract action.** Let *action* = the operation type implied by the write (typically `createLink` for additions, `removeLink` for removals).

3. **Collect capability constraints.** From [§6.2](#62-constraint-collection), select constraints with `constraint_kind = "capability"` and `capability_enforcement = "required"`. If none, return ACCEPT.

4. **Find author's capabilities.** Query for `<author> -[governance://has_zcap]→ ?cap`, resolving each ZCAP. Include capabilities whose `invoker` is a graph DID *if* the author currently holds a `capabilityInvocation` delegate on that graph (per [[DECENTRALISED-IDENTITY]] §5).

5. **Evaluate each capability.**
   1. **Action match.** *action* MUST be in `cap.actions`.
   2. **Resource match.** `cap.resource` MUST equal the context's `did:graph:...` or be an ancestor in the scope chain.
   3. **Expiry check.** If `caveats[].expiry.expiresAt` is set and exceeded, skip.
   4. **Revocation check.** If a valid revocation targets this `cap.id`, skip.
   5. **Caveat check.** Evaluate each caveat ([§9](#9-caveat-vocabulary)) against the operation. If any fails, skip.
   6. **Chain verification.** Walk the parent chain:
      1. If `chain_depth > 10`, skip.
      2. Verify `cap.proof` signature against the public key of `proof.verificationMethod`. For graph-DID delegators, verify the method is currently in the graph's `capabilityDelegation` set.
      3. If `parentCapability` is `null`, this MUST be the context's root capability. Validate that `cap.id` matches `<context> -[governance://root_capability]→ ?`. If so, chain is valid.
      4. Resolve `parentCapability`. Verify attenuation ([§8](#8-capability-attenuation)). Verify the proof signer is the parent's invoker or a delegate. Verify the parent is not revoked.
      5. Set cap = parent; increment depth.
   7. If chain verification succeeded, return ACCEPT.

6. **No valid capability.** Return REJECT with `rejectedBy`, `module: "capability"`, `reason`.

---

## 8. Capability Attenuation

A delegated capability MUST be a strict subset of its parent across:

- **Actions.** `child.actions ⊆ parent.actions`.
- **Resource.** `child.resource` is the same context as parent's, or a child context in the scope chain.
- **Expiry.** If parent has an `expiry` caveat, child's expiry MUST be at or before parent's.
- **Caveats.** Every caveat on the parent MUST be present (or strictly narrowed) on the child. The child MAY add new caveats. The child MUST NOT remove caveats.

The runtime MUST verify attenuation during chain walk. A capability that violates attenuation invalidates the chain.

Capabilities flow downward, getting narrower, never wider.

---

## 9. Caveat Vocabulary

This section is normative.

### 9.1 Caveat Format

Each caveat in a ZCAP's `caveats` array is:

```json
{ "type": "<caveat-type>", "value": { ... } }
```

### 9.2 Standard Caveat Types

| Type | Purpose | `value` shape |
|---|---|---|
| `expiry` | Delegation expires at a time | `{ "expiresAt": "<RFC3339>" }` |
| `predicate` | Restrict to specific predicates | `{ "allowed": ["<uri>", ...], "denied": ["<uri>", ...] }` |
| `shape` | Link must conform to a SHACL shape | `{ "shapeIri": "<uri>" }` |
| `property` | Restrict to specific property paths | `{ "allowed": ["<uri>", ...], "denied": ["<uri>", ...] }` |
| `content` | SPARQL ASK on the link content | `{ "sparql": "ASK { ... }" }` |
| `rateLimit` | Max operations per window | `{ "maxPerWindow": <int>, "windowSeconds": <int> }` |
| `cardinality` | Max total uses of this delegation | `{ "max": <int> }` |
| `source` | Restrict link source patterns (glob) | `{ "pattern": "<glob>" }` |
| `target` | Restrict link target patterns (glob) | `{ "pattern": "<glob>" }` |
| `authorOnly` | Operation must come from the original instance creator | `{}` |

Applications MAY define additional caveat types; the engine MUST treat unknown caveat types conservatively (reject the operation).

### 9.3 Three Levels of Granularity

- **Coarse (graph-level):** `actions: [createLink], caveats: []` — "can write anything to this context."
- **Medium (shape-level):** `+ { "type": "shape", "value": { "shapeIri": "msg://MessageShape" }}` — "can only write data conforming to MessageShape."
- **Fine (property-level):** `+ { "type": "property", "value": { "allowed": ["msg://body"] }}` — "can only modify 'body' on existing Messages."

### 9.4 SHACL/ZCAP Bridge

The `shape` and `property` caveats integrate with [[SHAPE-VALIDATION]]:

- **SHACL** says: "a Message has a body (string, required) and an author (URI, required)."
- **`shape` caveat** says: "this agent can only write data conforming to MessageShape."
- **`property` caveat** says: "this agent can only write the body property of MessageShape."

The runtime validates: ZCAP grants authority → caveats narrow scope → SHACL validates structure.

### 9.5 Performance

Caveat evaluation is designed for negligible overhead:

- `predicate`, `property` — O(1) set lookup.
- `shape` — delegates to the SHACL engine (runs on every write anyway).
- `content` — SPARQL ASK against an in-memory model of the write.
- `rateLimit`, `cardinality` — counter lookup with TTL cache.

---

## 10. Governance of DID-Document Delegates

This section is normative.

The DID-document delegate model ([[DECENTRALISED-IDENTITY]] §5) gives a context shared signing authority through multiple keys listed in capability sections of its DID document. Modifying these is a write to the context's own triples and is therefore governed by this specification.

### 10.1 Governed Predicates

| Predicate | Effect |
|---|---|
| `did-document://add-method` | Add a new `verificationMethod` entry |
| `did-document://remove-method` | Remove a `verificationMethod` and all its section memberships |
| `did-document://grant-section` | Add a method to a capability section |
| `did-document://revoke-section` | Remove a method from a section (without removing the method) |

### 10.2 Capability Required

By default, modifying the DID document requires an `updateDIDDocument` capability scoped to the context. The capability MAY carry caveats constraining which sections can be granted/revoked.

The bootstrap root capability ([§4.3](#43-governance-bootstrap-root-capability)) includes `updateDIDDocument` by default. The creator can add the initial set of delegates without further ceremony.

### 10.3 Delegate-of-Delegate

A delegate's authority to modify the DID document is bounded:

- A `capabilityInvocation` delegate may sign as the graph for ZCAP invocations, but **may not** modify the DID document unless they also hold `updateDIDDocument`.
- A `capabilityDelegation` delegate may issue new ZCAPs from the graph DID, but **may not** add/remove DID document methods unless they also hold `updateDIDDocument`.

### 10.4 Self-Rotation

A delegate MAY rotate their own key by issuing a `did-document://remove-method` + `did-document://add-method` pair as an atomic operation. The default permits self-rotation. Communities that want to prevent unilateral self-rotation MAY add a content caveat requiring an additional signer.

### 10.5 Non-Goal: Multisig

This specification does NOT define multisig, threshold signing, or aggregate-key schemes for the graph DID itself. Shared authority is achieved through the delegate set in the DID document; "this graph said it" is satisfied by any current delegate's signature. See [[DECENTRALISED-IDENTITY]] §5.2.

---

## 11. Temporal Verification Algorithm

**Input:** A triple, the author's DID, the scope chain, the authoritative timestamp.

**Algorithm:**

1. **Collect temporal constraints** with `constraint_kind = "temporal"`. If none, return ACCEPT.

2. **For each constraint:**
   1. **Predicate match.** If `temporal_applies_to_predicates` is set and the triple's predicate is not listed, skip.
   2. **Query recent triples** by the same author within scope.
   3. **Interval check.** If `temporal_min_interval_seconds` is set, find the most recent matching triple and compute elapsed time. If too short, REJECT.
   4. **Window count check.** If `temporal_max_count_per_window` is set, count matching triples in the sliding window. If at or above max, REJECT.

3. All passed → ACCEPT.

---

## 12. Content Verification Algorithm

**Input:** A triple, the scope chain, the graph state.

**Algorithm:**

1. **Collect content constraints**. If none, return ACCEPT.

2. **For each constraint:**
   1. **Predicate match.**
   2. **Resolve target** to text content (literal directly, or by resolving a content-addressed expression — fail-closed on resolution error).
   3. **Length check.** REJECT if exceeds `content_max_length`.
   4. **Blocked patterns.** REJECT if any regex matches.
   5. **URL policy.** REJECT if `content_allow_urls = "false"` and content contains URLs.
   6. **Domain whitelist.** REJECT if any URL's domain is not in `content_allowed_domains`.
   7. **Media type.** REJECT if media type does not match any glob.

3. All passed → ACCEPT.

---

## 13. Governance API on Context

```webidl
[Exposed=Window,Worker]
partial interface Context {
  [NewObject] Promise<ValidationResult> canAddTriple(Triple triple);
  [NewObject] Promise<sequence<GraphConstraint>> constraintsFor(USVString contextDid);
  [NewObject] Promise<sequence<CapabilityInfo>> myCapabilities();
  [NewObject] Promise<DOMString> enforcementMode();
  [NewObject] Promise<undefined> setEnforcementMode(EnforcementMode mode);
};

enum EnforcementMode { "open", "announced", "enforced" };

dictionary ValidationResult {
  required boolean allowed;
  USVString? rejectedBy;       // constraint id
  USVString? module;            // "capability" | "temporal" | "content" | "credential"
  USVString? reason;
  DOMString? mode;              // current enforcement mode
};

dictionary GraphConstraint {
  required USVString id;
  required USVString kind;
  required USVString scope;       // context DID this constraint applies to
  unsigned long depth;            // depth in the scope chain
  record<USVString, USVString> properties;
};

dictionary CapabilityInfo {
  required USVString id;
  required sequence<USVString> actions;
  required USVString resource;     // context did:graph:...
  sequence<object> caveats;
  DOMString? expires;
};
```

### 13.1 `canAddTriple()`

Evaluates whether the current identity would be permitted to add the triple. Executes the algorithms in [§7](#7-zcap-verification-algorithm), [§4.6](#46-credential-requirements), [§11](#11-temporal-verification-algorithm), [§12](#12-content-verification-algorithm) in order. Stops at first rejection.

### 13.2 `constraintsFor()`

Returns all constraints applying to a context, including those inherited via the scope chain.

### 13.3 `myCapabilities()`

Returns valid, non-revoked, non-expired capabilities held by the current identity for this context.

### 13.4 `enforcementMode()` / `setEnforcementMode()`

Reads the current enforcement mode; the setter requires an `updateGovernance` capability on the context.

---

## 14. Integration with Sync Protocol

### 14.1 Sync-Layer Enforcement (Normative)

A conforming sync protocol MUST evaluate governance constraints for every incoming triple before accepting it into the local replica.

1. On receiving a `ContextDiff`, the sync protocol MUST evaluate every additions+removals triple against the context's governance.
2. If `allowed: false`, the triple MUST be rejected. Rejected triples MUST NOT be stored or forwarded.
3. The protocol MUST check the context's current enforcement mode before applying capability rules.

### 14.2 Capability Proof on ContextDiff

A `ContextDiff` carries a `CapabilityProof` (the chain proving the committing agent's authority for the writes in the diff). Verification at three points:

| Point | Who | What is checked |
|---|---|---|
| **Commit time** | Committing agent's runtime | Full SHACL + ZCAP + caveats against the agent's local state |
| **Gossip time** | Each receiving peer | Re-verify capability chain, re-verify caveats with link content, re-verify SHACL conformance |
| **Transport integrity** | Underlying transport (e.g., relay's validation) | Cryptographic signatures only |

See [[P2P-GRAPH-SYNC]] for the wire format.

### 14.3 Pre-Validation (Informative)

The runtime MAY pre-validate before submitting to sync, for immediate user feedback. Pre-validation is not authoritative.

### 14.4 Application Queries (Informative)

Applications MAY call `constraintsFor()` and `myCapabilities()` to adapt UI. Application enforcement is cosmetic; it MUST NOT be relied on for security.

---

## 15. Rule Evolution

### 15.1 Adding a Rule

An authorised agent (holding `updateGovernance` for the context) creates a constraint instance and binds it via `governance://has_constraint`. The triples propagate via sync; all peers enforce the new rule on receipt.

### 15.2 Modifying a Rule

Remove existing constraint triples, add new ones. SHOULD be atomic.

### 15.3 Removing a Rule

Remove the `governance://has_constraint` binding.

### 15.4 Mode Promotion

Change `governance://enforcement_mode`. Subject to `updateGovernance`.

### 15.5 Propagation

Constraint changes propagate via sync like any other triple. During the propagation window, peers may temporarily enforce different rule sets; this is inherent to eventual consistency.

### 15.6 No Restart Required

Governance rules are interpreted at runtime.

---

## 16. Security Considerations

### 16.1 Cryptographic Verification

ZCAP chain verification MUST validate all signatures. For graph-DID-signed delegations, the runtime MUST resolve the graph's DID document and verify that the signing method is currently listed in `capabilityDelegation` ([[DECENTRALISED-IDENTITY]] §5).

### 16.2 Revocation Freshness

Revocation checking MUST be performed on every validation. Caching is permitted for short periods (seconds) but MUST invalidate on new revocation triples.

### 16.3 Revocation Propagation Delay

Revocations are eventually consistent. Implementations SHOULD prioritise governance-related triples in sync.

### 16.4 Content Resolution Availability

If content resolution is unavailable, REJECT the triple (fail-closed).

### 16.5 Constraint Flooding

Limit the number of constraints evaluated per validation (RECOMMENDED: 1000 per scope chain).

### 16.6 Authoritative Timestamps

Temporal enforcement depends on timestamps from the sync protocol's authoritative source, NOT triple-author self-reported timestamps.

### 16.7 Regex Denial of Service

Implementations MUST timeout regex evaluation (RECOMMENDED: 10ms per pattern).

### 16.8 Bootstrap Constitutionalisation Integrity

When a context is bootstrapped from a parent, the bootstrap ZCAP MUST be verified at the child's creation time. After constitutionalisation, the parent's signing key MUST NOT have any standing in the child's governance.

### 16.9 DID Document Tampering

DID-document triples (`did-document://*`) are governance-controlled. An agent who modifies them without `updateDIDDocument` capability is performing an unauthorised governance write; the engine MUST reject the triple at the standard validation step.

### 16.10 Mutual Participation

Inheritance via `context://participates_in` MUST be mutual. Implementations that skip the `context://accepts_participation` check are vulnerable to inheritance hijacking.

---

## 17. Privacy Considerations

### 17.1 Rule Transparency

All governance rules are visible to peers with read access to the context. There are no hidden rules.

### 17.2 Capability Visibility

ZCAPs are stored as graph data; this reveals which agents hold which permissions.

### 17.3 Credential Exposure

Credential requirements reveal what identity attestations agents hold.

### 17.4 Activity Tracking

Temporal enforcement requires the engine to scan recent triples by a specific author.

### 17.5 Enforcement Mode Disclosure

A context's enforcement mode is itself public (a governance triple). Communities transitioning into Enforced mode SHOULD coordinate the change.

---

## 18. Examples

### 18.1 Bootstrap: Creating a Context with a Root Capability

```javascript
// `me` is the user's GraphStore.
const community = await me.createContext({ displayName: "Acme Community" });
// The runtime mints a root capability signed by `me`.
//
//   <community.did>
//     governance://root_capability  <urn:uuid:root-cap-1> .
//   <urn:uuid:root-cap-1>
//     zcap://invoker  <did:key:creator> ;
//     zcap://actions  "createLink" , "removeLink" , "updateSHACL" ,
//                     "updateGovernance" , "updateDIDDocument" ;
//     zcap://resource <community.did> ;
//     zcap://proof    "<signature by did:key:creator>" .
```

### 18.2 Promote Through Enforcement Modes

```javascript
console.log(await community.enforcementMode());   // "open"

// Promote to Announced while wiring up roles.
await community.setEnforcementMode("announced");

// Once confident, lock down to Enforced.
await community.setEnforcementMode("enforced");
```

### 18.3 Delegate Capabilities (Admin → Moderator → Member)

```javascript
const creator = await navigator.credentials.get({ did: { kind: "individual" } });

const adminCap = await creator.signCapability({
  parentCapability: rootCap.id,
  invoker: "did:key:z6MkAdmin...",
  actions: ["createLink", "removeLink", "updateGovernance", "delegateCapability"],
  resource: community.did,
  caveats: []
});

const admin = await navigator.credentials.get({ did: { kind: "individual" } });
const modCap = await admin.signCapability({
  parentCapability: adminCap.id,
  invoker: "did:key:z6MkModerator...",
  actions: ["createLink", "removeLink"],
  resource: community.did,
  caveats: [
    { type: "predicate", value: { allowed: ["msg://body", "msg://reaction"] }},
    { type: "rateLimit", value: { maxPerWindow: 1000, windowSeconds: 3600 }}
  ]
});
```

### 18.4 Bootstrap a Child Context (Constitutionalisation)

```javascript
const general = await me.createContext({
  displayName: "#general",
  participatesIn: community.did
});
// The runtime:
//   1. Mints a fresh did:graph for #general.
//   2. Issues a bootstrap ZCAP from community.did (signed by an authorised
//      capabilityDelegation delegate of community).
//   3. Constitutionalises it as <#general.did> -[governance://root_capability]→ ...
//   4. Writes <#general.did> -[context://participates_in]→ <community.did>
//      in #general's graph.
//   5. Writes <community.did> -[context://accepts_participation]→ <#general.did>
//      in community's graph (signed by a community capabilityDelegation delegate).
//
// From now on, #general governs itself. Community-level governance still applies
// transitively, but community admins cannot reach into #general to override its
// local rules.
```

### 18.5 Capability with a Shape Caveat

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

### 18.6 Adding a DID-Document Delegate

```javascript
const teamCred = await navigator.credentials.get({
  did: { kind: "graph", filter: { did: team.did } }
});

await teamCred.addDelegate(
  {
    id: `${team.did}#key-newhire`,
    type: "Ed25519VerificationKey2020",
    controller: team.did,
    publicKeyMultibase: "z6MkNewHire..."
  },
  ["capabilityInvocation", "assertionMethod"]
);
// Issues did-document://add-method and did-document://grant-section triples
// to the team's context. The writes are subject to the team's
// updateDIDDocument capability (which teamCred holds because it's currently
// in capabilityDelegation).
```

### 18.7 Rate Limit (Slow Mode)

```javascript
const slowMode = `urn:constraint:slow-${crypto.randomUUID()}`;
await general.addTriple({
  source: slowMode, predicate: "governance://entry_type", target: "governance://constraint"
});
await general.addTriple({
  source: slowMode, predicate: "governance://constraint_kind", target: "temporal"
});
await general.addTriple({
  source: slowMode, predicate: "governance://temporal_min_interval_seconds", target: "30"
});
await general.addTriple({
  source: slowMode, predicate: "governance://temporal_applies_to_predicates", target: "msg://body"
});
await general.addTriple({
  source: general.did, predicate: "governance://has_constraint", target: slowMode
});
```

### 18.8 Credential Requirement (Proof of Humanity at Community Root)

```javascript
const humanity = `urn:constraint:hum-${crypto.randomUUID()}`;
await community.addTriple({
  source: humanity, predicate: "governance://entry_type", target: "governance://constraint"
});
await community.addTriple({
  source: humanity, predicate: "governance://constraint_kind", target: "credential"
});
await community.addTriple({
  source: humanity, predicate: "governance://requires_credential_type", target: "ProofOfHumanity"
});
await community.addTriple({
  source: humanity, predicate: "governance://credential_issuer_pattern", target: "did:web:humancheck.org"
});
await community.addTriple({
  source: community.did, predicate: "governance://has_constraint", target: humanity
});
// Applies transitively: every child context inherits this requirement because
// they participate_in community.
```

### 18.9 Revoking a Capability (Ban)

```javascript
await community.addTriple({
  source: admin.did,
  predicate: "governance://revokes_capability",
  target: modCap.id
});
// Mod's chain is invalidated; sub-delegations from mod are also invalidated.
```

---

## 19. Predicate Reference Table

| Predicate | Target Type | Description |
|---|---|---|
| `governance://entry_type` | URI | Type discriminator for governance instances |
| `governance://constraint_kind` | String literal | `"capability"` \| `"temporal"` \| `"content"` \| `"credential"` |
| `governance://constraint_scope` | URI | Explicit scope (overrides inferred) |
| `governance://has_constraint` | URI | Binds a constraint to a context |
| `governance://root_capability` | URI | The context's root ZCAP |
| `governance://enforcement_mode` | String literal | `"open"` \| `"announced"` \| `"enforced"` |
| `governance://capability_enforcement` | String literal | `"required"` \| `"optional"` |
| `governance://capability_predicates` | Comma-separated URIs | Predicates requiring capability verification |
| `governance://has_zcap` | URI | Links an agent DID to a held capability |
| `governance://revokes_capability` | URI (ZCAP id) | Revocation triple |
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
| `governance://default_capability_actions` | Comma-separated actions | Default ZCAP template |
| `governance://default_capability_caveats` | JSON array | Default ZCAP caveats |
| `context://participates_in` | URI (context DID) | Child declares participation in parent (in the child's graph) |
| `context://accepts_participation` | URI (context DID) | Parent confirms acceptance (in the parent's graph, signed by a `capabilityDelegation` delegate) |
| `did-document://add-method` | URI | Add a `verificationMethod` to a graph DID's document |
| `did-document://remove-method` | URI | Remove a `verificationMethod` |
| `did-document://grant-section` | URI | Add method to a capability section |
| `did-document://revoke-section` | URI | Remove method from a capability section |

---

## 20. References

### 20.1 Normative References

<dl>
<dt>[RFC2119]</dt>
<dd>Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.</dd>

<dt>[RFC8174]</dt>
<dd>Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.</dd>

<dt>[RFC3339]</dt>
<dd>Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002.</dd>

<dt>[ZCAP-LD]</dt>
<dd>Longley, D., Sporny, M., and C. Webber, "Authorization Capabilities for Linked Data", W3C Community Group Report. https://w3c-ccg.github.io/zcap-spec/</dd>

<dt>[VC-DATA-MODEL-2.0]</dt>
<dd>Sporny, M., et al., "Verifiable Credentials Data Model v2.0", W3C Recommendation. https://www.w3.org/TR/vc-data-model-2.0/</dd>

<dt>[DID-CORE]</dt>
<dd>Sporny, M., et al., "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. https://www.w3.org/TR/did-core/</dd>

<dt>[DECENTRALISED-IDENTITY]</dt>
<dd><a href="./02_decentralised-identity-web-platform.md">Decentralised Identity Integration for the Web Platform</a>.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="./01_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>.</dd>

<dt>[ECMA-262]</dt>
<dd>Ecma International, "ECMAScript® Language Specification". https://tc39.es/ecma262/</dd>
</dl>

### 20.2 Informative References

<dl>
<dt>[SHACL]</dt>
<dd>Knublauch, H. and D. Kontokostas, "Shapes Constraint Language (SHACL)", W3C Recommendation, July 2017. https://www.w3.org/TR/shacl/</dd>

<dt>[SHAPE-VALIDATION]</dt>
<dd><a href="./04_dynamic-graph-shape-validation.md">Dynamic Graph Shape Validation</a>.</dd>

<dt>[P2P-GRAPH-SYNC]</dt>
<dd><a href="./03_p2p-graph-sync.md">Peer-to-Peer Context Synchronisation Protocol</a>.</dd>

<dt>[GRAPH-FLOWS]</dt>
<dd><a href="./07_graph-flows.md">Graph Flows</a>.</dd>

<dt>[GROUP-IDENTITY]</dt>
<dd><a href="./06_group-identity.md">Decentralised Group Identity</a>.</dd>
</dl>
