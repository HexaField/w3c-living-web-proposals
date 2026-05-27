# Graph Capability Framework

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a capability-based authorisation framework for linked data **graphs** as defined in [[PERSONAL-LINKED-DATA-GRAPHS]]. It defines a **root capability** minted at graph creation, a delegation algebra for [[ZCAP-LD]] capabilities targeting graph DIDs, a **caveat type system** with immutable per-delegation attenuation, three explicit **enforcement modes** (Open / Announced / Enforced), and a **scope-set** mechanism by which constraints from mutually-participating graphs accumulate over writes to any graph in the set. Participation declarations are directional and consent-gated; declaring participation in both directions creates a **holonic** relationship where governance flows both ways, while a single-direction declaration creates a conventional **hierarchical** relationship. The framework is *vocabulary-neutral*: it defines the structure of capability chains and caveats, and an extension point through which specific constraint kinds (temporal, content, credential, shape) plug in via other specifications or applications. Authority is constituted, not granted — no principal sits above the structure; capability chains trace to each graph's own root capability. A ZCAP's `invoker` is a DID — typically an individual's `did:key` — and the framework treats a graph's DID (per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3, populated by mechanisms such as [[GROUP-IDENTITY]]) as an additional invoker form: when a capability is invoked by a delegate of a graph's DID, the framework consults that DID's document to verify the signer.

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
6. [Scope Resolution (Graph Participation)](#6-scope-resolution-graph-participation)
7. [ZCAP Verification Algorithm](#7-zcap-verification-algorithm)
8. [Capability Attenuation](#8-capability-attenuation)
9. [Caveat Type System](#9-caveat-type-system)
10. [DID-Document Writes Are Governance Writes](#10-did-document-writes-are-governance-writes)
11. [Governance API on Graph](#11-governance-api-on-graph)
12. [Rule Evolution](#12-rule-evolution)
13. [Security Considerations](#13-security-considerations)
14. [Privacy Considerations](#14-privacy-considerations)
15. [Examples](#15-examples)
16. [Predicate Reference Table](#16-predicate-reference-table)
17. [References](#17-references)

---

## 1. Introduction

### 1.1 Motivation

Graphs face a fundamental authorisation problem: without enforceable rules, any agent with sync access can add any triple. There is no inherent mechanism to restrict who may contribute or under what conditions.

Application-layer enforcement is insufficient. Applications are swappable by design; an application that refuses to display certain triples provides no guarantee — another application can bypass the restrictions. **The application layer is not an authorisation boundary.**

This specification places authorisation at the data layer: every triple write may be required to carry a verifiable capability chain rooted in the graph's own root capability. Capability checks are deterministic, signed, and re-evaluable by any peer with the graph's local state.

### 1.2 Authority Is Constituted, Not Granted

When a graph comes into existence, a single **root capability** is minted as a ZCAP, signed by the creator using their `did:key` (or, for a graph created within a participating graph that carries a DID, signed by a `capabilityDelegation` delegate of that graph's DID).

From that moment, the structure of who-can-do-what is the accumulated history of delegations made by participants according to the governance rules they themselves defined. No principal sits above the structure. The creator initially holds the root capability and MAY delegate or rotate it — but as soon as they delegate it, others have equal standing under the new rules. Authority is **constituted**, not granted.

### 1.3 ZCAPs Target Graph DIDs

The critical architectural decision: **a graph's DID is the canonical resource of a ZCAP that governs its evolution**. A graph IRI (`graph://<content-hash>`) is a snapshot address — it changes whenever the graph's triples change (see [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3) — and so cannot serve as the resource of a ZCAP that is meant to outlive even a single write. A graph's `did` (per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3) does not change with content, so it can. Therefore:

- For a graph that carries a DID, ZCAP `resource` SHOULD be that DID. Capabilities then survive every mutation to the graph's content.
- A ZCAP MAY target a `graph://<content-hash>` IRI when authority is *deliberately* scoped to one snapshot — for example, "may sign a republication of *this specific* state". Such capabilities expire (in the sense that they no longer match the graph's current resource) as soon as the graph mutates; this is the intended semantics.
- For a graph with no DID, the only identifier available is its current IRI. ZCAPs against such graphs therefore only make sense for one-shot, immutable artifacts. **Long-lived governance against a mutable graph REQUIRES a graph DID**; this specification depends on a mechanism for attaching one (see [§1.6](#16-relationship-to-other-specifications)).

### 1.4 Enforcement Modes

Communities crystallise authorisation over time, not all at once. This specification defines three explicit enforcement modes ([§5](#5-enforcement-modes)):

| Mode | Behaviour |
|---|---|
| **Open** | No ZCAP checking. Anyone with sync access can write. The default for fresh graphs. |
| **Announced** | ZCAPs are stored and verifiable, but not enforced. Provides an audit trail. |
| **Enforced** | ZCAP verification is mandatory on every write. No valid capability chain → write rejected. |

### 1.5 Design Principles

1. **Ontology-agnostic.** The framework references predicates and DIDs, never application-specific entity names.
2. **Rules as data.** Governance rules are triples. Modifying rules uses the same mechanisms as content.
3. **Bidirectional governance via mutual participation.** Constraints flow along consent-gated `context://participates_in` edges. A single-direction declaration produces conventional hierarchical inheritance (parent rules bind child); bidirectional declarations produce holonic governance (both rule sets bind both graphs). One mechanism covers both ([§6](#6-scope-resolution-graph-participation)).
4. **Constraints accumulate; never silently override.** A child's same-kind constraint does NOT replace an ancestor's. Both apply. Same-kind composition is **deny-wins**. Children cannot escape ancestor rules by re-declaring loosely.
5. **Consensus-enforced.** All peers run the same logic on the same data, producing deterministic accept/reject decisions.
6. **Fail-closed.** When in doubt the engine MUST reject.
7. **Constitutionalisation.** Each constituent graph's root capability is bootstrapped from its creating graph's delegation but becomes the new graph's own root. The creating graph cannot reach into the new graph's root chain after bootstrap; the bootstrap delegation chain is *cut* at the boundary ([§4.3](#43-governance-bootstrap-root-capability), [§7](#7-zcap-verification-algorithm)).
8. **Immutable caveats.** Each delegation MAY add caveats but MUST NOT modify or remove caveats present on its parent ([§8](#8-capability-attenuation)).

### 1.6 Relationship to Other Specifications

- [[DECENTRALISED-IDENTITY]] defines `did:key` and the `DIDCredential` signing surface.
- [[PERSONAL-LINKED-DATA-GRAPHS]] defines the Graph that this framework governs and reserves the `did` slot at [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.
- [[GROUP-IDENTITY]] defines `did:graph` and the DID-document-as-triples model that populates the `did` slot for governable graphs. **This framework REQUIRES a DID-attachment mechanism that gives graphs an in-graph DID document with `capabilityDelegation` / `capabilityInvocation` sections.** `did:graph` is the model this framework is written against; other methods MAY be used provided they conform to the same in-graph delegate model.
- [[ZCAP-LD]] defines the underlying capability data model.

Specific constraint kinds (temporal, content, credential, shape) are out of scope here; they plug in via other specifications or applications using the mechanism in [§9.3](#93-plug-in-mechanism).

### 1.7 Use Cases

- **Community moderation.** Role-based permissions defined as graph data, enforced identically by all peers.
- **Collaborative workspaces.** Multiple agents collaborate on a document graph with section-level capabilities.
- **Peer-to-peer social.** Spam prevention via temporal caveats, content restrictions via content caveats — no central server.
- **Multi-identity systems.** Graphs where many independent identities participate enforce authorisation over each one's writes.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming **governance engine** is a software component that implements the algorithms in Sections [§6](#6-scope-resolution-graph-participation), [§7](#7-zcap-verification-algorithm), and [§8](#8-capability-attenuation), supports all three enforcement modes ([§5](#5-enforcement-modes)), and exposes the API defined in [§11](#11-governance-api-on-graph).

A conforming **constraint-kind plug-in** (as may be supplied by another specification or by applications) MUST implement the verification interface defined in [§9.3](#93-plug-in-mechanism).

A conforming **application** MAY call the governance engine's query methods to determine allowed actions, but MUST NOT be relied upon as an enforcement point.

A conforming implementation **REQUIRES** access to graphs with DIDs whose documents are stored as in-graph triples per [[GROUP-IDENTITY]] §5. An implementation that does not have such graphs available MAY refuse to instantiate governance for them. The engine MUST reject `createGovernanceLayer` calls against graphs whose `did` slot is null.

---

## 3. Terminology

<dl>

<dt>Graph</dt>
<dd>A named graph identified by a <code>graph://&lt;content-hash&gt;</code> IRI, optionally also addressable by a DID (the <code>did</code> attribute). The unit of governance. See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt>Triple</dt>
<dd>A directed, labelled relationship (subject, predicate, object). See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.1.</dd>

<dt>Constraint</dt>
<dd>A set of triples with <code>governance://</code> predicates defining a rule. Classified by <em>kind</em>; specific kinds are out of scope for this specification (see [§9.3](#93-plug-in-mechanism)).</dd>

<dt>Constraint Binding</dt>
<dd>A triple linking a constraint to the graph it governs: <code>&lt;graph-did&gt; -[governance://has_constraint]→ &lt;constraint&gt;</code>.</dd>

<dt>Scope Set</dt>
<dd>The set of graphs whose constraints apply to a write in some target graph: the target plus every graph reachable from it by walking <code>context://participates_in</code> edges that are confirmed by the corresponding <code>context://accepts_participation</code> declaration on the other side. The set is unordered; depth is recorded per-graph for audit only ([§6](#6-scope-resolution-graph-participation)).</dd>

<dt>Hierarchical Participation</dt>
<dd>The case where exactly one of two graphs declares <code>participates_in</code> the other (with mutual acceptance). Only the participatee's constraints bind the participator's writes; not vice versa.</dd>

<dt>Holonic Participation</dt>
<dd>The case where both graphs declare <code>participates_in</code> each other (with mutual acceptance on both sides). Each graph's constraints bind writes in the other. The same mechanism as hierarchical participation, just declared in both directions.</dd>

<dt>Root Capability</dt>
<dd>The ZCAP minted when a graph comes into existence. Initially held by the creator; delegatable like any other ZCAP.</dd>

<dt>Bootstrap Constitutionalisation</dt>
<dd>The process by which a child graph's root capability is delegated from its creating graph's delegation. Once written into the child's graph, the bootstrap becomes the child's own root and the chain is <em>cut</em>: ZCAP chain verification within the child terminates at the bootstrap delegation and does NOT walk into the parent's chain. The creating graph cannot subsequently modify the child's internal governance.</dd>

<dt>Capability</dt>
<dd>An authorisation token conforming to [[ZCAP-LD]] that grants a specific agent (or a graph DID) permission to perform specific actions on a specific resource (a graph DID). Delegatable, attenuable, revocable, cryptographically verifiable.</dd>

<dt>Caveat</dt>
<dd>A typed constraint attached to a ZCAP. Each delegation MAY add new caveats but MUST NOT modify or remove caveats present on its parent (immutable-caveats attenuation, [§8](#8-capability-attenuation)).</dd>

<dt>Enforcement Mode</dt>
<dd>One of Open, Announced, or Enforced. A property of a graph governing how the engine treats capability checks.</dd>

<dt>Governance Engine</dt>
<dd>A software component that evaluates incoming triples against all constraints in scope and returns a validation result.</dd>

<dt>Validation Result</dt>
<dd>The output of a governance engine evaluation: ACCEPT or REJECT, with the rejecting constraint identified.</dd>

</dl>

---

## 4. Data Model

This section defines the `governance://` predicates this framework defines. Constraint-kind-specific predicates are out of scope here and are declared by the specifications or applications that define those kinds (via the plug-in mechanism in [§9.3](#93-plug-in-mechanism)). All predicates use string-literal targets unless otherwise noted.

### 4.1 Constraint Base Type

Every constraint instance MUST have:

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ <kind>
```

The framework recognises the kind `"capability"` natively (defined in [§4.5](#45-capability-constraints-zcap-based)). All other kinds are supplied by other specifications or application-defined plug-ins ([§9.3](#93-plug-in-mechanism)). The framework engine MUST treat unknown kinds conservatively: if a registered plug-in handles the kind, defer to it; otherwise REJECT the operation (fail-closed).

A constraint applies to the graph to which it is bound by `governance://has_constraint` and — via [§6](#6-scope-resolution-graph-participation) — to writes in every graph in that graph's scope set.

### 4.2 Constraint Binding

A constraint is attached to a graph via:

```
<graph-did> -[governance://has_constraint]→ <constraint-id>
```

A graph MAY have zero or more constraint bindings.

**Scope-set inheritance.** Constraints flow along `context://participates_in` edges with mutual acceptance (see [§6](#6-scope-resolution-graph-participation) for the algorithm and [§6.2](#62-hierarchical-vs-holonic-participation) for the distinction between hierarchical and holonic configurations). A write to graph W is evaluated against the constraints bound to *every* graph in W's scope set.

```
Graph P
  └── governance://has_constraint → [credential requirement: proof of humanity]

Graph C  (declares context://participates_in → P inside C; P accepts)
  └── governance://has_constraint → [temporal: 30s cooldown]
  └── writes here are subject to BOTH constraints (P's credential rule + C's temporal rule)
```

**Constraints accumulate.** When constraints of the same `constraint_kind` exist on multiple graphs in the scope set, **all of them apply**. There is no replacement, override, or "most-specific wins" rule. A child's same-kind constraint adds to, but never displaces, an ancestor's. To relax a constraint inherited from another graph, an authorised agent on the inheriting graph MUST modify the originating constraint at its source — children cannot escape ancestor rules by re-declaring them loosely.

**Deny-wins same-kind composition.** When multiple same-kind constraints evaluate the same write and produce different results, the write is rejected if *any* of them reject ([§6.3](#63-precedence-and-conflict-resolution)).

A parent cannot reach into a child's graph to modify the child's constraints. Once a child is bootstrapped, it owns its own rules. Constraint inheritance is one-way per declaration: writes in graph A are bound by graph B's rules only if A `participates_in` B with mutual acceptance from B. Bidirectional binding requires both directions of declaration.

### 4.3 Governance Bootstrap (Root Capability)

When a graph is created and immediately given a DID per [[GROUP-IDENTITY]], a **root capability** is minted as a ZCAP. The bootstrap is signed:

- By the creator's `did:key` if the graph is created standalone.
- By a `capabilityDelegation` delegate of a participating graph's DID if the new graph is created as a participant of that graph. In this case, the creator MUST already hold `updateGovernance` on the participating graph at the moment of bootstrap, because bootstrap involves writing `accepts_participation` into the parent (a governed write per [§5](#5-enforcement-modes)).

The root capability is recorded in the new graph as a flattened [[ZCAP-LD]] document. Using the namespace `zcap = https://w3id.org/zcap/v1#`:

```
<graph-did> -[governance://root_capability]→ <cap-id>

<cap-id> -[rdf:type]→               <zcap:Delegation> .
<cap-id> -[zcap:parentCapability]→  <urn:living-web:zcap:BootstrapRoot> .
<cap-id> -[zcap:invoker]→           <did:key:creator> .
<cap-id> -[zcap:actions]→           "createLink,removeLink,updateSHACL,updateGovernance,updateDIDDocument,delegateCapability" .
<cap-id> -[zcap:resource]→          <graph-did> .
<cap-id> -[zcap:proofValue]→        "<signature>" .
<cap-id> -[zcap:proofPurpose]→      "capabilityDelegation" .
<cap-id> -[zcap:created]→           "2026-05-23T00:00:00Z"^^xsd:dateTime .
```

`<urn:living-web:zcap:BootstrapRoot>` is a **sentinel value** defined by this specification (not a resolvable ZCAP). When the chain-walk algorithm ([§7](#7-zcap-verification-algorithm)) encounters a capability whose `parentCapability` is `BootstrapRoot`, it terminates the walk after validating:

1. `cap.id` matches `<graph-did> -[governance://root_capability]→ ?` for the graph being written to (i.e., this is genuinely the local root).
2. The bootstrap proof was produced either by the creator's `did:key` (standalone case) or by a key that was at the time a `capabilityDelegation` delegate of a graph the new graph then declared participation in (constituted case). After constitutionalisation, that key's standing in the new graph is *cut* — no current delegate status of the parent confers any standing on writes within the child.

The root capability is **constitutionalised**: the bootstrap delegation becomes the new graph's own root. The creating graph cannot subsequently modify the new graph's governance, and the chain walk does NOT walk past `BootstrapRoot` into the parent's chain. Delegations from the new graph's root evolve independently.

**Bootstrap atomicity (normative).** When a child graph is created as a participant of a parent graph, the runtime MUST treat the following as a single atomic diff: (a) the child's `governance://root_capability` triple, (b) the child's `context://participates_in <parent.did>` triple, and (c) the parent's `context://accepts_participation <child.did>` triple. Peers MUST NOT process any of these triples in isolation: either all three are accepted into local state together, or none are. Without atomicity, there exists a window in which the child has declared participation but the parent has not yet accepted (or vice versa), during which the scope-set algorithm ([§6.1](#61-scope-set-resolution)) would not yet include the parent's constraints — writes to the child during that window could escape parent rules. Atomicity closes this gap and is the load-bearing invariant for the constitutionalisation guarantee.

### 4.4 Governance Constraint Conflicts

When constraints disagree on a write, the result is determined by [§6.3](#63-precedence-and-conflict-resolution). The canonical rule is **deny-wins**: if any same-kind constraint evaluating the write rejects, the write is rejected. The audit field `rejectedBy` is attributed to the rejecting constraint at the lowest delegation depth (the most-authoritative); ties are broken by lexicographically greater constraint ID. This affects only the audit record; the rejection itself is decided by deny-wins, not by precedence.

### 4.5 Capability Constraints (ZCAP-based)

A capability constraint requires triple authors to hold valid ZCAPs [[ZCAP-LD]].

#### 4.5.1 Constraint Definition

```
<constraint-id> -[governance://entry_type]→ governance://constraint
<constraint-id> -[governance://constraint_kind]→ "capability"
```

Optional:

```
<constraint-id> -[governance://capability_predicates]→ <comma-separated predicate URIs>
```

Restricts which predicates require capability verification. If absent or empty, all predicates within scope require verification.

The presence of a capability constraint in scope makes capability verification mandatory for matching writes (subject to the enforcement mode in [§5](#5-enforcement-modes)). Earlier drafts defined a `capability_enforcement` field with `"required"` / `"optional"` values; the `"optional"` semantics overlap with Announced mode without adding capability, so the field has been removed. A graph that wants capability checking to be advisory uses Announced mode; a graph that wants no capability checking declares no capability constraint.

#### 4.5.2 Self-Reference: Why `resource` MUST Be the Graph DID

A ZCAP that governs a graph typically lives **as triples inside that graph** — its triples are part of the same graph whose authority it asserts. This creates an apparent self-reference: how does a ZCAP stored *in* graph G describe graph G?

The answer is the two-layer identifier model defined by [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.

- A ZCAP's `resource` MUST be the graph's DID — its **content-independent identity**, independent of the graph's content.
- A ZCAP's `resource` MUST NOT be the graph's `graph://<content-hash>` IRI when the intent is ongoing authority. The IRI is a snapshot hash; adding the ZCAP triple to the graph changes the content and therefore changes the IRI, so any IRI-resourced ZCAP would target a state that no longer exists. (You also could not compute the post-add IRI before the ZCAP existed — a chicken-and-egg.)

An IRI-resourced ZCAP is *only* the correct primitive for **snapshot-scoped authority** — e.g., "authority to republish *this exact* state". Such a capability naturally ceases to match the graph's current resource on the next mutation. This is the intended semantics, not a defect.

A consequence: a graph that never receives a DID cannot have long-lived governance written into it. Per [§2](#2-conformance), conforming engines MUST reject `createGovernanceLayer` calls against graphs whose `did` slot is null.

#### 4.5.3 ZCAP Representation

A ZCAP is a [[ZCAP-LD]] document. Within the substrate it is stored **as triples in the graph it governs**: the JSON-LD is flattened into RDF triples (each JSON-LD property becomes one or more triples on the ZCAP's `id` subject) and persisted alongside the rest of the graph. The engine queries those triples to reconstruct the document.

Using the namespace `zcap = https://w3id.org/zcap/v1#`, a delegated capability is the following set of triples:

```
<cap-id> -[rdf:type]→               <zcap:Delegation> .
<cap-id> -[zcap:invoker]→           <did:key:z6MkAgent...> .
<cap-id> -[zcap:parentCapability]→  <urn:uuid:parent-cap-id> .
<cap-id> -[zcap:actions]→           "createLink,removeLink" .
<cap-id> -[zcap:resource]→          <did:graph:z6MkChannelGeneral...> .
<cap-id> -[zcap:caveats]→           '[{"type":"expiry","value":{"expiresAt":"2027-01-01T00:00:00Z"}}, ... ]' .
<cap-id> -[zcap:proofValue]→        "z..." .
<cap-id> -[zcap:proofPurpose]→      "capabilityDelegation" .
<cap-id> -[zcap:proofMethod]→       <did:key:z6MkIssuer...#key-1> .
<cap-id> -[zcap:created]→           "2026-05-23T00:00:00Z"^^xsd:dateTime .
```

Implementations MAY exchange ZCAPs in their canonical JSON-LD form on the wire; the on-the-wire form is equivalent to the flattened triples above per the JSON-LD-to-RDF mapping in [[JSON-LD12]]. The reference flattening uses one triple per simple field; the `caveats` array is carried as a single JSON-encoded string literal because its internal shape is caveat-type-specific (see [§9](#9-caveat-type-system)).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | URN UUID | REQUIRED | Unique identifier (used as the triple subject) |
| `invoker` | DID | REQUIRED | The agent (or graph DID) authorised to exercise this capability |
| `parentCapability` | URN UUID or `urn:living-web:zcap:BootstrapRoot` | REQUIRED | Parent capability. The sentinel `BootstrapRoot` marks a constitutionalised root ([§4.3](#43-governance-bootstrap-root-capability)). |
| `actions` | Comma-separated string | REQUIRED | Actions this capability authorises ([§4.5.4](#454-actions)). |
| `resource` | URI | REQUIRED | The graph's DID for long-lived governance. A `graph://<content-hash>` IRI MAY be used for snapshot-scoped authority. |
| `caveats` | JSON string | OPTIONAL | Fine-grained constraints ([§9](#9-caveat-type-system)). |
| `proofValue` + `proofMethod` + `proofPurpose` | per [[ZCAP-LD]] | REQUIRED | Cryptographic proof. The proof signer MUST be the `invoker` of the parent capability OR (if that invoker is a graph DID) a current `capabilityDelegation` delegate on that DID's document at the moment the parent's `created` timestamp was current. |

A ZCAP is linked to its holder by the predicate `governance://has_zcap` whose object is the ZCAP's `id`:

```
<agent-did> -[governance://has_zcap]→ <cap-id>
```

The engine resolves a `has_zcap` link by querying for all triples sharing the `<cap-id>` subject (within the scope set, per [§7](#7-zcap-verification-algorithm)).

#### 4.5.4 Actions

This specification defines the following framework-core actions. Additional actions are defined by extension specifications and registered with the engine.

| Action | Defined by | Meaning |
|---|---|---|
| `createLink` | this spec | Author a new triple in the graph |
| `removeLink` | this spec | Remove an existing triple |
| `updateGovernance` | this spec | Add/remove governance constraints (any triple with `governance://` predicate) |
| `updateDIDDocument` | this spec | Add/remove DID-document delegates (any triple with `did-document://` predicate; semantics in [[GROUP-IDENTITY]] §5) |
| `delegateCapability` | this spec | Issue new delegations from this capability (chain-walk requirement, [§7](#7-zcap-verification-algorithm) step 6.5) |
| `mountContext` | this spec | Mount the graph (gates read access, [§7.1](#71-non-triple-operations)) |

Extension specifications MAY register additional actions, for example `updateSHACL` ([[SHAPE-VALIDATION]]) or `updateFlow` ([[GRAPH-FLOWS]]). Applications MAY define further actions. The governance engine MUST treat unknown actions conservatively (require an explicit capability for the unknown action).

##### 4.5.4.1 Action Derivation

Given a triple write, the engine derives the implied `action` as follows:

1. If the triple's predicate begins with one of the registered governed prefixes, the action is the prefix-mapped action. The framework-core registry:

   | Predicate prefix | Action |
   |---|---|
   | `governance://` | `updateGovernance` |
   | `did-document://` | `updateDIDDocument` |

2. Otherwise the action is `createLink` for additions and `removeLink` for removals.

Other specifications and applications MAY register additional prefix → action mappings on the engine (for example `shacl://` / `shape://` → `updateSHACL`, `flow://` → `updateFlow`). The engine MUST NOT allow registration of a prefix that overlaps an existing registration.

#### 4.5.5 Revocation

Any authorised agent MAY revoke an issued capability by writing the following triple into the graph the capability resources:

```
<revoking-agent-did> -[governance://revokes_capability]→ <zcap-id>
```

**Authority to revoke.** A revocation is valid if the revoking agent (or, for graph-DID invokers, a current `capabilityDelegation` delegate on that DID's document) is *any ancestor* in the revoked capability's delegation chain — equivalently, anyone whose own valid capability sits between the revoked capability and the graph's root. This includes:

- The direct parent (the `invoker` of `parentCapability`).
- Any further ancestor up to and including the current root-capability holder.

This matches the natural transitive delegation model: anyone whose authority the revoked capability ultimately derives from MAY revoke it. An agent further down the chain (a delegate of the revoked capability) MAY NOT revoke their delegator.

**Forward-looking semantics.** Revoking C invalidates the entire delegation chain rooted at C from the moment the revocation is observable in the local state. Writes that were accepted under prior local state remain accepted in the historical record; only writes evaluated after the revocation becomes locally observable are affected. This preserves the determinism guarantee (every accept/reject decision is reproducible from the state at the time of evaluation) under eventual consistency.

**Engine requirements.** Conforming engines MUST check the revocation list during every capability verification (at every level of the chain walk). Engines MAY cache revocation status for short periods (seconds) but MUST invalidate the cache on observation of a new `revokes_capability` triple.

**Brick-state protection.** See [§13.10](#1310-brick-state-protection) — revocations that would leave the graph with zero valid capabilities carrying `updateGovernance` MUST be refused by conforming engines.

---

## 5. Enforcement Modes

This section is normative.

### 5.1 The Three Modes

A graph's enforcement mode is recorded as:

```
<graph-did> -[governance://enforcement_mode]→ "open" | "announced" | "enforced"
```

If absent, the default is `"open"`.

| Mode | Capability Check | Audit Trail | Use For |
|---|---|---|---|
| **Open** | No ZCAP checking on writes to this graph. Non-capability constraints (per [§5.3](#53-mode-agnostic-constraints)) still apply. | None for capability decisions; non-capability constraint outcomes are recorded as usual. | New graphs, prototyping, low-trust environments. |
| **Announced** | ZCAPs are stored and verifiable, but capability failures do not reject. | Yes — every write is annotated with the capability chain that *would* have authorised it (or "anonymous" if none). | Transitioning into enforcement; testing rules. |
| **Enforced** | ZCAP verification is mandatory. Writes without a valid chain are rejected. | Yes | Mature governance — production communities. |

**Open mode is not unconditional.** The name refers specifically to *capability* enforcement. A graph in Open mode with, e.g., a registered `temporal` constraint (rate limit) still enforces that constraint. To truly accept any write, a graph must be in Open mode AND have no registered constraints of any kind.

### 5.2 Mode Transitions

A graph can move between modes via writing the `governance://enforcement_mode` triple. The write itself is subject to governance: it requires an `updateGovernance` capability on the graph. The mode change takes effect for all subsequent writes.

The recommended progression is **Open → Announced → Enforced**.

### 5.3 Mode-Agnostic Constraints

Non-capability constraints (those defined by extension specifications or applications) apply in **all three modes**. The enforcement mode only governs whether *capability* checks are advisory or mandatory.

### 5.4 Caveats and Enforcement Mode

In Announced mode, caveats are checked and the result is recorded but never causes rejection. In Enforced mode, caveat violations reject the write.

---

## 6. Scope Resolution (Graph Participation)

This section defines how the governance engine determines which graphs' constraints apply to an incoming write.

### 6.1 Scope-Set Resolution

Given an incoming write to graph `W`:

1. Let *scopeSet* = set containing `W`, with `depth[W] = 0`.
2. Let *frontier* = queue initialised with `W`.
3. While *frontier* is non-empty:
   1. Pop *current*.
   2. Query *current*'s triples for all `<current> -[context://participates_in]→ ?target`.
   3. For each *target* not already in *scopeSet*:
      - **Mutual-acceptance check.** Query *target*'s triples for `<target> -[context://accepts_participation]→ <current>`. The accepts_participation triple's reifier author MUST be a key listed in `capabilityDelegation` on *target*'s DID document at the time of validation. If absent or signed by a non-delegate, **ignore the participation claim** and continue (do NOT add *target*).
      - **Cycle handling.** If *target* is in *scopeSet*, skip (already counted at lower depth).
      - Add *target* to *scopeSet* with `depth[target] = depth[current] + 1`. Enqueue *target*.
4. Return *scopeSet* (with depths).

Implementations MUST enforce a maximum *scopeSet* size of 100 graphs. Beyond this, validation REJECTs with `module: "scope-overflow"`.

**The set is unordered for evaluation purposes.** Every graph in the *scopeSet* contributes its constraints with equal standing. The recorded `depth` is for audit attribution only (per [§6.3](#63-precedence-and-conflict-resolution)). When a graph is reachable via multiple paths (multi-parent DAG), the *minimum* depth among those paths is recorded.

**Why participation is mutually declared.** A graph unilaterally claiming participation in another would allow inheritance hijacking — a malicious graph could declare participation in a high-trust target to claim its credentials. The target's mutual `accepts_participation` link, signed by an authorised delegate, prevents this.

### 6.2 Hierarchical vs Holonic Participation

Participation is **directional**: `A -[participates_in]→ B` means *A is joining B's governance*. When mutually accepted, B's constraints bind writes in A. The reverse is not implied.

- **Hierarchical** (one direction only): Only `A → B` declared and accepted. B's rules bind A's writes; A's rules do not bind B's writes. Conventional parent-child semantics.

- **Holonic** (both directions): BOTH `A → B` AND `B → A` declared, BOTH accepted by the corresponding target. Each graph's rules bind writes in the other. Symmetric governance. This is the substrate's expression of holonic structure: two graphs that are each whole-and-part with respect to the other.

The same mechanism — `participates_in` + `accepts_participation` — covers both. The semantics fall out of which declarations exist. The §6.1 algorithm produces the correct *scopeSet* in both cases without special-casing.

Bidirectional declaration is the more general case; hierarchical is the case where only one direction is asserted. There is no separate "mode" predicate.

### 6.3 Precedence and Conflict Resolution

Validation outcome — accept or reject — is determined by the **deny-wins** rule:

- **Within a constraint kind**, the write is REJECTED if *any* in-scope constraint of that kind rejects it. There is no "most-specific overrides".
- **Across kinds**, all kinds are evaluated; deny-wins applies per kind, then the overall result is REJECT if any kind rejected.
- **Constraints accumulate**: a child's same-kind constraint does NOT replace an ancestor's. Both apply, both must accept.

The recorded `depth` is used **only for audit attribution**, not for outcome:

- When the write is rejected, `rejectedBy` is the lowest-depth (most-authoritative) constraint that rejected. Ties broken by lexicographically greater constraint ID.
- The accept/reject decision itself does not depend on depth.

### 6.4 Constraint Collection

Given *scopeSet* with depths:

1. Let *constraints* = empty list.
2. For each graph G in *scopeSet*:
   1. Query G's triples for `<G> -[governance://has_constraint]→ ?c`.
   2. Resolve each `?c` to a constraint instance, tag with `depth[G]`, add to *constraints*.
3. Return *constraints*.

### 6.5 Caching

Implementations SHOULD cache *scopeSet* results and invalidate when any participation link (`participates_in` / `accepts_participation`) or constraint binding in any in-scope graph changes.

---

## 7. ZCAP Verification Algorithm

**Input:** An operation descriptor (either a triple to be written, or a non-triple operation), the author's DID, the target graph W (whose `did` is `W.did`), the *scopeSet* from [§6.1](#61-scope-set-resolution), the current local state of all in-scope graphs, the enforcement mode, and an OPTIONAL explicit `action` override.

**Algorithm:**

1. **Mode check.** If W's enforcement mode is `"open"`, skip capability verification and return ACCEPT (other constraint kinds still evaluate per [§5.3](#53-mode-agnostic-constraints)). If `"announced"`, perform the full algorithm below, record the result in the audit trail, but always return ACCEPT regardless of outcome.

2. **Determine action.** If the caller supplied an explicit `action` override, use it directly (this is the standard path for *non-triple* operations such as a read-mount authorisation check, which has no predicate to derive from). Otherwise let *action* be the action implied by the operation's predicate per [§4.5.4.1](#4541-action-derivation).

3. **Collect capability constraints.** From [§6.4](#64-constraint-collection), select constraints with `constraint_kind = "capability"`. If none, return ACCEPT.

4. **Predicate-coverage check.** If any selected constraint's `governance://capability_predicates` is non-empty and the triple's predicate is in none of them, capability checking does not apply to this predicate — return ACCEPT (other constraints still evaluate).

5. **Find the author's capabilities.** Query for `<author> -[governance://has_zcap]→ ?cap` across **every graph in the scopeSet** (not just W), dedupe by `cap-id`, and resolve each. A capability whose `invoker` is a graph G's DID is also eligible *if* the author is currently in G's `capabilityInvocation` set on G's DID document at validation time.

6. **Evaluate each candidate capability.** A capability passes if all of the following succeed; any failure means skip and try the next candidate.
   1. **Action match.** *action* MUST be in `cap.actions`.
   2. **Resource match.** `cap.resource` MUST equal:
      - W's DID (the stable, content-independent identifier), OR
      - W's current `iri` (deliberately snapshot-scoped capability), OR
      - the DID of any other graph in *scopeSet*.

      IRI-resourced capabilities whose IRI no longer matches the current state of any in-scope graph do not apply.

      **Capability accumulation across the scope set.** Because the resource match accepts any graph in *scopeSet* — not just W — capabilities issued in any participating graph contribute to authorisation in W. In hierarchical participation (`A → B` only), B is in A's scope set but A is *not* in B's, so B-resourced caps authorise A's writes but A-resourced caps do not authorise B's writes. In holonic participation (`A ↔ B`), both are in each other's scope set, so caps issued by either authorise writes in the other. This mirrors the symmetric way constraints accumulate ([§4.2](#42-constraint-binding)) and is the load-bearing mechanism for cross-graph holonic authority.
   3. **Revocation check.** If a valid revocation triple targets `cap.id` and is locally observable, skip.
   4. **Caveat check.** Evaluate each caveat against the triple + action + context ([§9](#9-caveat-type-system)). If any caveat fails, skip.
   5. **Chain verification.** Walk the parent chain starting from `cap`:
      1. If chain depth exceeds 10, skip.
      2. Verify the current capability's proof signature: the proof's signing key MUST be the parent capability's `invoker` (or, if that invoker is a graph DID, a current `capabilityDelegation` delegate on that DID's document at validation time).
      3. **Delegation right.** The parent's `actions` MUST contain `delegateCapability`. A capability that does not convey delegation rights MUST NOT be used to issue children — the chain is broken at this step. (Exception: the BootstrapRoot terminus in step 6.5.4 is not subject to this check, since `BootstrapRoot` is a sentinel, not a capability with actions.)
      4. **Bootstrap termination.** If `parentCapability == urn:living-web:zcap:BootstrapRoot`, validate that `cap.id` matches `<G> -[governance://root_capability]→ ?` for some graph G in *scopeSet*. If so, the chain is **cut here** — verification succeeds without further walking. The chain MUST NOT continue into any other graph's capability chain, even if the bootstrap proof was originally produced by an external graph's delegate ([§4.3](#43-governance-bootstrap-root-capability)).
      5. Otherwise resolve `parentCapability` by querying for triples with subject `<parentCapability>` across the scopeSet. If unresolvable, skip the candidate.
      6. Verify attenuation ([§8](#8-capability-attenuation)) between `cap` and parent.
      7. Verify parent is not revoked.
      8. Set `cap = parent`; increment depth; continue from step 6.5.2.

7. **Outcome.** If any candidate succeeded, return ACCEPT. Otherwise return REJECT with `rejectedBy = <constraint-id>`, `constraintKind = "capability"`, and a `reason` string identifying the failure (e.g., `"no_matching_capability"`, `"chain_broken"`, `"missing_delegate_capability"`, `"revoked"`, `"caveat_failed:<type>"`).

### 7.1 Non-Triple Operations

The same algorithm authorises non-triple operations — most notably the `mountContext` action invoked by [[CONTEXT-SYNC]] when a peer requests a read mount or a snapshot pull of a graph it does not yet hold. In that case:

- The caller supplies `action = "mountContext"` explicitly (step 2 takes the override).
- The operation has no `subject`/`predicate`/`object` triple, so step 4 (predicate-coverage check) is skipped, and in step 6.4 the engine MUST skip caveats whose handler reports `appliesToNonTripleOps = false` ([§9.3](#93-plug-in-mechanism)). The framework-core `expiry` caveat applies to non-triple operations. Plug-in caveats declare their own applicability; see [[CONSTRAINT-VOCABULARY]] §7 for the table covering the standard vocabulary.
- All other steps proceed unchanged: scope-set construction, `has_zcap` lookup, chain walk (including delegation-right check), bootstrap termination, revocation, attenuation.

The presence of a `mountContext`-bearing capability constraint in the scope set (§4.5 / §6.4) is what *makes* a graph's read access governed. Graphs with no such constraint accept any read.

---

## 8. Capability Attenuation

A delegated capability MUST be a strict subset of its parent across:

- **Actions.** `child.actions ⊆ parent.actions`.
- **Resource.** `child.resource` equals `parent.resource`, OR `child.resource` is a graph in the scope set of `parent.resource` (i.e., delegation may narrow to a more specific graph within the same governance domain, never broaden).
- **Caveats (immutable).** Every caveat present on the parent MUST appear **byte-identical** on the child. The child MAY add new caveats. The child MUST NOT modify or remove any caveat present on the parent.

The runtime MUST verify attenuation during chain walk. A capability that violates attenuation invalidates the chain.

**Why immutable rather than "strictly narrowed".** A "narrowed" rule would require the engine to compute partial-order relations over arbitrary caveat types (e.g., comparing rate-limit windows, glob subsets, plug-in-defined value spaces). For many caveat types this is non-obvious or undecidable. The immutable-caveats rule has equivalent expressive power — anything you could express as a narrowed caveat can be expressed as the parent's caveat unchanged plus a new caveat at the child that further restricts — and reduces attenuation to byte equality, which is unambiguous and trivially verifiable.

Capabilities flow downward, accumulating caveats, never relaxing them.

---

## 9. Caveat Type System

This section is normative.

### 9.1 Caveat Format

Each caveat in a ZCAP's `caveats` array is:

```json
{ "type": "<caveat-type>", "value": { ... } }
```

The framework defines the format and the meta-semantics of caveats (composition, attenuation). Specific caveat **types** are defined by this framework only when they are core to capability mechanics; the broader vocabulary is supplied by extension specifications and by applications.

### 9.2 Core Caveat Type

The framework defines a single core caveat type:

| Type | Purpose | `value` shape |
|---|---|---|
| `expiry` | Delegation expires at a time | `{ "expiresAt": "<RFC3339>" }` |

`expiry` is built in because it applies to the capability mechanism itself (every delegation has a lifecycle, and the engine needs to honour it independently of any plug-in being installed).

All other caveat types — including `predicate`, `property`, `subject`, `object`, `rateLimit`, `cardinality`, `authorOnly`, `shape`, `content`, and `credential` — are defined by [[CONSTRAINT-VOCABULARY]] and registered with the engine via the plug-in mechanism in [§9.3](#93-plug-in-mechanism). Applications MAY register further caveat types.

The engine MUST treat unknown caveat types conservatively (reject the operation) unless a registered plug-in supplies handling ([§13.9](#139-unknown-caveat-types)).

### 9.3 Plug-in Mechanism

Two plug-in surfaces are exposed by this framework:

**Constraint-kind handlers** — for evaluating constraints of non-capability kinds (`temporal`, `content`, `credential`, …):

```
interface ConstraintKindHandler {
  USVString kind;
  Promise<ValidationResult> validate(
    TripleInput triple,
    GraphConstraint constraint,
    ValidationContext ctx
  );
}
```

**Caveat handlers** — for evaluating caveats attached to specific delegations:

```
interface CaveatHandler {
  USVString type;
  /** Whether this caveat can be evaluated against non-triple operations (e.g., mountContext). */
  boolean appliesToNonTripleOps;
  Promise<ValidationResult> evaluate(
    Caveat caveat,
    TripleInput? triple,           // null for non-triple operations
    USVString action,
    ValidationContext ctx
  );
}
```

The engine dispatches constraint validation to the registered handler for the constraint's `governance://constraint_kind`, and caveat evaluation to the registered handler for the caveat's `type`. Unregistered kinds and types cause rejection (fail-closed; [§13.8](#138-unknown-constraint-kinds), [§13.9](#139-unknown-caveat-types)).

For non-triple operations ([§7.1](#71-non-triple-operations)), the engine MUST skip caveats whose handler reports `appliesToNonTripleOps = false`.

### 9.4 Performance

`expiry` is a single timestamp comparison. Plug-in caveats define their own evaluation cost; the framework simply dispatches and aggregates.

---

## 10. DID-Document Writes Are Governance Writes

A graph's DID document is itself a set of triples in the graph (per [[GROUP-IDENTITY]] §4.4). Writes to those triples use the `did-document://*` predicate family, which the action-derivation rule in [§4.5.4.1](#4541-action-derivation) maps to the `updateDIDDocument` action — and are therefore governed by the standard chain walk in [§7](#7-zcap-verification-algorithm).

This specification defines only the action and its derivation. The DID-document predicates themselves (`add-method`, `remove-method`, `grant-section`, `revoke-section`), the delegate-section semantics (`capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`), brick-state guards for sole-delegate removal, and self-rotation atomicity are defined by [[GROUP-IDENTITY]] §5. The bootstrap root capability ([§4.3](#43-governance-bootstrap-root-capability)) includes `updateDIDDocument` by default so the creator can add the initial delegate set without further ceremony.

This specification defines no multisig, threshold-signing, or aggregate-key schemes for the graph DID itself. Shared authority is expressed through the delegate set in the DID document; "this graph said it" is satisfied by any current delegate's signature.

---

## 11. Governance API on Graph

```webidl
[Exposed=Window,Worker]
partial interface Graph {
  [NewObject] Promise<GovernanceValidationResult> canAddTriple(Triple triple);
  /** Authorise a non-triple operation (e.g. mountContext) for the named author. */
  [NewObject] Promise<GovernanceValidationResult> canPerformAction(
    USVString action,
    USVString authorDid,
    optional CapabilityProofInput proof
  );
  [NewObject] Promise<sequence<GraphConstraint>> constraintsFor(USVString contextDid);
  [NewObject] Promise<sequence<CapabilityInfo>> myCapabilities();
  [NewObject] Promise<EnforcementMode> enforcementMode();
  [NewObject] Promise<undefined> setEnforcementMode(EnforcementMode mode);
};

enum EnforcementMode { "open", "announced", "enforced" };

dictionary CapabilityProofInput {
  /** Ordered ZCAP delegation chain (leaf → root), as content-addressed references
   *  resolvable within the scope set. */
  required sequence<USVString> chain;
  /** Optional verifiable-credential presentations consumed by `credential` caveats
   *  on the chain (per [[CONSTRAINT-VOCABULARY]] §7.10). */
  sequence<object> presentations;
};

dictionary GovernanceValidationResult {
  required boolean allowed;
  USVString? rejectedBy;       // constraint id
  USVString? constraintKind;   // "capability" | <plug-in kind>
  USVString? reason;
  DOMString? mode;              // current enforcement mode
};

dictionary GraphConstraint {
  required USVString id;
  required USVString kind;
  required USVString scope;       // graph DID this constraint is bound to
  unsigned long depth;            // depth in the scope set (audit attribution)
  record<USVString, USVString> properties;
};

dictionary CapabilityInfo {
  required USVString id;
  required sequence<USVString> actions;
  required USVString resource;     // graph DID (RECOMMENDED) or specific-snapshot graph IRI
  sequence<object> caveats;
  DOMString? expires;
};
```

The `canAddTriple()` and `myCapabilities()` results are **advisory** — applications MAY use them for UI gating but MUST NOT rely on them as enforcement points. Per [§2](#2-conformance), enforcement happens at the data layer when triples are accepted into the graph. Applications can be swapped; the data-layer check is the actual boundary.

### 11.1 `canAddTriple()`

Evaluates whether the current identity would be permitted to add the triple. Executes the algorithms in [§7](#7-zcap-verification-algorithm) followed by any registered constraint-kind plug-ins ([§9.3](#93-plug-in-mechanism)). Stops at first rejection.

### 11.2 `constraintsFor()`

Returns all constraints applying to a graph, including those inherited via the scope chain.

### 11.3 `myCapabilities()`

Returns valid, non-revoked, non-expired capabilities held by the current identity for this graph.

### 11.4 `enforcementMode()` / `setEnforcementMode()`

Reads the current enforcement mode; the setter requires an `updateGovernance` capability on the graph.

### 11.5 Consumer Integration

The framework exposes `canAddTriple()` (and the internal `validate(triple, ctx)` it implements) as the integration point for any consumer that needs authorisation checks (for example, a sync protocol). The framework itself does not depend on any particular consumer.

---

## 12. Rule Evolution

### 12.1 Adding a Rule

An authorised agent (holding `updateGovernance` for the graph) creates a constraint instance and binds it via `governance://has_constraint`. The triples propagate via sync; all peers enforce the new rule on receipt.

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

When a graph is bootstrapped from a parent, the bootstrap ZCAP MUST be verified at the child's creation time. After constitutionalisation, the parent's signing key MUST NOT have any standing in the child's governance.

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

### 13.10 Brick-State Protection

Conforming engines MUST refuse any operation — including `revokes_capability` writes, capability-bearing triple removals, and self-rotation of the last delegate — that would leave the graph with **zero** valid (non-expired, non-revoked) capabilities whose `actions` include `updateGovernance` and whose chain terminates at the graph's own `BootstrapRoot`. The engine MUST evaluate the proposed post-state before accepting the operation: if no remaining capability would satisfy the chain walk in [§7](#7-zcap-verification-algorithm) for the `updateGovernance` action by some currently-listed delegate, the operation MUST be rejected with `reason: "would_brick_governance"`.

Without this guard a community can be locked out of its own governance — accidentally (the sole `updateGovernance` holder revokes their own capability) or hostilely (a compromised key revokes every other governance-bearing capability before being detected). The post-state evaluation makes the substrate's "authority is constituted" guarantee operationally enforceable: the structure cannot be left in a state where authority cannot be exercised.

The analogous DID-document brick-state guard (refusing to remove the sole `capabilityDelegation` delegate) is defined by [[GROUP-IDENTITY]] §5; the two guards together ensure both signing authority and capability authority remain exercisable.

### 13.11 Concurrent Counter Caveats

Counter-style caveats (`rateLimit`, `cardinality` per [[CONSTRAINT-VOCABULARY]], and any application-defined caveat that depends on aggregate use across writes) cannot enforce a globally accurate bound under eventual consistency: two peers can each pass the local check on a `cardinality: { max: 1 }` capability simultaneously and only discover the over-use when their writes converge. Implementations MUST treat such caveats as best-effort under concurrent writes. Communities that require strict bounds MUST pair the caveat with a coordination mechanism (a write-order arbiter, a CRDT-aware counter at the sync layer, or a centralised gate). The framework neither provides nor requires such coordination.

---

## 14. Privacy Considerations

### 14.1 Rule Transparency

All governance rules are visible to peers with read access to the graph. There are no hidden rules.

### 14.2 Capability Visibility

ZCAPs are stored as graph data; this reveals which agents hold which permissions.

### 14.3 Enforcement Mode Disclosure

A graph's enforcement mode is itself public (a governance triple). Communities transitioning into Enforced mode SHOULD coordinate the change.

---

## 15. Examples

### 15.1 Bootstrap: Creating a Graph with a Root Capability

```javascript
const community = await navigator.graph.create({ displayName: "Acme Community" });
// The runtime mints a root capability signed by the active identity. The default
// action set covers the framework-core actions (extension actions like updateSHACL
// or updateFlow are not granted by default and must be delegated explicitly if
// needed).
//
//   <community.did>
//     governance://root_capability  <urn:uuid:root-cap-1> .
//   <urn:uuid:root-cap-1>
//     zcap://invoker  <did:key:creator> ;
//     zcap://actions  "createLink" , "removeLink" ,
//                     "updateGovernance" , "updateDIDDocument" ,
//                     "delegateCapability" , "mountContext" ;
//     zcap://resource <community.did> ;
//     zcap://parentCapability  <urn:living-web:zcap:BootstrapRoot> ;
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

### 15.4 Bootstrap a Child Graph (Constitutionalisation)

```javascript
// PRECONDITION: the creator currently holds `updateGovernance` on community.did.
// Without it, the runtime cannot write the `accepts_participation` triple into
// community and the bootstrap will reject.

const general = await navigator.graph.create({ displayName: "#general" });
await general.groupify();   // attaches general.did (per GROUP-IDENTITY)
await general.addTriple(new Triple(general.did, "context://participates_in", community.did));

// The runtime:
//   1. Mints the new graph and attaches general.did via groupification.
//   2. Issues a bootstrap ZCAP signed by an authorised `capabilityDelegation`
//      delegate of community.did, with parentCapability = urn:living-web:zcap:BootstrapRoot.
//   3. Constitutionalises it as <general.did> -[governance://root_capability]→ <cap-id>.
//   4. The participates_in triple links general's governance to community's scope set.
//   5. The runtime writes <community.did> -[context://accepts_participation]→ <general.did>
//      INTO community (requiring updateGovernance on community — see precondition).
//
// From now on, general governs itself. Community's constraints still apply to writes
// in general via the scope-set inheritance, but community delegates cannot reach into
// general's root chain — the bootstrap chain is cut at BootstrapRoot.
//
// To make this a HOLONIC link (community's writes also bound by general's rules):
//   await community.addTriple(new Triple(community.did, "context://participates_in", general.did));
//   await general.addTriple(new Triple(general.did, "context://accepts_participation", community.did));
// (Each side declared independently; same predicates, just in both directions.)
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

This table lists only the predicates this framework defines. Plug-in constraint kinds (e.g., `temporal`, `content`, `credential` in [[CONSTRAINT-VOCABULARY]]) declare additional predicates in their own specifications, as do DID-document predicates ([[GROUP-IDENTITY]] §4.5) and participation predicates ([[PERSONAL-LINKED-DATA-GRAPHS]]).

| Predicate | Target Type | Description |
|---|---|---|
| `governance://entry_type` | URI | Type discriminator for governance instances |
| `governance://constraint_kind` | String literal | `"capability"` or a plug-in-supplied kind |
| `governance://has_constraint` | URI | Binds a constraint to a graph |
| `governance://root_capability` | URI | The graph's root ZCAP |
| `governance://enforcement_mode` | String literal | `"open"` \| `"announced"` \| `"enforced"` |
| `governance://capability_predicates` | Comma-separated URIs | Predicates requiring capability verification |
| `governance://has_zcap` | URI | Links an agent DID to a held capability |
| `governance://revokes_capability` | URI (ZCAP id) | Revocation triple |

Referenced from outside this framework:

| Predicate | Defined in | Description |
|---|---|---|
| `context://participates_in` | [[PERSONAL-LINKED-DATA-GRAPHS]] | Child declares participation in parent (in the child's graph) |
| `context://accepts_participation` | [[PERSONAL-LINKED-DATA-GRAPHS]] | Parent confirms acceptance (in the parent's graph) |
| `did-document://*` | [[GROUP-IDENTITY]] §4.5 | DID-document write predicates; map to the `updateDIDDocument` action ([§10](#10-did-document-writes-are-governance-writes)) |

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
