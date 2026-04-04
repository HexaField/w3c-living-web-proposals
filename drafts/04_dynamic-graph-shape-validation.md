# Dynamic Graph Shape Validation

**W3C Draft Community Group Report**

**Latest published version:** This document  
**Editor:** [Editor Name]  
**This version:** Draft, 4 April 2026

---

## Abstract

This specification defines an extension to SHACL (Shapes Constraint Language) [[SHACL]] that adds action semantics — constructors, property setters, and collection operations — enabling declarative CRUD over RDF graphs. Shapes can be dynamically registered, queried, and used to create structured data instances within personal or shared linked data graphs. This allows applications to define portable, self-describing data models that drive both validation and data manipulation.

---

## Status of This Document

This document is a draft Community Group Report produced by the [Personal Linked Data Community Group](). It has not been reviewed or endorsed by the W3C Membership and is not a W3C Standard. This document is subject to change.

Comments on this specification are welcome. Please file issues on the [GitHub repository]().

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Shape Definition Format](#4-shape-definition-format)
5. [API](#5-api)
6. [Shape Storage Convention](#6-shape-storage-convention)
7. [Relationship to SHACL](#7-relationship-to-shacl)
8. [Security Considerations](#8-security-considerations)
9. [Privacy Considerations](#9-privacy-considerations)
10. [Examples](#10-examples)
11. [References](#11-references)

---

## 1. Introduction

### 1.1 Motivation

The Shapes Constraint Language (SHACL) [[SHACL]] is a W3C Recommendation for validating RDF graphs against a set of conditions (shapes). SHACL excels at answering the question "does this data conform to this shape?" — but it does not address the question "how do I create data that conforms to this shape?"

Applications working with RDF graphs need more than validation. They need to:

- **Create** new instances of a shape with correct structure
- **Read** property values from instances in a type-safe manner
- **Update** scalar properties and collection properties
- **Delete** or remove values from collections

Today, each application implements its own CRUD logic over RDF triples, duplicating effort and producing incompatible data access patterns. This specification addresses this gap by defining **action semantics** for SHACL shapes: constructors that create well-formed instances, property setters that maintain shape constraints, and collection operations that manage multi-valued properties.

### 1.2 Use Cases

- **Auto-generated forms:** Given a shape definition, a user agent or application can automatically generate a creation form with the correct fields, types, and cardinality constraints.
- **Agent tools from schemas:** Autonomous agents can discover available shapes in a graph and use them as typed tools — creating instances, querying data, and updating properties without hardcoded knowledge of the data model.
- **Portable data models:** Shape definitions travel with the graph. Any application that understands this specification can interact with the data, regardless of which application created it.
- **No-code application definitions:** Shapes define the data model; applications define the views. New data types can be introduced by adding shapes — no code deployment required.

### 1.3 Scope

This specification defines:

- A JSON format for shape definitions with action semantics
- A Web API for registering, querying, and executing shapes within graphs
- Conventions for storing shapes as graph data
- The relationship between this specification and standard SHACL validation

This specification does NOT define:

- A replacement for SHACL — standard SHACL validation remains applicable
- A query language — SPARQL [[SPARQL]] or other query mechanisms are used for data retrieval
- A user interface rendering model — how shapes are presented to users is application-defined

---

## 2. Conformance

As well as sections marked as non-normative, all authoring guidelines, diagrams, examples, and notes in this specification are non-normative. Everything else in this specification is normative.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [[RFC2119]].

A **conforming implementation** MUST support all normative requirements of this specification when processing shape definitions and executing shape actions.

---

## 3. Terminology

<dl>
<dt><dfn>Shape</dfn></dt>
<dd>A named definition comprising a target class, property definitions, and constructor actions. A shape defines both the validation constraints and the CRUD operations for a class of graph entities.</dd>

<dt><dfn>ShapeInstance</dfn></dt>
<dd>A graph entity (identified by an address/URI) that conforms to a shape. Created by executing a shape's constructor.</dd>

<dt><dfn>Constructor</dfn></dt>
<dd>An ordered list of triple operations (actions) that, when executed, create a well-formed ShapeInstance in the graph.</dd>

<dt><dfn>PropertySetter</dfn></dt>
<dd>A generated operation that modifies a single property of a ShapeInstance while maintaining shape constraints.</dd>

<dt><dfn>Collection</dfn></dt>
<dd>A multi-valued property (maxCount > 1 or unbounded) that supports add and remove operations.</dd>

<dt><dfn>TargetClass</dfn></dt>
<dd>A URI identifying the class of entities that a shape describes. Analogous to <code>sh:targetClass</code> in SHACL.</dd>
</dl>

---

## 4. Shape Definition Format

### 4.1 Base Shape Structure

A shape definition is a JSON object with the following structure:

```json
{
  "targetClass": "<URI>",
  "properties": [ ... ],
  "constructor": [ ... ]
}
```

- **targetClass** (REQUIRED): A URI identifying the RDF class this shape describes.
- **properties** (REQUIRED): An array of property definitions (see [4.2](#42-property-definitions)).
- **constructor** (REQUIRED): An ordered array of constructor actions (see [4.3](#43-constructor-actions)).

### 4.2 Property Definitions

Each property definition is a JSON object describing a property of the shape:

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
<dd>A short, human-readable identifier for the property. MUST be unique within the shape. MUST match the pattern <code>[a-zA-Z_][a-zA-Z0-9_]*</code>.</dd>

<dt><code>datatype</code> (OPTIONAL)</dt>
<dd>The expected datatype of the property value. MUST be an XSD datatype URI (e.g., <code>xsd:string</code>, <code>xsd:dateTime</code>, <code>xsd:integer</code>) or the string <code>"URI"</code> for object properties. If omitted, no type checking is performed.</dd>

<dt><code>minCount</code> (OPTIONAL, default: 0)</dt>
<dd>Minimum number of values. Corresponds to <code>sh:minCount</code> in SHACL.</dd>

<dt><code>maxCount</code> (OPTIONAL)</dt>
<dd>Maximum number of values. If omitted, the property is unbounded. If set to 1, the property is scalar. Corresponds to <code>sh:maxCount</code> in SHACL.</dd>

<dt><code>writable</code> (OPTIONAL, default: true)</dt>
<dd>Whether the property can be modified after construction. If <code>false</code>, no setter is generated.</dd>

<dt><code>readOnly</code> (OPTIONAL, default: false)</dt>
<dd>If <code>true</code>, the property value is computed (via <code>getter</code>) and cannot be set. Implies <code>writable: false</code>.</dd>

<dt><code>resolveProtocol</code> (OPTIONAL)</dt>
<dd>A content protocol URI used to resolve the property value from a content-addressed store. When present, the getter resolves the address to the content before returning the value.</dd>

<dt><code>getter</code> (OPTIONAL)</dt>
<dd>A SPARQL expression or query fragment that computes the property value from the graph. Used for derived or computed properties.</dd>
</dl>

Property setter generation rules:

- If `maxCount` is 1 and `writable` is `true`: a `set_{name}` setter is generated.
- If `maxCount` is absent or > 1 and `writable` is `true`: `add_{name}` and `remove_{name}` operations are generated.
- If `writable` is `false` or `readOnly` is `true`: no setter is generated.

### 4.3 Constructor Actions

A constructor is an ordered array of action objects. When a ShapeInstance is created, these actions are executed in order to insert the necessary triples into the graph.

Each action is one of:

#### addLink

```json
{
  "action": "addLink",
  "source": "this",
  "predicate": "<predicate URI>",
  "target": "<property name or literal>"
}
```

Adds a triple `(source, predicate, target)` to the graph. This action is used when a property may have multiple values (collection semantics).

#### setSingleTarget

```json
{
  "action": "setSingleTarget",
  "source": "this",
  "predicate": "<predicate URI>",
  "target": "<property name or literal>"
}
```

Sets exactly one triple `(source, predicate, target)`, removing any existing triple with the same source and predicate first. Used for scalar properties.

#### addCollectionTarget

```json
{
  "action": "addCollectionTarget",
  "source": "this",
  "predicate": "<predicate URI>",
  "target": "<property name or literal>"
}
```

Adds a value to a collection property. Similar to `addLink` but with explicit collection semantics — the implementation MAY use an intermediate collection node.

For all actions:

- **source**: MUST be `"this"`, referring to the address of the new ShapeInstance being created.
- **predicate**: MUST be a valid predicate URI.
- **target**: If the value matches a property `name`, it is resolved from the initial values provided at creation time. Otherwise, it is treated as a literal value.

### 4.4 Property Setters

Property setters are automatically generated from property definitions. They are not explicitly defined in the shape JSON — the implementation derives them.

For a scalar property (maxCount = 1) named `title`:

- `set_title(value)` → removes any existing triple `(instance, path, *)` and adds `(instance, path, value)`

For a collection property named `tags`:

- `add_tags(value)` → adds `(instance, path, value)`
- `remove_tags(value)` → removes `(instance, path, value)`

Setters MUST validate the new value against the property's datatype constraint before modifying the graph. If validation fails, the setter MUST reject with a `TypeError`.

### 4.5 Type Discriminator

Each shape SHOULD include a **flag** property — a property with a fixed predicate and value that serves as a type discriminator for identifying instances of the shape.

```json
{
  "path": "rdf:type",
  "name": "type_flag",
  "datatype": "URI",
  "minCount": 1,
  "maxCount": 1,
  "writable": false
}
```

The constructor MUST include an action that sets this flag:

```json
{
  "action": "setSingleTarget",
  "source": "this",
  "predicate": "rdf:type",
  "target": "<targetClass URI>"
}
```

The `getShapeInstances` method (see [Section 5.4](#54-getshapeinstances)) uses this flag to discover all instances of a shape in the graph.

[NOTE: The use of `rdf:type` as the default discriminator is conventional but not mandatory. Implementations MAY use alternative predicates if the shape definition specifies one. Feedback on whether to mandate `rdf:type` is welcome.]

---

## 5. API

### 5.1 addShape

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<undefined> addShape(
    DOMString name,
    DOMString shapeJson
  );
};
```

Registers a shape definition in the graph. The `name` MUST be unique within the graph. The `shapeJson` MUST be a valid JSON string conforming to [Section 4](#4-shape-definition-format).

If a shape with the same name already exists, the method MUST reject with a `ConstraintError` DOMException.

The shape definition is stored as a content-addressed entity in the graph (see [Section 6](#6-shape-storage-convention)).

### 5.2 getShapes

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<sequence<ShapeInfo>> getShapes();
};

dictionary ShapeInfo {
  DOMString name;
  USVString targetClass;
  USVString definitionAddress;
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

Returns all shapes registered in the graph.

### 5.3 createShapeInstance

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<USVString> createShapeInstance(
    DOMString shapeName,
    USVString address,
    optional record<DOMString, any> initialValues = {}
  );
};
```

Creates a new ShapeInstance by executing the shape's constructor actions.

The `address` parameter specifies the URI/address of the new instance. Implementations MAY generate a content-addressed identifier if `address` is empty.

The `initialValues` parameter provides values for properties referenced in constructor actions. If a required property (minCount ≥ 1) is missing from `initialValues` and has no default, the method MUST reject with a `TypeError`.

The method MUST execute constructor actions in order, resolving property name references against `initialValues`. On success, it returns the address of the created instance.

### 5.4 getShapeInstances

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<sequence<USVString>> getShapeInstances(
    DOMString shapeName
  );
};
```

Returns the addresses of all instances in the graph that match the shape's type discriminator (flag property).

### 5.5 getShapeInstanceData

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<record<DOMString, any>> getShapeInstanceData(
    DOMString shapeName,
    USVString address
  );
};
```

Returns all property values for a ShapeInstance as a dictionary mapping property names to values. Scalar properties return a single value; collection properties return an array.

Properties with a `resolveProtocol` SHOULD have their values resolved from the content-addressed store before returning.

Properties with a `getter` MUST have their values computed from the graph.

### 5.6 setShapeProperty

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<undefined> setShapeProperty(
    DOMString shapeName,
    USVString address,
    DOMString property,
    any value
  );
};
```

Sets a scalar property (maxCount = 1) on a ShapeInstance. Executes the generated `set_{property}` operation.

MUST reject with a `TypeError` if the property is not writable, if the value fails datatype validation, or if the property is a collection (maxCount ≠ 1).

### 5.7 addToShapeCollection

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<undefined> addToShapeCollection(
    DOMString shapeName,
    USVString address,
    DOMString collection,
    any value
  );
};
```

Adds a value to a collection property. MUST reject with a `TypeError` if the property is scalar (maxCount = 1), not writable, or the value fails datatype validation. MUST reject with a `ConstraintError` if adding the value would exceed `maxCount`.

### 5.8 removeFromShapeCollection

```webidl
[Exposed=Window,Worker]
partial interface PersonalGraph {
  [NewObject] Promise<undefined> removeFromShapeCollection(
    DOMString shapeName,
    USVString address,
    DOMString collection,
    any value
  );
};
```

Removes a value from a collection property. MUST reject with a `NotFoundError` if the value does not exist in the collection. MUST reject with a `ConstraintError` if removal would violate `minCount`.

---

## 6. Shape Storage Convention

### 6.1 Self-Describing Shapes

Shapes are stored as triples in the graph itself. This means the data model is self-describing — any application that can read the graph can discover the shapes that govern it.

### 6.2 Well-Known Predicate

Shapes are linked to the graph via a well-known predicate:

```
<graph-root> -[shacl://has_shape]→ <shape-definition-address>
```

The predicate `shacl://has_shape` is reserved for this purpose. Implementations MUST use this predicate when storing shape definitions.

### 6.3 Content Addressing

Shape definitions MUST be stored as content-addressed entities. The address of a shape definition is the cryptographic hash of its canonical JSON representation.

This ensures that shape definitions are **immutable** once stored. If a shape needs to be modified, a new version is created with a new address, and the `shacl://has_shape` link is updated.

[NOTE: The canonicalisation algorithm for shape JSON (e.g., JCS [[JCS]] or a custom canonical form) needs to be specified. Feedback on the preferred approach is welcome.]

### 6.4 Composability

Shapes MAY be imported from other graphs. To import a shape:

1. Retrieve the shape definition from the source graph (by its content address).
2. Store the shape definition in the target graph.
3. Add a `shacl://has_shape` link in the target graph.

Because shape definitions are content-addressed and immutable, the same shape definition has the same address in any graph. This enables shape reuse across applications and communities.

---

## 7. Relationship to SHACL

### 7.1 Extension, Not Replacement

This specification extends SHACL [[SHACL]] with action semantics. It does NOT replace standard SHACL validation.

A shape definition as defined in this specification can be mechanically translated to a SHACL NodeShape for validation purposes. The `targetClass`, property `path`, `datatype`, `minCount`, and `maxCount` fields map directly to their SHACL counterparts.

### 7.2 Validation Compatibility

Standard SHACL validation SHOULD still apply to graphs using this specification's shapes. An instance created via `createShapeInstance` SHOULD validate successfully against the equivalent SHACL NodeShape.

Implementations SHOULD provide a method to export shapes as SHACL NodeShapes for interoperability with standard SHACL tools.

### 7.3 Additive Semantics

The action semantics defined in this specification (constructors, setters, collection operations) are **additive** to SHACL. A shape can be:

- Validated by standard SHACL tools (which ignore the action semantics)
- Executed by implementations of this specification (which use the action semantics for CRUD)

This dual nature enables a migration path: existing SHACL-based systems can adopt action semantics incrementally.

---

## 8. Security Considerations

### 8.1 Shapes Are Data, Not Code

Shape definitions are declarative data structures, not executable code. Constructor actions are limited to triple operations:

- `addLink` — adds a triple
- `setSingleTarget` — sets a single triple (removing prior values)
- `addCollectionTarget` — adds to a collection

These operations MUST NOT trigger arbitrary code execution. Implementations MUST NOT interpret any part of a shape definition as executable code (e.g., JavaScript, WASM).

### 8.2 Getter Expressions

The `getter` field in property definitions accepts query expressions. Implementations MUST treat these as read-only queries against the graph. Getter expressions MUST NOT:

- Modify the graph
- Access resources outside the graph
- Execute arbitrary code

Implementations SHOULD use a restricted subset of SPARQL (e.g., SELECT queries only) for getter expressions.

### 8.3 Input Validation

All values provided to shape operations (constructors, setters, collection operations) MUST be validated against the property's declared datatype before being stored in the graph. This prevents injection of malformed data.

---

## 9. Privacy Considerations

### 9.1 Shape Visibility

Shapes stored in a graph are visible to anyone with read access to the graph. In shared graphs, this means all peers can see all shape definitions.

Shape definitions may reveal the ontology and data model of the application. This constitutes **ontology disclosure** — an observer can infer what types of data are stored without seeing instance data.

### 9.2 Shape Names

Shape names (the `name` parameter in `addShape`) are human-readable strings that may convey semantic meaning (e.g., "MedicalRecord", "FinancialTransaction"). Applications SHOULD consider the privacy implications of shape names in shared contexts.

### 9.3 Instance Enumeration

The `getShapeInstances` method returns all instances of a shape. In shared graphs, any peer can enumerate all instances of any registered shape. Applications that require instance-level access control SHOULD implement it at the governance layer, not the shape layer.

---

## 10. Examples

*This section is non-normative.*

### 10.1 Defining a Task Shape

```javascript
const taskShape = {
  targetClass: "https://schema.org/Action",
  properties: [
    {
      path: "rdf:type",
      name: "type_flag",
      datatype: "URI",
      minCount: 1,
      maxCount: 1,
      writable: false
    },
    {
      path: "schema:name",
      name: "title",
      datatype: "xsd:string",
      minCount: 1,
      maxCount: 1,
      writable: true
    },
    {
      path: "schema:description",
      name: "description",
      datatype: "xsd:string",
      minCount: 0,
      maxCount: 1,
      writable: true
    },
    {
      path: "schema:actionStatus",
      name: "status",
      datatype: "xsd:string",
      minCount: 1,
      maxCount: 1,
      writable: true
    },
    {
      path: "schema:agent",
      name: "assignees",
      datatype: "URI",
      minCount: 0,
      writable: true
    }
  ],
  constructor: [
    {
      action: "setSingleTarget",
      source: "this",
      predicate: "rdf:type",
      target: "https://schema.org/Action"
    },
    {
      action: "setSingleTarget",
      source: "this",
      predicate: "schema:name",
      target: "title"
    },
    {
      action: "setSingleTarget",
      source: "this",
      predicate: "schema:description",
      target: "description"
    },
    {
      action: "setSingleTarget",
      source: "this",
      predicate: "schema:actionStatus",
      target: "status"
    }
  ]
};

// Register the shape
await graph.addShape("Task", JSON.stringify(taskShape));
```

### 10.2 Creating and Querying Task Instances

```javascript
// Create a new Task
const taskAddress = await graph.createShapeInstance("Task", "task:001", {
  title: "Write specification",
  description: "Draft the Dynamic Graph Shape Validation spec",
  status: "InProgress"
});

// Create another Task
await graph.createShapeInstance("Task", "task:002", {
  title: "Review examples",
  description: "Ensure all examples are correct",
  status: "Pending"
});

// List all Tasks
const taskAddresses = await graph.getShapeInstances("Task");
console.log("Tasks:", taskAddresses);
// → ["task:001", "task:002"]

// Get data for a specific Task
const taskData = await graph.getShapeInstanceData("Task", "task:001");
console.log(taskData);
// → {
//     type_flag: "https://schema.org/Action",
//     title: "Write specification",
//     description: "Draft the Dynamic Graph Shape Validation spec",
//     status: "InProgress",
//     assignees: []
//   }
```

### 10.3 Updating Properties and Collections

```javascript
// Update a scalar property
await graph.setShapeProperty("Task", "task:001", "status", "Complete");

// Add to a collection property
await graph.addToShapeCollection("Task", "task:001", "assignees", "did:key:z6Mk...");
await graph.addToShapeCollection("Task", "task:001", "assignees", "did:key:z6Mn...");

// Verify the changes
const updated = await graph.getShapeInstanceData("Task", "task:001");
console.log(updated.status);
// → "Complete"
console.log(updated.assignees);
// → ["did:key:z6Mk...", "did:key:z6Mn..."]

// Remove from a collection
await graph.removeFromShapeCollection("Task", "task:001", "assignees", "did:key:z6Mn...");
```

### 10.4 Discovering Shapes in a Graph

```javascript
// List all registered shapes
const shapes = await graph.getShapes();

for (const shape of shapes) {
  console.log(`Shape: ${shape.name} (${shape.targetClass})`);
  console.log(`  Properties:`);
  for (const prop of shape.properties) {
    const cardinality = prop.maxCount === 1 ? "scalar" : "collection";
    console.log(`    ${prop.name}: ${prop.datatype || "any"} (${cardinality})`);
  }

  // Count instances
  const instances = await graph.getShapeInstances(shape.name);
  console.log(`  Instances: ${instances.length}`);
}
```

---

## 11. References

### 11.1 Normative References

<dl>
<dt>[RFC2119]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc2119">Key words for use in RFCs to Indicate Requirement Levels</a>. IETF RFC 2119.</dd>

<dt>[SHACL]</dt>
<dd><a href="https://www.w3.org/TR/shacl/">Shapes Constraint Language (SHACL)</a>. W3C Recommendation.</dd>

<dt>[PERSONAL-LINKED-DATA-GRAPHS]</dt>
<dd><a href="https://github.com/HexaField/w3c-living-web-proposals/blob/main/drafts/01_personal-linked-data-graphs.md">Personal Linked Data Graphs</a>. Draft. (Companion specification)</dd>

<dt>[RDF12]</dt>
<dd><a href="https://www.w3.org/TR/rdf12-concepts/">RDF 1.2 Concepts and Abstract Syntax</a>. W3C Working Draft.</dd>
</dl>

### 11.2 Informative References

<dl>
<dt>[SPARQL]</dt>
<dd><a href="https://www.w3.org/TR/sparql11-query/">SPARQL 1.1 Query Language</a>. W3C Recommendation.</dd>

<dt>[JCS]</dt>
<dd><a href="https://www.rfc-editor.org/rfc/rfc8785">JSON Canonicalization Scheme (JCS)</a>. IETF RFC 8785.</dd>

<dt>[SHACL-AF]</dt>
<dd><a href="https://www.w3.org/TR/shacl-af/">SHACL Advanced Features</a>. W3C Working Group Note.</dd>

<dt>[JSON-LD]</dt>
<dd><a href="https://www.w3.org/TR/json-ld11/">JSON-LD 1.1</a>. W3C Recommendation.</dd>
</dl>
