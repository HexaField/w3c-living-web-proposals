/**
 * Shape extension — mixed into Graph.prototype at install time.
 *
 * Methods exposed on Graph:
 *   addShape(name, shapeJson)
 *   removeShape(name)
 *   getShapes(options?)
 *   createShapeInstance(shapeName, address, initialValues?)
 *   getShapeInstances(shapeName)
 *   getShapeInstanceData(shapeName, address)
 *   setShapeProperty(shapeName, address, property, value)
 *   addToShapeCollection(shapeName, address, collection, value)
 *   removeFromShapeCollection(shapeName, address, collection, value)
 *
 * Shape definitions are stored as triples inside the graph. Shape inheritance
 * walks `context://participates_in` links upward through the navigator.graph
 * resolver.
 */

import { Graph } from '@living-web/personal-graph';
import type {
  ShapeDefinition,
  PropertyDefinition,
  RegisteredShape,
  ShapeInfo,
  PropertyInfo,
} from './types.js';
import {
  SHAPE_PREDICATE,
  SHAPE_TYPE,
  SHAPE_NAME_PREDICATE,
  SHAPE_TARGET_CLASS_PREDICATE,
  SHAPE_DEFINITION_PREDICATE,
  actionKind,
} from './types.js';
import { validateShapeDefinition } from './validator.js';
import { validateDatatype } from './xsd.js';
import { contentAddress } from './storage.js';

const registries = new WeakMap<Graph, Map<string, RegisteredShape>>();

function getRegistry(graph: Graph): Map<string, RegisteredShape> {
  let reg = registries.get(graph);
  if (!reg) {
    reg = new Map();
    registries.set(graph, reg);
  }
  return reg;
}

function isScalar(prop: PropertyDefinition): boolean {
  return prop.maxCount === 1;
}

function isWritable(prop: PropertyDefinition): boolean {
  if (prop.readOnly) return false;
  return prop.writable !== false;
}

function getPropertyDef(shape: ShapeDefinition, propName: string): PropertyDefinition {
  const prop = shape.properties.find(p => p.name === propName);
  if (!prop) throw new TypeError(`Property "${propName}" not found in shape`);
  return prop;
}

function resolveTarget(
  object: string,
  propertyNames: Set<string>,
  initialValues: Record<string, unknown>,
): string {
  if (propertyNames.has(object)) {
    const v = initialValues[object];
    return v !== undefined ? String(v) : object;
  }
  return object;
}

function getDiscriminator(shape: ShapeDefinition): { predicate: string; value: string } | null {
  for (const action of shape.constructor) {
    if ((action.predicate === 'rdf://type' || action.predicate === 'rdf:type')
        && action.object === shape.targetClass
        && actionKind(action.action) === 'setSingleTarget') {
      return { predicate: action.predicate, value: action.object };
    }
  }
  for (const action of shape.constructor) {
    const prop = shape.properties.find(p => p.path === action.predicate);
    if (prop && !isWritable(prop) && !shape.properties.some(p => p.name === action.object)) {
      return { predicate: action.predicate, value: action.object };
    }
  }
  return null;
}

function propToPublic(prop: PropertyDefinition): PropertyInfo {
  return {
    name: prop.name,
    path: prop.path,
    datatype: prop.datatype,
    minCount: prop.minCount ?? 0,
    maxCount: prop.maxCount,
    writable: isWritable(prop),
    readOnly: prop.readOnly ?? false,
  };
}

// ── Public methods (mixed into Graph.prototype) ────────────────────────────

async function addShape(this: Graph, name: string, shapeJson: string): Promise<void> {
  const registry = getRegistry(this);
  if (registry.has(name)) {
    throw new DOMException(`Shape "${name}" already exists`, 'ConstraintError');
  }
  const definition = validateShapeDefinition(shapeJson);
  const address = contentAddress(shapeJson);

  await this.addTriple({ subject: (this.did ?? this.id), predicate: SHAPE_PREDICATE, object: address });
  await this.addTriple({ subject: address, predicate: 'rdf://type', object: SHAPE_TYPE });
  await this.addTriple({ subject: address, predicate: SHAPE_NAME_PREDICATE, object: `"${name}"` });
  await this.addTriple({ subject: address, predicate: SHAPE_TARGET_CLASS_PREDICATE, object: definition.targetClass });
  await this.addTriple({
    subject: address,
    predicate: SHAPE_DEFINITION_PREDICATE,
    object: `"${shapeJson.replace(/"/g, '\\"')}"`,
  });

  registry.set(name, { name, definition, address, contextDid: (this.did ?? this.id) });
}

async function removeShape(this: Graph, name: string): Promise<void> {
  const registry = getRegistry(this);
  const shape = registry.get(name);
  if (!shape) return;
  const triples = await this.queryTriples({
    subject: (this.did ?? this.id),
    predicate: SHAPE_PREDICATE,
    object: shape.address,
  });
  for (const t of triples) await this.removeTriple(t);
  registry.delete(name);
}

interface GetShapesOptions {
  includeInherited?: boolean;
}

async function getShapes(this: Graph, options?: GetShapesOptions): Promise<ShapeInfo[]> {
  const registry = getRegistry(this);
  const result: ShapeInfo[] = [];
  for (const shape of registry.values()) {
    result.push({
      name: shape.name,
      targetClass: shape.definition.targetClass,
      definitionAddress: shape.address,
      sourceContextDid: shape.contextDid,
      properties: shape.definition.properties.map(propToPublic),
    });
  }
  if (options?.includeInherited === false) return result;
  for (const info of await collectInheritedShapes(this)) {
    if (!result.find(r => r.name === info.name)) result.push(info);
  }
  return result;
}

interface GraphStoreLike {
  resolveContext(graphDid: string): Promise<Graph | null>;
}

interface NavigatorWithGraph {
  graph?: GraphStoreLike;
}

async function collectInheritedShapes(graph: Graph): Promise<ShapeInfo[]> {
  const inherited: ShapeInfo[] = [];
  const nav = globalThis.navigator as Navigator & NavigatorWithGraph;
  const manager = nav.graph;
  if (!manager || typeof manager.resolveContext !== 'function') return inherited;

  const participations = await graph.queryTriples({
    subject: graph.did,
    predicate: 'context://participates_in',
  });
  for (const link of participations) {
    const parent = await manager.resolveContext(link.data.object);
    if (parent && parent !== graph) {
      const parentShapes = await getShapes.call(parent, { includeInherited: true });
      for (const p of parentShapes) inherited.push(p);
    }
  }
  return inherited;
}

async function resolveShape(graph: Graph, shapeName: string): Promise<RegisteredShape | null> {
  const local = getRegistry(graph).get(shapeName);
  if (local) return local;
  const nav = globalThis.navigator as Navigator & NavigatorWithGraph;
  const manager = nav.graph;
  if (!manager) return null;
  const participations = await graph.queryTriples({
    subject: graph.did,
    predicate: 'context://participates_in',
  });
  for (const link of participations) {
    const parent = await manager.resolveContext(link.data.object);
    if (parent) {
      const inherited = await resolveShape(parent, shapeName);
      if (inherited) return inherited;
    }
  }
  return null;
}

async function createShapeInstance(
  this: Graph,
  shapeName: string,
  address: string,
  initialValues: Record<string, unknown> = {},
): Promise<string> {
  const shape = await resolveShape(this, shapeName);
  if (!shape) throw new TypeError(`Shape "${shapeName}" not found`);
  const def = shape.definition;

  const propertyNames = new Set(def.properties.map(p => p.name));
  for (const prop of def.properties) {
    const minCount = prop.minCount ?? 0;
    if (minCount > 0 && isWritable(prop) && initialValues[prop.name] === undefined) {
      const hasLiteralInConstructor = def.constructor.some(
        a => a.predicate === prop.path && !propertyNames.has(a.object),
      );
      if (!hasLiteralInConstructor) {
        throw new TypeError(`Required property "${prop.name}" missing from initialValues`);
      }
    }
  }

  for (const action of def.constructor) {
    const subject = address;
    const object = resolveTarget(action.object, propertyNames, initialValues);
    const prop = def.properties.find(p => p.path === action.predicate);
    if (prop?.datatype && propertyNames.has(action.object)) {
      const val = initialValues[action.object];
      if (val !== undefined && !validateDatatype(String(val), prop.datatype)) {
        throw new TypeError(`Value "${String(val)}" does not match datatype ${prop.datatype} for "${prop.name}"`);
      }
    }
    const kind = actionKind(action.action);
    if (kind === 'setSingleTarget') {
      const existing = await this.queryTriples({ subject, predicate: action.predicate });
      for (const t of existing) await this.removeTriple(t);
      await this.addTriple({ subject, predicate: action.predicate, object });
    } else {
      await this.addTriple({ subject, predicate: action.predicate, object });
    }
  }

  return address;
}

async function getShapeInstances(this: Graph, shapeName: string): Promise<string[]> {
  const shape = await resolveShape(this, shapeName);
  if (!shape) throw new TypeError(`Shape "${shapeName}" not found`);
  const disc = getDiscriminator(shape.definition);
  if (!disc) return [];
  const triples = await this.queryTriples({ predicate: disc.predicate, object: disc.value });
  return [...new Set(triples.map(t => t.data.subject))];
}

async function getShapeInstanceData(
  this: Graph,
  shapeName: string,
  address: string,
): Promise<Record<string, unknown>> {
  const shape = await resolveShape(this, shapeName);
  if (!shape) throw new TypeError(`Shape "${shapeName}" not found`);
  const def = shape.definition;
  const result: Record<string, unknown> = {};
  for (const prop of def.properties) {
    if (prop.getter) {
      const sparql = prop.getter
        .replace(/\?this/g, `<${address}>`)
        .replace(/\$this/g, `<${address}>`);
      try {
        const r = await this.querySparql(sparql);
        if (r.bindings.length > 0) {
          const firstBinding = r.bindings[0];
          const keys = Object.keys(firstBinding);
          result[prop.name] = keys.length > 0 ? firstBinding[keys[0]] : null;
        } else {
          result[prop.name] = null;
        }
      } catch {
        result[prop.name] = null;
      }
      continue;
    }
    const triples = await this.queryTriples({ subject: address, predicate: prop.path });
    if (isScalar(prop)) {
      result[prop.name] = triples.length > 0 ? triples[0].data.object : null;
    } else {
      result[prop.name] = triples.map(t => t.data.object);
    }
  }
  return result;
}

async function setShapeProperty(
  this: Graph,
  shapeName: string,
  address: string,
  property: string,
  value: unknown,
): Promise<void> {
  const shape = await resolveShape(this, shapeName);
  if (!shape) throw new TypeError(`Shape "${shapeName}" not found`);
  const prop = getPropertyDef(shape.definition, property);
  if (!isWritable(prop)) throw new TypeError(`Property "${property}" is not writable`);
  if (!isScalar(prop)) throw new TypeError(`Property "${property}" is a collection — use addToShapeCollection`);
  if (prop.datatype && !validateDatatype(String(value), prop.datatype)) {
    throw new TypeError(`Value "${String(value)}" does not match datatype ${prop.datatype}`);
  }
  const existing = await this.queryTriples({ subject: address, predicate: prop.path });
  for (const t of existing) await this.removeTriple(t);
  await this.addTriple({ subject: address, predicate: prop.path, object: String(value) });
}

async function addToShapeCollection(
  this: Graph,
  shapeName: string,
  address: string,
  collection: string,
  value: unknown,
): Promise<void> {
  const shape = await resolveShape(this, shapeName);
  if (!shape) throw new TypeError(`Shape "${shapeName}" not found`);
  const prop = getPropertyDef(shape.definition, collection);
  if (!isWritable(prop)) throw new TypeError(`Property "${collection}" is not writable`);
  if (isScalar(prop)) throw new TypeError(`Property "${collection}" is scalar — use setShapeProperty`);
  if (prop.datatype && !validateDatatype(String(value), prop.datatype)) {
    throw new TypeError(`Value "${String(value)}" does not match datatype ${prop.datatype}`);
  }
  if (prop.maxCount !== undefined) {
    const existing = await this.queryTriples({ subject: address, predicate: prop.path });
    if (existing.length >= prop.maxCount) {
      throw new DOMException(`Adding value would exceed maxCount (${prop.maxCount})`, 'ConstraintError');
    }
  }
  await this.addTriple({ subject: address, predicate: prop.path, object: String(value) });
}

async function removeFromShapeCollection(
  this: Graph,
  shapeName: string,
  address: string,
  collection: string,
  value: unknown,
): Promise<void> {
  const shape = await resolveShape(this, shapeName);
  if (!shape) throw new TypeError(`Shape "${shapeName}" not found`);
  const prop = getPropertyDef(shape.definition, collection);
  const existing = await this.queryTriples({ subject: address, predicate: prop.path });
  const toRemove = existing.find(t => t.data.object === String(value));
  if (!toRemove) {
    throw new DOMException(`Value "${String(value)}" not found in collection "${collection}"`, 'NotFoundError');
  }
  const minCount = prop.minCount ?? 0;
  if (existing.length <= minCount) {
    throw new DOMException(`Removing value would violate minCount (${minCount})`, 'ConstraintError');
  }
  await this.removeTriple(toRemove);
}

/**
 * Augment Graph with shape methods. The interface declarations let TypeScript
 * see the methods on `Graph` after the module is loaded.
 */
declare module '@living-web/personal-graph' {
  interface Graph {
    addShape(name: string, shapeJson: string): Promise<void>;
    removeShape(name: string): Promise<void>;
    getShapes(options?: GetShapesOptions): Promise<ShapeInfo[]>;
    createShapeInstance(
      shapeName: string,
      address: string,
      initialValues?: Record<string, unknown>,
    ): Promise<string>;
    getShapeInstances(shapeName: string): Promise<string[]>;
    getShapeInstanceData(
      shapeName: string,
      address: string,
    ): Promise<Record<string, unknown>>;
    setShapeProperty(
      shapeName: string,
      address: string,
      property: string,
      value: unknown,
    ): Promise<void>;
    addToShapeCollection(
      shapeName: string,
      address: string,
      collection: string,
      value: unknown,
    ): Promise<void>;
    removeFromShapeCollection(
      shapeName: string,
      address: string,
      collection: string,
      value: unknown,
    ): Promise<void>;
  }
}

/** Install all methods onto Graph.prototype. Idempotent. */
export function installShapeExtension(): void {
  const proto = Graph.prototype as Graph;
  if (typeof proto.addShape === 'function') return;
  Object.assign(Graph.prototype, {
    addShape,
    removeShape,
    getShapes,
    createShapeInstance,
    getShapeInstances,
    getShapeInstanceData,
    setShapeProperty,
    addToShapeCollection,
    removeFromShapeCollection,
  });
}
