# Decentralised Group Identity

**W3C Draft Community Group Report**

**Latest published version:** This document

**Editors:**

- [Editor Name], [Affiliation]

**Abstract:**

This specification defines a data model and API for decentralised group identity on the web. A group is a persistent, DID-identified entity whose identity is independent of its membership. Groups are isomorphic — a group of one is structurally identical to a group of many. Groups may be members of other groups, enabling fractal holonic composition. This specification builds on Personal Linked Data Graphs [[SPEC-01]], Decentralised Identity [[SPEC-02]], P2P Graph Synchronisation [[SPEC-03]], and Graph Governance [[SPEC-05]].

**Status of This Document:**

This is a draft community group report. It has no official standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Data Model](#4-data-model)
5. [API](#5-api)
6. [Group Lifecycle](#6-group-lifecycle)
7. [Governance Integration](#7-governance-integration)
8. [Isomorphism: Individual = Group of One](#8-isomorphism-individual--group-of-one)
9. [Security Considerations](#9-security-considerations)
10. [Privacy Considerations](#10-privacy-considerations)
11. [Examples](#11-examples)
12. [Predicate Reference Table](#12-predicate-reference-table)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 Motivation

The web has identity for individuals. The Decentralised Identifiers (DID) specification [[DID-CORE]] provides a mechanism by which any autonomous agent — human or software — can create, control, and present a globally unique identifier without reliance on a centralised registry. Combined with personal linked data graphs [[SPEC-01]] and peer-to-peer sync [[SPEC-03]], individual agents can own their data and share it on their own terms.

But people do not act only as individuals. They act as teams, organisations, families, communities, consortia, coalitions, and ad-hoc collaborations. Every meaningful human endeavour involves collective action, and collective action requires collective identity.

The web has no native primitive for this.

Every existing system forces groups into platform-specific constructs. A Discord server is not addressable from Slack. A GitHub organisation cannot be referenced from a project management tool. A family group chat on one messaging platform has no identity that carries to another. These constructs do not compose, do not interoperate, and cannot be referenced across systems. They are not identities — they are platform features.

This specification defines a **group**: a DID-identified entity with mutable membership, composable via recursive nesting, and governed by its own shared graph. A group is the missing collective primitive for the decentralised web.

### 1.2 Design Principles

Three principles govern the design of this specification:

**Principle 1: A group of one is no different from a group of many.** An individual is a degenerate case of a group with a single member. There is no special "individual mode" — every agent operates through the group primitive. A personal identity IS a group with membership: \[self\]. This is not a convenience abstraction; it is the literal data model. Section 8 elaborates this principle in detail.

**Principle 2: Group identity and group membership are distinct.** A group has a DID that persists across membership changes. Members join and leave; the group remains the same group. Identity is not the set of members — it is the entity itself. A football team that replaces every player over a decade is still the same team. A company that turns over its entire workforce is still the same company. The group DID captures this.

**Principle 3: Groups can be members of groups.** A team (group) can join an organisation (group). An organisation can join a consortium (group). The membership relation is recursive. This enables fractal holonic composition — individuals within teams within organisations within networks — all using the same primitive at every level.

### 1.3 Use Cases

The group primitive is intentionally general. The following use cases illustrate its range:

- **Teams.** A software development team creates a group, invites members, and uses the group's shared graph to coordinate work. The team's DID is referenced in commit metadata, CI configurations, and access control lists.

- **Organisations.** A company creates a group and nests department groups within it. The company group's DID appears in contracts, credentials, and inter-organisational agreements. Department membership changes do not affect the company's identity.

- **Communities.** An open-source community creates a group with governance rules defining how members join, what roles exist, and how decisions are made. The community's DID is its persistent identity across platforms.

- **Families.** A family creates a group for shared photos, calendars, and documents. The group persists as children grow up and new members join through marriage or birth.

- **DAOs and cooperatives.** Decentralised autonomous organisations use group identity with governance rules that encode their decision-making processes. Membership is managed through the group's governance, not through a platform's admin panel.

- **Ad-hoc collaborations.** Three people working on a weekend project create a group. It exists for a month and then goes dormant. The group's DID and shared graph persist as a record of the collaboration.

- **Federations and consortia.** Multiple organisations (each a group) form a consortium (another group). The consortium's governance defines how member organisations interact, what capabilities they share, and how decisions are made at the federation level.

- **Nation-states and jurisdictions.** At the largest scale, the same primitive can represent political entities — groups of groups of groups, with governance at every level.

All of these are the same data model. The same API. The same governance framework. The only differences are scale, membership count, and governance configuration.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [[RFC2119]] [[RFC8174]] when, and only when, they appear in ALL CAPITALS, as shown here.

A conforming implementation MUST support:

1. The data model defined in Section 4, including all REQUIRED predicates.
2. The API defined in Section 5, including all methods marked as REQUIRED.
3. The group lifecycle defined in Section 6, including creation, joining, leaving, and nesting.
4. The isomorphism property defined in Section 8: a group of one MUST be structurally and behaviourally identical to a group of many.

A conforming implementation MAY support:

1. Additional predicates beyond those defined in this specification, provided they do not conflict with predicates in the `group://` namespace.
2. Extended governance rules beyond those described in Section 7.
3. Optimised transitive membership resolution algorithms, provided they produce results equivalent to the naive recursive algorithm described in Section 5.

---

## 3. Terminology

<dl>

<dt>Group</dt>
<dd>A persistent entity identified by a DID, with a membership set and an associated shared graph. A group's identity is independent of its members. Groups are the fundamental collective primitive defined by this specification.</dd>

<dt>Group DID</dt>
<dd>A decentralised identifier [[DID-CORE]] that uniquely identifies a group. The group DID is generated at group creation time and persists for the lifetime of the group, independent of membership changes. The DID document associated with a group DID contains the group's public key material and service endpoints.</dd>

<dt>Member</dt>
<dd>An entity that belongs to a group. A member is identified by a DID, which MAY be either an individual DID or a group DID. The membership predicate makes no structural distinction between individual and group members.</dd>

<dt>Membership</dt>
<dd>The current set of members of a group at a given point in time. Membership is mutable — members may be added or removed according to the group's governance rules. Membership is represented as a set of triples in the group's shared graph.</dd>

<dt>Root Member</dt>
<dd>The member or members with root authority over a group's governance. Initially, the root member is the group's creator. Root authority MAY be transferred or shared according to governance rules defined in [[SPEC-05]].</dd>

<dt>Holonic Nesting</dt>
<dd>The recursive composition of groups within groups. When group G is a member of group H, G is said to be <em>nested</em> within H. The term "holonic" refers to the property that each group is simultaneously a whole (with its own members and governance) and a part (a member of a larger group). This nesting can recurse to arbitrary depth.</dd>

<dt>Transitive Membership</dt>
<dd>The set of all individual (non-group) members reachable by recursively resolving group memberships. If group H contains group G, and G contains individuals Alice and Bob, then Alice and Bob are transitive members of H.</dd>

<dt>Shared Graph</dt>
<dd>A linked data graph synchronised across multiple peers via a peer-to-peer sync protocol [[SPEC-03]]. Every group has an associated shared graph that stores the group's identity triples, membership triples, and any additional data the group produces.</dd>

<dt>Capability (ZCAP)</dt>
<dd>An authorisation token, as defined in [[ZCAP-LD]], that grants a specific ability to a specific DID. In the context of group identity, capabilities may be delegated to individual member DIDs or to group DIDs. When delegated to a group DID, any member of that group may invoke the capability.</dd>

</dl>

---

## 4. Data Model

### 4.1 Group Identity Triples

A group is represented as a set of triples in its shared graph. The following predicates are REQUIRED for every group:

```
<group-did>
  -[rdf://type]→         "group://Group"
  -[group://created]→     <dateTime>
  -[group://creator]→     <creator-did>
```

The following predicates are OPTIONAL:

```
<group-did>
  -[rdf://name]→          <literal>
  -[rdf://description]→   <literal>
  -[group://avatar]→      <uri>
  -[group://metadata]→    <uri>
```

The `rdf://type` triple with value `"group://Group"` is the canonical marker that identifies an entity as a group. Implementations MUST recognise this type when resolving group identity.

The `group://created` triple MUST contain an ISO 8601 dateTime value representing the moment of group creation.

The `group://creator` triple MUST contain the DID of the agent that created the group. This DID becomes the initial root member.

### 4.2 Membership Triples

Membership is expressed as triples linking the group DID to member DIDs:

```
<group-did> -[group://has_member]→ <member-did>
```

Where `<member-did>` is a DID identifying the member. This DID MAY be:

- An individual DID (e.g., `did:key:z6MkhaXgBZD...`) — representing a person or software agent.
- A group DID (e.g., `did:key:z6MknGc7Yuw...`) — representing another group (holonic nesting).

There is **no structural difference** between individual and group members at the triple level. The membership predicate is identical. Implementations that need to distinguish between individual and group members MUST resolve the member DID and check for the presence of a `rdf://type` → `"group://Group"` triple in the member's graph.

Each membership triple MAY be accompanied by metadata:

```
<membership-uri>
  -[rdf://type]→              "group://Membership"
  -[group://member]→          <member-did>
  -[group://group]→           <group-did>
  -[group://joined_at]→       <dateTime>
  -[group://invited_by]→      <inviter-did>
  -[group://role]→            <literal>
```

The `group://joined_at` triple SHOULD be present and MUST contain an ISO 8601 dateTime value. The `group://invited_by` and `group://role` triples are OPTIONAL.

### 4.3 Group as Shared Graph

Every group MUST have an associated shared graph, as defined in [[SPEC-03]]. The relationship between a group and its shared graph is fundamental:

1. The group's shared graph is the authoritative store for the group's identity triples, membership triples, and governance rules.
2. Members of the group are peers in the shared graph's sync protocol.
3. The group's DID is the root authority for the shared graph's governance, as defined in [[SPEC-05]].

When a group is created, the following sequence MUST occur:

1. A new keypair is generated.
2. A DID is derived from the public key.
3. A shared graph is created using the sync protocol [[SPEC-03]].
4. The group identity triples (Section 4.1) are added to the shared graph.
5. The creator's DID is added as the first member (Section 4.2).
6. The creator is granted root authority for the shared graph's governance [[SPEC-05]].

The shared graph MUST be accessible to all current members. When a member is removed, their access to the shared graph SHOULD be revoked according to the sync protocol's access control mechanisms.

### 4.4 Group of One

An individual's personal identity is a group with exactly one member — themselves. This is not a special case; it is the default case.

When a user agent creates a decentralised identity via `navigator.credentials.create({did})` [[SPEC-02]], the following MUST occur:

1. A keypair and DID are generated for the individual.
2. A personal linked data graph is created [[SPEC-01]].
3. A group is implicitly created with the individual as the sole member.
4. The personal graph IS the group's shared graph.
5. The individual is the root authority for the group's governance.

Conforming implementations MUST NOT provide separate code paths for "individual" and "group" operations. The API defined in Section 5 MUST behave identically whether the group contains one member or one million members.

This means:

- An individual's personal graph is accessible via the `Group` interface.
- Adding a collaborator to a personal graph is equivalent to adding a member to a group.
- The transition from individual to collective is not a mode switch — it is a membership count change.

### 4.5 Holonic Nesting

A group MAY be a member of another group. This enables recursive composition of collective identity.

When a group G becomes a member of group H:

1. G's DID is added to H's membership set: `<H-did> -[group://has_member]→ <G-did>`.
2. G's members do NOT automatically become members of H. Membership is not transitive by default.
3. G retains its own identity, its own shared graph, and its own governance. Nesting does not merge groups.
4. H's governance MAY grant capabilities to G's DID via ZCAP delegation [[ZCAP-LD]]. When a capability is delegated to a group DID, any current member of that group MAY invoke the capability (see Section 7).

Implementations MUST support nesting to at least 8 levels of depth. Implementations SHOULD support arbitrary nesting depth but MAY impose a configurable maximum to prevent resource exhaustion during transitive membership resolution.

The nesting relation is directed. If G is a member of H, H is NOT automatically a member of G. Bidirectional nesting (G is a member of H, and H is a member of G) is permitted but implementations MUST detect cycles during transitive membership resolution and terminate traversal when a cycle is encountered.

---

## 5. API

### 5.1 Group Interface

The `Group` interface is the primary API for interacting with group identity.

```webidl
[Exposed=Window, SecureContext]
interface Group {
  readonly attribute USVString did;
  readonly attribute USVString name;
  readonly attribute USVString description;
  readonly attribute DOMTimeStamp created;
  readonly attribute SharedGraph graph;

  // Membership
  [NewObject] Promise<sequence<Member>> members();
  [NewObject] Promise<undefined> addMember(USVString memberDid);
  [NewObject] Promise<undefined> removeMember(USVString memberDid);
  [NewObject] Promise<boolean> isMember(USVString did);

  // Holonic queries
  [NewObject] Promise<sequence<Group>> parentGroups();
  [NewObject] Promise<sequence<Group>> childGroups();
  [NewObject] Promise<sequence<Member>> transitiveMembers();

  // Governance delegation
  [NewObject] Promise<undefined> delegateCapability(
    USVString memberDid,
    USVString predicate,
    USVString scope
  );

  // Identity
  [NewObject] Promise<any> resolve();
};
```

#### 5.1.1 Attributes

The `did` attribute MUST return the group's DID as a USVString.

The `name` attribute MUST return the value of the `rdf://name` triple for this group, or the empty string if no name is set.

The `description` attribute MUST return the value of the `rdf://description` triple for this group, or the empty string if no description is set.

The `created` attribute MUST return the value of the `group://created` triple as a DOMTimeStamp.

The `graph` attribute MUST return the `SharedGraph` object [[SPEC-03]] associated with this group.

#### 5.1.2 members()

The `members()` method MUST return a Promise that resolves to a sequence of `Member` dictionaries representing the current direct members of the group.

This method MUST return only direct members — DIDs that appear in `group://has_member` triples for this group. It MUST NOT recursively resolve group members. For recursive resolution, use `transitiveMembers()`.

#### 5.1.3 addMember(memberDid)

The `addMember()` method MUST:

1. Verify that the caller has the `manage_members` governance capability for this group.
2. Verify that `memberDid` is a valid DID.
3. Add a `<group-did> -[group://has_member]→ <memberDid>` triple to the group's shared graph.
4. Add a corresponding membership metadata triple with the current timestamp as `group://joined_at`.
5. Return a Promise that resolves to `undefined` on success.

If the caller lacks the `manage_members` capability, the Promise MUST reject with a `"NotAllowedError"` DOMException.

If `memberDid` is already a member, the method SHOULD resolve successfully without adding a duplicate triple.

#### 5.1.4 removeMember(memberDid)

The `removeMember()` method MUST:

1. Verify that the caller has the `manage_members` governance capability for this group, OR that `memberDid` is the caller's own DID (a member MAY always remove themselves).
2. Remove the `<group-did> -[group://has_member]→ <memberDid>` triple from the group's shared graph.
3. Remove any associated membership metadata triples.
4. Return a Promise that resolves to `undefined` on success.

If the caller lacks authority and is not removing themselves, the Promise MUST reject with a `"NotAllowedError"` DOMException.

Removing the last member of a group does not destroy the group. The group's DID, shared graph, and identity triples persist. A group with zero members is a valid state.

#### 5.1.5 isMember(did)

The `isMember()` method MUST return a Promise that resolves to `true` if the given DID is a direct member of this group, and `false` otherwise. This method checks direct membership only — it does not perform transitive resolution.

#### 5.1.6 parentGroups()

The `parentGroups()` method MUST return a Promise that resolves to a sequence of `Group` objects representing groups that contain this group as a member. Discovery of parent groups requires querying known shared graphs for `group://has_member` triples pointing to this group's DID.

Implementations MAY cache parent group relationships. Implementations SHOULD provide a mechanism for discovering parent groups via relay services or DID document service endpoints.

#### 5.1.7 childGroups()

The `childGroups()` method MUST return a Promise that resolves to a sequence of `Group` objects representing members of this group that are themselves groups. This is determined by checking each member DID for the `rdf://type` → `"group://Group"` triple.

#### 5.1.8 transitiveMembers()

The `transitiveMembers()` method MUST return a Promise that resolves to a sequence of `Member` dictionaries representing all individual (non-group) members reachable by recursively resolving group memberships.

The algorithm is:

1. Let *result* be an empty set.
2. Let *visited* be an empty set (to detect cycles).
3. For each direct member M of this group:
   a. If M's DID is in *visited*, skip M (cycle detected).
   b. Add M's DID to *visited*.
   c. If M is not a group (no `rdf://type` → `"group://Group"` triple), add M to *result*.
   d. If M is a group, recursively resolve M's transitive members and add them to *result*.
4. Return *result*.

Implementations MUST detect cycles and terminate traversal. Implementations MAY impose a maximum recursion depth and SHOULD return a partial result if the depth limit is reached, accompanied by a warning.

#### 5.1.9 delegateCapability(memberDid, predicate, scope)

The `delegateCapability()` method MUST:

1. Verify that the caller has root authority or a delegatable capability for the specified predicate and scope.
2. Create a ZCAP [[ZCAP-LD]] delegating the specified capability to `memberDid`.
3. Add the ZCAP to the group's shared graph.
4. Return a Promise that resolves to `undefined` on success.

When `memberDid` is a group DID, the capability applies to all current members of that group. The governance engine MUST resolve group membership when verifying ZCAP invocations (see Section 7).

#### 5.1.10 resolve()

The `resolve()` method MUST return a Promise that resolves to the DID document associated with this group's DID, as defined in [[DID-CORE]]. The DID document includes the group's public key material, verification methods, and service endpoints.

### 5.2 Member Dictionary

```webidl
dictionary Member {
  required USVString did;
  required boolean isGroup;
  USVString name;
  DOMTimeStamp joinedAt;
};
```

The `did` field MUST contain the member's DID.

The `isGroup` field MUST be `true` if the member is itself a group (has a `rdf://type` → `"group://Group"` triple), and `false` otherwise.

The `name` field SHOULD contain the member's display name if available, or `null` if not.

The `joinedAt` field SHOULD contain the timestamp at which the member joined the group, derived from the `group://joined_at` membership metadata triple.

### 5.3 PersonalGraphManager Extension

The `PersonalGraphManager` interface [[SPEC-01]] is extended with group management methods:

```webidl
partial interface PersonalGraphManager {
  [NewObject] Promise<Group> createGroup(optional GroupOptions options = {});
  [NewObject] Promise<Group> joinGroup(USVString groupDid);
  [NewObject] Promise<sequence<Group>> listGroups();
};
```

#### 5.3.1 createGroup(options)

The `createGroup()` method MUST:

1. Generate a new keypair and derive a DID for the group.
2. Create a shared graph using the specified sync module (or a default if none is specified).
3. Add the group identity triples to the shared graph (Section 4.1).
4. Add the caller as the first member (Section 4.2).
5. Grant the caller root authority for the group's governance [[SPEC-05]].
6. Return a Promise that resolves to a `Group` object representing the new group.

#### 5.3.2 joinGroup(groupDid)

The `joinGroup()` method MUST:

1. Resolve the group DID to discover the group's shared graph and relay endpoints.
2. Join the shared graph's sync network [[SPEC-03]].
3. Submit a membership request by adding a `<caller-did> -[group://membership_request]→ <group-did>` triple.
4. Return a Promise that resolves to a `Group` object. The caller is not yet a member — membership is pending approval by an existing member with `manage_members` authority.

Implementations MAY support auto-approval if the group's governance rules permit open membership.

#### 5.3.3 listGroups()

The `listGroups()` method MUST return a Promise that resolves to a sequence of `Group` objects representing all groups the caller is a member of (including the caller's implicit group of one).

### 5.4 GroupOptions Dictionary

```webidl
dictionary GroupOptions {
  USVString name;
  USVString description;
  USVString syncModule;
  sequence<USVString> relays;
};
```

The `name` field is an OPTIONAL human-readable name for the group.

The `description` field is an OPTIONAL human-readable description.

The `syncModule` field is an OPTIONAL identifier (e.g., content hash) for the sync module to use for the group's shared graph. If omitted, the implementation MUST use a default sync module.

The `relays` field is an OPTIONAL list of relay URIs for peer discovery in the group's shared graph.

---

## 6. Group Lifecycle

### 6.1 Creation

Group creation follows the sequence defined in Section 5.3.1. The complete lifecycle is:

1. **Key generation.** A new keypair is generated using a method compatible with the DID method in use. The private key MUST be stored securely by the creating agent.

2. **DID derivation.** A DID is derived from the public key. The DID method SHOULD support key rotation to allow future changes to the group's key material.

3. **Shared graph creation.** A new shared graph is created using the sync protocol [[SPEC-03]]. The sync module specified in `GroupOptions.syncModule` determines the sync behaviour. Relay URIs from `GroupOptions.relays` are used for peer discovery.

4. **Identity triple insertion.** The group identity triples (Section 4.1) are added to the shared graph. The `group://creator` triple records the creating agent's DID.

5. **Initial membership.** The creator's DID is added as the first member via a `group://has_member` triple.

6. **Governance initialisation.** The creator is granted root authority over the shared graph's governance [[SPEC-05]]. This includes the `manage_members` capability by default.

### 6.2 Joining

An agent joins an existing group through the following process:

1. **Discovery.** The agent receives the group's DID through an out-of-band mechanism (link, QR code, referral, etc.).

2. **Graph sync.** The agent joins the group's shared graph by connecting to the sync network. Peer discovery uses the relay URIs in the group's DID document service endpoints.

3. **Membership request.** The agent adds a membership request triple to the shared graph:
   ```
   <requester-did> -[group://membership_request]→ <group-did>
   ```
   This triple is propagated to all peers via the sync protocol.

4. **Approval.** An existing member with the `manage_members` governance capability reviews the request and, if approved, adds the membership triple:
   ```
   <group-did> -[group://has_member]→ <requester-did>
   ```
   The request triple SHOULD be removed after approval or rejection.

5. **Capability delegation.** The approving member MAY delegate governance capabilities to the new member via ZCAP [[ZCAP-LD]], according to the group's governance rules.

6. **Sync participation.** Once added as a member, the new agent participates fully in the shared graph's sync protocol.

### 6.3 Leaving

A member leaves a group through one of two mechanisms:

**Self-removal.** A member MAY remove their own membership triple at any time:
```
REMOVE: <group-did> -[group://has_member]→ <member-did>
```

This does not require any governance capability. A member always has the right to leave.

**Removal by authority.** A member with the `manage_members` capability MAY remove another member's membership triple. This is the mechanism for ejecting members.

In both cases:

1. The `group://has_member` triple is removed from the shared graph.
2. Associated membership metadata triples SHOULD be removed.
3. Any ZCAPs delegated to the removed member for this group SHOULD be revoked.
4. The group persists. Its DID, shared graph, and identity triples are unchanged.
5. The group's governance rules continue to apply to remaining members.

A group with zero members is a valid state. The group is not destroyed — it is dormant. If the group's governance rules permit it, new members MAY still join.

### 6.4 Nesting

A group joins another group through the standard membership mechanism, with the group's DID as the member identifier.

1. **Initiation.** A member of group G with appropriate authority decides that G should join group H. The authority required is implementation-defined but SHOULD be the root authority or a specific `manage_group_membership` capability.

2. **Request.** The authorised member of G calls `H.addMember(G.did)`, where `G.did` is the DID of group G.

3. **Validation.** H's governance engine validates the request:
   - Does the invoker have `manage_members` capability on H?
   - Does H's governance permit group members (some groups MAY restrict membership to individuals only)?
   - Would adding G create a cycle? (If H is already a transitive member of G, adding G to H creates a cycle. Implementations MUST detect and reject this if cycle prevention is enabled.)

4. **Acceptance.** If approved, the membership triple is added:
   ```
   <H-did> -[group://has_member]→ <G-did>
   ```

5. **Capability propagation.** H's governance MAY delegate capabilities to G's DID. Any member of G can then invoke those capabilities when interacting with H's shared graph (see Section 7).

---

## 7. Governance Integration

Groups integrate with the graph governance framework [[SPEC-05]] at multiple levels.

### 7.1 Group as Governance Root

The group's DID is the root authority for its shared graph's governance. This means:

- The group's creator initially holds root authority, as the creator of the governance root.
- All governance rules for the group's shared graph are anchored to the group's DID.
- Capability chains for the group's shared graph MUST trace back to the group's DID as the root.

### 7.2 Capability Delegation to Groups

A critical feature of group identity is the ability to delegate capabilities to group DIDs, not just individual DIDs.

When a ZCAP is delegated to a group DID:

1. The ZCAP's `delegatee` field contains the group DID.
2. Any current member of the delegatee group MAY invoke the capability.
3. The governance engine, when verifying a ZCAP invocation, MUST:
   a. Identify the invoker's DID.
   b. Check if the ZCAP's delegatee is a group DID (has `rdf://type` → `"group://Group"`).
   c. If yes, verify that the invoker is a current member of the delegatee group.
   d. If the invoker is a member, treat the invocation as valid.

This enables **role-based access control** through group composition:

- Create a "moderators" sub-group within a community group.
- Delegate moderation capabilities (e.g., `manage_members`, content removal) to the moderators group's DID.
- Any member of the moderators group automatically receives those capabilities.
- Adding or removing a moderator is simply adding or removing a member of the moderators group — no capability re-delegation is required.

### 7.3 Transitive Capability Resolution

When capabilities are delegated to a group DID, and that group contains nested groups, the governance engine MUST resolve capabilities transitively:

1. If a capability is delegated to group H, and group G is a member of H, then members of G can invoke the capability — but **only if** the capability's scope permits transitive resolution.
2. The `group://capability_transitive` predicate on a ZCAP controls whether transitive resolution is permitted. If absent, the default is `false` (non-transitive).
3. When transitive resolution is enabled, the governance engine applies the same cycle-detection algorithm described in Section 5.1.8 to prevent infinite loops.

### 7.4 Membership Governance

The act of adding or removing members is itself governed:

- The `manage_members` capability controls who can add or remove members.
- Groups MAY define additional membership governance rules:
  - `group://membership_open`: if `true`, any agent may join without approval.
  - `group://membership_requires_credential`: specifies a credential type required for membership.
  - `group://membership_max_count`: specifies a maximum membership count.
  - `group://membership_vote_threshold`: specifies a vote threshold for approving new members.

These governance predicates are stored as triples in the group's shared graph and enforced by the governance engine at the sync protocol layer.

---

## 8. Isomorphism: Individual = Group of One

This section defines the most important property of this specification: **an individual identity and a group identity are the same thing.**

### 8.1 The Claim

An individual agent's identity IS a group with membership \[self\]. This is not a metaphor, not a convenience layer, not an abstraction. It is the literal data model.

When a user agent executes `navigator.credentials.create({did})`, the following occurs:

1. A keypair is generated and a DID is derived.
2. A personal linked data graph is created [[SPEC-01]].
3. A group is created with the individual as the sole member.
4. The personal graph IS the group's shared graph (currently with one peer: the individual).
5. Governance is initialised: the individual is the root authority.

The user now has a group. It happens to have one member. There is nothing special about this — it is the same data structure, the same API, and the same governance framework as a group of one thousand.

### 8.2 The Consequence

This isomorphism has profound consequences for the architecture of the web:

**There is no "personal vs shared" distinction at the data model level.** A personal graph and a group graph are the same type. They use the same predicates, the same sync protocol, the same governance framework. The only difference is the membership count.

**There is no "upgrade to group" flow.** Traditional systems require a user to "create a group" or "start a team" — a distinct action that creates a new entity. In this model, you were always a group. Inviting a collaborator is not creating something new; it is adding a member to something that already exists.

**The transition from individual to collective is seamless.** When Alice adds Bob to her personal graph, she is not switching modes. She is not migrating data. She is adding a member to her group. The graph, the governance, the DID — everything continues. The group that was \[Alice\] is now \[Alice, Bob\]. The data model did not change. The API did not change. The identity did not change (the DID persists).

**Scale is not a type distinction.** An individual, a pair, a team, a department, an organisation, a nation — these are not different kinds of entities. They are the same kind of entity at different membership counts. The software that manages a personal graph is the same software that manages a multinational organisation's graph. The governance that controls a solo project is the same governance that controls a community of millions.

### 8.3 Why This Matters

Every collaboration platform in existence has a seam between "personal" and "shared." You create a document; then you "share" it, which copies it or moves it or links it into a different system with different rules. You have a personal account; then you "create an organisation," which is a different kind of entity with different APIs, different permissions models, and different data stores.

These seams are not accidental. They reflect an architectural assumption: that individuals and collectives are fundamentally different. This specification rejects that assumption.

By making individual and collective identity isomorphic, this specification eliminates an entire class of complexity:

- No migration path from personal to shared (there is nothing to migrate).
- No permission model differences between personal and shared (same governance).
- No data model incompatibilities between personal and shared (same graph, same predicates).
- No "sharing" action that copies or moves data (you add a member; they sync).

The group primitive is the universal identity primitive. It works for one. It works for billions. The data model is the same.

### 8.4 Formal Statement

Let I be an individual identity and G be a group identity as defined by this specification. The following MUST hold:

1. I is representable as a `Group` with exactly one member (the individual).
2. All operations defined in Section 5 that are valid on G are also valid on I.
3. The return types and semantics of all operations are identical for I and G.
4. No API method, predicate, or governance rule distinguishes between I and G based on membership count.

Conforming implementations MUST NOT provide separate interfaces, code paths, or data stores for individual identities and group identities. A single implementation of the `Group` interface MUST serve both.

---

## 9. Security Considerations

### 9.1 Group DID Key Management

A group's DID is backed by a keypair. The security of the group depends on the security of the private key. Several strategies exist:

- **Designated key holder.** A single member holds the group's private key. This is simple but creates a single point of failure and a trust dependency. Suitable for small, high-trust groups.

- **Threshold signatures.** The group's private key is split among members using a threshold signature scheme (e.g., Shamir's Secret Sharing or a multi-party computation protocol). A quorum of members is required to produce a valid signature. This distributes trust but adds complexity.

- **Key rotation.** The group's DID method SHOULD support key rotation, allowing the group to replace its keypair without changing its DID. This mitigates the impact of key compromise.

Implementations MUST document their key management strategy. Implementations SHOULD support key rotation. Implementations MAY support threshold signatures.

Group DID key management MUST use one of the following strategies, declared in the group's metadata:

1. **Designated holder:** One member holds the private key and signs on behalf of the group. If the holder leaves, they MUST transfer the key to another member before departure.
2. **Threshold signatures:** The group's private key is split among N members using Shamir's Secret Sharing or a threshold signature scheme. K-of-N members must cooperate to sign.
3. **Rotatable keys:** The group DID supports key rotation via DID Document updates. Any member with `manage_group` capability can trigger rotation.

### 9.1.1 Abandoned Groups

A group with zero members is considered abandoned. Abandoned groups MUST retain their DID and graph data on any peer that still holds a copy. Any agent MAY re-claim an abandoned group by joining its shared graph and adding themselves as a member, provided the sync module accepts the join. The re-claiming agent becomes the new root authority.

### 9.2 Membership Spoofing

Only members with the `manage_members` governance capability can add members. The sync protocol enforces this at the consensus layer — a `group://has_member` triple submitted by an unauthorised agent is rejected by all peers.

However, an attacker who compromises a member with `manage_members` capability can add arbitrary members. Mitigations include:

- Requiring multi-party approval for membership changes (via `group://membership_vote_threshold`).
- Requiring credential attestation for new members (via `group://membership_requires_credential`).
- Auditing membership changes via the shared graph's history.

### 9.3 Nesting Depth Attacks

Deeply nested groups can cause resource exhaustion during transitive membership resolution. An attacker could create a chain of groups nested to extreme depth, then trigger a `transitiveMembers()` call on the outermost group.

Implementations MUST detect cycles during transitive resolution and terminate traversal. Implementations SHOULD impose a configurable maximum nesting depth (the default SHOULD be 16 levels). Implementations SHOULD return partial results when the depth limit is reached.

### 9.4 Group Impersonation

Group DIDs are cryptographically unique — two groups cannot have the same DID. However, group metadata (name, description, avatar) can be freely chosen and MAY duplicate existing groups.

Implementations SHOULD provide mechanisms for verifying group authenticity:

- Out-of-band verification of the group DID (e.g., published on a trusted website).
- Verifiable credentials attesting to the group's identity (e.g., a domain linkage credential).
- Web-of-trust endorsements from known groups or individuals.

### 9.5 Capability Escalation via Nesting

When capabilities are delegated to a group DID and transitive resolution is enabled, adding a group as a member effectively grants that group's members the delegated capabilities. An attacker who controls a group could add many members to that group, all of whom would inherit the capabilities.

Mitigations include:

- Disabling transitive capability resolution by default (`group://capability_transitive` defaults to `false`).
- Monitoring group membership changes for delegatee groups.
- Revoking capabilities when the delegatee group's membership changes unexpectedly.

---

## 10. Privacy Considerations

### 10.1 Membership Visibility

Membership triples are stored in the group's shared graph and are visible to all peers in the sync network. This means:

- All members can see all other members.
- Any agent with access to the shared graph can enumerate the group's membership.

For groups where membership is sensitive (e.g., support groups, political organisations, whistleblower networks), this is a significant privacy concern.

Mitigations:

- Groups MAY encrypt membership triples using the group's shared key, making them readable only to current members.
- Implementations MAY support zero-knowledge membership proofs, allowing a member to prove membership without revealing the full membership list.
- Implementations MAY support pseudonymous membership, where members use group-specific DIDs that are not linked to their primary identity.

### 10.2 Organisational Structure Leakage

Holonic nesting reveals organisational structure. If group A is a member of group B, which is a member of group C, the nesting reveals a hierarchy. An observer with access to any of these groups' shared graphs can infer relationships between groups.

Mitigations:

- Groups MAY omit `rdf://type` → `"group://Group"` triples for member groups, making it non-obvious that a member is itself a group. This prevents casual enumeration but does not prevent determined analysis.
- Nesting relationships MAY be encrypted or stored in a separate, access-controlled graph.

### 10.3 Correlation Attacks

If an individual is a member of multiple groups, and those groups' membership lists are visible, an observer can correlate the individual across groups. This is equivalent to the correlation problem in decentralised identity generally.

Mitigations:

- Using group-specific DIDs (pairwise DIDs) for each group membership.
- Using zero-knowledge proofs for cross-group interactions.

---

## 11. Examples

### 11.1 Create a Personal Identity (Group of One)

A user creates their decentralised identity. This implicitly creates a group with one member.

```javascript
// Create a decentralised identity
const identity = await navigator.credentials.create({ did: true });

// The identity IS a group of one
const myGroups = await navigator.graph.listGroups();
console.log(myGroups.length); // 1

const selfGroup = myGroups[0];
console.log(selfGroup.did); // "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2..."
console.log(await selfGroup.members());
// [{ did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2...", isGroup: false, name: "Alice" }]

// The personal graph IS the group's shared graph
console.log(selfGroup.graph === navigator.graph.personal); // true
```

The user now has a group. It has one member. There is nothing special about it — it is the same data structure that will later represent a team of fifty or an organisation of thousands.

### 11.2 Create a Team and Invite Members

Alice creates a team and invites Bob and Carol.

```javascript
// Alice creates a team
const team = await navigator.graph.createGroup({
  name: "Project Alpha",
  description: "Core development team for Project Alpha",
  relays: ["wss://relay.example.com"]
});

console.log(team.did); // "did:key:z6MknGc7YuwHbf..."

// Alice invites Bob
await team.addMember("did:key:z6MkpTHR8VNs5xYA...");

// Alice invites Carol
await team.addMember("did:key:z6MkrHKzgsahxBTS...");

// Check membership
const members = await team.members();
console.log(members.length); // 3 (Alice + Bob + Carol)
console.log(members.map(m => m.name)); // ["Alice", "Bob", "Carol"]

// All members are peers in the team's shared graph
// Bob and Carol can now add triples to the team's graph
```

### 11.3 Nest a Team in an Organisation

An organisation creates sub-teams and nests them.

```javascript
// Create the organisation
const org = await navigator.graph.createGroup({
  name: "Acme Corp",
  description: "Acme Corporation"
});

// Create department groups
const engineering = await navigator.graph.createGroup({
  name: "Engineering"
});
const marketing = await navigator.graph.createGroup({
  name: "Marketing"
});

// Nest departments in the organisation
await org.addMember(engineering.did);
await org.addMember(marketing.did);

// Check the org's direct members
const orgMembers = await org.members();
console.log(orgMembers.length); // 3 (creator + engineering group + marketing group)

// Check child groups
const departments = await org.childGroups();
console.log(departments.map(d => d.name)); // ["Engineering", "Marketing"]

// Check transitive members (all individuals across all departments)
const allPeople = await org.transitiveMembers();
console.log(allPeople.length); // all individual members across all nested groups

// The engineering group knows it belongs to the org
const parents = await engineering.parentGroups();
console.log(parents[0].name); // "Acme Corp"
```

### 11.4 Delegate Moderation to a Sub-group

A community creates a moderators group and delegates moderation capabilities to it.

```javascript
// Create the community
const community = await navigator.graph.createGroup({
  name: "Web Standards Community",
  description: "Open community for web standards discussion"
});

// Create a moderators sub-group
const moderators = await navigator.graph.createGroup({
  name: "Moderators"
});

// Add the moderators group as a member of the community
await community.addMember(moderators.did);

// Delegate moderation capabilities to the moderators group
await community.delegateCapability(
  moderators.did,
  "manage_members",    // capability: can add/remove members
  "community"          // scope: the community's graph
);

await community.delegateCapability(
  moderators.did,
  "remove_content",    // capability: can remove triples
  "community"          // scope: the community's graph
);

// Now, anyone added to the moderators group automatically gets
// moderation capabilities — no per-person delegation needed

// Add Alice as a moderator
await moderators.addMember("did:key:z6MkhaXgBZDvotDkL...");

// Alice can now moderate the community — she inherits the capabilities
// delegated to the moderators group. If Alice is later removed from
// the moderators group, she loses those capabilities immediately.
```

### 11.5 Transitive Membership Query

Query all individuals in a deeply nested organisational structure.

```javascript
// Assume the following structure:
// Consortium
//   ├── Org A
//   │   ├── Team A1 (Alice, Bob)
//   │   └── Team A2 (Carol)
//   └── Org B
//       └── Team B1 (Dave, Eve)

const consortium = await navigator.graph.joinGroup("did:key:z6Mkp...");

// Direct members: Org A, Org B
const directMembers = await consortium.members();
console.log(directMembers.length); // 2 (plus consortium creator)
console.log(directMembers.filter(m => m.isGroup).length); // 2

// Transitive members: all individuals, recursively
const allPeople = await consortium.transitiveMembers();
console.log(allPeople.length); // 5 (Alice, Bob, Carol, Dave, Eve)
console.log(allPeople.every(m => !m.isGroup)); // true — only individuals

// This works regardless of nesting depth
// The same query on Org A would return: Alice, Bob, Carol
// The same query on Team A1 would return: Alice, Bob
```

### 11.6 Seamless Individual-to-Collective Transition

Demonstrating the isomorphism property: transitioning from individual to collective without any mode switch.

```javascript
// Alice starts with her personal identity — a group of one
const alice = (await navigator.graph.listGroups())[0];
console.log((await alice.members()).length); // 1 — just Alice

// Alice adds data to her personal graph (which IS the group's graph)
await alice.graph.add({
  subject: "project://alpha",
  predicate: "rdf://type",
  object: "project://Project"
});

// Alice invites Bob — this is just addMember(), not "create a shared space"
await alice.addMember("did:key:z6MkpTHR8VNs5xYA...");

// Now the group has two members
console.log((await alice.members()).length); // 2 — Alice and Bob

// The data Alice added is still there — no migration, no copy
// Bob can now see and contribute to the same graph
// The DID hasn't changed. The graph hasn't changed. The governance hasn't changed.
// The only thing that changed is the membership count: 1 → 2

// Later, a whole team joins
const designTeam = await navigator.graph.createGroup({ name: "Design" });
await alice.addMember(designTeam.did);

// Now Alice's group contains an individual (Bob) and a group (Design)
// Still the same group. Still the same DID. Still the same graph.
```

### 11.7 Group-Specific DID for Privacy

A member uses a pairwise DID to prevent cross-group correlation.

```javascript
// Alice generates a group-specific DID for a sensitive group
const pairwiseDid = await navigator.credentials.create({
  did: true,
  purpose: "group-membership",
  linkable: false  // prevent correlation with other DIDs
});

// Alice joins the group using the pairwise DID
const sensitiveGroup = await navigator.graph.joinGroup(
  "did:key:z6MkrHKzgs...",
  { memberDid: pairwiseDid.id }
);

// Alice is a member, but her membership cannot be correlated
// with her membership in other groups (different DID)
```

---

## 12. Predicate Reference Table

The following table lists all predicates defined in this specification within the `group://` namespace.

| Predicate | Domain | Range | Required | Description |
|---|---|---|---|---|
| `group://Group` | — | — | — | Type identifier for group entities. Used as the object of `rdf://type` triples. |
| `group://created` | Group DID | ISO 8601 dateTime | REQUIRED | The timestamp at which the group was created. |
| `group://creator` | Group DID | DID (USVString) | REQUIRED | The DID of the agent that created the group. |
| `group://has_member` | Group DID | DID (USVString) | — | Asserts that the object DID is a member of the subject group. |
| `group://membership_request` | DID (requester) | Group DID | — | A request by the subject DID to join the object group. |
| `group://Membership` | — | — | — | Type identifier for membership metadata entities. |
| `group://member` | Membership URI | DID (USVString) | — | The member DID associated with a membership metadata entity. |
| `group://group` | Membership URI | Group DID | — | The group DID associated with a membership metadata entity. |
| `group://joined_at` | Membership URI | ISO 8601 dateTime | RECOMMENDED | The timestamp at which the member joined the group. |
| `group://invited_by` | Membership URI | DID (USVString) | OPTIONAL | The DID of the member who invited/approved this member. |
| `group://role` | Membership URI | Literal (USVString) | OPTIONAL | A role label for the member within the group. |
| `group://avatar` | Group DID | URI | OPTIONAL | A URI pointing to the group's avatar image. |
| `group://metadata` | Group DID | URI | OPTIONAL | A URI pointing to additional group metadata. |
| `group://membership_open` | Group DID | Boolean | OPTIONAL | If `true`, any agent may join without approval. Default: `false`. |
| `group://membership_requires_credential` | Group DID | Credential Type URI | OPTIONAL | Specifies a credential type required for membership. |
| `group://membership_max_count` | Group DID | Integer | OPTIONAL | Maximum number of members permitted. |
| `group://membership_vote_threshold` | Group DID | Integer | OPTIONAL | Number of existing member approvals required for a new member. |
| `group://capability_transitive` | ZCAP URI | Boolean | OPTIONAL | If `true`, the capability may be invoked by members of nested groups. Default: `false`. |

---

## 13. References

### 13.1 Normative References

**[SPEC-01]** Personal Linked Data Graphs. W3C Draft Community Group Report. URL: [01_personal-linked-data-graphs.md](01_personal-linked-data-graphs.md)

**[SPEC-02]** Decentralised Identity for the Web Platform. W3C Draft Community Group Report. URL: [02_decentralised-identity-web-platform.md](02_decentralised-identity-web-platform.md)

**[SPEC-03]** P2P Graph Synchronisation. W3C Draft Community Group Report. URL: [03_p2p-graph-sync.md](03_p2p-graph-sync.md)

**[SPEC-05]** Graph Governance: Constraint Enforcement for Shared Linked Data Graphs. W3C Draft Community Group Report. URL: [05_graph-governance.md](05_graph-governance.md)

**[DID-CORE]** Decentralized Identifiers (DIDs) v1.0. W3C Recommendation, 19 July 2022. URL: https://www.w3.org/TR/did-core/

**[RFC2119]** S. Bradner. Key words for use in RFCs to Indicate Requirement Levels. BCP 14, RFC 2119, March 1997. URL: https://www.rfc-editor.org/rfc/rfc2119

**[RFC8174]** B. Leiba. Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words. BCP 14, RFC 8174, May 2017. URL: https://www.rfc-editor.org/rfc/rfc8174

**[ZCAP-LD]** Authorization Capabilities for Linked Data. W3C Community Group Report. URL: https://w3c-ccg.github.io/zcap-spec/

### 13.2 Informative References

**[SPEC-04]** Dynamic Graph Shape Validation. W3C Draft Community Group Report. URL: [04_dynamic-graph-shape-validation.md](04_dynamic-graph-shape-validation.md)

**[VC-DATA-MODEL-2.0]** Verifiable Credentials Data Model v2.0. W3C Recommendation. URL: https://www.w3.org/TR/vc-data-model-2.0/

**[SHACL]** Shapes Constraint Language (SHACL). W3C Recommendation, 20 July 2017. URL: https://www.w3.org/TR/shacl/
