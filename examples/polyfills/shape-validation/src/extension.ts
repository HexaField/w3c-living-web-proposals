// Shape validation extension for PersonalGraph — §5
// Mixin pattern: adds shape methods to PersonalGraph.prototype

import { PersonalGraph, SemanticTriple, type SignedTriple } from '@living-web/personal-graph';
import type {
  ShapeDefinition,
  PropertyDefinition,
  ConstructorAction,
  RegisteredShape,
  ShapeInfo,
  PropertyInfoPublic,
} from './types.js';
import { SHAPE_PREDICATE, SHAPE_NAME_PREDICATE } from './types.js';
import { validateShapeDefinition } from './validator.js';
import { validateDatatype } from './xsd.js';
import { contentAddress } from './storage.js';

// Internal per-graph state
const shapeRegistries = new WeakMap<PersonalGraph, Map<string, RegisteredShape>>();

function getRegistry(graph: PersonalGraph): Map<string, RegisteredShape> {
  let reg = shapeRegistries.get(graph);
  if (!reg) {
    reg = new Map();
    shapeRegistries.set(graph, reg);
  }
  return reg;
}

function getPropertyDef(shape: ShapeDefinition, propName: string): PropertyDefinition {
  const prop = shape.properties.find((p) => p.name === propName);
  if (!prop) {
    throw new TypeError(`Property "${propName}" not found in shape`);
  }
  return prop;
}

function isScalar(prop: PropertyDefinition): boolean {
  return prop.maxCount === 1;
}

function isWritable(prop: PropertyDefinition): boolean {
  if (prop.readOnly) return false;
  return prop.writable !== false;
}

function resolveTarget(
  target: string,
  propertyNames: Set<string>,
  initialValues: Record<string, any>,
): string {
  if (propertyNames.has(target)) {
    const val = initialValues[target];
    return val !== undefined ? String(val) : target;
  }
  return target;
}

// Find the type discriminator property + value for a shape
function getDiscriminator(shape: ShapeDefinition): { predicate: string; value: string } | null {
  // Look for a constructor action that sets rdf:type to targetClass
  for (const action of shape.constructor) {
    if (action.predicate === 'rdf:type' && action.target === shape.targetClass) {
      return { predicate: 'rdf:type', value: shape.targetClass };
    }
  }
  // Fallback: look for any non-writable property with a fixed value in constructor
  for (const action of shape.constructor) {
    const prop = shape.properties.find((p) => p.path === action.predicate);
    if (prop && !isWritable(prop) && !shape.properties.some((p) => p.name === action.target)) {
      return { predicate: action.predicate, value: action.target };
    }
  }
  return null;
}

// §5.1 addShape
async function addShape(this: PersonalGraph, name: string, shapeJson: string): Promise<void> {
  const registry = getRegistry(this);
  if (registry.has(name)) {
    throw new DOMException(`Shape "${name}" already exists`, 'ConstraintError');
  }

  const definition = validateShapeDefinition(shapeJson);
  const address = contentAddress(shapeJson);

  // Store shape as content-addressed triple in the graph
  const graphUri = this.uuid.includes(':') ? this.uuid : `urn:uuid:${this.uuid}`;
  await this.addTriple(new SemanticTriple(graphUri, address, SHAPE_PREDICATE));
  // Store shape name mapping
  await this.addTriple(new SemanticTriple(address, name, SHAPE_NAME_PREDICATE));
  // Store the actual shape JSON as a triple (address → content)
  await this.addTriple(new SemanticTriple(address, shapeJson, 'shacl://shape_content'));

  registry.set(name, { name, definition, address });
}

// §5.2 getShapes
async function getShapes(this: PersonalGraph): Promise<ShapeInfo[]> {
  const registry = getRegistry(this);
  const result: ShapeInfo[] = [];
  for (const [, shape] of registry) {
    result.push({
      name: shape.name,
      targetClass: shape.definition.targetClass,
      definitionAddress: shape.address,
      properties: shape.definition.properties.map(propToPublic),
    });
  }
  return result;
}

function propToPublic(prop: PropertyDefinition): PropertyInfoPublic {
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

// §5.3 createShapeInstance
async function createShapeInstance(
  this: PersonalGraph,
  shapeName: string,
  address: string,
  initialValues: Record<string, any> = {},
): Promise<string> {
  const registry = getRegistry(this);
  const shape = registry.get(shapeName);
  if (!shape) {
    throw new TypeError(`Shape "${shapeName}" not found`);
  }
  const def = shape.definition;

  // Validate required properties
  const propertyNames = new Set(def.properties.map((p) => p.name));
  for (const prop of def.properties) {
    const minCount = prop.minCount ?? 0;
    if (minCount > 0 && isWritable(prop) && initialValues[prop.name] === undefined) {
      // Check if constructor sets a literal for this property
      const hasLiteralInConstructor = def.constructor.some(
        (a) => a.predicate === prop.path && !propertyNames.has(a.target),
      );
      if (!hasLiteralInConstructor) {
        throw new TypeError(`Required property "${prop.name}" missing from initialValues`);
      }
    }
  }

  // Execute constructor actions in order
  for (const action of def.constructor) {
    const source = address; // "this" → instance address
    const target = resolveTarget(action.target, propertyNames, initialValues);

    // Validate datatype if property is known
    const prop = def.properties.find((p) => p.path === action.predicate);
    if (prop && prop.datatype && propertyNames.has(action.target)) {
      const val = initialValues[action.target];
      if (val !== undefined && !validateDatatype(String(val), prop.datatype)) {
        throw new TypeError(`Value "${val}" does not match datatype ${prop.datatype} for property "${prop.name}"`);
      }
    }

    switch (action.action) {
      case 'setSingleTarget': {
        // Remove existing triples with same source+predicate
        const existing = await this.queryTriples({ source, predicate: action.predicate });
        for (const t of existing) {
          await this.removeTriple(t);
        }
        await this.addTriple(new SemanticTriple(source, target, action.predicate));
        break;
      }
      case 'addLink':
      case 'addCollectionTarget': {
        await this.addTriple(new SemanticTriple(source, target, action.predicate));
        break;
      }
    }
  }

  return address;
}

// §5.4 getShapeInstances
async function getShapeInstances(this: PersonalGraph, shapeName: string): Promise<string[]> {
  const registry = getRegistry(this);
  const shape = registry.get(shapeName);
  if (!shape) {
    throw new TypeError(`Shape "${shapeName}" not found`);
  }

  const disc = getDiscriminator(shape.definition);
  if (!disc) {
    return [];
  }

  const triples = await this.queryTriples({ predicate: disc.predicate, target: disc.value });
  const addresses = [...new Set(triples.map((t) => t.data.source))];
  return addresses;
}

// §5.5 getShapeInstanceData
async function getShapeInstanceData(
  this: PersonalGraph,
  shapeName: string,
  address: string,
): Promise<Record<string, any>> {
  const registry = getRegistry(this);
  const shape = registry.get(shapeName);
  if (!shape) {
    throw new TypeError(`Shape "${shapeName}" not found`);
  }

  const def = shape.definition;
  const result: Record<string, any> = {};

  for (const prop of def.properties) {
    // Handle getter (computed) properties
    if (prop.getter) {
      try {
        const sparql = prop.getter.replace(/\?this/g, `<${address}>`);
        const sparqlResult = await this.querySparql(sparql);
        if (sparqlResult.bindings.length > 0) {
          const firstBinding = sparqlResult.bindings[0];
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

    const triples = await this.queryTriples({ source: address, predicate: prop.path });
    if (isScalar(prop)) {
      result[prop.name] = triples.length > 0 ? triples[0].data.target : null;
    } else {
      result[prop.name] = triples.map((t) => t.data.target);
    }
  }

  return result;
}

// §5.6 setShapeProperty
async function setShapeProperty(
  this: PersonalGraph,
  shapeName: string,
  address: string,
  property: string,
  value: any,
): Promise<void> {
  const registry = getRegistry(this);
  const shape = registry.get(shapeName);
  if (!shape) {
    throw new TypeError(`Shape "${shapeName}" not found`);
  }

  const prop = getPropertyDef(shape.definition, property);

  if (!isWritable(prop)) {
    throw new TypeError(`Property "${property}" is not writable`);
  }
  if (!isScalar(prop)) {
    throw new TypeError(`Property "${property}" is a collection (maxCount ≠ 1), use addToShapeCollection`);
  }
  if (prop.datatype && !validateDatatype(String(value), prop.datatype)) {
    throw new TypeError(`Value "${value}" does not match datatype ${prop.datatype}`);
  }

  // Remove existing value(s) for this property
  const existing = await this.queryTriples({ source: address, predicate: prop.path });
  for (const t of existing) {
    await this.removeTriple(t);
  }
  await this.addTriple(new SemanticTriple(address, String(value), prop.path));
}

// §5.7 addToShapeCollection
async function addToShapeCollection(
  this: PersonalGraph,
  shapeName: string,
  address: string,
  collection: string,
  value: any,
): Promise<void> {
  const registry = getRegistry(this);
  const shape = registry.get(shapeName);
  if (!shape) {
    throw new TypeError(`Shape "${shapeName}" not found`);
  }

  const prop = getPropertyDef(shape.definition, collection);

  if (!isWritable(prop)) {
    throw new TypeError(`Property "${collection}" is not writable`);
  }
  if (isScalar(prop)) {
    throw new TypeError(`Property "${collection}" is scalar (maxCount = 1), use setShapeProperty`);
  }
  if (prop.datatype && !validateDatatype(String(value), prop.datatype)) {
    throw new TypeError(`Value "${value}" does not match datatype ${prop.datatype}`);
  }

  // Check maxCount constraint
  if (prop.maxCount !== undefined) {
    const existing = await this.queryTriples({ source: address, predicate: prop.path });
    if (existing.length >= prop.maxCount) {
      throw new DOMException(
        `Adding value would exceed maxCount (${prop.maxCount}) for "${collection}"`,
        'ConstraintError',
      );
    }
  }

  await this.addTriple(new SemanticTriple(address, String(value), prop.path));
}

// §5.8 removeFromShapeCollection
async function removeFromShapeCollection(
  this: PersonalGraph,
  shapeName: string,
  address: string,
  collection: string,
  value: any,
): Promise<void> {
  const registry = getRegistry(this);
  const shape = registry.get(shapeName);
  if (!shape) {
    throw new TypeError(`Shape "${shapeName}" not found`);
  }

  const prop = getPropertyDef(shape.definition, collection);

  // Find the triple to remove
  const existing = await this.queryTriples({ source: address, predicate: prop.path });
  const toRemove = existing.find((t) => t.data.target === String(value));

  if (!toRemove) {
    throw new DOMException(`Value "${value}" not found in collection "${collection}"`, 'NotFoundError');
  }

  // Check minCount constraint
  const minCount = prop.minCount ?? 0;
  if (existing.length <= minCount) {
    throw new DOMException(
      `Removing value would violate minCount (${minCount}) for "${collection}"`,
      'ConstraintError',
    );
  }

  await this.removeTriple(toRemove);
}

// Install all methods onto PersonalGraph.prototype
export function installShapeExtension(GraphClass: typeof PersonalGraph): void {
  const proto = GraphClass.prototype as any;
  proto.addShape = addShape;
  proto.getShapes = getShapes;
  proto.createShapeInstance = createShapeInstance;
  proto.getShapeInstances = getShapeInstances;
  proto.getShapeInstanceData = getShapeInstanceData;
  proto.setShapeProperty = setShapeProperty;
  proto.addToShapeCollection = addToShapeCollection;
  proto.removeFromShapeCollection = removeFromShapeCollection;
}
