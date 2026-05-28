# Decentralised Group Identity

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines the `did:graph` DID method and the **DID-document delegate model** for shared signing authority, and uses both to define decentralised collective identity on the web. Graphs as defined by [[PERSONAL-LINKED-DATA-GRAPHS]] are identified by `graph://<content-hash>` IRIs — content-derived addresses that change with every mutation. The IRI alone therefore identifies a *snapshot*, never an evolving graph: by construction, the same address cannot ever name two different contents. A `did:graph:...` gives a graph a **content-independent identity**: a single identifier that survives all changes to the graph's triples and to its delegate set, anchored cryptographically to an initial key and resolved through the graph's own DID-document triples. This specification defines that DID method, the operation (**groupification**) by which an existing graph takes one on (becoming a **group**), and the DID-document delegate model — multiple verification methods partitioned into the W3C-defined capability sections (`verificationMethod`, `capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`), where a signature by any current method in the relevant section counts as a signature *by the DID*. Multisig, threshold signatures, and aggregate-key schemes are explicit non-goals — shared signing authority is the delegate set. The term **group** in this specification means *a graph with a `did:graph` identity*; there is no separate "group" data type. Two concerns are kept structurally separate: **participation** (who is *part of* the group, declared from below via `context://participates_in`) and **signing authority** (who can currently *sign as* the group, declared in the group's DID document as `capabilityInvocation` delegates). Groups remain isomorphic to individuals (a group with one delegate is structurally identical to one with many) and nestable to arbitrary depth (groups may participate in other groups). This specification plugs into the resolver-registry extension point of [[DECENTRALISED-IDENTITY]] §4.2 and extends its `DIDCredential` surface.

---

## Status of This Document

This document is a draft Community Group Report. It has no official W3C standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [The did:graph Method](#4-the-didgraph-method)
5. [DID-Document Delegates](#5-did-document-delegates)
6. [Data Model](#6-data-model)
7. [Two Distinct Concerns: Participation vs Signing Authority](#7-two-distinct-concerns-participation-vs-signing-authority)
8. [API](#8-api)
9. [Group Lifecycle](#9-group-lifecycle)
10. [Governance Integration](#10-governance-integration)
11. [Isomorphism: Individual = Group of One](#11-isomorphism-individual--group-of-one)
12. [Delegated Voting Use Case](#12-delegated-voting-use-case)
13. [Security Considerations](#13-security-considerations)
14. [Privacy Considerations](#14-privacy-considerations)
15. [Examples](#15-examples)
16. [Predicate Reference Table](#16-predicate-reference-table)
17. [References](#17-references)

---

## 1. Introduction

### 1.1 Motivation

The web has identity for individuals via DIDs ([[DID-CORE]], [[DECENTRALISED-IDENTITY]]). It also needs identity for *collectives* — teams, communities, organisations, families, coalitions — without picking a custodian and without bolting on multisig or threshold cryptography. It also needs, more fundamentally, **identity for graphs that mutate**.

Graphs as defined by [[PERSONAL-LINKED-DATA-GRAPHS]] are content-addressed: a graph's IRI is the SHA-256 of its current triples. That is a precise, verifiable address for *one state* of the graph — and it is, by design, the wrong address for almost anything else. The moment a triple is added or removed the IRI changes, because by construction the same content-hash cannot name two different contents. This is the substrate's hard guarantee of snapshot-level immutability: every state is its own immutable artifact, addressed by its hash, never overwritten. It is also a substrate-level invocation of version control: a graph naturally becomes a sequence of states, each with its own IRI, none renaming the others.

This guarantee leaves a real problem: how do you refer to "the graph" as such — the evolving entity that has gone through many states and will go through many more — when no single IRI can serve that purpose? Conventional answers are mutable pointers maintained by a trusted server (a URL, a database row) or naming conventions enforced by an application; both reintroduce the centralisation graphs were meant to avoid.

This specification's answer is `did:graph`. A `did:graph:...` is a DID derived from a fresh Ed25519 keypair generated at groupification time, bound to a host graph via a triple in that graph (`group://didIdentity`). The DID is **content-independent**: it does not change when the graph's content changes, and it carries its own provenance — the graph's DID document lives as triples inside the graph itself, so resolving the DID and verifying its signers happens against the same data the agent already trusts. A `did:graph` is the right answer to "is this the same graph as before?" exactly when the IRI is the right answer to "do these triples match this address?". The two layers are complementary by construction; neither subsumes the other.

This specification introduces:

- The **`did:graph` method** — a DID whose identifier is derived from a fresh Ed25519 keypair (the *initial key*) and whose DID document lives as triples inside an existing graph. The DID does not own the graph; it identifies it. The graph keeps its IRI; the DID gives it a content-independent identity and shared signing authority.
- The **DID-document delegate model** — a DID document MAY list multiple verification methods, partitioned into the W3C-defined capability sections. A signature by any current method in the relevant section is a signature *by the DID*. There is no aggregation, no quorum, no joint key — verification is a single Ed25519 check.
- **Groupification** — the operation that takes a graph (without a DID), mints a fresh `did:graph` keypair, writes the binding plus the seed DID-document triples into the graph, and atomically makes the graph addressable as a collective signer. After groupification the graph is a **group**.

A **group**, in this specification, means exactly *a graph with a `did:graph` identity*. There is no separate "group" data type and no "create-a-group" flow that conjures a new kind of object — every group is a graph; some graphs are groups. The term is a usage convention, not a type.

Built on these primitives:

1. This is a DID method specification (for `did:graph`).
2. It is a delegate-model specification (the DID-document delegate semantics that make `did:graph` useful).
3. It is a pattern document (how to use the substrate together to express collective identity), with particular attention to **two concerns that MUST be kept structurally distinct**:
   - **Participation** — who is *part of* this collective? Declared from below via `context://participates_in` and mutually acknowledged from the group via `context://accepts_participation`. This is a **membership** relation: content discovery, navigation, federated read mounts, and UI all consume it. Cross-graph shared authority (the "holonic" pattern) is expressed separately, via mutual DID-document delegation ([[CAPABILITY-FRAMEWORK]] Appendix A).
   - **Signing authority** — who currently can *sign as* this collective? Declared in the group's DID document via `verificationMethod` + `capabilityInvocation`.

In conventional systems these are conflated (a "member" is implicitly a "signer"). This specification separates them, with the result that the same model scales from a personal identity to a multinational federation using one set of primitives.

### 1.2 Design Principles

**Principle 0: Groupification attaches a content-independent identity in place; it does NOT preserve the IRI.** A graph can exist with only its `graph://<content-hash>` IRI (Spec 02) — but the IRI is a snapshot address that changes with every mutation, so a graph without a DID can be referenced only as a specific frozen state (an immutable artifact, a one-shot publication, a content-addressed cache key). Any application that mutates a graph and needs others to keep referencing the same graph — every sync subscription, every long-lived ZCAP, every durable participation link — MUST groupify. Groupification adds new triples (the binding + the seed DID document), which **changes the graph's IRI to a new value** like any other write. The `did:graph` minted at that moment then becomes the durable handle that survives this and all subsequent mutations. Groupification is a one-way upgrade: a graph cannot be un-groupified without forking.

**Principle 1: Shared authority lives in the DID document, not in the identifier.** The `did:graph` identifier is single-key by construction (the initial key); the delegate set in the DID document is what changes over time. The DID itself never moves.

**Principle 2: A group of one is structurally identical to a group of many.** Within the `did:graph` data model, a group with exactly one `capabilityInvocation` delegate is identical to one with one hundred delegates, except for the size of the delegate set. The transition is membership growth, not a mode switch. (`did:key` is a *constrained* form of one-delegate identity — see [§11](#11-isomorphism-individual--group-of-one) for the precise relationship.)

**Principle 3: Identity persists independent of participation and delegate set.** A `did:graph` persists across changes in both who participates and who signs. A team that replaces every member over a decade is still the same team — its `did:graph:...` is unchanged. (The underlying graph's IRI changes with every write, but the DID does not.)

**Principle 4: Groups can participate in groups, to arbitrary depth.** A group's underlying graph MAY declare `context://participates_in <larger-graph-iri>` in its own graph. The substrate provides participation-from-below for the entire nesting structure. See [§6.3](#63-graph-nesting).

### 1.3 Use Cases

- **Teams.** A team creates a `did:graph` for itself. Initial delegates are the founding members.
- **Organisations.** A company creates a `did:graph` and accepts participation from department `did:graph`s. The company's delegate set is its executive officers; departments have their own delegates.
- **Communities.** An open community creates a `did:graph` with governance rules ([[CAPABILITY-FRAMEWORK]]) defining participation criteria, delegate addition processes, and decision-making structure.
- **Families.** A family creates a `did:graph` for shared photos, calendars, documents.
- **DAOs.** A decentralised autonomous organisation uses a `did:graph` with on-chain-style governance encoded as flow definitions ([[GRAPH-FLOWS]]).
- **Ad-hoc collaborations.** Three people create a temporary `did:graph` for a weekend project.
- **Federations.** Multiple organisations form a federation by each declaring `context://participates_in <federation-did>`; the federation's delegates are designated representatives.
- **Delegated voting.** A voter delegates their vote to a `did:graph` (a working group of experts) rather than to a single person. The group's internal governance produces the vote; one of its `capabilityInvocation` delegates signs the resulting ballot. See [§12](#12-delegated-voting-use-case).

All of these use the same data model and the same API. The differences are scale and governance configuration.

### 1.4 Relationship to Other Specifications

- [[DECENTRALISED-IDENTITY]] defines the `DIDCredential` interface, the signing API, the resolver-registry extension point, and the REQUIRED `did:key` method. This specification registers `did:graph` into that registry and extends `DIDCredential` with the delegate-management API.
- [[PERSONAL-LINKED-DATA-GRAPHS]] supplies the host graph (identified by its `graph://<content-hash>` IRI) whose triples carry a `did:graph` DID document once the graph has been groupified.
- [[CAPABILITY-FRAMEWORK]] defines the ZCAPs that govern changes to a `did:graph` DID document and to participation acceptance. ZCAPs target a graph's DID for long-lived authority; the IRI is reserved for snapshot-scoped capabilities (per [[CAPABILITY-FRAMEWORK]] §1.3). A group's `did:graph` is therefore the natural `resource` value for capabilities governing it.
- [[CONTEXT-SYNC]] is the path by which a group's DID document can be resolved from an external source when the host graph is not locally mounted.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in BCP 14 [[RFC2119]] [[RFC8174]].

A conforming implementation MUST:

1. Implement the `did:graph` method ([§4](#4-the-didgraph-method)), including identifier construction, DID-document-as-triples projection, document-update predicates, resolution, and deactivation.
2. Implement the DID-document delegate semantics ([§5](#5-did-document-delegates)) for `did:graph` DIDs.
3. Register `did:graph` into the [[DECENTRALISED-IDENTITY]] §4.2 resolver registry, including both creation and resolution handlers.
4. Treat a "group" as a Graph with a `did:graph:...` DID, per [[PERSONAL-LINKED-DATA-GRAPHS]].
5. Use `context://participates_in` (declared from below) and the corresponding `context://accepts_participation` (declared from above) as the canonical participation relation ([§6.2](#62-participation)).
6. Use DID-document delegates as the canonical mechanism for shared signing authority ([§7.2](#72-signing-authority-did-document-delegates)).
7. Expose a single `DIDCredential` interface that handles `method = "key"` and `method = "graph"` identically from the application's perspective (no method-specific call paths or separate stores observable to applications). The isomorphism property ([§11](#11-isomorphism-individual--group-of-one)) MUST hold to the extent permitted by `did:key`'s immutability constraints.

A conforming implementation MUST NOT:

- Define multisig, threshold signing, or aggregate-key schemes for the group DID itself.
- Conflate participation with signing authority.

A conforming implementation MAY provide convenience APIs that look like a `Group` interface, provided they map to the underlying Graph + DID + governance correctly.

---

## 3. Terminology

<dl>

<dt>did:graph</dt>
<dd>A DID method (defined in <a href="#4-the-didgraph-method">§4</a>) whose method-specific identifier is a multibase-encoded Ed25519 public key and whose DID document is composed from triples inside a host graph. The DID does not own or replace the graph's <code>graph://&lt;content-hash&gt;</code> IRI — it identifies it via a <code>group://didIdentity</code> binding.</dd>

<dt>Group</dt>
<dd>A graph with a <code>did:graph:...</code> identity. There is no separate "group" data type — every group is a graph; some graphs are groups (the ones that have been groupified). The term "group" is a usage convention.</dd>

<dt>Groupification</dt>
<dd>The (one-way) operation that takes a graph (without a DID) and attaches a fresh <code>did:graph</code> identity to it: generate a keypair, mint the DID, write the seed DID-document triples + the <code>group://didIdentity</code> binding into the graph. After groupification the graph is a group; its IRI advances to a new value reflecting the added triples, and its DID is set.</dd>

<dt>DID-Document Delegate</dt>
<dd>An entry in a <code>did:graph</code> DID document's <code>verificationMethod</code> list, referenced from one or more capability sections (<code>capabilityInvocation</code>, <code>capabilityDelegation</code>, <code>assertionMethod</code>, <code>authentication</code>). A signature produced by a current delegate's key counts as a signature by the DID for that section. See <a href="#5-did-document-delegates">§5</a>.</dd>

<dt>Initial Key</dt>
<dd>The Ed25519 keypair generated at groupification, encoded into the resulting <code>did:graph</code> identifier. Its public-key fragment becomes the first <code>verificationMethod</code> entry; its holder is the first delegate in every capability section. The public half is permanently embedded in the DID identifier (see [§13.1](#131-initial-key-permanence)).</dd>

<dt>Group DID</dt>
<dd>A <code>did:graph:...</code> DID identifying the signing identity of a group. The DID persists across changes in participation, delegate set, and graph content; the host graph's IRI does not (it advances with every write).</dd>

<dt>Participant</dt>
<dd>An agent (or another group) that has declared <code>context://participates_in &lt;group-did&gt;</code> in its own graph, where the group has mutually declared <code>context://accepts_participation</code>. Participation is about <em>being part of</em>, not about authority.</dd>

<dt>Signer</dt>
<dd>A synonym for "DID-document delegate" used in the graph of a group. A signer's key produces signatures that count as <em>the group's</em> signatures for the granted section. Signers are about <em>signing as</em>, not about being a participant. The two roles overlap by convention but are not identical.</dd>

<dt>Graph Nesting</dt>
<dd>The recursive composition where a group's <code>did:graph</code> participates in a larger group's graph. Authority flows from below: the child declares participation; the parent confirms acceptance.</dd>

<dt>Transitive Participation</dt>
<dd>The set of all individual (non-group) agents reachable by recursively resolving group participations. Implementations MUST detect cycles.</dd>

<dt>Group-Specific Identity</dt>
<dd>A privacy pattern where an agent uses a different <code>did:key</code> when participating in each group. The substrate makes this cheap; the recommended privacy posture per [[PERSONAL-LINKED-DATA-GRAPHS]] §10.2.</dd>

</dl>

---

## 4. The `did:graph` Method

This section is normative. It defines the `did:graph` DID method registered into the [[DECENTRALISED-IDENTITY]] §4.2 resolver registry.

### 4.1 Identifier Format

The `did:graph` method-specific identifier uses the same multibase encoding as `did:key` — a multicodec-prefixed Ed25519 public key:

```
did:graph:z6Mkh...   ← initial pubkey, multibase Ed25519
```

The key generated at groupification is the **initial key**: it becomes the first entry in the host graph's DID document, and its holder is the first delegate in every capability section. The DID identifier is single-key by construction. There is no multihash-of-keys, no aggregate key, no derived identifier. **Shared authority lives in the DID document, not in the identifier.**

The `did:graph` identifier is *not* the host graph's IRI — the IRI is a content hash from [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3 and is independent of the key material. The binding between the two is recorded as a triple inside the graph ([§4.3](#43-the-binding-triple)).

### 4.2 Groupification

**Groupification** is the operation that attaches a `did:graph` to a graph. It is a one-way upgrade: a graph can be groupified at most once.

Groupification adds triples (the binding + the seed DID document + any initial-delegate triples). Like any other writes, these change the graph's IRI: the graph's IRI advances from its pre-groupification value to a new value that reflects the added triples. The DID minted at this moment, by contrast, is *content-independent* — it is fixed at the moment of groupification and does not change as the graph evolves further.

**Groupification is a privileged atomic bootstrap.** The seed writes in steps 4–5 below do NOT pass through ordinary `updateDIDDocument` capability checks (no such capability exists yet at this moment — the graph has no DID, no DID document, and no governance referencing one). Atomicity of the bootstrap is the trust anchor for the initial state; no agent has standing in the DID document that predates the bootstrap. Step 7 (initial delegates) DOES go through capability checks — by then the root capability has been minted and grants `updateDIDDocument` to the creator.

The algorithm:

1. Let `ctx` be the target graph. Reject with `"InvalidStateError"` if `ctx` already has a `group://didIdentity` triple (already groupified).
2. Generate a fresh Ed25519 keypair `(sk, pk)` (the **initial key**).
3. Derive `did = "did:graph:" + multibase_ed25519(pk)` per [§4.1](#41-identifier-format).
4. **(Atomic bootstrap, no governance check.)** Write the binding triple `<ctx.iri> group://didIdentity <did>` into `ctx`. After this write `ctx.iri` advances to its new value; the `did` is now bound to the graph regardless of subsequent IRI changes.
5. **(Atomic bootstrap, no governance check.)** Write the seed DID-document triples ([§4.4](#44-did-document-storage)) into `ctx`, granting the creator's method (`did + "#" + multibase_ed25519(pk)`) all four capability sections.
6. Persist the private key `sk` via [[DECENTRALISED-IDENTITY]] §5.1 storage as a delegate credential for `did`.
7. **(Governed.)** Optionally write `initialDelegates` per the caller's options, using the `did-document://*` write predicates ([§4.5](#45-document-updates)). These writes use the freshly-minted root capability ([[CAPABILITY-FRAMEWORK]] §4.3), which grants `updateDIDDocument` to the creator.
8. Return the `did` and the credential. The graph is now a group.

Groupification MUST be authorised at the substrate level by either:

- the creator at graph-creation time (the root capability granted at creation includes the right to groupify), or
- a `groupifyContext` ZCAP on the graph for graphs that were previously created without an attached DID.

After groupification, the host graph's `iri` reflects the post-bootstrap state; pre-groupification snapshots remain addressable by their old IRI (those snapshots are immutable, per Spec 02), but they refer to the graph in a state without the DID binding.

### 4.3 The Binding Triple

The `group://didIdentity` predicate records the binding from a graph's IRI to its DID identity. It is the canonical answer to "does this graph have a did:graph?".

```turtle
# Inside the host graph (whose IRI is graph://<content-hash>):
<graph://<content-hash>>  group://didIdentity  <did:graph:z6Mkh...> .
```

A graph has at most one `group://didIdentity` triple. Multiple `did:graph` identities for one host graph are NOT permitted (the operation is one-way; to bind a second DID, fork into a new graph).

A consumer checking whether a graph is groupified queries its triples for `<ctx.iri> group://didIdentity ?did`. A resolver receiving a `did:graph:...` finds its host graph by querying for `?iri group://didIdentity <this-did>` across mounted stores. (One predicate is sufficient in both directions; the spec deliberately does NOT introduce a reverse predicate.)

### 4.4 DID Document Storage

The DID document for a `did:graph` DID is composed from the following triples inside the host graph:

```turtle
# Inside the host graph (whose IRI is graph://<content-hash>):
<graph://<content-hash>>  group://didIdentity  <did:graph:z6Mkh...> .

<did:graph:z6Mkh...>
  did://verificationMethod              <did:graph:z6Mkh...#key-creator> ,
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

### 4.5 Document Updates

Adding, removing, or moving a method between capability sections of a `did:graph` DID document is a write to the host graph and is therefore subject to that graph's governance ([[CAPABILITY-FRAMEWORK]]). The canonical predicates for governed changes are:

- `did-document://add-method` — add a new `verificationMethod` entry.
- `did-document://remove-method` — remove an entry; cryptographically invalidates future signatures by that method.
- `did-document://grant-section` — add a method to a capability section.
- `did-document://revoke-section` — remove a method from a section without removing it from `verificationMethod`.

Each operation is a triple write authorised by a ZCAP whose `resource` is the group's `did:graph` (per [[CAPABILITY-FRAMEWORK]] §1.3 — the DID is the canonical resource for ongoing authority). There is no separate "DID document update" wire format — the DID document *is* triples in the host graph, and updating it is just authoring triples.

### 4.6 Resolution

`did:graph` resolution is registered into [[DECENTRALISED-IDENTITY]] §7.1.

**Routing limitation.** A `did:graph:z6Mk...` identifier contains no routing information — it does not encode where the host graph lives. Resolution is bounded by what the local agent already knows: its own mounted graphs and the sync spaces it is subscribed to. **A `did:graph` is unresolvable without a routing context.** Cold-start resolution requires out-of-band hints (an invitation link, a snapshot URI, a known relay endpoint).

**Discovery is out of scope.** *How* the agent obtains those hints — the mechanism that maps "I know this DID" to "I know which peer holds it" — is deliberately not specified here. Discovery is a substrate-level concern with multiple reasonable answers (invitation links, DHT, gossip, mDNS, friend-of-friend, blockchain registries, DNS), each with different trust, scale, and privacy trade-offs. Picking one normatively would couple `did:graph` to a particular topology and exclude others.

Two substrate properties make this defensible:

1. **Content-addressed snapshots are self-verifying** ([[PERSONAL-LINKED-DATA-GRAPHS]] §5.5). Trust does not depend on which peer delivered the bytes — only on the IRI/proof checks against the bytes themselves. Discovery's job is reduced to "get the bytes from anyone".
2. **The DID identifier embeds the initial public key** ([§4.1](#41-identifier-format)), and the DID-document delegate model is gated by `did-document://*` writes auditable in the graph. A malicious discovery channel cannot impersonate the graph; the worst it can do is fail to deliver.

The non-normative discussion of anticipated application-layer discovery patterns (invitation links, transitive discovery via mounted graphs, shared discovery graphs, DHT bridges, mDNS, sync-space membership) lives in [[CONTEXT-SYNC]] §8.6. This specification's normative surface is the DID-URL query parameters defined immediately below — they are the *interface* by which applications hand discovery results to the resolver, not the discovery mechanism itself.

To support hint-bearing resolution, this specification reserves the following [[DID-CORE]] §3.2 DID-URL query parameters; their syntax is defined here for forward use, and conforming resolvers MUST accept them when present:

- `?snapshot=<https-or-ipfs-uri>` — a hint pointing to a `GraphSnapshot` (per [[PERSONAL-LINKED-DATA-GRAPHS]] §5) the resolver MAY fetch to bootstrap the DID document.
- `?relay=<wss-or-https-uri>` — a hint pointing to a sync-space relay the resolver MAY join to fetch and follow the host graph.

Both parameters are *hints*, not authority — the resolved DID document is still verified against the identifier's initial-key embedding and (when received over sync) against the graph's own integrity rules.

The resolution algorithm:

1. **Local lookup.** Across graphs the local `GraphManager` (per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.4) knows about, find the graph whose triples contain `<?iri> group://didIdentity <this-did>`. (This lookup REQUIRES the user agent to maintain an internal index of mounted graphs by `did:graph` binding; per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.4 this index is not exposed as JavaScript API surface but is REQUIRED by conforming implementations of `did:graph`.) If found, query that graph's triples for the canonical DID-document predicates ([§4.4](#44-did-document-storage)) and project them into a DID document. Set `trustLevel` to `"local"` for `write` or `governance` mounts, or `"mounted-read"` for `read` mounts.
2. **Hint-driven snapshot fetch.** If a `?snapshot=` parameter is present, fetch and verify the snapshot per [[PERSONAL-LINKED-DATA-GRAPHS]] §5.5; on success mount it read-only with `trustLevel: "external"`, verify the snapshot contains `?iri group://didIdentity <this-did>` for some IRI in its own data, project the DID-document triples into a DID document, and cache with a TTL derived from the snapshot's signed timestamp; subsequent reads within the TTL return `trustLevel: "cached"`.
3. **Hint-driven sync-space join.** If a `?relay=` parameter is present (and no snapshot was fetched), the user agent MAY join the named relay and follow the host graph via [[CONTEXT-SYNC]]; same trust-level handling as step 2.
4. **Known-sync-space scan.** Otherwise, the resolver MAY scan sync spaces it is already a member of for a host graph matching `<this-did>`.
5. If none of the above succeeds, reject with `"NotFoundError"`. The application is responsible for surfacing the failure to the user, who can supply a routing hint manually (e.g., paste a snapshot URI) and retry.

Resolution never blocks on remote authority — there is no registrar, no ledger, no consensus dependency. The local mounts, the supplied hints, and the sync-space memberships *are* the resolution domain.

### 4.7 Deactivation

A `did:graph` DID is deactivated by writing `<did> did://deactivated true` into the host graph via the governance flow. Historical signatures remain verifiable against the DID document state at the time of signing. The underlying graph IRI continues to identify the graph regardless — deactivation only removes the *signing* identity, not the data.

---

## 5. DID-Document Delegates

This section is normative. It defines how multiple verification methods on a `did:graph` DID document are interpreted as a delegate set, and how shared signing authority is realised without multisig or threshold schemes.

### 5.1 Semantics

A `did:graph` DID document MAY list one or more methods in `verificationMethod`. The capability sections (`capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`) reference subsets of `verificationMethod`.

**A signature produced by any current method in the relevant capability section is a valid signature by the DID** for that purpose. Verification consists of:

1. Resolve the DID to its current DID document ([§4.4](#44-resolution)).
2. Identify the method referenced by the signature's `proof.method` field.
3. Confirm the method is currently listed in the appropriate capability section for the signature's intended use:
   - ZCAP invocation requires `capabilityInvocation`.
   - ZCAP delegation requires `capabilityDelegation`.
   - Snapshot or expression assertion requires `assertionMethod`.
   - Authentication challenges require `authentication`.
4. Verify the signature against the method's public key using the method's algorithm.

There is no aggregation, no quorum check, no joint key. Each verification is a single algorithmic operation.

This is the method-specific authorisation rule referenced by [[DECENTRALISED-IDENTITY]] §6.2 step 6 for `did:graph` credentials.

### 5.2 Non-Goals

The following are explicitly out of scope for this specification:

- **Multisignature (multisig) schemes.** This specification does not define joint signing, M-of-N approval, or signature aggregation.
- **Threshold cryptography.** Shamir, FROST, BLS-threshold, and similar schemes are not part of the substrate.
- **Multihash-of-keys identifiers.** The DID identifier is derived from a single Ed25519 public key (the initial key); shared authority is added to the DID document, not embedded in the identifier.

Implementations that need joint *operational* approval SHOULD layer it on top — for example, by requiring multiple authorised delegates to each independently sign a ZCAP via a `content` caveat ([[CONSTRAINT-VOCABULARY]] §7.9) — but the substrate itself takes the position that **the delegate set is the answer to "who is currently authorised."**

### 5.3 Delegate Lifecycle

A delegate is added to a DID document by writing `verificationMethod` and capability-section triples authorised by a ZCAP. A delegate is removed by removing those triples, also under ZCAP control.

| Stage | Triggered by | Effect |
|---|---|---|
| **Add** | `did-document://add-method` + section grants | New method becomes a valid signer for the granted sections. |
| **Promote** | `did-document://grant-section` | Existing method gains additional sections. |
| **Demote** | `did-document://revoke-section` | Method loses a section but remains in `verificationMethod`. Historical signatures in the removed section remain verifiable. |
| **Remove** | `did-document://remove-method` | Method is removed entirely. Historical signatures remain verifiable against the document state at the time of signing. |
| **Rotate** | Remove + Add as one batch | The method's underlying key is replaced. |

### 5.4 Extending `DIDCredential` for `did:graph`

This specification extends the [[DECENTRALISED-IDENTITY]] §3 `DIDCredential` interface with `did:graph`-specific attributes and a delegate-management API.

```webidl
partial interface DIDCredential {
  /** For did:graph: the specific verification method id whose key this credential holds. */
  readonly attribute USVString methodId;

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

  [NewObject] Promise<SignedContent> signGraph(USVString graphIri);
};

partial dictionary DIDCredentialCreationOptions {
  GraphDIDCreationOptions graphOptions;   // REQUIRED when method = "graph"
};

dictionary GraphDIDCreationOptions {
  USVString hostGraphIri;                 // graph IRI of an existing graph to groupify;
                                          // if absent, a fresh graph is minted alongside
  sequence<USVString> initialDelegates;   // DIDs to add as capabilityInvocation delegates
                                          // (in addition to the creator)
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

For a `did:graph` credential:

- `addDelegate()` translates into the corresponding `did-document://add-method` triple write against the host graph and SHALL reject with `"NotAllowedError"` if the credential does not hold a `capabilityDelegation` delegate permitting the change.
- `grantSection()` and `revokeSection()` translate into the corresponding `did-document://*` writes and follow the same authorisation rule.
- `removeDelegate()` is governed identically, **and** MUST refuse — rejecting with `"InvalidStateError"` — if the named method is the *only* method currently listed in the group's `capabilityDelegation` section. Removing it would render the DID document permanently unmodifiable (no remaining key can authorise further `did-document://*` writes). Applications that need to hand off sole `capabilityDelegation` authority MUST use an atomic add-then-remove batch (or `replaceDelegate()` if the implementation provides it; see [§8.1.4](#814-addsigner--removesigner)).
- `revokeSection()` MUST refuse with `"InvalidStateError"` when the section is `capabilityDelegation` AND the named method is the only remaining member — same brick-state reasoning.

`signGraph(target, options?)` produces a signed assertion of a graph's current state — the canonical way to attest "I observed graph G at state-hash H at time T." The method MUST:

1. Resolve `target`: if it is an `https://`/`graph://` IRI, treat it as the graph IRI directly and resolve the corresponding `did:graph` via `<target> group://didIdentity ?did` (null if the graph has no DID); if it is a `did:graph:...`, resolve to its current host graph and current IRI per [§4.6](#46-resolution).
2. Capture `timestamp` as the current time in RFC 3339 form.
3. Sign the structured payload `{ graphDid, graphIri, timestamp }` using `sign()` ([[DECENTRALISED-IDENTITY]] §6.1). `graphDid` is the resolved DID (may be null for graphs without a DID); `graphIri` is the IRI at the moment of observation.
4. Return the `SignedContent`.

The signed payload binds three independent facts: *which graph* (`graphDid`, the durable identity), *what state* (`graphIri`, the content commitment at that moment), and *when* (`timestamp`). Verifiers can check any or all of these depending on their use case — e.g., "this DID observed this state" (compare `graphDid` + `graphIri`), or "this state was observed before time X" (compare `timestamp`).

When the credential's DID is the graph's own `did:graph:...`, the signature has additional significance: it is the graph asserting its own state. This requires the credential to hold an `assertionMethod` delegate on the graph DID; if not, reject with `"NotAllowedError"`.

The `DIDCredentialCreationOptions.method` value `"graph"` dispatches to this specification's creation handler. For `method = "graph"`, the user agent MUST:

1. If `graphOptions.hostGraphIri` is provided, perform groupification ([§4.2](#42-groupification)) on the existing graph.
2. Otherwise, create a fresh graph via [[PERSONAL-LINKED-DATA-GRAPHS]] §4.1 and immediately groupify it.
3. Persist the initial private key in platform secure storage ([[DECENTRALISED-IDENTITY]] §5.1).
4. Write any `initialDelegates` to the DID document via the host graph's governance.
5. Return a `DIDCredential` with `method = "graph"` and `methodId` set to the creator's verification-method id.

The credential's `displayName` prompt MUST make clear that the identity *belongs to a graph*, not to the user personally.

### 5.5 Revocation Semantics for `did:graph` Credentials

[[DECENTRALISED-IDENTITY]] §5.3.3 (Revocation) is refined for `did:graph` credentials:

The user holds a *delegate key* on the graph DID. Deleting the local credential prevents the user from signing as the graph going forward but does not affect other delegates, and it does not remove the host graph's binding triples — the graph remains groupified. Removing the delegate's *entry* from the graph's DID document is a separate, governance-controlled operation ([§5.3](#53-delegate-lifecycle)).

For `did:key`, only `Add` (at creation) and `Remove` (via credential deletion) apply; `did:key` documents are immutable beyond their initial form, and the delegate-management methods above (`addDelegate`, `removeDelegate`, `grantSection`, `revokeSection`) reject with `"NotSupportedError"` on `did:key` credentials. This is the architectural point of `did:graph`: shared, evolvable authority through DID-document writes.

---

## 6. Data Model

### 6.1 Group Identity

A group is a graph with a `did:graph` identity. It has both a `graph://<content-hash>` IRI (its current snapshot address, per [[PERSONAL-LINKED-DATA-GRAPHS]]) and a `did:graph:...` DID (its content-independent identity, per [§4](#4-the-didgraph-method)), bound by a `group://didIdentity` triple. The DID document — itself triples inside the host graph, per [§4.4](#44-did-document-storage) — declares the group's current delegates. The IRI changes with every write to the graph; the DID does not.

Beyond the standard `did:graph` data model, a group MAY carry:

```turtle
<group-did>  group://name         "Engineering Team" ;
             group://description  "The folks shipping the substrate" ;
             group://avatar       <https://example.com/avatar.png> ;
             group://created      "2026-05-23T00:00:00Z"^^xsd:dateTime ;
             group://creator      <did:key:z6MkCreator...> .
```

These predicates are stored as triples inside the group's own graph.

### 6.2 Participation

Participation is declared **from below**: a participant graph (which MAY be an individual's personal graph or another group's graph — with or without a `did:graph`) authors a triple in *its own* graph naming the parent group by either its IRI or, if it is a group, its DID:

```turtle
# Inside the participant's graph (e.g., graph://<alice-personal-hash>):
<graph://<alice-personal-hash>>  context://participates_in  <did:graph:engineering-team> .
```

The group graph confirms acceptance from above:

```turtle
# Inside the group's graph (whose DID is did:graph:engineering-team):
<did:graph:engineering-team>  context://accepts_participation  <graph://<alice-personal-hash>> .
```

Either side MAY use the IRI or the DID alias to name the other. Both directions are REQUIRED. Unilateral participation claims (where the child declares but the parent does not accept, or vice versa) are ignored for scope inheritance ([[CAPABILITY-FRAMEWORK]] §6.1).

The acceptance MUST be authored by a delegate in the group's `capabilityDelegation` section AND requires an `acceptParticipation` ZCAP on the group's graph.

The participation triple lives in the participant's graph. The acceptance triple lives in the group's graph. The participant always controls whether they participate (they can remove their own triple). The group controls whether to accept (it can withdraw its acceptance).

### 6.3 Graph Nesting

A group is itself a graph, so it can participate in other groups. A graph without a DID may also participate up the chain — it simply can't sign as its own collective identity. A team participates in a project; the project participates in a department; the department participates in a company:

```turtle
# In did:graph:engineering-team's host graph:
<did:graph:engineering-team>  context://participates_in  <did:graph:project-alpha> .

# In did:graph:project-alpha's host graph:
<did:graph:project-alpha>     context://participates_in  <did:graph:r-and-d> .

# In did:graph:r-and-d's host graph:
<did:graph:r-and-d>           context://participates_in  <did:graph:acme-corp> .
```

Each layer is its own graph with its own delegates and its own governance. Nesting is detected by walking `context://participates_in` links upward; the runtime MUST enforce a maximum nesting depth (RECOMMENDED: 16) and MUST detect cycles.

An individual who participates in `engineering-team` is NOT automatically a participant of `acme-corp`. Membership is not transitive by default. Capability delegation flows differently (see [§10](#10-governance-integration)).

### 6.4 Group of One

A group with one `capabilityInvocation` delegate is structurally identical to one with many — the size of the delegate set is the only difference. A user who wants the ability to add delegates later (e.g., to designate a secondary identity to sign on their behalf) MAY groupify their personal graph rather than creating a `did:key`; the application-level API is the same in both cases.

A `did:key` is a *constrained* form of one-delegate identity: it carries exactly one verification method and that method cannot be rotated. A `did:key` MAY be treated, for signing and capability-holding purposes, as a one-delegate group; but it does NOT support `addDelegate`, `grantSection`, or any other mutation of its document. See [§11](#11-isomorphism-individual--group-of-one) for the precise relationship.

There is no separate "create a group" flow that conjures a new kind of entity. Inviting a collaborator is delegate addition (and optionally participation acceptance) on an existing group. Promoting an ordinary graph to a group is a single `groupify()` call.

This specification does NOT define a `did:key` → `did:graph` migration path. A `did:key` identity is fixed; users who anticipate ever wanting more delegates SHOULD create a `did:graph` from the start.

---

## 7. Two Distinct Concerns: Participation vs Signing Authority

This section is normative.

"Member" can mean both "is part of this group" and "can sign as this group." This specification separates these two concerns, because they answer different questions, follow different lifecycles, and warrant different governance.

### 7.1 Participation

**Question answered:** "Who is part of this group?"

**Recorded in:** Triples in participant graphs (`context://participates_in`) plus reciprocal acceptance in the group graph (`context://accepts_participation`).

**Authority required:** The participant declares; the group accepts via an `acceptParticipation` ZCAP held by a `capabilityDelegation` delegate.

**Consequences:** Inheritance of governance constraints across the participation graph ([[CAPABILITY-FRAMEWORK]] §6), visibility in `transitiveParticipants()`.

**Lifecycle:** Either side can revoke. Participants can simply remove their `participates_in` triple. Groups can remove their `accepts_participation` triple.

### 7.2 Signing Authority (DID-Document Delegates)

**Question answered:** "Who can currently sign as this group?"

**Recorded in:** Triples in the group's own DID document, in the `verificationMethod` and capability sections (`capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`). See [§5](#5-did-document-delegates).

**Authority required:** An `updateDIDDocument` ZCAP held by the agent making the change.

**Consequences:** A signature by any current delegate's method counts as a signature *by the group* for the granted capability section. Used to invoke ZCAPs, sign expressions, and sign snapshots on the group's behalf.

**Lifecycle:** Add, remove, promote, demote, rotate per [§5.3](#53-delegate-lifecycle).

### 7.3 Why They Are Separate

Consider a company. The CEO can sign contracts on the company's behalf — they are a `capabilityInvocation` delegate. Every employee is a participant in the company — but most employees cannot sign contracts. Conflating the two would make every employee able to bind the company (chaos) or require every contract to involve every employee (impossible).

Concretely:

- **Participation answers governance scope.** What rules apply to your writes? You inherit them from the graphs you participate in.
- **Signing authority answers attribution.** When a signature is presented, who counts as the signer? Any current delegate.

The two overlap by convention (a participant who is also a `capabilityInvocation` delegate is common). But the substrate keeps them in different sections of the data model so they can be managed independently.

### 7.4 Common Patterns

| Pattern | Participants | Delegates |
|---|---|---|
| Personal identity (`did:key`) | One (self) | One (self) |
| Tight team | Everyone is a participant | Everyone is a `capabilityInvocation` delegate |
| Org with execs | Everyone is a participant | Only execs are `capabilityInvocation` delegates |
| Council-led community | Everyone is a participant | Only council members are delegates |
| Federation | Member orgs are participants | Only nominated representatives are delegates |
| Augmented team | The base identities are participants | The base identities plus an additional delegated identity are `capabilityInvocation` delegates |

### 7.5 Non-Goal: Multisig

This specification explicitly does NOT define multisig, threshold signatures, or aggregate-key schemes for the group DID itself ([§5.2](#52-non-goals)). Shared signing authority is achieved via DID-document delegates — any current delegate produces a signature that counts as the group's signature.

Joint *operational* approval (e.g., two delegates must each sign a particular ZCAP) MAY be expressed as a `content` caveat on a ZCAP ([[CONSTRAINT-VOCABULARY]] §7.9):

```json
{
  "type": "content",
  "sparql": "ASK { ... two distinct delegate signatures present ... }"
}
```

But this is governance-layer composition, not a built-in cryptographic feature of the DID.

---

## 8. API

### 8.1 The Group Convenience Interface

The `Group` interface is a thin convenience wrapper over `Graph` + `DIDCredential`. It exists for ergonomics; everything it does can be done directly via the underlying APIs ([§5.4](#54-extending-didcredential-for-didgraph)).

```webidl
[Exposed=Window, SecureContext]
interface Group {
  readonly attribute USVString did;          // did:graph:... (the signing identity)
  readonly attribute USVString iri;          // graph://<content-hash> (the host graph's IRI)
  readonly attribute Graph graph;        // the host graph
  readonly attribute DOMString? name;
  readonly attribute DOMString? description;
  readonly attribute DOMString created;      // RFC 3339
  readonly attribute USVString creator;      // did:key:... or did:graph:...

  // Participation
  [NewObject] Promise<sequence<Participant>> participants();
  [NewObject] Promise<sequence<Participant>> transitiveParticipants();
  [NewObject] Promise<sequence<Group>> parentGroups();
  [NewObject] Promise<sequence<Group>> childGroups();
  [NewObject] Promise<undefined> invite(USVString participantDid);
  [NewObject] Promise<undefined> revokeParticipation(USVString participantDid);
  [NewObject] Promise<boolean> hasParticipant(USVString did);

  // Signing authority (delegate management)
  [NewObject] Promise<sequence<DIDDocumentMethod>> signers(optional DIDCapabilitySection section);
  [NewObject] Promise<undefined> addSigner(DIDDocumentMethod method, sequence<DIDCapabilitySection> sections);
  [NewObject] Promise<undefined> removeSigner(USVString methodId);
  [NewObject] Promise<boolean> isSigner(USVString did, optional DIDCapabilitySection section);

  // Capability delegation
  [NewObject] Promise<SignedContent> delegateCapability(DelegateOptions options);

  // Identity resolution
  [NewObject] Promise<DIDDocument> resolve();
};

dictionary Participant {
  required USVString did;
  required boolean isGroup;     // true if the participant is itself a did:graph
  required DOMString joinedAt;  // RFC 3339; derived from the accepts_participation reifier
  DOMString name;
};

dictionary DelegateOptions {
  required USVString invoker;       // DID receiving the capability
  required sequence<USVString> actions;
  required USVString resource;       // did:graph (the group's, or another group it has authority over)
  sequence<object> caveats;
  USVString expiresAt;
};
```

#### 8.1.1 invite(participantDid)

Adds an `accepts_participation` triple in the group's graph. Requires the caller to hold an `acceptParticipation` ZCAP. The named participant must then add its own `participates_in` triple in its own graph to complete participation.

#### 8.1.2 revokeParticipation(participantDid)

Removes the group's acceptance triple. Requires an `acceptParticipation` ZCAP.

#### 8.1.3 participants() / transitiveParticipants()

`participants()` returns the direct participant set. `transitiveParticipants()` recursively resolves all individual participants of nested participating groups, with cycle detection per [§6.3](#63-graph-nesting).

#### 8.1.4 addSigner / removeSigner / replaceSigner

`addSigner` and `removeSigner` wrap [§5.4](#54-extending-didcredential-for-didgraph)'s delegate management. Both modify the group's DID document and require an `updateDIDDocument` ZCAP.

`removeSigner` MUST refuse — rejecting with `"InvalidStateError"` — when the named method is the only remaining member of the group's `capabilityDelegation` section. Removing it would leave the DID document permanently unmodifiable.

The `Group` interface SHOULD provide a `replaceSigner(oldMethodId, newMethod, sections)` convenience that performs add-and-remove as one atomic governance batch. This is the supported path for handing off sole `capabilityDelegation` authority without entering the brick state.

```webidl
partial interface Group {
  [NewObject] Promise<undefined> replaceSigner(
    USVString oldMethodId,
    DIDDocumentMethod newMethod,
    sequence<DIDCapabilitySection> sections
  );
};
```

#### 8.1.5 delegateCapability

Issues a ZCAP whose `resource` is this group's `did:graph` (or another `did:graph` the group has authority over). Signed by a current `capabilityDelegation` delegate of this group. Per [[CAPABILITY-FRAMEWORK]] §1.3, ZCAP `resource` MUST be a DID for long-lived authority; IRIs are reserved for snapshot-scoped capabilities.

### 8.2 GraphManager Extension

A group is created via the user agent's `GraphManager` (`navigator.graph`, defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §3.4).

```webidl
partial interface GraphManager {
  /** Create a fresh graph AND groupify it in one step. */
  [NewObject] Promise<Group> createGroup(optional GroupCreationOptions options);

  /** Groupify an existing graph (one without a DID). One-way upgrade. */
  [NewObject] Promise<Group> groupify(USVString graphIri, optional GroupifyOptions options);

  /** Open a group by its IRI or its did:graph alias. */
  [NewObject] Promise<Group> openGroup(USVString iriOrDid);

  [NewObject] Promise<sequence<Group>> listGroups();
};

dictionary GroupCreationOptions {
  DOMString displayName;
  DOMString description;
  sequence<USVString> initialDelegates;   // additional DIDs to add as capabilityInvocation delegates
  USVString participatesIn;                // IRI or did:graph of parent (if creating a sub-group)
  USVString syncModule;                    // module hash for the group's sync
  sequence<USVString> relays;
  EnforcementMode enforcementMode;         // initial governance mode — see [[CAPABILITY-FRAMEWORK]] §11
};

dictionary GroupifyOptions {
  DOMString displayName;                   // optional metadata to add at groupification
  DOMString description;
  sequence<USVString> initialDelegates;
};
```

#### 8.2.1 createGroup

Creates a fresh graph via [[PERSONAL-LINKED-DATA-GRAPHS]] §4.1, immediately groupifies it via [§4.2](#42-groupification), populates the standard `group://` metadata, and optionally configures sync ([[CONTEXT-SYNC]]) and governance ([[CAPABILITY-FRAMEWORK]]). Returns a `Group` convenience handle.

#### 8.2.2 groupify

Performs [§4.2](#42-groupification) on a graph that does not yet have a DID. Requires the caller to hold a `groupifyContext` ZCAP on the graph (the root capability minted at creation includes this). Rejects with `"InvalidStateError"` if the graph is already a group. After this call:

- `graph.did` returns the newly-minted `did:graph:...`.
- `graph.iri` advances to the post-groupification IRI (the binding + seed DID document are now part of the canonical triple set).
- Any existing `Graph` instances backed by the same per-graph store observe the change via the realm's normal mutation events (`tripleadded`); their `did` and `iri` attributes update accordingly.

A `Group` convenience handle is returned.

#### 8.2.3 openGroup

Opens an existing group's host graph (via [[CONTEXT-SYNC]] mount with `mode: "read"`, "write", or "governance" as appropriate) and returns the convenience handle. The argument MAY be either the host graph's IRI or its `did:graph` alias.

---

## 9. Group Lifecycle

### 9.1 Creation

```javascript
const team = await navigator.graph.createGroup({
  displayName: "Engineering",
  initialDelegates: ["did:key:z6MkAlice...", "did:key:z6MkBob..."],
  enforcementMode: "open"
});
```

Behind the scenes:

1. A fresh graph is minted via [[PERSONAL-LINKED-DATA-GRAPHS]] §4.1, yielding a `graph://<content-hash>` IRI.
2. A new `did:graph` keypair is generated and the graph is groupified ([§4.2](#42-groupification)): the binding triples and seed DID-document triples are written. The creator becomes the first delegate.
3. `initialDelegates` are added via `did-document://add-method` and `did-document://grant-section` writes (subject to `updateDIDDocument` ZCAP, which the creator holds via the root capability).
4. The group's metadata is written.
5. The graph is mounted in `"governance"` mode.
6. The `Group` convenience handle is returned.

To groupify an *existing* graph without a DID, use `navigator.graph.groupify(graphIri)` instead — the IRI stays the same; the DID and DID document are added in place.

### 9.2 Inviting a Participant

The group's acceptance triple is written first; the participant then completes participation in their own graph.

```javascript
// On the group's side (with acceptParticipation capability):
await team.invite("graph://<alice-personal-hash>");

// Out of band, Alice receives the invitation.
// On Alice's side:
const alicePersonal = await navigator.graph.create({ displayName: "Alice (personal)" });
await alicePersonal.addTriple({
  subject: alicePersonal.iri,
  predicate: "context://participates_in",
  object: team.did   // or team.iri — both work
});
```

### 9.3 Adding a Signer

A signer is added by modifying the group's DID document. The new signer's DID need not be a current participant.

```javascript
await team.addSigner(
  {
    id: `${team.did}#key-charlie`,
    type: "Ed25519VerificationKey2020",
    controller: team.did,
    publicKeyMultibase: "z6MkCharlie..."
  },
  ["capabilityInvocation", "assertionMethod"]
);
```

### 9.4 Withdrawal

Either side can withdraw participation:

- The participant removes their `participates_in` triple.
- The group removes its `accepts_participation` triple (via `revokeParticipation()`).

A signer is removed via `removeSigner()`. Past signatures by the removed signer remain verifiable against historical DID-document state.

### 9.5 Empty Groups

A group with zero participants is valid. A group with zero `capabilityInvocation` delegates can still exist (the group cannot sign anything new, but its prior signed expressions remain verifiable). This is the dormant state.

---

## 10. Governance Integration

### 10.1 Group as Governance Graph

A group's host graph is governed like any other graph: its root capability is minted at creation, ZCAPs target the group's DID as `resource`, and constraint inheritance follows participation links per [[CAPABILITY-FRAMEWORK]] §6.

The creator holds the root capability initially. Delegating it (e.g., to a separate "Governance Council" group's DID) shifts the locus of authority — and once delegated, the creator has no special standing.

### 10.2 Capability Delegation to a Group DID

A capability MAY be delegated with a group DID as `invoker`:

```json
{
  "invoker": "did:graph:moderators...",
  "actions": ["removeLink"],
  "resource": "did:graph:community-general...",
  "caveats": []
}
```

When the governance engine verifies an invocation:

1. Identify the agent who actually signed the operation.
2. Check whether the agent's signing key is currently listed in `capabilityInvocation` of the `did:graph:moderators...` DID document.
3. If yes, the invocation is valid.

This enables **role-based access control** through delegate sets:

- The capability is delegated to a `did:graph` representing the role.
- Adding or removing a "moderator" is adding or removing a delegate in the moderators' DID document.
- The capability itself is unchanged.

### 10.3 No Transitive Capability Through Participation

This specification does NOT define a mechanism by which a capability delegated to group H propagates to participants of H. Cascading authority across nested groups MUST be expressed as an explicit delegation chain (H delegates to G's DID; G in turn delegates to A's DID).

Explicit delegation chains are auditable, each hop carries its own caveats, and each hop can be revoked independently. A transitive-through-participation shortcut would conflate participation with signing authority — exactly what [§7](#7-two-distinct-concerns-participation-vs-signing-authority) is at pains to keep apart — and would create an opaque escalation vector when a participating group adds members.

### 10.4 Membership Governance

The rules governing who can be invited and how participation is accepted live as governance triples in the group's graph:

```turtle
<group-did>
  group://participation_open    "false" ;
  group://participation_requires_credential
                                <did:vc:type:CommunityMember> ;
  group://participation_max_count "500" .
```

The `accepts_participation` operation is gated by an `acceptParticipation` ZCAP whose caveats MAY encode these rules. Patterns more complex than the predicates above (e.g., "M of N delegates must each approve") MUST be expressed as a `content` caveat on the `acceptParticipation` ZCAP per [[CONSTRAINT-VOCABULARY]] §7.9; this specification does not define dedicated predicates for them.

---

## 11. Isomorphism: Individual = Group of One

This section is normative.

### 11.1 The Claim

Within the `did:graph` data model, "individual" and "collective" are the same kind of thing at the data-model level — they differ only in the size of their delegate set and (typically) participant set.

When a user creates a `did:graph` with `initialDelegates: []` ([§9.1](#91-creation)), they have a group with exactly one `capabilityInvocation` delegate (themselves) and no participants. When the group grows to a hundred delegates, only the document size changes. No code path, predicate, or governance rule branches on delegate count.

`did:key` is a related but constrained form (see [§11.2](#112-didkey-as-a-constrained-form)).

### 11.2 `did:key` as a Constrained Form

A `did:key` carries exactly one verification method, derived from the single key, and that method cannot be rotated. It can be treated, for *signing* and *capability-holding* purposes, as a one-delegate group — but the delegate-management operations defined in [§5.4](#54-extending-didcredential-for-didgraph) (`addDelegate`, `removeDelegate`, `grantSection`, `revokeSection`) reject on `did:key` credentials with `"NotSupportedError"`. The `did:key` document is immutable beyond its initial form.

This specification does NOT define a `did:key` → `did:graph` migration. Users who anticipate ever wanting more delegates SHOULD create a `did:graph` from the start. The application API (`navigator.credentials.create`, `sign`, capability invocation) is the same in both cases; the difference is whether the delegate set can grow.

### 11.3 "Upgrade to Group" Is a Single Operation

A graph that begins without a DID (Spec 02) can be promoted to a group with a single `groupify()` call: no migration, no data move. The data already in the graph is unchanged. New triples are added — the binding + DID document — and the graph's IRI advances to a new value reflecting the addition (per [§4.2](#42-groupification)). The DID minted at that moment is the durable identity that survives this and all subsequent IRI changes.

Inviting an additional collaborator after groupification is two operations on existing structures:

- Adding a delegate to the group's DID document (so the collaborator can sign as the group).
- Issuing an invitation (writing `accepts_participation`) so the collaborator can declare participation.

Neither creates a new identity. The DID is unchanged. Only the membership counts change.

### 11.4 Why This Matters

Many collaboration systems have a seam between "personal" and "shared". You have a personal account; you "create an organisation" which is a different kind of entity. These seams cause accidental complexity — migration paths, permission-model mismatches, two sets of APIs.

This specification eliminates the seam within `did:graph`: a one-delegate group and a one-hundred-delegate group are the same kind of thing. The substrate has one identity primitive (the DID) and one data primitive (the Graph). Both work for one and for billions.

### 11.5 Formal Statement

Let G₁ be a `did:graph` group with a single delegate. Let Gₙ be a `did:graph` group with n > 1 delegates. The following MUST hold:

1. G₁ and Gₙ are represented identically: both are DIDs with backing host graphs whose triples include the DID-document predicates from [§4.4](#44-did-document-storage).
2. Every operation defined in this specification's API ([§8](#8-api)) that is valid on Gₙ is also valid on G₁ (subject to capability checks and the brick-state guards of [§5.4](#54-extending-didcredential-for-didgraph)).
3. The return types and semantics of operations are identical.
4. No API method, predicate, or governance rule branches on delegate count or participant count.

A `did:key` identity K MAY be treated as a constrained G₁ for signing and capability-holding purposes. The delegate-management operations of [§5.4](#54-extending-didcredential-for-didgraph) are not defined on K and MUST reject with `"NotSupportedError"`. Other operations defined on G₁ that do not require document mutation (`sign`, `delegateCapability` invocation as the resource, capability holding) MUST behave identically on K and G₁.

Conforming implementations MUST NOT provide separate JavaScript interfaces, code paths, or data stores for "individual" and "collective" `did:graph` identities; the same `DIDCredential` instance handles both regardless of delegate count. `did:key` and `did:graph` MAY share or differ in their internal representation, provided the application-visible API is the single `DIDCredential` interface defined by [[DECENTRALISED-IDENTITY]].

---

## 12. Delegated Voting Use Case

This section is informative.

### 12.1 The Pattern

Delegated voting combines direct voting (every voter holds a vote on every issue) with representative voting (you delegate your vote to someone you trust). Critical properties:

- **Granular** — you can delegate differently on different topics.
- **Revocable** — you can pull your delegation back at any moment.
- **Transitive** — your delegate can delegate further (with limits).
- **Transparent** — you can see how your delegated vote was cast.

The substrate makes this a natural consequence of composition: identity ([[DECENTRALISED-IDENTITY]]), `did:graph` ([§4](#4-the-didgraph-method)), governance ([[CAPABILITY-FRAMEWORK]]), and groups (this specification) compose to give delegated voting "for free."

### 12.2 Delegation as a Signed Triple

A delegation is a triple in the delegator's graph:

```turtle
# In Alice's personal graph (graph://<alice-personal-hash>; may or may not have its own DID):
<graph://<alice-personal-hash>>
  vote://delegates_to    <did:graph:energy-experts> ;
  vote://delegates_topic <topic://climate-energy> ;
  vote://valid_until     "2027-01-01T00:00:00Z"^^xsd:dateTime ;
  vote://revocable       "true" .
```

The delegate may be any DID — an individual (`did:key`) OR a group (`did:graph`). When the delegate is a group, the group's internal governance produces the cast vote.

### 12.3 Casting the Vote

When the delegate is an individual, they sign the vote with their `did:key`. Standard.

When the delegate is a group, one of the group's `capabilityInvocation` delegates produces a vote according to the group's internal governance:

- The group might use a flow ([[GRAPH-FLOWS]]) to deliberate.
- The group might require quorum (a guard on the "submit-vote" transition).
- The group might require multiple internal delegates to sign (a content caveat on the submit-vote ZCAP).
- The group might delegate further to a sub-group of domain experts.

The resulting ballot is signed by a current `capabilityInvocation` delegate of the group's DID. The ballot's author is the group's `did:graph:...`. Verification follows the standard DID-document-delegate semantics ([§5.1](#51-semantics)).

### 12.4 Composing the Pieces

Delegated voting is not a feature added to this substrate. It is the result of:

- Identity at every scale, via DIDs.
- Per-graph governance (ZCAPs, immanent rules).
- Structured reasoning as data (triples — delegate reasoning is queryable).
- Nesting (parts forming wholes forming parts).

Delegating a vote to a *group* — not just to an individual expert — is what previous systems could not do without bespoke infrastructure. Here, it is the obvious case.

---

## 13. Security Considerations

### 13.1 Initial-Key Permanence

The initial public key is permanently embedded in the `did:graph` identifier (per [§4.1](#41-identifier-format)). This has two consequences:

- **The identifier discloses the initial key forever.** Anyone seeing the DID can recover the initial public key, even after the initial method has been removed from `verificationMethod`. This is unavoidable given the identifier construction.
- **A holder of the initial private key can produce signatures that verify against the embedded public key indefinitely.** Such signatures will fail capability-section checks once the initial method has been revoked (per [§5.3](#53-delegate-lifecycle)), but verifiers that do not consult the current DID document — for example, naive Ed25519 verifiers checking against the identifier directly — would still accept them.

Communities for whom the initial key's eventual disclosure or compromise is a concern SHOULD use an *ephemeral* keypair at groupification time: generate the keypair, perform groupification, immediately grant `capabilityInvocation` / `capabilityDelegation` to one or more long-lived delegates, then destroy the initial private key. The identifier still encodes the (now-orphaned) initial public key, but no one possesses the corresponding private half.

### 13.2 Group DID Key Custody

A group's DID document lists multiple verification methods, each backed by a separate keypair held by its corresponding delegate. There is no single "group key" to lose — losing a delegate's key only removes that one delegate's ability to sign.

For redundancy, groups SHOULD have multiple `capabilityDelegation` delegates so that any one becoming unavailable does not leave the group unable to update its DID document. The substrate enforces this at the API level: `removeDelegate` / `revokeSection` MUST refuse to remove the last `capabilityDelegation` method (per [§5.4](#54-extending-didcredential-for-didgraph)), but applications SHOULD still maintain redundancy proactively.

### 13.3 Compromised Delegate

A compromised `capabilityInvocation` delegate can sign on the group's behalf until removed. Mitigations:

- Regular review of the delegate set by holders of `capabilityDelegation`.
- Prompt removal of suspected-compromised delegates via `removeSigner()` (or directly via `DIDCredential.removeDelegate()`).
- For high-value capabilities, use `content` caveats on ZCAPs to require multiple independent signatures ([[CONSTRAINT-VOCABULARY]] §7.9).

Historical signatures by removed delegates remain verifiable; this is intentional (verification of past statements should not depend on current document state).

Compared to `did:key`, the DID-document-delegate model is **strictly better** for compromise recovery: a `did:key` compromise is unrecoverable (the key cannot be rotated), whereas a single-delegate compromise in `did:graph` is recoverable by any remaining `capabilityDelegation` delegate via `removeSigner()`. Implementations that need stronger compromise resistance MAY layer joint-signing protocols on top, but the substrate does not require them.

### 13.4 Participation Spoofing

Unilateral participation claims are ignored. Both sides must declare. The parent's acceptance MUST be signed by a current `capabilityDelegation` delegate of the parent.

### 13.5 DID-Document Tampering and Integrity

DID-document writes are governance-controlled via `did-document://*` predicates ([§4.5](#45-document-updates), [[CAPABILITY-FRAMEWORK]] §10). An agent without `updateDIDDocument` capability cannot modify the document.

For `did:graph`, the DID document is triple data in the underlying graph. Its integrity depends on the graph's own integrity (sync-layer governance, capability proofs, snapshot signatures). A user agent MUST refuse to honour signatures by methods listed in a DID document fetched from an `"external"` source if the source snapshot's authorship cannot be verified.

### 13.6 Group Impersonation

Group DIDs are cryptographically unique. However, group metadata (name, description) is freely chosen and could mimic existing groups. Implementations SHOULD provide mechanisms for verifying group authenticity (out-of-band DID publication, verifiable credentials, web-of-trust endorsements).

### 13.7 Nesting Depth Attacks

Deep nesting can cause resource exhaustion for membership traversals (e.g., federated discovery walks across many participating graphs). Implementations MUST enforce a maximum nesting depth (RECOMMENDED: 16) for such walks. Governance validation is per-graph ([[CAPABILITY-FRAMEWORK]] §6.1) and is unaffected by nesting depth.

---

## 14. Privacy Considerations

### 14.1 Participation Visibility

`accepts_participation` triples are in the group's graph; `participates_in` triples are in the participant's graph. Both are visible to anyone with read access to the respective graphs.

### 14.2 Delegate-Set Disclosure

The group's DID document is part of its graph. Anyone with read access to the graph sees the current delegates. A DID document discloses *who can sign as the group* — if delegate keys are tied to individual identities, the document leaks the signing-membership. Communities that need delegate-set privacy SHOULD use rotated, single-use delegate keys not tied to long-term individual DIDs and treat the DID document as public.

### 14.3 Per-Graph Identity

An agent SHOULD use different `did:key`s when participating in different groups, to prevent cross-graph correlation. The substrate makes this cheap.

### 14.4 Nesting Structure Leakage

Graph nesting reveals organisational structure. If A participates in B which participates in C, the chain reveals a hierarchy to anyone reading these graphs. For high-privacy needs, nesting MAY be implemented via a separate (sync-isolated) graph.

### 14.5 Delegated Vote Deliberation

When a delegate is a group, that group's internal deliberation may include sensitive opinions of participants. Communities that need internal-deliberation privacy SHOULD use a Privacy-Tiered or Fully Partitioned sync topology ([[CONTEXT-SYNC]] §7.2) for the deliberation graph.

---

## 15. Examples

### 15.1 Create a `did:graph` Credential Directly

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
console.log(team.did);     // "did:graph:z6Mkh..."
console.log(team.method);  // "graph"
console.log(team.methodId); // "did:graph:z6Mkh...#key-creator"
```

### 15.2 Create a Personal Identity

```javascript
// Option A: did:key (immutable — cannot later add delegates).
const meKey = await navigator.credentials.create({
  did: { method: "key", displayName: "Alice" }
});
console.log(meKey.did);   // "did:key:z6Mk..."

// Option B: a did:graph with one delegate — same surface, but the document
// is mutable so additional delegates can be added later. Recommended when
// the user might ever want shared signing authority.
const mePersonal = await navigator.credentials.create({
  did: { method: "graph", displayName: "Alice", graphOptions: { initialDelegates: [] } }
});
console.log(mePersonal.did);   // "did:graph:z6Mk..."

// Option C: a plain graph (no DID), to be promoted later if needed.
const notes = await navigator.graph.create({ displayName: "Notes" });
console.log(notes.iri);   // "graph://<hash>..."
console.log(notes.did);   // null

// Promote when desired. The graph's IRI advances when groupify writes the
// binding + seed DID document; the existing `notes` Graph instance observes
// the change via the realm's normal mutation events (per [§8.2.2](#822-groupify))
// and its `did` and `iri` attributes update accordingly.
await navigator.graph.groupify(notes.iri);
console.log(notes.did);   // "did:graph:z6Mk..."
console.log(notes.iri);   // a new graph://<hash>... — IRI advanced
```

### 15.3 Create a Team via the Group Convenience API

```javascript
const team = await navigator.graph.createGroup({
  displayName: "Project Alpha",
  description: "Core development team",
  initialDelegates: [
    "did:key:z6MkAlice...",
    "did:key:z6MkBob...",
    "did:key:z6MkCarol..."
  ],
  enforcementMode: "announced"
});

await team.invite("graph://<alice-personal-hash>");
await team.invite("graph://<bob-personal-hash>");
await team.invite("graph://<carol-personal-hash>");

const ps = await team.participants();
const signers = await team.signers("capabilityInvocation");
```

### 15.4 Sign as the Group

```javascript
const teamCred = await navigator.credentials.get({
  did: { method: "graph", filter: { did: team.did } }
});

const announcement = await teamCred.sign({
  type: "Announcement",
  body: "v1.0 shipped",
  timestamp: new Date().toISOString()
});

console.log(announcement.author);            // team.did (did:graph:...)
console.log(announcement.proof.method);      // the specific delegate's verification method
```

### 15.5 Managing Delegates Directly on a `did:graph` Credential

```javascript
const current = await teamCred.delegates();

await teamCred.addDelegate(
  {
    id: `${team.did}#key-charlie`,
    type: "Ed25519VerificationKey2020",
    controller: team.did,
    publicKeyMultibase: "z6MkCharlie..."
  },
  ["capabilityInvocation", "assertionMethod"]
);

await teamCred.removeDelegate(`${team.did}#key-charlie`);
```

### 15.6 Signing a Graph Snapshot

```javascript
const sig = await teamCred.signGraph(team.did);
console.log(sig.data);
// {
//   graphDid:   "did:graph:z6Mk...",       // durable identity
//   graphIri:   "graph://<content-hash>",  // state at the moment of observation
//   timestamp:  "2026-05-27T09:00:00Z"     // when the observation was made
// }
```

### 15.7 Groupify an Existing Graph

```javascript
// Alice has been collecting notes in a personal graph.
const notes = await navigator.graph.create({ displayName: "Notes" });
await notes.addTriple(new Triple("urn:note:1", "schema://text", "first note"));
const iriBefore = notes.iri;

// Later, she wants to share these with a co-author and let either of them
// sign on the notes' behalf. Promote the graph to a group:
const notesGroup = await navigator.graph.groupify(notes.iri, {
  initialDelegates: ["did:key:z6MkBob..."],
});

console.log(notes.iri !== iriBefore);   // true — IRI advanced (binding + DID-doc triples added)
console.log(notes.did);                  // now "did:graph:z6Mk..." — durable identity
console.log(notesGroup.did);             // same
// Existing triples and their authorship are untouched; only new triples were added.
```

### 15.8 Nest a Team in an Organisation

```javascript
const org = await navigator.graph.createGroup({ displayName: "Acme Corp" });
const eng = await navigator.graph.createGroup({ displayName: "Engineering" });
const marketing = await navigator.graph.createGroup({ displayName: "Marketing" });

await org.invite(eng.did);
await org.invite(marketing.did);

const children = await org.childGroups();
const everyone = await org.transitiveParticipants();
```

### 15.9 Role-Based Access via Delegate Set

```javascript
const community = await navigator.graph.createGroup({ displayName: "Web Standards Community" });

const moderators = await navigator.graph.createGroup({
  displayName: "Moderators",
  initialDelegates: ["did:key:z6MkMod1...", "did:key:z6MkMod2..."]
});

await community.delegateCapability({
  invoker: moderators.did,
  actions: ["removeLink"],
  resource: community.did,
  caveats: [
    { type: "predicate", value: { allowed: ["msg://body", "msg://reaction"] }}
  ]
});

// Adding a new moderator is addSigner() on moderators — no per-person re-delegation needed.
await moderators.addSigner(
  { id: `${moderators.did}#key-mod3`, type: "Ed25519VerificationKey2020",
    controller: moderators.did, publicKeyMultibase: "z6MkMod3..." },
  ["capabilityInvocation"]
);
```

### 15.10 Delegate a Vote to a Group

```javascript
// In Alice's personal graph: delegate her energy-policy vote to a working group.
const alicePersonal = await navigator.graph.create({ displayName: "Alice (personal)" });

await alicePersonal.addTriple({
  subject: alicePersonal.iri,
  predicate: "vote://delegates_to",
  object: "did:graph:energy-experts"
});
await alicePersonal.addTriple({
  subject: alicePersonal.iri,
  predicate: "vote://delegates_topic",
  object: "topic://climate-energy"
});
```

### 15.11 Resolving a Group DID Document

```javascript
const doc = await navigator.credentials.resolve(team.did);
console.log(doc.verificationMethod);
console.log(doc.capabilityInvocation);
console.log(doc.trustLevel);   // "local" | "mounted-read" | "external" | "cached"
```

---

## 16. Predicate Reference Table

| Predicate | Domain | Range | Description |
|---|---|---|---|
| `did://verificationMethod` | `did:graph` DID | Verification method id | Lists a method as belonging to the DID document. |
| `did://capabilityInvocation` | `did:graph` DID | Verification method id | Method is authorised to invoke capabilities held by the DID. |
| `did://capabilityDelegation` | `did:graph` DID | Verification method id | Method is authorised to delegate the DID's capabilities further (including updating the DID document). |
| `did://assertionMethod` | `did:graph` DID | Verification method id | Method is authorised to assert on behalf of the DID (sign snapshots, attest). |
| `did://authentication` | `did:graph` DID | Verification method id | Method is authorised to authenticate as the DID. |
| `did://verificationMethod/type` | Verification method id | Literal string | Method's cryptographic type (e.g. `"Ed25519VerificationKey2020"`). |
| `did://verificationMethod/controller` | Verification method id | DID | The DID that controls the method. |
| `did://verificationMethod/publicKeyMultibase` | Verification method id | Multibase literal | The method's public key. |
| `did://deactivated` | `did:graph` DID | `xsd:boolean` | If true, the DID is deactivated; no further signatures from current delegates will verify. |
| `did-document://add-method` | `did:graph` DID | (governance op) | Adds a new `verificationMethod`. |
| `did-document://remove-method` | `did:graph` DID | (governance op) | Removes a method entirely. |
| `did-document://grant-section` | `did:graph` DID | (governance op) | Adds a method to a capability section. |
| `did-document://revoke-section` | `did:graph` DID | (governance op) | Removes a method from a capability section. |
| `group://didIdentity` | Graph IRI | `did:graph` DID | Binds a graph's IRI to its DID identity. Present iff the graph is a group. Queryable in either direction (no reverse predicate is defined). |
| `group://name` | Group DID | Literal string | Human-readable group name |
| `group://description` | Group DID | Literal string | Group description |
| `group://avatar` | Group DID | URI | URI of the group's avatar |
| `group://created` | Group DID | xsd:dateTime | Creation timestamp |
| `group://creator` | Group DID | DID | DID of the agent that created the group |
| `group://participation_open` | Group DID | xsd:boolean | If true, agents may self-add participation. Default false. |
| `group://participation_requires_credential` | Group DID | VC type URI | Credential required for participation acceptance. More complex rules (M-of-N approval, etc.) MUST be expressed as `content` caveats on the `acceptParticipation` ZCAP per [[CONSTRAINT-VOCABULARY]] §7.9. |
| `group://participation_max_count` | Group DID | xsd:integer | Maximum number of accepted participants |
| `context://participates_in` | Participant DID (any graph) | Group DID | Asserted in the participant's graph; declares participation. Mutually required. |
| `context://accepts_participation` | Group DID | Participant DID | Asserted in the group's graph; confirms participation. Mutually required; MUST be signed by a `capabilityDelegation` delegate of the group. |
| `vote://delegates_to` | Participant DID | DID (individual or group) | Asserts a vote delegation. |
| `vote://delegates_topic` | Participant DID | Topic URI | Scopes the delegation to a topic. |
| `vote://valid_until` | Participant DID | xsd:dateTime | Delegation expiry. |
| `vote://revocable` | Participant DID | xsd:boolean | Whether the delegation can be revoked unilaterally. |

---

## 17. References

### 17.1 Normative References

**[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./01_decentralised-identity-web-platform.md).

**[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./02_personal-linked-data-graphs.md).

**[CAPABILITY-FRAMEWORK]** [Graph Capability Framework](./04_graph-capability-framework.md).

**[CONTEXT-SYNC]** [Graph Synchronisation Protocol](./05_context-sync-protocol.md).

**[DID-CORE]** Decentralized Identifiers (DIDs) v1.0. W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/

**[RFC2119]** Key words for use in RFCs to Indicate Requirement Levels. BCP 14, RFC 2119, March 1997.

**[RFC8174]** Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words. BCP 14, RFC 8174, May 2017.

**[RFC8032]** Edwards-Curve Digital Signature Algorithm (EdDSA). RFC 8032, January 2017.

**[ZCAP-LD]** Authorization Capabilities for Linked Data. W3C Community Group Report. https://w3c-ccg.github.io/zcap-spec/

### 17.2 Informative References

**[GRAPH-FLOWS]** [Graph Flows](./10_graph-flows.md).

**[CONSTRAINT-VOCABULARY]** [Governance Constraint Vocabulary](./08_governance-constraint-vocabulary.md).

**[SHAPE-VALIDATION]** [Dynamic Graph Shape Validation](./07_dynamic-graph-shape-validation.md).

**[VC-DATA-MODEL-2.0]** Verifiable Credentials Data Model v2.0. W3C Recommendation. https://www.w3.org/TR/vc-data-model-2.0/
