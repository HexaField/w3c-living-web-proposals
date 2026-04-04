import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  SemanticTriple,
  PersonalGraphManager,
  PersonalGraph,
  TripleEvent,
  verifyTripleSignature,
  EphemeralIdentity,
  type SignedTriple,
} from '../index.js';

let manager: PersonalGraphManager;
let identity: EphemeralIdentity;
let testDbName: string;

beforeEach(async () => {
  testDbName = `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  identity = new EphemeralIdentity();
  await identity.ensureReady();
  manager = new PersonalGraphManager(identity, testDbName);
});

// §3.1 SemanticTriple
describe('§3.1 SemanticTriple', () => {
  it('MUST reject triple with non-URI source', () => {
    expect(() => new SemanticTriple('not a uri', 'https://example.com/target')).toThrow(TypeError);
  });

  it('MUST accept URI target and literal string target', () => {
    const t1 = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    expect(t1.target).toBe('https://example.com/t');
    const t2 = new SemanticTriple('https://example.com/s', 'some literal value');
    expect(t2.target).toBe('some literal value');
  });

  it('MUST reject triple with non-URI predicate when present', () => {
    expect(() => new SemanticTriple('https://example.com/s', 'https://example.com/t', 'bad predicate')).toThrow(TypeError);
  });

  it('predicate is null when not provided', () => {
    const t = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    expect(t.predicate).toBeNull();
  });

  it('accepts valid URI predicate', () => {
    const t = new SemanticTriple('https://example.com/s', 'https://example.com/t', 'https://schema.org/about');
    expect(t.predicate).toBe('https://schema.org/about');
  });
});

// §3.2 SignedTriple
describe('§3.2 SignedTriple', () => {
  it('MUST have author as valid DID URI', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t', 'https://schema.org/about');
    const signed = await graph.addTriple(triple);
    expect(signed.author).toMatch(/^did:/);
  });

  it('MUST have timestamp as valid RFC 3339', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    const signed = await graph.addTriple(triple);
    // ISO 8601 / RFC 3339 check
    expect(new Date(signed.timestamp).toISOString()).toBe(signed.timestamp);
  });

  it('MUST have verifiable Ed25519 signature over SHA-256(JCS(data) + timestamp)', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t', 'https://schema.org/about');
    const signed = await graph.addTriple(triple);
    const valid = await verifyTripleSignature(signed, identity.getPublicKey());
    expect(valid).toBe(true);
  });

  it('signature uses Ed25519 algorithm', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    const signed = await graph.addTriple(triple);
    // Ed25519 signature is 64 bytes = 128 hex chars
    expect(signed.proof.signature).toMatch(/^[0-9a-f]{128}$/);
  });
});

// §4.1 PersonalGraphManager
describe('§4.1 PersonalGraphManager', () => {
  it('create() MUST return graph with valid UUIDv4', async () => {
    const graph = await manager.create();
    expect(graph.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('create("My Graph") MUST store and return the name', async () => {
    const graph = await manager.create('My Graph');
    expect(graph.name).toBe('My Graph');
  });

  it('create() without name has null name', async () => {
    const graph = await manager.create();
    expect(graph.name).toBeNull();
  });

  it('list() returns created graphs', async () => {
    await manager.create('A');
    await manager.create('B');
    const list = await manager.list();
    expect(list.length).toBe(2);
  });

  it('get() returns graph by UUID', async () => {
    const graph = await manager.create('test');
    const found = await manager.get(graph.uuid);
    expect(found).not.toBeNull();
    expect(found!.uuid).toBe(graph.uuid);
  });

  it('get() returns null for nonexistent UUID', async () => {
    const found = await manager.get('00000000-0000-4000-8000-000000000000');
    expect(found).toBeNull();
  });

  it('remove() MUST return true for existing graph', async () => {
    const graph = await manager.create('test');
    const result = await manager.remove(graph.uuid);
    expect(result).toBe(true);
  });

  it('remove() MUST return false for nonexistent UUID', async () => {
    const result = await manager.remove('00000000-0000-4000-8000-000000000000');
    expect(result).toBe(false);
  });

  it('remove() MUST permanently delete all triples and metadata', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    await graph.addTriple(triple);
    await manager.remove(graph.uuid);
    const found = await manager.get(graph.uuid);
    expect(found).toBeNull();
    const list = await manager.list();
    expect(list.length).toBe(0);
  });
});

// §4.2.1 addTriple
describe('§4.2.1 addTriple', () => {
  it('MUST return SignedTriple with valid signature', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    const signed = await graph.addTriple(triple);
    expect(signed.data.source).toBe('https://example.com/s');
    expect(signed.data.target).toBe('https://example.com/t');
    expect(signed.author).toBeTruthy();
    expect(signed.proof).toBeTruthy();
  });

  it('MUST fire tripleadded event', async () => {
    const graph = await manager.create('test');
    const handler = vi.fn();
    graph.ontripleadded = handler;
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    await graph.addTriple(triple);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as TripleEvent;
    expect(event.triple.data.source).toBe('https://example.com/s');
  });
});

// §4.2.2 addTriples
describe('§4.2.2 addTriples', () => {
  it('MUST sign and return all triples in batch', async () => {
    const graph = await manager.create('test');
    const triples = [
      new SemanticTriple('https://example.com/s1', 'https://example.com/t1'),
      new SemanticTriple('https://example.com/s2', 'https://example.com/t2'),
    ];
    const signed = await graph.addTriples(triples);
    expect(signed.length).toBe(2);
    expect(signed[0].proof).toBeTruthy();
    expect(signed[1].proof).toBeTruthy();
  });

  it('MUST fire tripleadded event for each triple', async () => {
    const graph = await manager.create('test');
    const handler = vi.fn();
    graph.ontripleadded = handler;
    await graph.addTriples([
      new SemanticTriple('https://example.com/s1', 'https://example.com/t1'),
      new SemanticTriple('https://example.com/s2', 'https://example.com/t2'),
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// §4.2.3 removeTriple
describe('§4.2.3 removeTriple', () => {
  it('MUST remove triple and return true', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    const signed = await graph.addTriple(triple);
    const result = await graph.removeTriple(signed);
    expect(result).toBe(true);
    const remaining = await graph.snapshot();
    expect(remaining.length).toBe(0);
  });

  it('MUST return false for nonexistent triple', async () => {
    const graph = await manager.create('test');
    const fakeTriple: SignedTriple = {
      data: new SemanticTriple('https://example.com/s', 'https://example.com/t'),
      author: 'did:key:fake',
      timestamp: new Date().toISOString(),
      proof: { key: 'did:key:fake#key-1', signature: '00'.repeat(64) },
    };
    const result = await graph.removeTriple(fakeTriple);
    expect(result).toBe(false);
  });

  it('MUST fire tripleremoved event', async () => {
    const graph = await manager.create('test');
    const handler = vi.fn();
    graph.ontripleremoved = handler;
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    const signed = await graph.addTriple(triple);
    await graph.removeTriple(signed);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// §4.2.4 queryTriples
describe('§4.2.4 queryTriples', () => {
  it('MUST return matching triples ordered by timestamp desc', async () => {
    const graph = await manager.create('test');
    await graph.addTriple(new SemanticTriple('https://example.com/s', 'https://example.com/t1', 'https://schema.org/about'));
    await graph.addTriple(new SemanticTriple('https://example.com/s', 'https://example.com/t2', 'https://schema.org/about'));
    const results = await graph.queryTriples({ source: 'https://example.com/s' });
    expect(results.length).toBe(2);
    expect(results[0].timestamp >= results[1].timestamp).toBe(true);
  });

  it('queryTriples with source+predicate returns intersection', async () => {
    const graph = await manager.create('test');
    await graph.addTriple(new SemanticTriple('https://example.com/s', 'https://example.com/t1', 'https://schema.org/about'));
    await graph.addTriple(new SemanticTriple('https://example.com/s', 'https://example.com/t2', 'https://schema.org/name'));
    const results = await graph.queryTriples({
      source: 'https://example.com/s',
      predicate: 'https://schema.org/about',
    });
    expect(results.length).toBe(1);
    expect(results[0].data.predicate).toBe('https://schema.org/about');
  });

  it('queryTriples with null source matches all sources', async () => {
    const graph = await manager.create('test');
    await graph.addTriple(new SemanticTriple('https://example.com/s1', 'https://example.com/t'));
    await graph.addTriple(new SemanticTriple('https://example.com/s2', 'https://example.com/t'));
    const results = await graph.queryTriples({});
    expect(results.length).toBe(2);
  });

  it('queryTriples with limit MUST return at most that many results', async () => {
    const graph = await manager.create('test');
    for (let i = 0; i < 10; i++) {
      await graph.addTriple(new SemanticTriple(`https://example.com/s${i}`, 'https://example.com/t'));
    }
    const results = await graph.queryTriples({ limit: 5 });
    expect(results.length).toBe(5);
  });
});

// §4.2.5 querySparql
describe('§4.2.5 querySparql', () => {
  it('MUST execute SELECT and return bindings', async () => {
    const graph = await manager.create('test');
    await graph.addTriple(new SemanticTriple('https://example.com/note1', 'https://example.com/topic1', 'https://schema.org/about'));
    const result = await graph.querySparql(`
      SELECT ?note ?topic WHERE {
        ?note <https://schema.org/about> ?topic .
      }
    `);
    expect(result.type).toBe('bindings');
    expect(result.bindings.length).toBe(1);
    expect(result.bindings[0].note).toBe('https://example.com/note1');
    expect(result.bindings[0].topic).toBe('https://example.com/topic1');
  });

  it('supports LIMIT', async () => {
    const graph = await manager.create('test');
    for (let i = 0; i < 5; i++) {
      await graph.addTriple(new SemanticTriple(`https://example.com/s${i}`, `https://example.com/t${i}`, 'https://schema.org/about'));
    }
    const result = await graph.querySparql(`
      SELECT ?s ?t WHERE { ?s <https://schema.org/about> ?t . } LIMIT 2
    `);
    expect(result.bindings.length).toBe(2);
  });
});

// §4.2.6 snapshot
describe('§4.2.6 snapshot', () => {
  it('MUST return all triples ordered by timestamp ascending', async () => {
    const graph = await manager.create('test');
    await graph.addTriple(new SemanticTriple('https://example.com/s1', 'https://example.com/t1'));
    await graph.addTriple(new SemanticTriple('https://example.com/s2', 'https://example.com/t2'));
    const snap = await graph.snapshot();
    expect(snap.length).toBe(2);
    expect(snap[0].timestamp <= snap[1].timestamp).toBe(true);
  });
});

// §3.3 GraphSyncState
describe('§3.3 GraphSyncState', () => {
  it('state is "private" by default', async () => {
    const graph = await manager.create('test');
    expect(graph.state).toBe('private');
  });
});

// §6.1 Persistence
describe('§6.1 Persistence', () => {
  it('data MUST persist across manager instances (simulated restart)', async () => {
    const graph = await manager.create('test');
    const triple = new SemanticTriple('https://example.com/s', 'https://example.com/t');
    await graph.addTriple(triple);

    // Create new manager (simulates page reload)
    const manager2 = new PersonalGraphManager(identity, testDbName);
    const list = await manager2.list();
    expect(list.length).toBe(1);
    const graph2 = list[0];
    const snap = await graph2.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0].data.source).toBe('https://example.com/s');
  });
});

// §4.6 SparqlResult types
describe('§4.6 SparqlResult', () => {
  it('SELECT query returns type=bindings with variable bindings', async () => {
    const graph = await manager.create('test');
    await graph.addTriple(new SemanticTriple('https://example.com/s', 'https://example.com/t', 'https://schema.org/about'));
    const result = await graph.querySparql('SELECT ?s ?o WHERE { ?s <https://schema.org/about> ?o . }');
    expect(result.type).toBe('bindings');
    expect(Array.isArray(result.bindings)).toBe(true);
    expect(result.bindings[0]).toHaveProperty('s');
    expect(result.bindings[0]).toHaveProperty('o');
  });
});

// Event handler replacement
describe('Event handlers', () => {
  it('replacing ontripleadded replaces handler', async () => {
    const graph = await manager.create('test');
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    graph.ontripleadded = handler1;
    graph.ontripleadded = handler2;
    await graph.addTriple(new SemanticTriple('https://example.com/s', 'https://example.com/t'));
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});
