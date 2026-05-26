# Graph Capability Framework

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a capability-based authorisation framework for linked data **contexts** (named graphs identified by `graph://<content-hash>` IRIs, as defined in [[PERSONAL-LINKED-DATA-GRAPHS]]). It defines a **root capability** minted at context creation, a delegation algebra for [[ZCAP-LD]] capabilities targeting context IRIs, a **caveat type system** for fine-grained attenuation, three explicit **enforcement modes** (Open / Announced / Enforced), and a scope-inheritance mechanism via mutual `context://participates_in` / `context://accepts_participation` declarations. The framework is *vocabulary-neutral*: it defines the structure of capability chains and caveats, and an extension point through which specific constraint kinds (temporal, content, credential, shape) plug in via extension specifications or applications. Authority is constituted, not granted — no principal sits above the structure; capability chains trace to each context's own root capability. A ZCAP's `invoker` is a DID — typically an individual's `did:key` — and the framework treats a context's optional sovereign DID (the `did` attribute defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3) as an additional invoker form: when a capability is invoked by a delegate of a context's DID, the framework consults that DID's document to verify the signer.

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
9. [Caveat Type System](#9-caveat-type-system)
10. [Governance of DID-Document Delegates](#10-governance-of-did-document-delegates)
11. [Governance API on Context](#11-governance-api-on-context)
12. [Rule Evolution](#12-rule-evolution)
13. [Security Considerations](#13-security-considerations)
14. [Privacy Considerations](#14-privacy-considerations)
15. [Examples](#15-examples)
16. [Predicate Reference Table](#16-predicate-reference-table)
17. [References](#17-references)

---

## 1. Introduction

### 1.1 Motivation

Contexts face a fundamental authorisation problem: without enforceable rules, any agent with sync access can add any triple. There is no inherent mechanism to restrict who may contribute or under what conditions.

Application-layer enforcement is insufficient. Applications are swappable by design; an application that refuses to display certain triples provides no guarantee — another application can bypass the restrictions. **The application layer is not an authorisation boundary.**

This specification places authorisation at the data layer: every triple write may be required to carry a verifiable capability chain rooted in the context's own root capability. Capability checks are deterministic, signed, and re-evaluable by any peer with the context's local state.

### 1.2 Authority Is Constituted, Not Granted

When a context comes into existence, a single **root capability** is minted as a ZCAP, signed by the creator using their `did:key` (or, for a context created within a parent context that carries a sovereign DID, signed by a `capabilityDelegation` delegate of the parent's DID).

From that moment, the structure of who-can-do-what is the accumulated history of delegations made by participants according to the governance rules they themselves defined. No principal sits above the structure. The creator initially holds the root capability and MAY delegate or rotate it — but as soon as they delegate it, others have equal standing under the new rules. Authority is **constituted**, not granted.

### 1.3 ZCAPs Target Sovereign DIDs

The critical architectural decision: **a graph's *sovereign* identifier is the canonical resource of a ZCAP that governs its evolution**. A graph IRI (`graph://<content-hash>`) is a snapshot address — it changes whenever the graph's triples change (see [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3) — and so cannot serve as the resource of a ZCAP that is meant to outlive even a single write. A sovereign DID (the `did` attribute defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3) does not change with content, so it can. Therefore:

- For a context that carries a sovereign DID, ZCAP `resource` SHOULD be that DID. Capabilities then survive every mutation to the graph's content.
- A ZCAP MAY target a `graph://<content-hash>` IRI when authority is *deliberately* scoped to one snapshot — for example, "may sign a republication of *this specific* state". Such capabilities expire (in the sense that they no longer match the context's current resource) as soon as the graph mutates; this is the intended semantics.
- For a context with no sovereign DID, the only identifier available is its current IRI. ZCAPs against such contexts therefore only make sense for one-shot, immutable artifacts. Long-lived governance against a mutable graph REQUIRES a sovereign DID; how one is attached is out of scope for this specification.

### 1.4 Enforcement Modes

Communities crystallise authorisation over time, not all at once. This specification defines three explicit enforcement modes ([§5](#5-enforcement-modes)):

| Mode | Behaviour |
|---|---|
| **Open** | No ZCAP checking. Anyone with sync access can write. The default for fresh contexts. |
| **Announced** | ZCAPs are stored and verifiable, but not enforced. Provides an audit trail. |
| **Enforced** | ZCAP verification is mandatory on every write. No valid capability chain → write rejected. |

### 1.5 Design Principles

1. **Ontology-agnostic.** The framework references predicates and DIDs, never application-specific entity names.
2. **Rules as data.** Governance rules are triples. Modifying rules uses the same mechanisms as content.
3. **Context nesting.** Constraints attached to a parent context apply to child contexts that declare `context://participates_in <parent>`. Participation is declared from below; no parent can override a child's local rules.
4. **Consensus-enforced.** All peers run the same logic on the same data, producing deterministic accept/reject decisions.
5. **Fail-closed.** When in doubt the engine SHOULD reject.
6. **Constitutionalisation.** Each constituent context's root capability is bootstrapped from its creating context's delegation but becomes the new context's own root. The creating context cannot reach into the new context's governance after bootstrap.

### 1.6 Relationship to Other Specifications

- [[DECENTRALISED-IDENTITY]] defines `did:key` and the `DIDCredential` signing surface.
- [[PERSONAL-LINKED-DATA-GRAPHS]] defines the Context that this framework governs, including the optional sovereign DID (`Context.did`) and its DID-document delegate model that this framework's `updateDIDDocument` ZCAP governs.
- [[ZCAP-LD]] defines the underlying capability data model.

Specific constraint kinds (temporal, content, credential, shape) are out of scope here; they plug in via extension specifications or applications using the mechanism in [§9.4](#94-constraint-kind-plug-ins).

### 1.7 Use Cases

- **Community moderation.** Role-based permissions defined as graph data, enforced identically by all peers.
- **Collaborative workspaces.** Multiple agents collaborate on a document context with section-level capabilities.
- **Peer-to-peer social.** Spam prevention via temporal caveats, content restrictions via content caveats — no central server.
- **Multi-identity systems.** Contexts where many independent identities participate enforce authorisation over each one's writes.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming **governance engine** is a software component that implements the algorithms in Sections [§6](#6-scope-resolution-context-nesting), [§7](#7-zcap-verification-algorithm), and [§8](#8-capability-attenuation), supports all three enforcement modes ([§5](#5-enforcement-modes)), and exposes the API defined in [§11](#11-governance-api-on-context).

A conforming **constraint-kind plug-in** (as may be supplied by an extension specification or by applications) MUST implement the verification interface defined in [§9.4](#94-constraint-kind-plug-ins).

A conforming **application** MAY call the governance engine's query methods to determine allowed actions, but MUST NOT be relied upon as an enforcement point.

---

## 3. Terminology

<dl>

<dt>Context</dt>
<dd>A named graph identified by a <code>graph://&lt;content-hash&gt;</code> IRI, optionally also addressable by a sovereign DID (the <code>did</code> attribute). The unit of governance. See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt>Triple</dt>
<dd>A directed, labelled relationship (subject, predicate, object). See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.1.</dd>

<dt>Constraint</dt>
<dd>A set of triples with <code>governance://</code> predicates defining a rule. Classified by <em>kind</em>; specific kinds are out of scope for this specification (see [§9.4](#94-constraint-kind-plug-ins)).</dd>

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
<dd>A typed constraint that narrows a ZCAP. Each delegation in a chain MAY add caveats but MUST NOT remove them. See [§9](#9-caveat-type-system).</dd>

<dt>Enforcement Mode</dt>
<dd>One of Open, Announced, or Enforced. A property of a context governing how the engine treats capability checks.</dd>

<dt>Governance Engine</dt>
<dd>A software component that evaluates incoming triples against all constraints in scope and returns a validation result.</dd>

<dt>Validation Result</dt>
<dd>The output of a governance engine evaluation: ACCEPT or REJECT, with the rejecting constraint identified.</dd>

</dl>

---

## 4. Data Model

This section defines the `governance://` predicates this framework defines. Constraint-kind-specific predicates are out of scope here and are declared by the specifications or applications that define those kinds (via the plug-in mechanism in [§9.4](#94-constraint-kind-plug-ins)). All predicates use string-literal targets unless otherwise noted.

### 4.1 Constraint Base Type

Every constraint instance MUST have:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ <kind>
```

The framework recognises the kind `"capability"` natively (defined in [§4.5](#45-capability-constraints-zcap-based)). All other kinds are supplied by extension specifications or application-defined plug-ins ([§9.4](#94-constraint-kind-plug-ins)). The framework engine MUST treat unknown kinds conservatively (defer to a registered plug-in if present; otherwise reject the operation).

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
- By a `capabilityDelegation` delegate of the creating context's sovereign DID if the context is created as a participant of a parent context that carries one.

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

#### 4.5.2 Self-Reference: Why `resource` MUST Be the Sovereign DID

A ZCAP that governs a context typically lives **as triples inside that context** — its triples are part of the same graph whose authority it asserts. This creates an apparent self-reference: how does a ZCAP stored *in* graph G describe graph G?

The answer is the two-layer identifier model defined by [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.

- A ZCAP's `resource` MUST be the graph's sovereign DID — its **content-independent identity**, independent of the graph's content.
- A ZCAP's `resource` MUST NOT be the graph's `graph://<content-hash>` IRI when the intent is ongoing authority. The IRI is a snapshot hash; adding the ZCAP triple to the graph changes the content and therefore changes the IRI, so any IRI-resourced ZCAP would target a state that no longer exists. (You also could not compute the post-add IRI before the ZCAP existed — a chicken-and-egg.)

An IRI-resourced ZCAP is *only* the correct primitive for **snapshot-scoped authority** — e.g., "authority to republish *this exact* state". Such a capability naturally ceases to match the context's current resource on the next mutation. This is the intended semantics, not a defect.

A consequence: a context that never receives a sovereign DID cannot have long-lived governance written into it. Conforming `createGovernanceLayer` implementations SHOULD reject host contexts with no sovereign DID.

#### 4.5.3 ZCAP Document Structure

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
  "resource": "did:example:z6MkChannelGeneral...",
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
| `resource` | URI | REQUIRED | The context's sovereign DID for long-lived governance (RECOMMENDED for any context that carries one). A `graph://<content-hash>` IRI MAY be used when authority is deliberately scoped to a specific snapshot — see [§3](#3-zcap-shape). |
| `caveats` | Array of caveat objects | OPTIONAL | Fine-grained constraints ([§9](#9-caveat-type-system)). |
| `proof` | Object | REQUIRED | Cryptographic proof signed by the delegator. The delegator MUST be the `invoker` of the parent capability (or the holder of a `capabilityDelegation` delegate key on the parent invoker's DID document if the parent invoker is a graph DID). |

#### 4.5.3 Actions

Standard actions:

| Action | Meaning |
|---|---|
| `createLink` | Author a new triple in the context |
| `removeLink` | Remove an existing triple |
| `updateProperty` | Modify a scalar property of a ShapeInstance |
| `updateSHACL` | Register or modify shapes (defined by an extension specification) |
| `updateGovernance` | Add/remove governance constraints |
| `updateFlow` | Register or modify flows (defined by an extension specification) |
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

### 4.6 Default Capability

A **default capability** template — the ZCAP automatically issued to agents joining a context:

```
<default-cap-id> -[governance://entry_type]→ governance://default_capability
<default-cap-id> -[governance://default_capability_actions]→ <comma-separated actions>
<default-cap-id> -[governance://default_capability_caveats]→ <JSON array of caveat objects>
```

When an agent joins, a runtime SHOULD issue a ZCAP matching the default template. The engine does not perform issuance — it reads templates so join-flow implementations know what to issue.

### 4.7 Revocation List

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

Non-capability constraints (those defined by extension specifications or applications) apply in **all three modes**. The enforcement mode only governs whether *capability* checks are advisory or mandatory.

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

4. **Find author's capabilities.** Query for `<author> -[governance://has_zcap]→ ?cap`, resolving each ZCAP. Include capabilities whose `invoker` is a graph's sovereign DID *if* the author currently holds a `capabilityInvocation` delegate on that DID's document.

5. **Evaluate each capability.**
   1. **Action match.** *action* MUST be in `cap.actions`.
   2. **Resource match.** `cap.resource` MUST equal the context's sovereign DID (the stable, content-independent identifier, when present) OR the context's current IRI (when the capability is deliberately scoped to this specific snapshot), or be an ancestor in the scope chain. Capabilities whose `resource` is an IRI that no longer matches the current state do not apply.
   3. **Expiry check.** If `caveats[].expiry.expiresAt` is set and exceeded, skip.
   4. **Revocation check.** If a valid revocation targets this `cap.id`, skip.
   5. **Caveat check.** Evaluate each caveat ([§9](#9-caveat-type-system)) against the operation. If any fails, skip.
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

## 9. Caveat Type System

This section is normative.

### 9.1 Caveat Format

Each caveat in a ZCAP's `caveats` array is:

```json
{ "type": "<caveat-type>", "value": { ... } }
```

The framework defines the format and the meta-semantics of caveats (composition, attenuation). Specific caveat **types** are defined by this framework only when they are core to capability mechanics; the broader vocabulary is supplied by extension specifications and by applications.

### 9.2 Core Caveat Types

The following caveats are defined by this framework because they apply to the capability mechanism itself, independently of any constraint vocabulary:

| Type | Purpose | `value` shape |
|---|---|---|
| `expiry` | Delegation expires at a time | `{ "expiresAt": "<RFC3339>" }` |
| `predicate` | Restrict to specific predicates | `{ "allowed": ["<uri>", ...], "denied": ["<uri>", ...] }` |
| `property` | Restrict to specific property paths | `{ "allowed": ["<uri>", ...], "denied": ["<uri>", ...] }` |
| `rateLimit` | Max operations per window | `{ "maxPerWindow": <int>, "windowSeconds": <int> }` |
| `cardinality` | Max total uses of this delegation | `{ "max": <int> }` |
| `subject` | Restrict triple subject patterns (glob) | `{ "pattern": "<glob>" }` |
| `object` | Restrict triple object patterns (glob) | `{ "pattern": "<glob>" }` |
| `authorOnly` | Operation must come from the original instance creator | `{}` |

Additional caveat types are defined by extension specifications or by applications. The engine MUST treat unknown caveat types conservatively (reject the operation) unless a registered plug-in supplies handling.

### 9.3 Three Levels of Granularity

- **Coarse (graph-level):** `actions: [createLink], caveats: []` — "can write anything to this context."
- **Medium (predicate-level):** `+ { "type": "predicate", "value": { "allowed": ["msg://body"] }}` — "can only write the `msg://body` predicate."
- **Fine (shape-level, requires an extension caveat type):** `+ { "type": "shape", "value": { "shapeIri": "msg://MessageShape" }}` — "can only write data conforming to MessageShape."

### 9.4 Constraint-Kind Plug-ins

Specific constraint kinds (and the corresponding caveat types) are supplied by plug-ins. A plug-in supplies, at minimum:

```
interface ConstraintKindHandler {
  USVString kind;                              // e.g., "temporal", "content", "credential"
  Promise<ValidationResult> validate(
    TripleInput triple,
    GraphConstraint constraint,
    ValidationContext ctx
  );
}
```

The engine routes constraint validation to the registered handler for the constraint's `governance://constraint_kind`. Unregistered kinds cause the framework to reject the write (fail-closed).

Extension specifications and applications MAY register handlers for additional kinds (e.g., `temporal`, `content`, `credential`, `shape`).

### 9.5 Performance

Caveat evaluation is designed for negligible overhead:

- `predicate`, `property` — O(1) set lookup.
- `subject`, `object` — glob match.
- `rateLimit`, `cardinality` — counter lookup with TTL cache.
- Plug-in-supplied caveats — defined by the plug-in.

---

## 10. Governance of DID-Document Delegates

This section is normative.

A context's optional sovereign DID (per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3) is associated with a DID document whose capability sections list one or more verification methods. This delegate model gives the context shared signing authority across multiple keys. Modifying the DID-document triples is a write to the context's own graph and is therefore governed by this specification.

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

This specification does NOT define multisig, threshold signing, or aggregate-key schemes for the graph DID itself. Shared authority is achieved through the delegate set in the DID document; "this graph said it" is satisfied by any current delegate's signature.

---

## 11. Governance API on Context

```webidl
[Exposed=Window,Worker]
partial interface Context {
  [NewObject] Promise<GovernanceValidationResult> canAddTriple(Triple triple);
  [NewObject] Promise<sequence<GraphConstraint>> constraintsFor(USVString contextDid);
  [NewObject] Promise<sequence<CapabilityInfo>> myCapabilities();
  [NewObject] Promise<EnforcementMode> enforcementMode();
  [NewObject] Promise<undefined> setEnforcementMode(EnforcementMode mode);
};

enum EnforcementMode { "open", "announced", "enforced" };

dictionary GovernanceValidationResult {
  required boolean allowed;
  USVString? rejectedBy;       // constraint id
  USVString? module;            // "capability" | <plug-in kind>
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
  required USVString resource;     // sovereign DID (RECOMMENDED) or specific-snapshot graph IRI
  sequence<object> caveats;
  DOMString? expires;
};
```

### 11.1 `canAddTriple()`

Evaluates whether the current identity would be permitted to add the triple. Executes the algorithms in [§7](#7-zcap-verification-algorithm) followed by any registered constraint-kind plug-ins ([§9.4](#94-constraint-kind-plug-ins)). Stops at first rejection.

### 11.2 `constraintsFor()`

Returns all constraints applying to a context, including those inherited via the scope chain.

### 11.3 `myCapabilities()`

Returns valid, non-revoked, non-expired capabilities held by the current identity for this context.

### 11.4 `enforcementMode()` / `setEnforcementMode()`

Reads the current enforcement mode; the setter requires an `updateGovernance` capability on the context.

### 11.5 Consumer Integration

The framework exposes `canAddTriple()` (and the internal `validate(triple, ctx)` it implements) as the integration point for any consumer that needs authorisation checks (for example, a sync protocol). The framework itself does not depend on any particular consumer.

---

## 12. Rule Evolution

### 12.1 Adding a Rule

An authorised agent (holding `updateGovernance` for the context) creates a constraint instance and binds it via `governance://has_constraint`. The triples propagate via sync; all peers enforce the new rule on receipt.

### 12.2 Modifying a Rule

Remove existing constraint triples, add new ones. SHOULD be atomic.

### 12.3 Removing a Rule

Remove the `governance://has_constraint` binding.

### 12.4 Mode Promotion

Change `governance://enforcement_mode`. Subject to `updateGovernance`.

### 12.5 Propagation

Constraint changes propagate via sync like any other triple. During the propagation window, peers may temporarily enforce different rule sets; this is inherent to eventual consistency.

### 12.6 No Restart Required

Governance rules are interpreted at runtime.

---

## 13. Security Considerations

### 13.1 Cryptographic Verification

ZCAP chain verification MUST validate all signatures. For graph-DID-signed delegations, the runtime MUST resolve the graph's DID document and verify that the signing method is currently listed in `capabilityDelegation`.

### 13.2 Revocation Freshness

Revocation checking MUST be performed on every validation. Caching is permitted for short periods (seconds) but MUST invalidate on new revocation triples.

### 13.3 Revocation Propagation Delay

Revocations are eventually consistent. Implementations SHOULD prioritise governance-related triples in sync.

### 13.4 Bootstrap Constitutionalisation Integrity

When a context is bootstrapped from a parent, the bootstrap ZCAP MUST be verified at the child's creation time. After constitutionalisation, the parent's signing key MUST NOT have any standing in the child's governance.

### 13.5 DID Document Tampering

DID-document triples (`did-document://*`) are governance-controlled. An agent who modifies them without `updateDIDDocument` capability is performing an unauthorised governance write; the engine MUST reject the triple at the standard validation step.

### 13.6 Mutual Participation

Inheritance via `context://participates_in` MUST be mutual. Implementations that skip the `context://accepts_participation` check are vulnerable to inheritance hijacking.

### 13.7 Constraint Flooding

Limit the number of constraints evaluated per validation (RECOMMENDED: 1000 per scope chain).

### 13.8 Unknown Constraint Kinds

Unknown `constraint_kind` values MUST cause rejection (fail-closed). Implementations MUST NOT silently ignore unrecognised constraint kinds.

### 13.9 Unknown Caveat Types

Unknown caveat `type` values MUST cause rejection unless a plug-in handler is registered. Silent ignore would allow an attacker to bypass attenuation by adding a no-op caveat type.

---

## 14. Privacy Considerations

### 14.1 Rule Transparency

All governance rules are visible to peers with read access to the context. There are no hidden rules.

### 14.2 Capability Visibility

ZCAPs are stored as graph data; this reveals which agents hold which permissions.

### 14.3 Enforcement Mode Disclosure

A context's enforcement mode is itself public (a governance triple). Communities transitioning into Enforced mode SHOULD coordinate the change.

---

## 15. Examples

### 15.1 Bootstrap: Creating a Context with a Root Capability

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

### 15.2 Promote Through Enforcement Modes

```javascript
console.log(await community.enforcementMode());   // "open"

// Promote to Announced while wiring up roles.
await community.setEnforcementMode("announced");

// Once confident, lock down to Enforced.
await community.setEnforcementMode("enforced");
```

### 15.3 Delegate Capabilities (Admin → Moderator → Member)

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

### 15.4 Bootstrap a Child Context (Constitutionalisation)

```javascript
const general = await me.createContext({
  displayName: "#general",
  participatesIn: community.did
});
// The runtime:
//   1. Mints a fresh graph IRI for #general (and a sovereign DID for long-lived
//      governance, when supported by the runtime).
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

### 15.5 Revoking a Capability (Ban)

```javascript
await community.addTriple({
  subject: admin.did,
  predicate: "governance://revokes_capability",
  object: modCap.id
});
// Mod's chain is invalidated; sub-delegations from mod are also invalidated.
```

Examples of temporal, content, credential, and shape constraints are defined by extension specifications that supply those constraint kinds.

---

## 16. Predicate Reference Table

| Predicate | Target Type | Description |
|---|---|---|
| `governance://entry_type` | URI | Type discriminator for governance instances |
| `governance://constraint_kind` | String literal | `"capability"` or a plug-in-supplied kind |
| `governance://constraint_scope` | URI | Explicit scope (overrides inferred) |
| `governance://has_constraint` | URI | Binds a constraint to a context |
| `governance://root_capability` | URI | The context's root ZCAP |
| `governance://enforcement_mode` | String literal | `"open"` \| `"announced"` \| `"enforced"` |
| `governance://capability_enforcement` | String literal | `"required"` \| `"optional"` |
| `governance://capability_predicates` | Comma-separated URIs | Predicates requiring capability verification |
| `governance://has_zcap` | URI | Links an agent DID to a held capability |
| `governance://revokes_capability` | URI (ZCAP id) | Revocation triple |
| `governance://default_capability_actions` | Comma-separated actions | Default ZCAP template |
| `governance://default_capability_caveats` | JSON array | Default ZCAP caveats |
| `context://participates_in` | URI (context DID) | Child declares participation in parent (in the child's graph) |
| `context://accepts_participation` | URI (context DID) | Parent confirms acceptance (in the parent's graph, signed by a `capabilityDelegation` delegate) |
| `did-document://add-method` | URI | Add a `verificationMethod` to a graph DID's document |
| `did-document://remove-method` | URI | Remove a `verificationMethod` |
| `did-document://grant-section` | URI | Add method to a capability section |
| `did-document://revoke-section` | URI | Remove method from a capability section |

Plug-in-supplied constraint kinds (e.g., `temporal`, `content`, `credential`) declare additional predicates in their own specifications.

---

## 17. References

### 17.1 Normative References

<dl>
<dt>[RFC2119]</dt>
<dd>Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.</dd>

<dt>[RFC8174]</dt>
<dd>Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.</dd>

<dt>[RFC3339]</dt>
<dd>Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002.</dd>

<dt>[ZCAP-LD]</dt>
<dd>Longley, D., Sporny, M., and C. Webber, "Authorization Capabilities for Linked Data", W3C Community Group Report. https://w3c-ccg.github.io/zcap-spec/</dd>

<dt>[DID-CORE]</dt>
<dd>Sporny, M., et al., "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. https://www.w3.org/TR/did-core/</dd>

<dt>[DECENTRALISED-IDENTITY]</dt>
<dd><a href="./01_decentralised-identity-web-platform.md">Decentralised Identity Integration for the Web Platform</a>.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="./02_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>.</dd>

<dt>[ECMA-262]</dt>
<dd>Ecma International, "ECMAScript® Language Specification". https://tc39.es/ecma262/</dd>
</dl>

### 17.2 Informative References

None.
