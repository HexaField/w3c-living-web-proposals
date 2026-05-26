# Graph Flows: Temporal Process Primitives for Linked Data Contexts

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines **flows** — declarative state machines that govern how data within a context evolves over time. Flows complement shapes (which constrain what data looks like — [[SHAPE-VALIDATION]]), contexts (which scope where data lives — [[PERSONAL-LINKED-DATA-GRAPHS]]), and ZCAPs (which authorise who can act — [[CAPABILITY-FRAMEWORK]]). A flow defines states, transitions between them, **SPARQL ASK guards** that gate transitions, **temporal constraints** (minimum delays, deadlines), and **role requirements** that bind transitions to specific capabilities. Flows are stored as triples inside the context they govern; they participate in graph-snapshot transfer, so a context's process logic travels with its data and rules.

---

## Status of This Document

This document is a draft Community Group Report. It has no official W3C standing.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Flow Definition Format](#4-flow-definition-format)
5. [Storage and Discovery](#5-storage-and-discovery)
6. [Flow Instance Lifecycle](#6-flow-instance-lifecycle)
7. [Guards](#7-guards)
8. [Temporal Constraints](#8-temporal-constraints)
9. [Role Requirements](#9-role-requirements)
10. [Composite Flows](#10-composite-flows)
11. [API](#11-api)
12. [Integration with Sync Protocol](#12-integration-with-sync-protocol)
13. [Integration with Shapes and Governance](#13-integration-with-shapes-and-governance)
14. [Security Considerations](#14-security-considerations)
15. [Privacy Considerations](#15-privacy-considerations)
16. [Examples](#16-examples)
17. [References](#17-references)

---

## 1. Introduction

### 1.1 Motivation

SHACL shapes tell you what data *looks like* (structural constraints). Named graphs tell you where data *lives* (contextual boundaries). ZCAPs tell you who can *act* (authorisation). None of these tell you *how data should evolve over time*.

Consider a governance proposal in a decentralised community. It should not jump from "draft" to "ratified" in one step. There is a process: draft → open for comment → voting period → ratified (or rejected). The process has temporal constraints (voting must remain open for at least 48 hours), conditional constraints (cannot ratify unless quorum is met), and role constraints (only council members can move to the final vote).

This is what flows are for. They complement the three existing primitives:

| Primitive | Governs | Example |
|---|---|---|
| SHACL Shapes [[SHAPE-VALIDATION]] | What data must look like | "A message must have a body and an author" |
| Contexts [[PERSONAL-LINKED-DATA-GRAPHS]] | Where data lives | "Messages in #general live in the `#general` context" |
| ZCAPs [[CAPABILITY-FRAMEWORK]] | Who can act | "Only moderators can delete messages" |
| **Flows** | **How data evolves** | "A proposal must be open for 48h before it can be ratified" |

### 1.2 Flows Travel With the Context

Because flows are stored as triples in the context they govern, they participate in graph-snapshot transfer ([[PERSONAL-LINKED-DATA-GRAPHS]] §5). Export a context → export its flows. Mount a context → mount its flows. The process constraints travel with the data they constrain. When you subscribe to a context, you do not separately download "the data" and "the rules" — you receive one graph that contains both.

### 1.3 Scope

This specification defines:

- A JSON format for flow definitions.
- The storage convention for flows as triples in a context.
- The flow instance lifecycle and state representation.
- SPARQL ASK guards on transitions.
- Temporal constraints (`minDelay`, `maxDelay`, deadline behaviour).
- Role requirements via ZCAPs.
- Composite flows (flows triggering other flows).
- A web API for registering, executing, and inspecting flows.
- Integration with the sync protocol so flow transitions propagate consistently.

This specification does NOT define specific application workflows, UI for visualising flows, or a modelling language beyond the JSON format.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A conforming **flow engine** is a software component that:

1. Implements the flow definition format ([§4](#4-flow-definition-format)).
2. Implements the flow instance lifecycle ([§6](#6-flow-instance-lifecycle)).
3. Evaluates SPARQL ASK guards before firing transitions ([§7](#7-guards)).
4. Enforces temporal constraints based on reifier timestamps ([§8](#8-temporal-constraints)).
5. Verifies role requirements via [[CAPABILITY-FRAMEWORK]] ([§9](#9-role-requirements)).
6. Exposes the API in [§11](#11-api).

---

## 3. Terminology

<dl>
<dt><dfn>Flow</dfn></dt>
<dd>A declarative state machine definition: states, transitions, guards, temporal constraints, role requirements.</dd>

<dt><dfn>FlowInstance</dfn></dt>
<dd>A specific entity in a context that is governed by a flow. The instance's current state is recorded as a triple <code>&lt;instance&gt; -[flow://state]→ &lt;state-name&gt;</code>.</dd>

<dt><dfn>State</dfn></dt>
<dd>A named position in a flow's state machine. An instance is always in exactly one state per flow.</dd>

<dt><dfn>Transition</dfn></dt>
<dd>A named edge between two states with optional guard, temporal, and role conditions.</dd>

<dt><dfn>Guard</dfn></dt>
<dd>A SPARQL ASK query that MUST evaluate to <code>true</code> for a transition to fire.</dd>

<dt><dfn>Temporal Constraint</dfn></dt>
<dd>A minimum delay, maximum delay, or deadline associated with a transition.</dd>

<dt><dfn>Role Requirement</dfn></dt>
<dd>A reference to a ZCAP action that the agent firing a transition MUST be authorised for.</dd>

<dt><dfn>Reifier</dfn></dt>
<dd>An RDF 1.2 reifier triple (per [[PERSONAL-LINKED-DATA-GRAPHS]] §3.2) carrying the timestamp of a state-establishing link. Used by the temporal engine to compute elapsed time in a state.</dd>

<dt><dfn>Sub-Flow</dfn></dt>
<dd>A flow triggered by a parent flow's transition. The parent flow MAY wait for the sub-flow to complete before continuing.</dd>
</dl>

---

## 4. Flow Definition Format

### 4.1 Base Structure

```json
{
  "name": "<flow name, unique within the context>",
  "namespace": "<URI namespace prefix for this flow's predicates>",
  "appliesTo": "<targetClass URI — the shape of entities this flow governs>",
  "initialState": "<state name>",
  "states": [ ... ],
  "transitions": [ ... ]
}
```

- **name** (REQUIRED): Unique flow identifier within the context.
- **namespace** (REQUIRED): URI namespace under which state and transition predicates are defined. Convention: `flow://<flow-name>/`.
- **appliesTo** (REQUIRED): The `targetClass` of entities this flow governs. SHOULD reference a shape registered via [[SHAPE-VALIDATION]].
- **initialState** (REQUIRED): The name of the state assigned to a newly-created instance.
- **states**: Array of state definitions ([§4.2](#42-state-definitions)).
- **transitions**: Array of transition definitions ([§4.3](#43-transition-definitions)).

### 4.2 State Definitions

```json
{
  "name": "<state name>",
  "displayName": "<human-readable name>",
  "isTerminal": false
}
```

- **name** (REQUIRED): Identifier unique within the flow. MUST match `[a-zA-Z_][a-zA-Z0-9_]*`.
- **displayName** (OPTIONAL): For UI use.
- **isTerminal** (OPTIONAL, default `false`): If `true`, no transitions may leave this state.

### 4.3 Transition Definitions

```json
{
  "name": "<transition name>",
  "displayName": "<human-readable name>",
  "fromState": "<state name>",
  "toState": "<state name>",
  "guard": "<SPARQL ASK query>",
  "guardDescription": "<human-readable explanation>",
  "temporal": {
    "minDelay": "<ISO 8601 duration>",
    "maxDelay": "<ISO 8601 duration>",
    "onDeadline": "auto-transition" | "error-state" | "notify"
  },
  "role": "<ZCAP action name>",
  "actions": [ ... ],
  "triggersSubFlow": "<sub-flow name>"
}
```

- **name** (REQUIRED): Unique transition identifier within the flow.
- **fromState** (REQUIRED): The state this transition leaves.
- **toState** (REQUIRED): The state this transition enters.
- **guard** (OPTIONAL): A SPARQL ASK query. If present, MUST return `true` for the transition to fire. See [§7](#7-guards).
- **temporal** (OPTIONAL): Temporal constraints. See [§8](#8-temporal-constraints).
- **role** (OPTIONAL): A ZCAP action name ([[CAPABILITY-FRAMEWORK]] §4.5.3). If present, the firing agent MUST hold a valid ZCAP authorising this action on the context. See [§9](#9-role-requirements).
- **actions** (OPTIONAL): Side effects to perform on transition (triple writes). See [§4.4](#44-actions).
- **triggersSubFlow** (OPTIONAL): The name of a sub-flow that this transition launches. See [§10](#10-composite-flows).

### 4.4 Actions

Actions are triple operations executed atomically with the state change:

```json
{ "type": "flow://actions/addLink",         "subject": "this", "predicate": "<URI>", "object": "<value>" }
{ "type": "flow://actions/setSingleTarget", "subject": "this", "predicate": "<URI>", "object": "<value>" }
{ "type": "flow://actions/removeLink",      "subject": "this", "predicate": "<URI>", "object": "<value>" }
```

- **subject**: MUST be `"this"` (referring to the FlowInstance) or a static URI.
- **predicate**: A URI.
- **object**: A static URI/literal, or `"now"` (substituted with the current ISO 8601 timestamp), or `"agent"` (substituted with the firing agent's DID).

---

## 5. Storage and Discovery

### 5.1 Triple Representation

A flow is stored as triples inside the context it governs:

```turtle
# In the community-root context
<context-id>  flow://has_flow  <flow://Proposal> .

<flow://Proposal>  rdf://type           flow://Flow ;
                   flow://name           "Proposal" ;
                   flow://applies_to     <gov://ProposalShape> ;
                   flow://initial_state  "draft" .

<flow://Proposal>  flow://has_state  <flow://Proposal/state/draft> ,
                                      <flow://Proposal/state/comment> ,
                                      <flow://Proposal/state/voting> ,
                                      <flow://Proposal/state/ratified> ,
                                      <flow://Proposal/state/rejected> .

<flow://Proposal/state/draft>     flow://state_name "draft" .
<flow://Proposal/state/comment>   flow://state_name "comment" .
<flow://Proposal/state/voting>    flow://state_name "voting" .
<flow://Proposal/state/ratified>  flow://state_name "ratified" ;
                                  flow://is_terminal true .

<flow://Proposal>  flow://has_transition  <flow://Proposal/transition/open-comment> ,
                                          <flow://Proposal/transition/open-voting> ,
                                          <flow://Proposal/transition/ratify> .

<flow://Proposal/transition/ratify>
  flow://transition_name    "ratify" ;
  flow://transition_from    "voting" ;
  flow://transition_to      "ratified" ;
  flow://transition_guard   "ASK WHERE { $this <gov://vote_count> ?v . $this <gov://quorum> ?q . FILTER(?v >= ?q) }" ;
  flow://transition_min_delay "PT48H" ;
  flow://transition_role     "ratify" .
```

### 5.2 Well-Known Predicates

| Predicate | Purpose |
|---|---|
| `flow://has_flow` | Binds a flow to a context |
| `flow://name` | The flow's name (unique within the context) |
| `flow://applies_to` | The shape (or class URI) of entities this flow governs |
| `flow://initial_state` | The state name a new instance enters |
| `flow://has_state` | Enumerates the flow's states |
| `flow://state_name` | A state's name |
| `flow://is_terminal` | Whether a state is terminal |
| `flow://has_transition` | Enumerates the flow's transitions |
| `flow://transition_name` / `_from` / `_to` | A transition's name and endpoints |
| `flow://transition_guard` | A transition's SPARQL ASK guard |
| `flow://transition_min_delay` / `_max_delay` / `_on_deadline` | Temporal constraints |
| `flow://transition_role` | Required ZCAP action |
| `flow://state` | A FlowInstance's current state (on the instance itself) |
| `flow://entered_state_at` | A FlowInstance's timestamp of entering its current state (carried by reifier on the state-establishing link) |

### 5.3 Self-Describing Contexts

Flows are part of a context's self-description. Exporting a context as a snapshot ([[PERSONAL-LINKED-DATA-GRAPHS]] §5) includes flow triples. Mounting a snapshot installs the flows. The flow engine queries the context's local store to discover flows on demand — no separate registration step is required after mount.

### 5.4 Discovery

Discovery is via SPARQL:

```sparql
SELECT ?flow ?name ?appliesTo WHERE {
  ?flow rdf:type             flow://Flow ;
        flow://name           ?name ;
        flow://applies_to     ?appliesTo .
}
```

---

## 6. Flow Instance Lifecycle

### 6.1 Creation

When a shape instance (e.g., a Proposal) is created, the flow engine MAY automatically set the initial state if the shape's `targetClass` matches a flow's `appliesTo`. The state-establishing link is:

```
<instance>  flow://state  <state-name-literal-or-uri> .
```

The triple is authored with a reifier ([[PERSONAL-LINKED-DATA-GRAPHS]] §3.2) carrying author and timestamp. The reifier's timestamp is the canonical "entered this state at" time for temporal constraints.

### 6.2 Transition

Firing a transition (via `executeFlowTransition()`) MUST:

1. Resolve the flow definition and the named transition.
2. Verify the instance is currently in `fromState`.
3. Evaluate the guard ([§7](#7-guards)). If `false`, reject.
4. Evaluate temporal constraints ([§8](#8-temporal-constraints)). If unmet, reject.
5. Verify the role requirement ([§9](#9-role-requirements)). If absent, reject.
6. Atomically: remove the old state link, add the new state link (with a fresh reifier), and execute the transition's `actions`.
7. If `triggersSubFlow` is present, instantiate the sub-flow.
8. Fire a `transitionfired` event.

### 6.3 State Inspection

```javascript
const state = await context.getFlowState("Proposal", instanceUri);
// → "voting"
```

### 6.4 Termination

When an instance enters a terminal state (`isTerminal: true`), the flow engine considers the lifecycle complete. No further transitions are permitted from that state.

---

## 7. Guards

### 7.1 SPARQL ASK

A guard is a SPARQL ASK query that MUST return `true` for a transition to fire. The query has access to the instance's data via a `$this` binding (substituted at evaluation time with the instance's URI).

```sparql
ASK WHERE {
  $this <gov://vote_count> ?v .
  $this <gov://quorum>     ?q .
  FILTER(?v >= ?q)
}
```

### 7.2 Evaluation

- The guard query is evaluated against the context the flow is registered in. Cross-context references in the query MUST use SPARQL `GRAPH` clauses with the target context's DID.
- Plain literal storage ensures all property values are SPARQL-visible — guards can reason over them directly.
- Evaluation MUST timeout after a UA-configurable budget (RECOMMENDED: 100ms per guard). On timeout, the transition is rejected.

### 7.3 Failure Reporting

When a guard fails, the transition rejects with a structured error including the guard's `guardDescription` (if defined):

```json
{
  "success": false,
  "reason": "Quorum not reached",
  "guardDescription": "Quorum must be reached before ratification"
}
```

### 7.4 Safety Constraints

Guards MUST be pure-SPARQL `ASK` queries. They MUST NOT use `UPDATE`, `INSERT`, `DELETE`, `LOAD`, or `CLEAR`. They MUST NOT reference external services (e.g., `SERVICE` clauses) unless the runtime explicitly permits federated queries with the user's consent.

---

## 8. Temporal Constraints

### 8.1 Format

```json
{
  "minDelay": "PT48H",
  "maxDelay": "P30D",
  "onDeadline": "auto-transition" | "error-state" | "notify"
}
```

- **minDelay** (OPTIONAL): An ISO 8601 duration. The transition cannot fire until at least `minDelay` has elapsed since the instance entered its current state.
- **maxDelay** (OPTIONAL): An ISO 8601 duration. After `maxDelay` has elapsed without the transition firing, `onDeadline` behaviour applies.
- **onDeadline** (OPTIONAL):
  - `"auto-transition"`: The runtime fires the transition automatically (treated as system-authored).
  - `"error-state"`: The runtime fires a (configurable) error-state transition.
  - `"notify"`: The runtime fires a notification event but does not change state.

### 8.2 Timestamp Source

The "entered state at" timestamp is the reifier timestamp on the most recent `<instance> flow://state ?state` triple. This is sync-authoritative (per [[CONTEXT-SYNC]] §12.5) and not subject to author manipulation.

### 8.3 Evaluation

```sparql
SELECT ?ts WHERE {
  ?r rdf:reifies <<( $this flow://state $currentState )>> .
  ?r prov://timestamp ?ts .
}
ORDER BY DESC(?ts)
LIMIT 1
```

`elapsed = now - ts`. The transition fires only if `elapsed >= minDelay`.

### 8.4 Auto-Transition Authorship

Auto-transitions fired by the runtime SHOULD be authored under a designated "system" identity (a delegate of the context's sovereign DID dedicated to runtime operations). Implementations MAY support per-flow system identities so different contexts isolate their automation.

---

## 9. Role Requirements

A transition's `role` field names a ZCAP action ([[CAPABILITY-FRAMEWORK]] §4.5.3) that the firing agent MUST be authorised for. The flow engine MUST:

1. Resolve the role action.
2. Query [[CAPABILITY-FRAMEWORK]]'s `myCapabilities()` on the context (or directly check ZCAPs via `verify(agent, action, context, ...)`).
3. If no valid capability is held, reject the transition with `"NotAllowedError"`.

This composes the flow with the governance layer: shapes describe structure, ZCAPs grant authority, flows define when authority can be exercised, and the *role* field is the joint:

> "Only a council member can ratify a proposal, but only after 48 hours of voting, but only if quorum is met."

That sentence maps directly to: `role: "ratify"` + `temporal.minDelay: "PT48H"` + `guard: "ASK { quorum reached }"`.

---

## 10. Composite Flows

### 10.1 Sub-Flows

A transition MAY trigger a sub-flow:

```json
{
  "name": "open-voting",
  "fromState": "comment",
  "toState": "voting",
  "triggersSubFlow": "VotingPeriod"
}
```

On firing, the runtime instantiates `VotingPeriod` with the same `this` instance and the parent's state captured. The parent flow remains in `voting` until the sub-flow reaches a terminal state, at which point the parent MAY fire a follow-up transition (see [§10.2](#102-completion-callback)).

### 10.2 Completion Callback

A sub-flow's terminal state MAY emit a `flow://completed` link the parent can guard on:

```json
{
  "name": "tally-votes",
  "fromState": "voting",
  "toState": "ratified",
  "guard": "ASK WHERE { $this <flow://completed> <VotingPeriod> . ... }"
}
```

### 10.3 Composition

Sub-flows can themselves trigger sub-sub-flows; the runtime MUST enforce a maximum nesting depth (RECOMMENDED: 8) to prevent runaway composition.

---

## 11. API

### 11.1 Context Methods

```webidl
[Exposed=Window,Worker]
partial interface Context {
  [NewObject] Promise<undefined> addFlow(DOMString name, DOMString flowJson);
  [NewObject] Promise<undefined> removeFlow(DOMString name);
  [NewObject] Promise<sequence<FlowInfo>> getFlows();

  [NewObject] Promise<DOMString> getFlowState(DOMString flowName, USVString instanceUri);
  [NewObject] Promise<FlowTransitionResult> executeFlowTransition(
    DOMString flowName,
    USVString instanceUri,
    DOMString transitionName
  );

  [NewObject] Promise<sequence<DOMString>> availableTransitions(
    DOMString flowName,
    USVString instanceUri
  );

  attribute EventHandler ontransitionfired;
  attribute EventHandler ontransitiondeadline;
};

dictionary FlowInfo {
  DOMString name;
  USVString appliesTo;
  USVString initialState;
  sequence<DOMString> states;
  sequence<DOMString> transitions;
};

dictionary FlowTransitionResult {
  required boolean success;
  DOMString? newState;
  USVString? reason;
  USVString? guardDescription;
  DOMString? secondsUntilAllowed;   // for minDelay rejections
};
```

### 11.2 addFlow

Registers a flow into this context. Requires an `updateFlow` capability ([[CAPABILITY-FRAMEWORK]] §4.5.3). Validates the JSON, writes the flow's triples to the context.

### 11.3 executeFlowTransition

Attempts to fire the named transition. The runtime:

1. Verifies the instance's current state matches the transition's `fromState`.
2. Evaluates guards, temporal constraints, and role requirements.
3. If all pass, atomically writes the new state, executes actions, and emits `ontransitionfired`.
4. Returns the result.

If any check fails, returns `{ success: false, reason: ... }` with detail useful for UI feedback.

### 11.4 availableTransitions

Returns the names of transitions that would *currently* succeed for the given instance — useful for enabling/disabling UI buttons.

### 11.5 Subscription

`ontransitionfired` fires when any FlowInstance in this context transitions. `ontransitiondeadline` fires when a transition with `temporal.maxDelay` and `onDeadline: "notify"` reaches its deadline.

---

## 12. Integration with Sync Protocol

### 12.1 Transitions as Diffs

A transition is a write to the context — removing the old state link, adding the new state link, executing `actions`. These triples are gathered into a `ContextDiff` ([[CONTEXT-SYNC]]) carrying the firing agent's `CapabilityProof`.

### 12.2 Validation on Receipt

When a peer receives a `ContextDiff` containing flow state transitions, the receiving peer:

1. Re-evaluates the guard against its local state.
2. Re-checks temporal constraints against the local reifier timestamps.
3. Re-verifies the role requirement against the context's current ZCAPs.

If any check fails on the receiving peer's local state, the diff is rejected.

### 12.3 Concurrency

If two agents fire conflicting transitions concurrently, the sync protocol's conflict resolution applies. For OR-Set CRDT semantics (the [[DEFAULT-SYNC-MODULE]]):

- Both transitions are added.
- The runtime detects the conflict (two `flow://state` triples on the same instance from the same prior state) and applies a deterministic tie-break (e.g., lexicographically smaller reifier hash wins).
- The losing transition's side-effect triples are rolled back at evaluation time.

This is the same convergence model as for any other concurrent writes; flows do not introduce new consensus requirements.

### 12.4 Auto-Transitions

Auto-transitions fired by the runtime are written by the system identity. Their `CapabilityProof` is the system identity's ZCAP for the relevant action; if the system identity does not hold the required role, the auto-transition fails and the runtime emits a deadline error.

---

## 13. Integration with Shapes and Governance

### 13.1 Shape-Bound Flows

A flow's `appliesTo` SHOULD reference a shape's `targetClass` ([[SHAPE-VALIDATION]]). The runtime auto-applies the flow's `initialState` to newly-created shape instances of that class.

A shape can declare its associated flow:

```json
{
  "targetClass": "gov://Proposal",
  "properties": [ ... ],
  "constructor": [ ... ],
  "flow://default": "Proposal"
}
```

### 13.2 ZCAP-Guarded Roles

A flow's `role` field names a ZCAP action ([§9](#9-role-requirements)). The complete authorisation story:

1. Shape says "a Proposal has body, author, status."
2. ZCAP says "this agent can `createLink` (Messages) and `ratify` (Proposals) in this context."
3. Flow says "to ratify, you need the `ratify` capability AND the proposal must be in `voting` state for 48 hours AND quorum must be reached."

Each layer composes cleanly; none can substitute for the others.

### 13.3 Governance Mode and Flows

Flows are subject to the context's enforcement mode ([[CAPABILITY-FRAMEWORK]] §5):

- **Open mode**: Role requirements are not enforced (anyone may fire any transition that passes guards and temporals).
- **Announced mode**: Role requirements are checked and recorded but not enforced.
- **Enforced mode**: Role requirements are mandatory.

This lets a community shape flow design iteratively without instantly gating contributors.

---

## 14. Security Considerations

### 14.1 Guard Safety

Guards run SPARQL queries against the local context. They MUST be read-only and time-bounded ([§7.4](#74-safety-constraints)). Implementations MUST disable destructive SPARQL keywords and federated services unless explicitly permitted.

### 14.2 Timestamp Authority

Temporal constraints depend on reifier timestamps from the sync protocol's authoritative source. Self-reported timestamps from the firing agent MUST NOT be used. If sync provides no authoritative timestamps, the runtime MUST disable temporal constraints with a warning.

### 14.3 Auto-Transition Privilege

The system identity that fires auto-transitions has elevated standing. Implementations MUST scope the system identity's ZCAPs narrowly — only to the actions needed for the auto-transitions actually configured.

### 14.4 Sub-Flow Depth

Deep sub-flow nesting can be used to exhaust runtime resources. Implementations MUST enforce a maximum nesting depth (RECOMMENDED: 8).

### 14.5 Guard DOS

A maliciously complex SPARQL guard can exhaust query budget. Implementations MUST apply per-guard time and result budgets, and SHOULD log guards that exceed them.

### 14.6 Concurrent Transition Forging

An adversarial peer could spam transition attempts to win deterministic tie-breaks. The combination of ZCAP rate limits ([[CAPABILITY-FRAMEWORK]] caveats §9) and per-transition role requirements provides defence.

---

## 15. Privacy Considerations

### 15.1 Process Visibility

Flow definitions are stored as triples in the context. Anyone with read access to the context sees the flow structure — what states exist, what transitions are possible, what guards gate them.

### 15.2 Transition History

Every state change is a triple with a reifier carrying author and timestamp. The complete history of state changes for a FlowInstance is observable to all participants. Applications that need transition privacy SHOULD partition sensitive flows into restricted-mount contexts.

### 15.3 Guard Disclosure

Guards expose business logic. Communities that need guard privacy SHOULD avoid encoding sensitive predicates in guards directly.

---

## 16. Examples

### 16.1 Simple Two-State Flow (Open/Closed Channels)

```javascript
await channel.addFlow("ChannelLifecycle", JSON.stringify({
  name: "ChannelLifecycle",
  namespace: "flow://ChannelLifecycle/",
  appliesTo: "msg://Channel",
  initialState: "open",
  states: [
    { name: "open" },
    { name: "closed", isTerminal: true }
  ],
  transitions: [
    {
      name: "close",
      fromState: "open",
      toState: "closed",
      role: "moderate",
      actions: [
        { type: "flow://actions/setSingleTarget", source: "this", predicate: "msg://closed_at", target: "now" },
        { type: "flow://actions/setSingleTarget", source: "this", predicate: "msg://closed_by", target: "agent" }
      ]
    }
  ]
}));
```

### 16.2 Proposal Lifecycle with Guards, Temporal, and Roles

```javascript
await community.addFlow("Proposal", JSON.stringify({
  name: "Proposal",
  namespace: "flow://Proposal/",
  appliesTo: "gov://Proposal",
  initialState: "draft",
  states: [
    { name: "draft" },
    { name: "comment" },
    { name: "voting" },
    { name: "ratified", isTerminal: true },
    { name: "rejected", isTerminal: true }
  ],
  transitions: [
    {
      name: "open-comment",
      fromState: "draft",
      toState: "comment",
      guard: "ASK WHERE { $this <gov://title> ?t . $this <gov://body> ?b . FILTER(STRLEN(STR(?t)) > 0 && STRLEN(STR(?b)) > 0) }",
      guardDescription: "Title and body must be non-empty",
      role: "propose"
    },
    {
      name: "open-voting",
      fromState: "comment",
      toState: "voting",
      temporal: { minDelay: "P7D" },
      role: "moderate"
    },
    {
      name: "ratify",
      fromState: "voting",
      toState: "ratified",
      guard: "ASK WHERE { $this <gov://vote_count> ?v . $this <gov://quorum> ?q . FILTER(?v >= ?q) }",
      guardDescription: "Quorum must be reached",
      temporal: { minDelay: "PT48H" },
      role: "ratify"
    },
    {
      name: "reject",
      fromState: "voting",
      toState: "rejected",
      temporal: { maxDelay: "P30D", onDeadline: "auto-transition" },
      role: "ratify"
    }
  ]
}));
```

### 16.3 Firing a Transition with Feedback

```javascript
const result = await community.executeFlowTransition("Proposal", "proposal:42", "ratify");

if (result.success) {
  console.log("Now in state:", result.newState);
} else {
  console.warn("Cannot ratify:", result.reason);
  if (result.guardDescription) {
    console.warn("Guard says:", result.guardDescription);
  }
  if (result.secondsUntilAllowed) {
    console.warn(`Try again in ${result.secondsUntilAllowed}s`);
  }
}
```

### 16.4 UI Adaptation via availableTransitions

```javascript
const available = await community.availableTransitions("Proposal", "proposal:42");
for (const t of available) {
  ui.addButton(t, () => community.executeFlowTransition("Proposal", "proposal:42", t));
}
```

### 16.5 Composite Flow (Proposal → VotingPeriod)

```javascript
await community.addFlow("VotingPeriod", JSON.stringify({
  name: "VotingPeriod",
  namespace: "flow://VotingPeriod/",
  appliesTo: "gov://Proposal",
  initialState: "active",
  states: [
    { name: "active" },
    { name: "tallied", isTerminal: true }
  ],
  transitions: [
    {
      name: "tally",
      fromState: "active",
      toState: "tallied",
      temporal: { minDelay: "PT48H", onDeadline: "auto-transition" },
      actions: [
        { type: "flow://actions/setSingleTarget", source: "this", predicate: "flow://completed", target: "VotingPeriod" }
      ]
    }
  ]
}));

// Now the Proposal flow's open-voting transition can trigger VotingPeriod and
// the ratify guard can check $this flow://completed <VotingPeriod>.
```

---

## 17. References

### 17.1 Normative References

<dl>
<dt>[RFC2119]</dt>
<dd>Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.</dd>

<dt>[RFC8174]</dt>
<dd>Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.</dd>

<dt>[ISO-8601]</dt>
<dd>ISO 8601-1:2019, Date and time — Representations for information interchange.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="./02_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>.</dd>

<dt>[CAPABILITY-FRAMEWORK]</dt>
<dd><a href="./03_graph-capability-framework.md">Graph Capability Framework</a>.</dd>

<dt>[CONTEXT-SYNC]</dt>
<dd><a href="./04_context-sync-protocol.md">Context Synchronisation Protocol</a>.</dd>

<dt>[SHAPE-VALIDATION]</dt>
<dd><a href="./06_dynamic-graph-shape-validation.md">Dynamic Graph Shape Validation</a>.</dd>
</dl>

### 17.2 Informative References

<dl>
<dt>[SPARQL12-QUERY]</dt>
<dd><a href="https://www.w3.org/TR/sparql12-query/">SPARQL 1.2 Query Language</a>. W3C Working Draft.</dd>

<dt>[CONSTRAINT-VOCABULARY]</dt>
<dd><a href="./07_governance-constraint-vocabulary.md">Governance Constraint Vocabulary</a>.</dd>

<dt>[DEFAULT-SYNC-MODULE]</dt>
<dd><a href="./08_default-sync-module.md">Default Sync Module</a>.</dd>

<dt>[DECENTRALISED-IDENTITY]</dt>
<dd><a href="./01_decentralised-identity-web-platform.md">Decentralised Identity Integration for the Web Platform</a>.</dd>
</dl>
