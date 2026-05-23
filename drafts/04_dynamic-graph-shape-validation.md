# Dynamic Graph Shape Validation

**W3C Draft Community Group Report**

**Latest published version:** This document
**Editor:** [TBD]

---

## Abstract

This specification defines an extension to SHACL (Shapes Constraint Language) [[SHACL]] that adds **action semantics** — constructors, property setters, and collection operations — enabling declarative CRUD over RDF graphs. Shapes register into a **context** (a named graph identified by a `did:graph:...` DID — see [[PERSONAL-LINKED-DATA-GRAPHS]]) and define both the validation constraints and the CRUD operations for a class of graph entities. Shapes are stored as triples inside the context they describe, so contexts are self-describing and shapes travel with their data through snapshot transfer (see [[PERSONAL-LINKED-DATA-GRAPHS]] §5). Shapes registered on a parent context are visible to child contexts that participate in it via [[GROUP-IDENTITY]] participation links.

---

## Status of This Document

This document is a draft Community Group Report. It has no official W3C standing and is subject to change.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Shape Definition Format](#4-shape-definition-format)
5. [API](#5-api)
6. [Shape Storage Convention](#6-shape-storage-convention)
7. [Shape Inheritance Across Contexts](#7-shape-inheritance-across-contexts)
8. [Relationship to SHACL](#8-relationship-to-shacl)
9. [Relationship to Flows](#9-relationship-to-flows)
10. [Security Considerations](#10-security-considerations)
11. [Privacy Considerations](#11-privacy-considerations)
12. [Examples](#12-examples)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 Motivation

SHACL [[SHACL]] excels at validation — "does this data conform to this shape?" — but does not address the complement: "how do I create data that conforms to this shape?" Applications need to **create** instances with correct structure, **read** properties in a type-safe manner, **update** scalar and collection properties, and **delete** values.

Today each application implements its own CRUD logic over RDF triples, duplicating effort and producing incompatible data access patterns. This specification defines **action semantics** for SHACL shapes: constructors that create well-formed instances, property setters that maintain shape constraints, and collection operations that manage multi-valued properties.

### 1.2 Shapes Are Context-Local Self-Description

Shapes register *into a specific context* and are stored as triples inside that context. This gives two important properties:

- **Self-describing contexts.** Mounting a context (via `mountSnapshot()`) brings its shapes along. A new agent encountering a context can inspect its shapes, understand its constraints, and participate meaningfully — the description of what the context *is* travels with it.
- **Cross-context inheritance.** A child context that declares `context://participates_in <parent>` inherits the parent's shapes. Child contexts MAY add new shapes or extend existing ones, but MUST NOT relax constraints below what the parent declares. See [§7](#7-shape-inheritance-across-contexts).

### 1.3 Use Cases

- **Auto-generated forms.** Given a shape definition, an application can automatically generate a creation form with the correct fields, types, and cardinality.
- **Agent tools from schemas.** Autonomous agents can discover available shapes in a context and use them as typed tools — creating instances, querying data, and updating properties without hardcoded knowledge of the data model.
- **Portable data models.** Shape definitions travel with the context. Any application that understands this specification can interact with the data, regardless of which application created it.
- **No-code application definitions.** Shapes define the data model; applications define the views. New data types can be introduced by adding shapes — no code deployment required.

### 1.4 Scope

This specification defines:

- A JSON format for shape definitions with action semantics.
- A web API for registering, querying, and executing shapes within a context.
- Conventions for storing shapes as triples in the context they describe.
- Shape inheritance across nested contexts via `context://participates_in`.
- The relationship between this specification and standard SHACL validation.
- The relationship between this specification and [[GRAPH-FLOWS]].

This specification does NOT define a replacement for SHACL — standard SHACL validation remains applicable.

---

## 2. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in [[RFC2119]] and [[RFC8174]].

A **conforming implementation** MUST support all normative requirements when processing shape definitions and executing shape actions.

---

## 3. Terminology

<dl>
<dt><dfn>Shape</dfn></dt>
<dd>A named definition comprising a target class, property definitions, and constructor actions. Defines both validation constraints and CRUD operations for a class of entities.</dd>

<dt><dfn>Context</dfn></dt>
<dd>A named graph identified by a <code>did:graph:...</code> DID in which shapes are registered. See [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3.</dd>

<dt><dfn>ShapeInstance</dfn></dt>
<dd>A graph entity (identified by a URI) that conforms to a shape. Created by executing a shape's constructor.</dd>

<dt><dfn>Constructor</dfn></dt>
<dd>An ordered list of triple operations (actions) that create a well-formed ShapeInstance.</dd>

<dt><dfn>PropertySetter</dfn></dt>
<dd>A generated operation that modifies a single property of a ShapeInstance while maintaining shape constraints.</dd>

<dt><dfn>Collection</dfn></dt>
<dd>A multi-valued property (<code>maxCount &gt; 1</code> or unbounded) that supports add and remove operations.</dd>

<dt><dfn>TargetClass</dfn></dt>
<dd>A URI identifying the class of entities that a shape describes. Analogous to <code>sh:targetClass</code> in SHACL.</dd>

<dt><dfn>Action Namespace</dfn></dt>
<dd>The URI namespace <code>shape://actions/</code> under which constructor action types are defined.</dd>

<dt><dfn>Inherited Shape</dfn></dt>
<dd>A shape defined in a parent context (a context that the current context declares <code>context://participates_in</code> against) which is visible inside the child context.</dd>
</dl>

---

## 4. Shape Definition Format

### 4.1 Base Shape Structure

```json
{
  "targetClass": "<URI>",
  "properties": [ ... ],
  "constructor": [ ... ],
  "extends": "<parent shape URI>"
}
```

- **targetClass** (REQUIRED): A URI identifying the RDF class this shape describes.
- **properties** (REQUIRED): An array of property definitions ([§4.2](#42-property-definitions)).
- **constructor** (REQUIRED): An ordered array of constructor actions ([§4.3](#43-constructor-actions)).
- **extends** (OPTIONAL): A URI of a parent shape this shape extends. The child inherits the parent's properties and constructor; the child's properties and constructor are appended/overlaid per [§4.6](#46-shape-extension).

### 4.2 Property Definitions

```json
{
  "path": "<predicate URI>",
  "name": "<human-readable name>",
  "datatype": "<XSD datatype URI or 'URI'>",
  "minCount": 0,
  "maxCount": 1,
  "writable": true,
  "readOnly": false,
  "resolveProtocol": "<content protocol URI>",
  "getter": "<custom query expression>"
}
```

<dl>
<dt><code>path</code> (REQUIRED)</dt>
<dd>The predicate URI used in triples for this property.</dd>

<dt><code>name</code> (REQUIRED)</dt>
<dd>Short human-readable identifier. MUST be unique within the shape. MUST match <code>[a-zA-Z_][a-zA-Z0-9_]*</code>.</dd>

<dt><code>datatype</code> (OPTIONAL)</dt>
<dd>Expected datatype. MUST be an XSD URI or <code>"URI"</code>. If omitted, no type checking is performed.</dd>

<dt><code>minCount</code> (OPTIONAL, default: 0)</dt>
<dd>Minimum number of values. Corresponds to <code>sh:minCount</code> in SHACL.</dd>

<dt><code>maxCount</code> (OPTIONAL)</dt>
<dd>Maximum number of values. If omitted, unbounded. <code>maxCount = 1</code> means scalar.</dd>

<dt><code>writable</code> (OPTIONAL, default: true)</dt>
<dd>Whether the property can be modified after construction.</dd>

<dt><code>readOnly</code> (OPTIONAL, default: false)</dt>
<dd>If <code>true</code>, value is computed via <code>getter</code> and cannot be set. Implies <code>writable: false</code>.</dd>

<dt><code>resolveProtocol</code> (OPTIONAL)</dt>
<dd>A content protocol URI used to resolve the property value from a content-addressed store.</dd>

<dt><code>getter</code> (OPTIONAL)</dt>
<dd>A SPARQL expression that computes the property value from the context.</dd>
</dl>

Property setter generation rules:

- `maxCount = 1` AND `writable: true` → `set_{name}` setter is generated.
- `maxCount` absent or > 1 AND `writable: true` → `add_{name}` and `remove_{name}` are generated.
- `writable: false` OR `readOnly: true` → no setter generated.

### 4.3 Constructor Actions

A constructor is an ordered array of action objects. Each action is one of three forms (all under the `shape://actions/` namespace):

#### 4.3.1 addLink

```json
{
  "action": "shape://actions/addLink",
  "subject": "this",
  "predicate": "<predicate URI>",
  "object": "<property name or literal>"
}
```

Adds a triple `(subject, predicate, object)`. Used for collection-like properties.

#### 4.3.2 setSingleTarget

```json
{
  "action": "shape://actions/setSingleTarget",
  "subject": "this",
  "predicate": "<predicate URI>",
  "object": "<property name or literal>"
}
```

Sets exactly one triple, removing any existing triple with the same subject and predicate. Used for scalar properties.

#### 4.3.3 addCollectionTarget

```json
{
  "action": "shape://actions/addCollectionTarget",
  "subject": "this",
  "predicate": "<predicate URI>",
  "object": "<property name or literal>"
}
```

Adds a value to a collection. Similar to `addLink` but with explicit collection semantics — implementations MAY use an intermediate collection node.

For all actions:

- **action**: MUST be a URI under `shape://actions/`.
- **subject**: MUST be `"this"` — the new ShapeInstance's URI.
- **predicate**: MUST be a valid predicate URI.
- **object**: If the value matches a property `name`, it is resolved from initial values supplied at creation. Otherwise it is treated as a literal.

### 4.4 Property Setters

Setters are automatically generated from property definitions; not explicitly listed in shape JSON.

For a scalar property `title`:

- `set_title(value)` → removes any existing `(instance, path, *)` and adds `(instance, path, value)`.

For a collection property `tags`:

- `add_tags(value)` → adds `(instance, path, value)`.
- `remove_tags(value)` → removes `(instance, path, value)`.

Setters MUST validate values against the property's `datatype` before modifying the context. If validation fails, the setter MUST reject with `TypeError`.

### 4.5 Type Discriminator

Each shape SHOULD include a **flag** property that serves as the type discriminator for instance discovery.

```json
{
  "path": "rdf://type",
  "name": "type_flag",
  "datatype": "URI",
  "minCount": 1,
  "maxCount": 1,
  "writable": false
}
```

The constructor MUST set this flag:

```json
{
  "action": "shape://actions/setSingleTarget",
  "subject": "this",
  "predicate": "rdf://type",
  "object": "<targetClass URI>"
}
```

`getShapeInstances` uses this flag to discover all instances of a shape.

### 4.6 Shape Extension

When a shape defines `extends: "<parent>"`:

- The child inherits all properties from the parent.
- The child MAY add new properties.
- The child MAY override a parent property *only* by narrowing it: increasing `minCount`, decreasing `maxCount`, narrowing `datatype`, or setting `writable: false`. Loosening any constraint MUST cause `addShape()` to reject with `"ConstraintError"`.
- The child's constructor is executed *after* the parent's constructor.

This is the in-shape extension mechanism. Cross-context inheritance via `context://participates_in` is described in [§7](#7-shape-inheritance-across-contexts).

---

## 5. API

### 5.1 Context Methods

All shape operations live on the `Context` interface (defined in [[PERSONAL-LINKED-DATA-GRAPHS]] §3.3). Shape modification is governed: the caller MUST hold an `updateSHACL` capability for the target context ([[GRAPH-GOVERNANCE]]).

```webidl
partial interface Context {
  // Registration
  [NewObject] Promise<undefined> addShape(DOMString name, DOMString shapeJson);
  [NewObject] Promise<undefined> removeShape(DOMString name);
  [NewObject] Promise<sequence<ShapeInfo>> getShapes(optional GetShapesOptions options);

  // Instance lifecycle
  [NewObject] Promise<USVString> createShapeInstance(
    DOMString shapeName,
    USVString address,
    optional record<DOMString, any> initialValues = {}
  );
  [NewObject] Promise<sequence<USVString>> getShapeInstances(DOMString shapeName);
  [NewObject] Promise<record<DOMString, any>> getShapeInstanceData(
    DOMString shapeName,
    USVString address
  );

  // Property/collection operations
  [NewObject] Promise<undefined> setShapeProperty(
    DOMString shapeName,
    USVString address,
    DOMString property,
    any value
  );
  [NewObject] Promise<undefined> addToShapeCollection(
    DOMString shapeName,
    USVString address,
    DOMString collection,
    any value
  );
  [NewObject] Promise<undefined> removeFromShapeCollection(
    DOMString shapeName,
    USVString address,
    DOMString collection,
    any value
  );
};

dictionary GetShapesOptions {
  boolean includeInherited = true;   // include shapes inherited from parent contexts
};

dictionary ShapeInfo {
  DOMString name;
  USVString targetClass;
  USVString definitionAddress;
  USVString sourceContextDid;       // the context where this shape is registered
                                     // (= this context for local shapes, parent for inherited)
  sequence<PropertyInfo> properties;
};

dictionary PropertyInfo {
  DOMString name;
  USVString path;
  USVString? datatype;
  unsigned long minCount;
  unsigned long? maxCount;
  boolean writable;
  boolean readOnly;
};
```

### 5.2 addShape

Registers a shape definition into this context.

1. MUST verify the caller holds an `updateSHACL` capability for this context. If not, reject with `"NotAllowedError"`.
2. MUST validate the shape JSON conforms to [§4](#4-shape-definition-format). If malformed, reject with `"SyntaxError"`.
3. If `extends` is present, MUST resolve the parent shape and apply the extension rules from [§4.6](#46-shape-extension). If extension is invalid, reject with `"ConstraintError"`.
4. MUST store the shape as triples in this context (see [§6](#6-shape-storage-convention)).

If a shape with the same name already exists in this context, reject with `"ConstraintError"`.

### 5.3 removeShape

Removes a shape registration. Requires `updateSHACL`. Existing instances are NOT deleted.

### 5.4 getShapes

Returns shapes registered in this context. When `includeInherited` is true (default), also returns shapes inherited from parent contexts via [§7](#7-shape-inheritance-across-contexts).

### 5.5 createShapeInstance

Creates a new instance by executing the shape's constructor actions. May reference local or inherited shapes.

1. Resolve the shape (local or inherited).
2. If `address` is empty, MAY generate a content-addressed identifier.
3. Validate that all required properties (`minCount ≥ 1`) without defaults are present in `initialValues`. If not, reject with `TypeError`.
4. Each constructor action becomes a triple write to *this* context (not the source context, if inherited). Writes are subject to this context's governance.
5. Return the instance's address.

### 5.6 getShapeInstances / getShapeInstanceData

`getShapeInstances` returns addresses of all entities in this context whose type discriminator matches the shape's `targetClass`. `getShapeInstanceData` returns the full property dictionary for an instance.

### 5.7 setShapeProperty / addToShapeCollection / removeFromShapeCollection

Standard CRUD operations. Each is a triple write to this context and is subject to governance.

---

## 6. Shape Storage Convention

### 6.1 Self-Describing Contexts

Shapes are stored as triples *inside the context they govern*. A context can be mounted, snapshotted, and transferred via [[PERSONAL-LINKED-DATA-GRAPHS]] §5; its shapes travel with it. No separate shape registry or schema service is required.

### 6.2 Well-Known Predicate

Shapes are linked to the context via:

```
<context-did> -[shape://has_shape]→ <shape-definition-address>
```

The predicate `shape://has_shape` is reserved for this purpose.

### 6.3 Content Addressing

Shape definitions MUST be stored as content-addressed entities. The address is the SHA-256 of the shape JSON's canonical form (JCS [[JCS]]).

This makes shape definitions immutable. Modifying a shape produces a new content-address; the `shape://has_shape` link is updated to point at the new address.

### 6.4 Stored Triple Shape

```turtle
# Inside the context's named graph:
<did:graph:context>  shape://has_shape   <sha256:abc...> .

<sha256:abc...>  rdf://type           shape://Shape ;
                 shape://name          "Task" ;
                 shape://targetClass   schema://Action ;
                 shape://definition    "<JCS-canonicalised JSON>" .
```

### 6.5 Composability

Shape definitions are content-addressed and immutable, so the same shape has the same address in any context. To import a shape:

1. Add the shape definition's triples (with the existing content-address) to the target context.
2. Add the `shape://has_shape` link from the target context's DID.

Because the address is identical, an importer can detect that the same shape is already known.

---

## 7. Shape Inheritance Across Contexts

This section is normative.

### 7.1 Inheritance via Context Participation

Contexts can be nested via `context://participates_in` links declared from below (see [[GROUP-IDENTITY]]). A child context that participates in a parent inherits the parent's shapes, with the same extension constraints as in-shape `extends`:

- The child MAY use the parent's shapes as if they were local.
- The child MAY register a new shape with the same name *only if* it satisfies [§4.6](#46-shape-extension)'s narrowing rule — it must be a strict refinement of the parent's shape.
- The child MAY register shapes the parent does not know about.

### 7.2 Resolution

When a method (such as `createShapeInstance` or `addShape`) references a shape by name, resolution proceeds:

1. Look up the name in the current context's local shapes.
2. If not found, walk `context://participates_in` links upward and look in each ancestor context, depth-first.
3. The first match wins.
4. If `extends` is declared on a child shape, the parent shape MUST resolve via the same mechanism (typically to an inherited shape).

### 7.3 Shape Conflicts

If the same shape name is registered locally in a child and also visible from a parent, the child's registration applies *within the child*. Local-overrides-inherited is consistent with the participates-from-below semantics.

### 7.4 Cross-Context Instance Discovery

`getShapeInstances` on a parent context returns instances in the parent's context. `getShapeInstances` on a child context returns instances in the child's context. To enumerate instances across nested contexts, the application MUST iterate explicitly:

```javascript
const everywhere = [];
for (const ctx of [parent, ...childrenOfParent]) {
  everywhere.push(...await ctx.getShapeInstances("Task"));
}
```

This is intentional: each context is sovereign over its own data, and cross-context enumeration is an explicit operation, not an implicit one.

---

## 8. Relationship to SHACL

### 8.1 Extension, Not Replacement

This specification extends SHACL with action semantics. It does NOT replace standard SHACL validation.

A shape definition can be mechanically translated to a SHACL NodeShape for validation purposes. `targetClass`, property `path`, `datatype`, `minCount`, `maxCount` map directly.

### 8.2 Validation Compatibility

Standard SHACL validation SHOULD still apply to graphs using this specification's shapes. An instance created via `createShapeInstance` SHOULD validate against the equivalent SHACL NodeShape.

Implementations SHOULD provide a method to export shapes as SHACL NodeShapes for interoperability with standard SHACL tools.

### 8.3 Additive Semantics

The action semantics are additive to SHACL:

- Standard SHACL tools (which ignore the action semantics) can validate.
- Implementations of this specification use the action semantics for CRUD.

### 8.4 The SHACL/ZCAP Bridge

[[GRAPH-GOVERNANCE]] defines a `ShapeCaveat` that constrains a ZCAP to writes conforming to a specific shape. The caveat references a shape by URI; shapes define structure; the runtime evaluates them at write time. The two specifications compose: ZCAP says "this agent can write Messages here", shape says "a Message has these fields."

---

## 9. Relationship to Flows

Shapes describe **structure** — what data must look like. [[GRAPH-FLOWS]] describes **process** — how data must evolve over time. The two compose:

- A shape says: "A Proposal has a body, an author, and a status."
- A flow says: "A Proposal's status transitions through draft → comment → voting → ratified, with guards and temporal constraints at each step."

Flow definitions reference shapes by `targetClass`; shape constructors create instances that flows then govern. Both are stored as triples in the context, and both travel with the context through snapshot transfer.

---

## 10. Security Considerations

### 10.1 Shapes Are Data, Not Code

Shape definitions are declarative; constructor actions are limited to triple operations. Implementations MUST NOT interpret any part of a shape definition as executable code.

### 10.2 Getter Expressions

The `getter` field accepts SPARQL expressions. Implementations MUST treat them as read-only against the context. They MUST NOT modify the context, access resources outside the context, or execute arbitrary code. Implementations SHOULD use a restricted SPARQL subset (SELECT only) for getters.

### 10.3 Input Validation

All values provided to shape operations MUST be validated against the property's declared datatype before being stored.

### 10.4 Authorisation

Shape registration, modification, and removal are governance-controlled operations. The runtime MUST verify an `updateSHACL` capability for the target context before processing them ([[GRAPH-GOVERNANCE]]).

### 10.5 Inheritance Tampering

Because inheritance walks `context://participates_in` links, an adversarial child context could declare participation in any parent to gain access to inherited shapes. Implementations MUST verify the parent context's governance accepts the child's participation — typically by a corresponding `context://accepts_participation` link from the parent, signed by a `capabilityDelegation` delegate of the parent. Unaccepted participation links MUST be ignored for inheritance purposes.

---

## 11. Privacy Considerations

### 11.1 Ontology Disclosure

Shapes stored in a context are visible to anyone with read access to the context. They reveal the ontology of the application — an observer can infer the types of data stored without seeing instance data.

### 11.2 Shape Names

Shape names are human-readable strings that may convey semantic meaning (e.g., "MedicalRecord"). Applications SHOULD consider the privacy implications of shape names in shared contexts.

### 11.3 Instance Enumeration

`getShapeInstances` returns all instances in a context for a given shape. Applications that require instance-level access control SHOULD implement it at the governance layer.

### 11.4 Inherited Shape Disclosure

Inheriting a parent's shapes discloses that the child participates in the parent. Communities that need participation-set privacy SHOULD avoid using cross-context inheritance for sensitive shapes.

---

## 12. Examples

*This section is non-normative.*

### 12.1 Defining a Task Shape in a Context

```javascript
const me = await navigator.graph.create("My Workspace");
const work = await me.createContext({ displayName: "Work Projects" });

await work.addShape("Task", JSON.stringify({
  targetClass: "schema://Action",
  properties: [
    { path: "rdf://type",            name: "type_flag",   datatype: "URI",         minCount: 1, maxCount: 1, writable: false },
    { path: "schema://name",         name: "title",       datatype: "xsd:string",  minCount: 1, maxCount: 1 },
    { path: "schema://description",  name: "description", datatype: "xsd:string",  minCount: 0, maxCount: 1 },
    { path: "schema://actionStatus", name: "status",      datatype: "xsd:string",  minCount: 1, maxCount: 1 },
    { path: "schema://agent",        name: "assignees",   datatype: "URI",         minCount: 0 }
  ],
  constructor: [
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "rdf://type",            target: "schema://Action" },
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "schema://name",         target: "title" },
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "schema://description",  target: "description" },
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "schema://actionStatus", target: "status" }
  ]
}));
```

### 12.2 Creating and Querying Task Instances

```javascript
const task1 = await work.createShapeInstance("Task", "task:001", {
  title: "Write specification",
  description: "Draft the Dynamic Graph Shape Validation spec",
  status: "InProgress"
});

const task2 = await work.createShapeInstance("Task", "task:002", {
  title: "Review examples",
  status: "Pending"
});

const all = await work.getShapeInstances("Task");
// → ["task:001", "task:002"]

const t1 = await work.getShapeInstanceData("Task", "task:001");
// → { type_flag: "schema://Action", title: "Write specification", ... }
```

### 12.3 Updating Properties and Collections

```javascript
await work.setShapeProperty("Task", "task:001", "status", "Complete");
await work.addToShapeCollection("Task", "task:001", "assignees", "did:key:z6Mk...");
await work.removeFromShapeCollection("Task", "task:001", "assignees", "did:key:z6Mn...");
```

### 12.4 Discovering Shapes (Local + Inherited)

```javascript
const local = await work.getShapes({ includeInherited: false });

const all = await work.getShapes();
for (const s of all) {
  console.log(`${s.name} (from ${s.sourceContextDid})`);
}
```

### 12.5 Shape Inheritance Across Contexts

```javascript
// Parent context defines a base "Item" shape.
const community = await me.getContext("did:graph:community-root");
await community.addShape("Item", JSON.stringify({
  targetClass: "schema://Thing",
  properties: [
    { path: "schema://name", name: "title", datatype: "xsd:string", minCount: 1, maxCount: 1 }
  ],
  constructor: [
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "rdf://type", target: "schema://Thing" },
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "schema://name", target: "title" }
  ]
}));

// Child context participates in the community and inherits "Item".
const channel = await me.createContext({
  displayName: "#general",
  participatesIn: community.did
});

const item = await channel.createShapeInstance("Item", "item:1", { title: "Welcome" });
```

### 12.6 Shape Extension by Narrowing

```javascript
await channel.addShape("FormalItem", JSON.stringify({
  extends: "Item",                              // inherited from community
  targetClass: "schema://Thing",
  properties: [
    // narrows the parent: title required and >= 5 chars (enforced via custom validator)
    { path: "schema://name", name: "title", datatype: "xsd:string", minCount: 1, maxCount: 1 },
    // adds a new property
    { path: "schema://identifier", name: "id", datatype: "xsd:string", minCount: 1, maxCount: 1 }
  ],
  constructor: [
    // parent constructor runs first; child constructor appends
    { action: "shape://actions/setSingleTarget", source: "this", predicate: "schema://identifier", target: "id" }
  ]
}));
```

---

## 13. References

### 13.1 Normative References

<dl>
<dt>[RFC2119]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc2119">Key words for use in RFCs to Indicate Requirement Levels</a>. IETF RFC 2119.</dd>

<dt>[RFC8174]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc8174">Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</a>. IETF RFC 8174.</dd>

<dt>[SHACL]</dt>
<dd><a href="https://www.w3.org/TR/shacl/">Shapes Constraint Language (SHACL)</a>. W3C Recommendation.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="./01_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>.</dd>
</dl>

### 13.2 Informative References

<dl>
<dt>[SPARQL12-QUERY]</dt>
<dd><a href="https://www.w3.org/TR/sparql12-query/">SPARQL 1.2 Query Language</a>. W3C Working Draft.</dd>

<dt>[JCS]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc8785">JSON Canonicalization Scheme (JCS)</a>. IETF RFC 8785.</dd>

<dt>[JSON-LD]</dt>
<dd><a href="https://www.w3.org/TR/json-ld11/">JSON-LD 1.1</a>. W3C Recommendation.</dd>

<dt>[GRAPH-GOVERNANCE]</dt>
<dd><a href="./05_graph-governance.md">Graph Governance</a>.</dd>

<dt>[GRAPH-FLOWS]</dt>
<dd><a href="./07_graph-flows.md">Graph Flows</a>.</dd>

<dt>[GROUP-IDENTITY]</dt>
<dd><a href="./06_group-identity.md">Decentralised Group Identity</a>.</dd>
</dl>
