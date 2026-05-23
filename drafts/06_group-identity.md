# Decentralised Group Identity

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines a pattern for decentralised group identity on the web, built on the primitives defined in [[PERSONAL-LINKED-DATA-GRAPHS]] (contexts), [[DECENTRALISED-IDENTITY]] (`did:graph`), and [[GRAPH-GOVERNANCE]] (ZCAP-based authorisation). A **group** is a context with a `did:graph:...` DID. Two distinct concerns are kept structurally separate: **participation** (who is *part of* the group, declared from below via `context://participates_in`) and **signing authority** (who can currently *sign as* the group, declared in the group's DID document as `capabilityInvocation` delegates). This separation also rules out multisig and threshold signatures as a substrate concern: shared signing authority is achieved via DID-document delegates. Groups remain isomorphic to individuals (a group of one is structurally identical to a group of many) and remain nestable to arbitrary depth (groups may participate in other groups), with the participation-from-below semantics ensuring that no parent can reach into a child's internal governance.

---

## Status of This Document

This document is a draft Community Group Report. It has no official W3C standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Data Model](#4-data-model)
5. [Two Distinct Concerns: Participation vs Signing Authority](#5-two-distinct-concerns-participation-vs-signing-authority)
6. [API](#6-api)
7. [Group Lifecycle](#7-group-lifecycle)
8. [Governance Integration](#8-governance-integration)
9. [Isomorphism: Individual = Group of One](#9-isomorphism-individual--group-of-one)
10. [Delegated Voting Use Case](#10-delegated-voting-use-case)
11. [Security Considerations](#11-security-considerations)
12. [Privacy Considerations](#12-privacy-considerations)
13. [Examples](#13-examples)
14. [Predicate Reference Table](#14-predicate-reference-table)
15. [References](#15-references)

---

## 1. Introduction

### 1.1 Motivation

The web has identity for individuals via DIDs ([[DID-CORE]]). It also needs identity for collectives — teams, communities, organisations, families, coalitions. This specification defines how to build collective identity on top of the existing primitives — without introducing a separate group-specific data type.

A group is a context (a named graph with a `did:graph:...` DID; see [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3). Both individuals and collectives hold DIDs. Both can sign. Both can hold capabilities. Both can participate in larger contexts.

This specification is therefore a *pattern document*: it describes how to use the other Living Web specifications together to express collective identity, with particular attention to **two concerns that must be kept distinct**:

- **Participation** — who is *part of* this collective? Declared from below via `context://participates_in`. ([[GRAPH-GOVERNANCE]] §6 defines the scope-resolution mechanics.)
- **Signing authority** — who currently can *sign as* this collective? Declared in the group's DID document via `verificationMethod` + `capabilityInvocation` ([[DECENTRALISED-IDENTITY]] §5).

In conventional systems these are conflated (a "member" is implicitly a "signer"). This specification separates them, with the result that the same model scales from a personal identity to a multinational federation using one set of primitives.

### 1.2 Design Principles

**Principle 1: A group of one is structurally identical to a group of many.** A personal `did:key` and a collective `did:graph` are both DIDs. A `did:graph` whose DID document has exactly one `capabilityInvocation` delegate is structurally identical to one with one hundred delegates, except for the size of the delegate set. The transition is membership growth, not a mode switch. See [§9](#9-isomorphism-individual--group-of-one).

**Principle 2: Identity persists independent of participation and delegate set.** A `did:graph` persists across changes in both who participates and who signs. A team that replaces every member over a decade is still the same team — its `did:graph:...` is unchanged.

**Principle 3: Groups can participate in groups, to arbitrary depth.** A group's `did:graph` MAY declare `context://participates_in <larger-graph>` in its own context. The substrate provides participation-from-below for the entire nesting structure. See [§4.3](#43-context-nesting).

### 1.3 Use Cases

- **Teams.** A team creates a `did:graph` for itself. Initial delegates are the founding members.
- **Organisations.** A company creates a `did:graph` and accepts participation from department `did:graph`s. The company's delegate set is its executive officers; departments have their own delegates.
- **Communities.** An open community creates a `did:graph` with governance rules ([[GRAPH-GOVERNANCE]]) defining participation criteria, delegate addition processes, and decision-making structure.
- **Families.** A family creates a `did:graph` for shared photos, calendars, documents.
- **DAOs.** A decentralised autonomous organisation uses a `did:graph` with on-chain-style governance encoded as flow definitions ([[GRAPH-FLOWS]]).
- **Ad-hoc collaborations.** Three people create a temporary `did:graph` for a weekend project.
- **Federations.** Multiple organisations form a federation by each declaring `context://participates_in <federation-did>`; the federation's delegates are designated representatives.
- **Delegated voting.** A voter delegates their vote to a `did:graph` (a working group of experts) rather than to a single person. The group's internal governance produces the vote; one of its `capabilityInvocation` delegates signs the resulting ballot. See [§10](#10-delegated-voting-use-case).

All of these use the same data model and the same API. The differences are scale and governance configuration.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in BCP 14 [[RFC2119]] [[RFC8174]].

A conforming implementation MUST:

1. Treat a "group" as a Context with a `did:graph:...` DID, per [[PERSONAL-LINKED-DATA-GRAPHS]] and [[DECENTRALISED-IDENTITY]].
2. Use `context://participates_in` (declared from below) and the corresponding `context://accepts_participation` (declared from above) as the canonical participation relation ([§4.2](#42-participation)).
3. Use DID-document delegates ([[DECENTRALISED-IDENTITY]] §5) as the canonical mechanism for shared signing authority ([§5.2](#52-signing-authority-did-document-delegates)).
4. NOT define separate code paths or data stores for "individual" and "group" identity. The isomorphism property ([§9](#9-isomorphism-individual--group-of-one)) MUST hold.

A conforming implementation MUST NOT:

- Define multisig, threshold signing, or aggregate-key schemes for the group DID itself.
- Conflate participation with signing authority.

A conforming implementation MAY provide convenience APIs that look like a `Group` interface, provided they map to the underlying Context + DID + governance correctly.

---

## 3. Terminology

<dl>

<dt>Group</dt>
<dd>A context with a <code>did:graph:...</code> DID, treated as a collective identity. "Group" is a usage term, not a separate data type. A group is just a context whose application semantics emphasise collective identity. See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3 for the underlying data structure.</dd>

<dt>Group DID</dt>
<dd>A <code>did:graph:...</code> DID identifying a group. The DID persists across changes in participation and delegate set. The DID document lists current delegates per [[DECENTRALISED-IDENTITY]] §5.</dd>

<dt>Participant</dt>
<dd>An agent (or another group) that has declared <code>context://participates_in &lt;group-did&gt;</code> in its own context, where the group has mutually declared <code>context://accepts_participation</code>. Participation is about <em>being part of</em>, not about authority.</dd>

<dt>Delegate</dt>
<dd>An entry in the group's DID document's capability sections (<code>verificationMethod</code> + <code>capabilityInvocation</code> / <code>capabilityDelegation</code> / <code>assertionMethod</code>). A delegate's key can produce signatures that count as <em>the group's</em> signatures for the granted section. Delegates are about <em>signing as</em>, not about being a participant. The two roles overlap by convention but are not identical.</dd>

<dt>Context Nesting</dt>
<dd>The recursive composition where a group's <code>did:graph</code> participates in a larger group's context. Sovereignty flows from below: the child declares participation; the parent confirms acceptance.</dd>

<dt>Transitive Participation</dt>
<dd>The set of all individual (non-group) agents reachable by recursively resolving group participations. Implementations MUST detect cycles.</dd>

<dt>Group-Specific Identity</dt>
<dd>A privacy pattern where an agent uses a different <code>did:key</code> when participating in each group. The substrate makes this cheap; the recommended privacy posture per [[PERSONAL-LINKED-DATA-GRAPHS]] §10.2.</dd>

</dl>

---

## 4. Data Model

### 4.1 Group Identity

A group is a context. Its `did:graph:...` is its canonical identity. The DID document — itself triples inside the context, per [[DECENTRALISED-IDENTITY]] §4.2.2 — declares the group's current delegates.

Beyond the standard `did:graph` data model, a group MAY carry:

```turtle
<group-did>  group://name         "Engineering Team" ;
             group://description  "The folks shipping the substrate" ;
             group://avatar       <https://example.com/avatar.png> ;
             group://created      "2026-05-23T00:00:00Z"^^xsd:dateTime ;
             group://creator      <did:key:z6MkCreator...> .
```

These predicates are stored as triples inside the group's own context.

### 4.2 Participation

Participation is declared **from below**: a participant context (which MAY be an individual's personal context or another group's context) authors a triple in *its own* graph:

```turtle
# Inside the participant's context (e.g., did:graph:alice-personal):
<did:graph:alice-personal>  context://participates_in  <did:graph:engineering-team> .
```

The group context confirms acceptance from above:

```turtle
# Inside the group's context (did:graph:engineering-team):
<did:graph:engineering-team>  context://accepts_participation  <did:graph:alice-personal> .
```

Both directions are REQUIRED. Unilateral participation claims (where the child declares but the parent does not accept, or vice versa) are ignored for scope inheritance ([[GRAPH-GOVERNANCE]] §6.1).

The acceptance MUST be authored by a delegate in the group's `capabilityDelegation` section AND requires an `acceptParticipation` ZCAP on the group's context.

The participation triple lives in the participant's graph. The acceptance triple lives in the group's graph. The participant always controls whether they participate (they can remove their own triple). The group controls whether to accept (it can withdraw its acceptance).

### 4.3 Context Nesting

A group is itself a context, so it can participate in other groups. A team participates in a project; the project participates in a department; the department participates in a company:

```turtle
# In did:graph:engineering-team:
<did:graph:engineering-team>  context://participates_in  <did:graph:project-alpha> .

# In did:graph:project-alpha:
<did:graph:project-alpha>     context://participates_in  <did:graph:r-and-d> .

# In did:graph:r-and-d:
<did:graph:r-and-d>           context://participates_in  <did:graph:acme-corp> .
```

Each layer is its own context with its own delegates and its own governance. Nesting is detected by walking `context://participates_in` links upward; the runtime MUST enforce a maximum nesting depth (RECOMMENDED: 16) and MUST detect cycles.

An individual who participates in `engineering-team` is NOT automatically a participant of `acme-corp`. Membership is not transitive by default. Capability delegation flows differently (see [§8](#8-governance-integration)).

### 4.4 Group of One

An individual's identity IS a group with exactly one delegate (themselves). When `navigator.credentials.create({ did: { method: "key", ... } })` runs, the resulting `did:key` is structurally a group of one — a DID with a verification method, and the single agent who controls the key is the sole signer.

If the user wants their personal identity to support adding delegates (e.g., they want to designate a software agent to sign on their behalf), they MAY create their identity as a `did:graph` instead of a `did:key`. The application API is the same.

This means there is no separate "create a group" flow that conjures something new. Inviting a collaborator is delegate addition (and optionally participation acceptance) on an existing context.

---

## 5. Two Distinct Concerns: Participation vs Signing Authority

This section is normative.

"Member" can mean both "is part of this group" and "can sign as this group." This specification separates these two concerns, because they answer different questions, follow different lifecycles, and warrant different governance.

### 5.1 Participation

**Question answered:** "Who is part of this group?"

**Recorded in:** Triples in participant contexts (`context://participates_in`) plus reciprocal acceptance in the group context (`context://accepts_participation`).

**Authority required:** The participant declares; the group accepts via an `acceptParticipation` ZCAP held by a `capabilityDelegation` delegate.

**Consequences:** Inheritance of governance constraints ([[GRAPH-GOVERNANCE]] §6), visibility in `transitiveParticipants()`, eligibility for capabilities delegated to the group with `context://capability_transitive: true`.

**Lifecycle:** Either side can revoke. Participants can simply remove their `participates_in` triple. Groups can remove their `accepts_participation` triple.

### 5.2 Signing Authority (DID-Document Delegates)

**Question answered:** "Who can currently sign as this group?"

**Recorded in:** Triples in the group's own DID document, in the `verificationMethod` and capability sections (`capabilityInvocation`, `capabilityDelegation`, `assertionMethod`, `authentication`). See [[DECENTRALISED-IDENTITY]] §5.

**Authority required:** An `updateDIDDocument` ZCAP held by the agent making the change.

**Consequences:** A signature by any current delegate's method counts as a signature *by the group* for the granted capability section. Used to invoke ZCAPs, sign expressions, and sign snapshots on the group's behalf.

**Lifecycle:** Add, remove, promote, demote, rotate per [[DECENTRALISED-IDENTITY]] §5.3.

### 5.3 Why They Are Separate

Consider a company. The CEO can sign contracts on the company's behalf — they are a `capabilityInvocation` delegate. Every employee is a participant in the company — but most employees cannot sign contracts. Conflating the two would make every employee able to bind the company (chaos) or require every contract to involve every employee (impossible).

Concretely:

- **Participation answers governance scope.** What rules apply to your writes? You inherit them from the contexts you participate in.
- **Signing authority answers attribution.** When a signature is presented, who counts as the signer? Any current delegate.

The two overlap by convention (a participant who is also a `capabilityInvocation` delegate is common). But the substrate keeps them in different sections of the data model so they can be managed independently.

### 5.4 Common Patterns

| Pattern | Participants | Delegates |
|---|---|---|
| Personal identity (`did:key`) | One (self) | One (self) |
| Tight team | Everyone is a participant | Everyone is a `capabilityInvocation` delegate |
| Org with execs | Everyone is a participant | Only execs are `capabilityInvocation` delegates |
| Council-led community | Everyone is a participant | Only council members are delegates |
| Federation | Member orgs are participants | Only nominated representatives are delegates |
| Bot-augmented team | Humans are participants | Humans + an AI agent are `capabilityInvocation` delegates |

### 5.5 Non-Goal: Multisig

This specification explicitly does NOT define multisig, threshold signatures, or aggregate-key schemes for the group DID itself. Shared signing authority is achieved via DID-document delegates — any current delegate produces a signature that counts as the group's signature.

Joint *operational* approval (e.g., two delegates must each sign a particular ZCAP) MAY be expressed as a Content caveat on a ZCAP ([[GRAPH-GOVERNANCE]] §9.2):

```json
{
  "type": "content",
  "sparql": "ASK { ... two distinct delegate signatures present ... }"
}
```

But this is governance-layer composition, not a built-in cryptographic feature of the DID.

---

## 6. API

### 6.1 The Group Convenience Interface

The `Group` interface is a thin convenience wrapper over `Context` + `DIDCredential`. It exists for ergonomics; everything it does can be done directly via the underlying APIs.

```webidl
[Exposed=Window, SecureContext]
interface Group {
  readonly attribute USVString did;          // did:graph:...
  readonly attribute Context context;
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
  required USVString resource;       // did:graph:... (typically this group's)
  sequence<object> caveats;
  USVString expiresAt;
  boolean transitiveToParticipants;  // for invoker being a group DID
};
```

#### 6.1.1 invite(participantDid)

Adds an `accepts_participation` triple in the group's context. Requires the caller to hold an `acceptParticipation` ZCAP. The named participant must then add its own `participates_in` triple in its own context to complete participation.

#### 6.1.2 revokeParticipation(participantDid)

Removes the group's acceptance triple. Requires an `acceptParticipation` ZCAP.

#### 6.1.3 participants() / transitiveParticipants()

`participants()` returns the direct participant set. `transitiveParticipants()` recursively resolves all individual participants of nested participating groups, with cycle detection per [§4.3](#43-context-nesting).

#### 6.1.4 addSigner / removeSigner

Wraps [[DECENTRALISED-IDENTITY]] §5.4's delegate management. Modifies the group's DID document. Requires `updateDIDDocument` ZCAP.

#### 6.1.5 delegateCapability

Issues a ZCAP whose `resource` is this group's `did:graph:...` (or another resource the group has authority over). Signed by a current `capabilityDelegation` delegate. Optionally `transitiveToParticipants` carries the `context://capability_transitive: true` predicate so the capability MAY be invoked by participants of the named invoker group.

### 6.2 GraphStore Extension

A group is created inside, and mounted into, a specific `GraphStore` ([[PERSONAL-LINKED-DATA-GRAPHS]] §3.4). The group's `did:graph:...` context joins that store's mount table.

```webidl
partial interface GraphStore {
  [NewObject] Promise<Group> createGroup(optional GroupCreationOptions options);
  [NewObject] Promise<Group> openGroup(USVString groupDid);
  [NewObject] Promise<sequence<Group>> listGroups();
};

dictionary GroupCreationOptions {
  DOMString displayName;
  DOMString description;
  sequence<USVString> initialDelegates;   // additional DIDs to add as capabilityInvocation delegates
  USVString participatesIn;                // did:graph of parent (if creating a sub-group)
  USVString syncModule;                    // module hash for the group's sync
  sequence<USVString> relays;
  EnforcementMode enforcementMode;         // initial governance mode — see [[GRAPH-GOVERNANCE]] §13
};
```

#### 6.2.1 createGroup

Creates a new `did:graph` context, mounts it into the current GraphStore in `"governance"` mode, populates the standard `group://` metadata, and optionally configures sync ([[P2P-GRAPH-SYNC]]) and governance ([[GRAPH-GOVERNANCE]]). Returns a `Group` convenience handle.

#### 6.2.2 openGroup

Mounts an existing group's context (per [[PERSONAL-LINKED-DATA-GRAPHS]] §4.2) and returns the convenience handle.

---

## 7. Group Lifecycle

### 7.1 Creation

```javascript
const team = await navigator.graph.createGroup({
  displayName: "Engineering",
  initialDelegates: ["did:key:z6MkAlice...", "did:key:z6MkBob..."],
  enforcementMode: "open"
});
```

Behind the scenes:

1. A new `did:graph` keypair is generated. The creator becomes the first delegate.
2. The new context is created with a fresh per-context store.
3. `initialDelegates` are added via `did-document://add-method` and `did-document://grant-section` writes (subject to `updateDIDDocument` ZCAP, which the creator holds via the root capability).
4. The group's metadata is written.
5. The context is mounted in `"governance"` mode.
6. The `Group` convenience handle is returned.

### 7.2 Inviting a Participant

The group's acceptance triple is written first; the participant then completes participation in their own context.

```javascript
// In the group's GraphStore (with acceptParticipation capability):
await team.invite("did:graph:alice-personal");

// Out of band, Alice receives the invitation.
// In Alice's GraphStore:
const alicePersonal = await me.getContext(me.privateGraphDid);
await alicePersonal.addTriple({
  subject: alicePersonal.did,
  predicate: "context://participates_in",
  object: team.did
});
```

### 7.3 Adding a Signer

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

### 7.4 Withdrawal

Either side can withdraw participation:

- The participant removes their `participates_in` triple.
- The group removes its `accepts_participation` triple (via `revokeParticipation()`).

A signer is removed via `removeSigner()`. Past signatures by the removed signer remain verifiable against historical DID-document state.

### 7.5 Empty Groups

A group with zero participants is valid. A group with zero `capabilityInvocation` delegates can still exist (the group cannot sign anything new, but its prior signed expressions remain verifiable). This is the dormant state.

---

## 8. Governance Integration

### 8.1 Group as Governance Context

A group's context is governed like any other context: its root capability is minted at creation, ZCAPs target the group's `did:graph:...` as resource, scope inheritance follows participation links.

The creator holds the root capability initially. Delegating it (e.g., to a separate "Governance Council" group's DID) shifts the locus of authority — and once delegated, the creator has no special standing.

### 8.2 Capability Delegation to a Group DID

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

### 8.3 Transitive Capability Through Participation

A capability MAY carry `context://capability_transitive: true`. When set, the capability is also valid if invoked by an agent whose signature can be traced through the participation graph:

- Capability delegated to group H, with `transitive = true`.
- Group G participates in H (mutually).
- Agent A participates in G (mutually).
- A's signature counts as a valid invocation.

This is OFF by default. Most capabilities should be delegate-bound rather than participant-bound, because participation is broader than signing authority. Transitive resolution requires explicit opt-in to prevent accidental escalation.

### 8.4 Membership Governance

The rules governing who can be invited and how participation is accepted live as governance triples in the group's context:

```turtle
<group-did>
  group://participation_open    "false" ;
  group://participation_requires_credential
                                <did:vc:type:CommunityMember> ;
  group://participation_max_count "500" .
```

The `accepts_participation` operation is gated by an `acceptParticipation` ZCAP whose caveats MAY encode these rules.

---

## 9. Isomorphism: Individual = Group of One

This section is normative.

### 9.1 The Claim

An individual's identity and a group's identity are the same kind of thing at the data-model level. They differ only in the size of their delegate set and (typically) participant set.

When a user creates a `did:key` ([[DECENTRALISED-IDENTITY]] §4.1), they have an identity with exactly one verification method.

When a user creates a `did:graph` with `initialDelegates: []` ([§7.1](#71-creation)), they have a context with exactly one delegate (themselves) and no participants.

The two are structurally identical for the purposes of "an entity that can sign and hold capabilities." The difference is that `did:graph` supports adding more delegates later via DID-document updates; `did:key` is locked to its single derived method.

### 9.2 No "Upgrade to Group" Flow

Inviting a collaborator is not creating something new. It is two operations on existing structures:

- Adding a delegate to the existing `did:graph`'s DID document (so the collaborator can sign as the group).
- Issuing an invitation (writing `accepts_participation`) so the collaborator can declare participation.

Neither operation creates a new identity or moves data. The DID is unchanged. The context is unchanged. Only the membership counts change.

### 9.3 Why This Matters

Many collaboration systems have a seam between "personal" and "shared." You have a personal account; you "create an organisation" which is a different kind of entity. These seams cause accidental complexity — migration paths, permission-model mismatches, two sets of APIs.

This specification eliminates the seam. The substrate has one identity primitive (the DID, via [[DECENTRALISED-IDENTITY]]) and one data primitive (the Context, via [[PERSONAL-LINKED-DATA-GRAPHS]]). Both work for one and for billions.

### 9.4 Formal Statement

Let I be an individual's identity (a `did:key` or a `did:graph` with a single delegate). Let G be a collective's identity (a `did:graph` with multiple delegates). The following MUST hold:

1. I and G are both represented as DIDs with DID documents and (for `did:graph`) backing contexts.
2. All operations defined in this specification's API ([§6](#6-api)) that are valid on G are also valid on I (subject to capability checks).
3. The return types and semantics of operations are identical.
4. No API method, predicate, or governance rule distinguishes I from G based on participant count or delegate count.

Conforming implementations MUST NOT provide separate interfaces, code paths, or data stores for individual and collective identities.

---

## 10. Delegated Voting Use Case

This section is informative.

### 10.1 The Pattern

Delegated voting combines direct voting (every voter holds a vote on every issue) with representative voting (you delegate your vote to someone you trust). Critical properties:

- **Granular** — you can delegate differently on different topics.
- **Revocable** — you can pull your delegation back at any moment.
- **Transitive** — your delegate can delegate further (with limits).
- **Transparent** — you can see how your delegated vote was cast.

The substrate makes this a natural consequence of composition: identity ([[DECENTRALISED-IDENTITY]]), governance ([[GRAPH-GOVERNANCE]]), and groups (this specification) compose to give delegated voting "for free."

### 10.2 Delegation as a Signed Triple

A delegation is a triple in the delegator's context:

```turtle
# In Alice's personal context (did:graph:alice-personal):
<did:graph:alice-personal>
  vote://delegates_to    <did:graph:energy-experts> ;
  vote://delegates_topic <topic://climate-energy> ;
  vote://valid_until     "2027-01-01T00:00:00Z"^^xsd:dateTime ;
  vote://revocable       "true" .
```

The delegate may be any DID — an individual (`did:key`) OR a group (`did:graph`). When the delegate is a group, the group's internal governance produces the cast vote.

### 10.3 Casting the Vote

When the delegate is an individual, they sign the vote with their `did:key`. Standard.

When the delegate is a group, one of the group's `capabilityInvocation` delegates produces a vote according to the group's internal governance:

- The group might use a flow ([[GRAPH-FLOWS]]) to deliberate.
- The group might require quorum (a guard on the "submit-vote" transition).
- The group might require multiple internal delegates to sign (a content caveat on the submit-vote ZCAP).
- The group might delegate further to a sub-group of domain experts.

The resulting ballot is signed by a current `capabilityInvocation` delegate of the group's DID. The ballot's author is the group's `did:graph:...`. Verification follows standard DID-document-delegate semantics ([[DECENTRALISED-IDENTITY]] §5.1).

### 10.4 Composing the Pieces

Delegated voting is not a feature added to this substrate. It is the result of:

- Identity at every scale, via DIDs.
- Per-context governance (ZCAPs, immanent rules).
- Structured reasoning as data (triples — delegate reasoning is queryable).
- Nesting (parts forming wholes forming parts).

Delegating a vote to a *group* — not just to an individual expert — is what previous systems could not do without bespoke infrastructure. Here, it is the obvious case.

---

## 11. Security Considerations

### 11.1 Group DID Key Custody

A group's DID document lists multiple verification methods, each backed by a separate keypair held by its corresponding delegate. There is no single "group key" to lose — losing a delegate's key only removes that one delegate's ability to sign.

For redundancy, groups SHOULD have multiple `capabilityDelegation` delegates so that any one becoming unavailable does not leave the group unable to update its DID document.

### 11.2 Compromised Delegate

A compromised `capabilityInvocation` delegate can sign on the group's behalf until removed. Mitigations:

- Regular review of the delegate set by holders of `capabilityDelegation`.
- Prompt removal of suspected-compromised delegates via `removeSigner()`.
- For high-value capabilities, use content caveats on ZCAPs to require multiple independent signatures ([[GRAPH-GOVERNANCE]] §9.2).

Historical signatures by removed delegates remain verifiable; this is intentional.

### 11.3 Participation Spoofing

Unilateral participation claims are ignored. Both sides must declare. The parent's acceptance MUST be signed by a current `capabilityDelegation` delegate of the parent.

### 11.4 Capability Escalation via Nesting

Capabilities delegated to a group DID with `context://capability_transitive: true` flow through participation. An adversarial group adding many participants would effectively grant them the capability. Mitigations:

- `context://capability_transitive` is OFF by default.
- When transitive resolution is enabled, the capability SHOULD carry caveats that constrain its scope (e.g., per-participant rate limits).
- The runtime MUST detect cycles in participation graphs.

### 11.5 DID-Document Tampering

DID-document writes are governance-controlled via `did-document://*` predicates ([[GRAPH-GOVERNANCE]] §10). An agent without `updateDIDDocument` capability cannot modify the document.

### 11.6 Group Impersonation

Group DIDs are cryptographically unique. However, group metadata (name, description) is freely chosen and could mimic existing groups. Implementations SHOULD provide mechanisms for verifying group authenticity (out-of-band DID publication, verifiable credentials, web-of-trust endorsements).

### 11.7 Nesting Depth Attacks

Deep nesting can cause resource exhaustion. Implementations MUST enforce a maximum nesting depth (RECOMMENDED: 16).

---

## 12. Privacy Considerations

### 12.1 Participation Visibility

`accepts_participation` triples are in the group's context; `participates_in` triples are in the participant's context. Both are visible to anyone with read access to the respective contexts.

### 12.2 Delegate-Set Disclosure

The group's DID document is part of its context. Anyone with read access to the context sees the current delegates. For communities where delegate-set privacy is important, use rotated single-use delegate keys not tied to long-term individual DIDs.

### 12.3 Per-Context Identity

An agent SHOULD use different `did:key`s when participating in different groups, to prevent cross-context correlation. The substrate makes this cheap.

### 12.4 Nesting Structure Leakage

Context nesting reveals organisational structure. If A participates in B which participates in C, the chain reveals a hierarchy to anyone reading these contexts. For high-privacy needs, nesting MAY be implemented via a separate (sync-isolated) context.

### 12.5 Delegated Vote Deliberation

When a delegate is a group, that group's internal deliberation may include sensitive opinions of participants. Communities that need internal-deliberation privacy SHOULD use a Privacy-Tiered or Fully Partitioned sync topology ([[P2P-GRAPH-SYNC]] §7.2) for the deliberation context.

---

## 13. Examples

### 13.1 Create a Personal Identity (Effective Group of One)

```javascript
const me = await navigator.credentials.create({
  did: { method: "key", displayName: "Alice" }
});
console.log(me.did);      // "did:key:z6Mk..."

// Or use did:graph if you anticipate adding signing delegates later
const personalGroup = await navigator.graph.create("Alice")
  .then(store => store.createContext({ displayName: "Alice (personal)" }));
console.log(personalGroup.did); // "did:graph:z6Mk..."
```

### 13.2 Create a Team and Add Members

```javascript
const me = await navigator.graph.create("Workspace");

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

// Invite each member's personal context to participate.
await team.invite("did:graph:alice-personal");
await team.invite("did:graph:bob-personal");
await team.invite("did:graph:carol-personal");

// Each member, in their own GraphStore, completes participation by adding
// the context://participates_in triple in their own context.

const ps = await team.participants();
console.log(ps.map(p => p.did));

const signers = await team.signers("capabilityInvocation");
console.log(signers.map(s => s.id));
```

### 13.3 Nest a Team in an Organisation

```javascript
const org = await navigator.graph.createGroup({ displayName: "Acme Corp" });
const eng = await navigator.graph.createGroup({ displayName: "Engineering" });
const marketing = await navigator.graph.createGroup({ displayName: "Marketing" });

await org.invite(eng.did);
await org.invite(marketing.did);

// Each department's GraphStore completes participation by writing
// context://participates_in in their own contexts.

const children = await org.childGroups();
console.log(children.map(c => c.name));

const everyone = await org.transitiveParticipants();
console.log(everyone.length);
```

### 13.4 Role-Based Access via Delegate Set

```javascript
const community = await navigator.graph.createGroup({ displayName: "Web Standards Community" });

// Create a "moderators" group — its DID document's delegates ARE the moderators.
const moderators = await navigator.graph.createGroup({
  displayName: "Moderators",
  initialDelegates: ["did:key:z6MkMod1...", "did:key:z6MkMod2..."]
});

// Delegate moderation capability to the moderators group (NOT transitive —
// only signed by a current delegate of moderators counts).
await community.delegateCapability({
  invoker: moderators.did,
  actions: ["removeLink"],
  resource: community.did,
  caveats: [
    { type: "predicate", value: { allowed: ["msg://body", "msg://reaction"] }}
  ]
});

// Now any moderator (any current delegate of moderators.did) can produce a
// signed removeLink op against community's context. Adding a new moderator
// is addSigner() on moderators — no per-person re-delegation needed.
await moderators.addSigner(
  { id: `${moderators.did}#key-mod3`, type: "Ed25519VerificationKey2020",
    controller: moderators.did, publicKeyMultibase: "z6MkMod3..." },
  ["capabilityInvocation"]
);
```

### 13.5 Sign as the Group

```javascript
const teamCred = await navigator.credentials.get({
  did: { kind: "graph", filter: { did: team.did } }
});

const announcement = await teamCred.sign({
  type: "Announcement",
  body: "v1.0 shipped",
  timestamp: new Date().toISOString()
});

console.log(announcement.author);            // team.did (did:graph:...)
console.log(announcement.proof.method);      // the specific delegate's verification method
```

### 13.6 Delegate a Vote to a Group

```javascript
// In Alice's personal context: delegate her energy-policy vote to a working group.
const alicePersonal = await me.getContext(me.privateGraphDid);

await alicePersonal.addTriple({
  subject: alicePersonal.did,
  predicate: "vote://delegates_to",
  object: "did:graph:energy-experts"
});
await alicePersonal.addTriple({
  subject: alicePersonal.did,
  predicate: "vote://delegates_topic",
  object: "topic://climate-energy"
});
```

### 13.7 Resolving a Group DID Document

```javascript
const doc = await navigator.credentials.resolve(team.did);
console.log(doc.verificationMethod);
console.log(doc.capabilityInvocation);
console.log(doc.trustLevel);
```

---

## 14. Predicate Reference Table

| Predicate | Domain | Range | Description |
|---|---|---|---|
| `group://name` | Group DID | Literal string | Human-readable group name |
| `group://description` | Group DID | Literal string | Group description |
| `group://avatar` | Group DID | URI | URI of the group's avatar |
| `group://created` | Group DID | xsd:dateTime | Creation timestamp |
| `group://creator` | Group DID | DID | DID of the agent that created the group |
| `group://participation_open` | Group DID | xsd:boolean | If true, agents may self-add participation. Default false. |
| `group://participation_requires_credential` | Group DID | VC type URI | Credential required for participation acceptance |
| `group://participation_max_count` | Group DID | xsd:integer | Maximum number of accepted participants |
| `group://participation_vote_threshold` | Group DID | xsd:integer | Number of delegate approvals required for new participants |
| `context://participates_in` | Participant DID (any context) | Group DID | Asserted in the participant's context; declares participation. Mutually required. |
| `context://accepts_participation` | Group DID | Participant DID | Asserted in the group's context; confirms participation. Mutually required; MUST be signed by a `capabilityDelegation` delegate of the group. |
| `context://capability_transitive` | ZCAP URI | xsd:boolean | If true, the capability may be invoked by participants of the named invoker group. Default: false. |
| `vote://delegates_to` | Participant DID | DID (individual or group) | Asserts a vote delegation. |
| `vote://delegates_topic` | Participant DID | Topic URI | Scopes the delegation to a topic. |
| `vote://valid_until` | Participant DID | xsd:dateTime | Delegation expiry. |
| `vote://revocable` | Participant DID | xsd:boolean | Whether the delegation can be revoked unilaterally. |
| `did-document://add-method` etc. | Group DID | (see [[DECENTRALISED-IDENTITY]] §5) | DID-document delegate management. Governed via [[GRAPH-GOVERNANCE]] §10. |

---

## 15. References

### 15.1 Normative References

**[PERSONAL-LINKED-DATA-GRAPHS]** [Personal Linked Data Graphs](./01_personal-linked-data-graphs.md).

**[DECENTRALISED-IDENTITY]** [Decentralised Identity Integration for the Web Platform](./02_decentralised-identity-web-platform.md).

**[GRAPH-GOVERNANCE]** [Graph Governance](./05_graph-governance.md).

**[DID-CORE]** Decentralized Identifiers (DIDs) v1.0. W3C Recommendation, 19 July 2022. https://www.w3.org/TR/did-core/

**[RFC2119]** Key words for use in RFCs to Indicate Requirement Levels. BCP 14, RFC 2119, March 1997.

**[RFC8174]** Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words. BCP 14, RFC 8174, May 2017.

**[ZCAP-LD]** Authorization Capabilities for Linked Data. W3C Community Group Report. https://w3c-ccg.github.io/zcap-spec/

### 15.2 Informative References

**[P2P-GRAPH-SYNC]** [Peer-to-Peer Context Synchronisation Protocol](./03_p2p-graph-sync.md).

**[SHAPE-VALIDATION]** [Dynamic Graph Shape Validation](./04_dynamic-graph-shape-validation.md).

**[GRAPH-FLOWS]** [Graph Flows](./07_graph-flows.md).

**[VC-DATA-MODEL-2.0]** Verifiable Credentials Data Model v2.0. W3C Recommendation. https://www.w3.org/TR/vc-data-model-2.0/
