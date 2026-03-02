import { describe, it, expect } from 'vitest';
import { LevelGraph } from './LevelGraph';
import type { IGraphVertex, ILevelGraphState } from './LevelGraph';

// ---------------------------------------------------------------------------
// Helper: build a simple linear graph A → B → C → D
// ---------------------------------------------------------------------------
function buildLinear(): LevelGraph {
  return new LevelGraph()
    .addVertex('A', 0, 0)
    .addVertex('B', 100, 0)
    .addVertex('C', 200, 0)
    .addVertex('D', 300, 0)
    .addUndirectedEdge('A', 'B')
    .addUndirectedEdge('B', 'C')
    .addUndirectedEdge('C', 'D');
}

// ---------------------------------------------------------------------------
// addVertex / getVertex
// ---------------------------------------------------------------------------
describe('LevelGraph – addVertex / getVertex', () => {
  it('stores a vertex with correct x, y, tags', () => {
    const g = new LevelGraph();
    g.addVertex('v1', 10, 20, ['indoor', 'safe']);
    const v = g.getVertex('v1');
    expect(v).toBeDefined();
    expect(v?.id).toBe('v1');
    expect(v?.x).toBe(10);
    expect(v?.y).toBe(20);
    expect(v?.tags).toEqual(['indoor', 'safe']);
  });

  it('stores a vertex with empty tags by default', () => {
    const g = new LevelGraph();
    g.addVertex('v2', 0, 0);
    expect(g.getVertex('v2')?.tags).toEqual([]);
  });

  it('overwrites an existing vertex when same ID is added', () => {
    const g = new LevelGraph();
    g.addVertex('v1', 1, 2, ['old']);
    g.addVertex('v1', 99, 88, ['new']);
    const v = g.getVertex('v1');
    expect(v?.x).toBe(99);
    expect(v?.y).toBe(88);
    expect(v?.tags).toEqual(['new']);
  });

  it('returns undefined for non-existent vertex', () => {
    const g = new LevelGraph();
    expect(g.getVertex('missing')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addEdge
// ---------------------------------------------------------------------------
describe('LevelGraph – addEdge', () => {
  it('creates a directed edge with auto Euclidean weight', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 3, 4);
    g.addEdge('A', 'B');
    const edges = g.getEdges('A');
    expect(edges.length).toBe(1);
    expect(edges[0].to).toBe('B');
    expect(edges[0].weight).toBeCloseTo(5, 5);
  });

  it('uses custom weight when provided', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 1000, 1000);
    g.addEdge('A', 'B', 42);
    expect(g.getEdges('A')[0].weight).toBe(42);
  });

  it('does not create an edge for unknown source vertex', () => {
    const g = new LevelGraph().addVertex('B', 0, 0);
    g.addEdge('MISSING', 'B');
    expect(g.edgeCount).toBe(0);
  });

  it('does not create an edge for unknown destination vertex', () => {
    const g = new LevelGraph().addVertex('A', 0, 0);
    g.addEdge('A', 'MISSING');
    expect(g.edgeCount).toBe(0);
  });

  it('edge is directed (no reverse edge created)', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 10, 0);
    g.addEdge('A', 'B');
    expect(g.getEdges('A').length).toBe(1);
    expect(g.getEdges('B').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addUndirectedEdge
// ---------------------------------------------------------------------------
describe('LevelGraph – addUndirectedEdge', () => {
  it('creates edges in both directions', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 10, 0);
    g.addUndirectedEdge('A', 'B');
    expect(g.getEdges('A').length).toBe(1);
    expect(g.getEdges('B').length).toBe(1);
    expect(g.getEdges('A')[0].to).toBe('B');
    expect(g.getEdges('B')[0].to).toBe('A');
  });

  it('both directions have the same weight', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 6, 8);
    g.addUndirectedEdge('A', 'B');
    const wAB = g.getEdges('A')[0].weight;
    const wBA = g.getEdges('B')[0].weight;
    expect(wAB).toBeCloseTo(10, 5);
    expect(wBA).toBeCloseTo(10, 5);
  });
});

// ---------------------------------------------------------------------------
// findPath – basic cases
// ---------------------------------------------------------------------------
describe('LevelGraph – findPath', () => {
  it('returns [A, B] for a direct edge', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    g.addEdge('A', 'B');
    expect(g.findPath('A', 'B')).toEqual(['A', 'B']);
  });

  it('returns [start] when start === goal', () => {
    const g = new LevelGraph().addVertex('A', 0, 0);
    expect(g.findPath('A', 'A')).toEqual(['A']);
  });

  it('returns null when start vertex does not exist', () => {
    const g = new LevelGraph().addVertex('B', 0, 0);
    expect(g.findPath('X', 'B')).toBeNull();
  });

  it('returns null when goal vertex does not exist', () => {
    const g = new LevelGraph().addVertex('A', 0, 0);
    expect(g.findPath('A', 'Z')).toBeNull();
  });

  it('returns null when no path exists', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    // No edges
    expect(g.findPath('A', 'B')).toBeNull();
  });

  it('finds multi-hop path A→B→C→D', () => {
    const g = buildLinear();
    expect(g.findPath('A', 'D')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('finds path in reverse when undirected', () => {
    const g = buildLinear();
    expect(g.findPath('D', 'A')).toEqual(['D', 'C', 'B', 'A']);
  });

  it('prefers shorter path (A→C direct vs A→B→C)', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0)
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 100);
    g.addEdge('B', 'C', 100);
    g.addEdge('A', 'C', 150); // shorter total cost
    expect(g.findPath('A', 'C')).toEqual(['A', 'C']);
  });
});

// ---------------------------------------------------------------------------
// findPath – terrain filter
// ---------------------------------------------------------------------------
describe('LevelGraph – findPath with filter', () => {
  it('routes around filtered vertex', () => {
    //   A --(10)--> B --(10)--> C
    //   A --(50)--> C  (direct but expensive)
    const g = new LevelGraph()
      .addVertex('A', 0,   0)
      .addVertex('B', 100, 0, ['danger'])
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 10);
    g.addEdge('B', 'C', 10);
    g.addEdge('A', 'C', 50);

    const noDanger: (v: IGraphVertex) => boolean = (v) => !v.tags.includes('danger');
    expect(g.findPath('A', 'C', noDanger)).toEqual(['A', 'C']);
  });

  it('returns null when filter blocks only available path', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0, ['danger'])
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 10);
    g.addEdge('B', 'C', 10);

    const noDanger: (v: IGraphVertex) => boolean = (v) => !v.tags.includes('danger');
    expect(g.findPath('A', 'C', noDanger)).toBeNull();
  });

  it('goal vertex is never filtered (can reach even if tagged)', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0, ['danger']);
    g.addEdge('A', 'B', 10);

    const noDanger: (v: IGraphVertex) => boolean = (v) => !v.tags.includes('danger');
    // Goal itself is allowed through even if it matches filter
    expect(g.findPath('A', 'B', noDanger)).toEqual(['A', 'B']);
  });

  it('filter receives correct vertex object for intermediate vertices', () => {
    const visited: string[] = [];
    // A → B → C: B is intermediate, so the filter should be called for B
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0)
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 10);
    g.addEdge('B', 'C', 10);

    g.findPath('A', 'C', (v) => { visited.push(v.id); return true; });
    // B is an intermediate vertex and should be evaluated by the filter
    expect(visited).toContain('B');
  });
});

// ---------------------------------------------------------------------------
// interpolatePosition
// ---------------------------------------------------------------------------
describe('LevelGraph – interpolatePosition', () => {
  it('t=0 returns from vertex position', () => {
    const g = new LevelGraph()
      .addVertex('A', 100, 200)
      .addVertex('B', 300, 400);
    expect(g.interpolatePosition('A', 'B', 0)).toEqual({ x: 100, y: 200 });
  });

  it('t=1 returns to vertex position', () => {
    const g = new LevelGraph()
      .addVertex('A', 100, 200)
      .addVertex('B', 300, 400);
    expect(g.interpolatePosition('A', 'B', 1)).toEqual({ x: 300, y: 400 });
  });

  it('t=0.5 returns midpoint', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 200, 100);
    const mid = g.interpolatePosition('A', 'B', 0.5);
    expect(mid.x).toBeCloseTo(100, 5);
    expect(mid.y).toBeCloseTo(50, 5);
  });

  it('clamps t below 0 to 0', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    expect(g.interpolatePosition('A', 'B', -0.5)).toEqual({ x: 0, y: 0 });
  });

  it('clamps t above 1 to 1', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    expect(g.interpolatePosition('A', 'B', 2)).toEqual({ x: 100, y: 0 });
  });

  it('returns {0, 0} for unknown vertex', () => {
    const g = new LevelGraph().addVertex('A', 0, 0);
    expect(g.interpolatePosition('A', 'MISSING', 0.5)).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// edgeWeight
// ---------------------------------------------------------------------------
describe('LevelGraph – edgeWeight', () => {
  it('returns weight for existing edge', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 0, 10);
    g.addEdge('A', 'B', 77);
    expect(g.edgeWeight('A', 'B')).toBe(77);
  });

  it('returns Infinity for non-existent edge', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 0, 10);
    expect(g.edgeWeight('A', 'B')).toBe(Infinity);
  });

  it('returns Infinity for unknown source vertex', () => {
    const g = new LevelGraph().addVertex('B', 0, 0);
    expect(g.edgeWeight('X', 'B')).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// vertexCount / edgeCount
// ---------------------------------------------------------------------------
describe('LevelGraph – vertexCount / edgeCount', () => {
  it('starts at 0 for empty graph', () => {
    const g = new LevelGraph();
    expect(g.vertexCount).toBe(0);
    expect(g.edgeCount).toBe(0);
  });

  it('counts vertices correctly', () => {
    const g = buildLinear(); // 4 vertices
    expect(g.vertexCount).toBe(4);
  });

  it('counts directed edges correctly (undirected adds 2)', () => {
    const g = buildLinear(); // 3 undirected edges = 6 directed edges
    expect(g.edgeCount).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// hasVertex / vertexIds / removeVertex
// ---------------------------------------------------------------------------
describe('LevelGraph – hasVertex', () => {
  it('returns true for existing vertex', () => {
    const g = new LevelGraph().addVertex('X', 0, 0);
    expect(g.hasVertex('X')).toBe(true);
  });

  it('returns false for unknown vertex', () => {
    const g = new LevelGraph();
    expect(g.hasVertex('X')).toBe(false);
  });
});

describe('LevelGraph – vertexIds', () => {
  it('iterates over all vertex IDs', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 1, 0)
      .addVertex('C', 2, 0);
    const ids = Array.from(g.vertexIds()).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});

describe('LevelGraph – vertices', () => {
  it('iterates over all IGraphVertex values', () => {
    const g = new LevelGraph()
      .addVertex('A', 10, 20, ['indoor'])
      .addVertex('B', 30, 40);
    const all = Array.from(g.vertices()).sort((a, b) => a.id.localeCompare(b.id));
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: 'A', x: 10, y: 20 });
    expect(all[1]).toMatchObject({ id: 'B', x: 30, y: 40 });
  });

  it('returns empty iterator for empty graph', () => {
    const g = new LevelGraph();
    expect(Array.from(g.vertices())).toHaveLength(0);
  });
});

describe('LevelGraph – removeVertex', () => {
  it('removes the vertex and its outgoing edges', () => {
    const g = buildLinear();
    expect(g.hasVertex('B')).toBe(true);
    g.removeVertex('B');
    expect(g.hasVertex('B')).toBe(false);
    expect(g.getEdges('B')).toEqual([]);
    expect(g.vertexCount).toBe(3);
  });

  it('returns this for fluent chaining', () => {
    const g = new LevelGraph().addVertex('A', 0, 0);
    expect(g.removeVertex('A')).toBe(g);
  });

  it('returns no path after removing a bridge vertex', () => {
    //  A → B → C  (B is the only bridge, removing it makes A→C unreachable)
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0)
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B').addEdge('B', 'C');
    g.removeVertex('B');
    expect(g.findPath('A', 'C')).toBeNull();
  });

  it('removes incoming edges from other vertices when vertex is deleted', () => {
    // A → B, B → A (undirected), remove B → A's edge to B must be gone
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    g.addUndirectedEdge('A', 'B');
    expect(g.getEdges('A').some(e => e.to === 'B')).toBe(true);
    g.removeVertex('B');
    // A→B edge should be removed because B no longer exists
    expect(g.getEdges('A').some(e => e.to === 'B')).toBe(false);
  });

  it('edge count decreases for both outgoing and incoming edges on removal', () => {
    // A ↔ B: 2 directed edges total, removing B should leave 0 edges
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 10, 0);
    g.addUndirectedEdge('A', 'B');
    expect(g.edgeCount).toBe(2);
    g.removeVertex('B');
    expect(g.edgeCount).toBe(0);
  });

  it('cleans up multiple incoming edges from different vertices', () => {
    // A→C, B→C, C→D — remove C cleans A→C, B→C, C→D
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 0, 100)
      .addVertex('C', 100, 50)
      .addVertex('D', 200, 50);
    g.addEdge('A', 'C');
    g.addEdge('B', 'C');
    g.addEdge('C', 'D');
    expect(g.edgeCount).toBe(3);
    g.removeVertex('C');
    expect(g.edgeCount).toBe(0);
    expect(g.getEdges('A')).toHaveLength(0);
    expect(g.getEdges('B')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fluent API
// ---------------------------------------------------------------------------
describe('LevelGraph – fluent API', () => {
  it('addVertex returns this', () => {
    const g = new LevelGraph();
    expect(g.addVertex('A', 0, 0)).toBe(g);
  });

  it('addEdge returns this', () => {
    const g = new LevelGraph().addVertex('A', 0, 0).addVertex('B', 1, 0);
    expect(g.addEdge('A', 'B')).toBe(g);
  });

  it('addUndirectedEdge returns this', () => {
    const g = new LevelGraph().addVertex('A', 0, 0).addVertex('B', 1, 0);
    expect(g.addUndirectedEdge('A', 'B')).toBe(g);
  });
});

// ---------------------------------------------------------------------------
// serialize / restore
// ---------------------------------------------------------------------------
describe('LevelGraph – serialize / restore', () => {
  it('serialize produces correct vertex count and edge count', () => {
    const g = buildLinear(); // 4 vertices, 3 undirected = 6 directed edges
    const state: ILevelGraphState = g.serialize();
    expect(state.vertices).toHaveLength(4);
    const totalEdges = state.edges.reduce((n, entry) => n + entry.edges.length, 0);
    expect(totalEdges).toBe(6);
  });

  it('serialized vertices have correct fields', () => {
    const g = new LevelGraph()
      .addVertex('X', 10, 20, ['indoor', 'safe'])
      .addVertex('Y', 30, 40);
    const state = g.serialize();
    const vx = state.vertices.find(v => v.id === 'X');
    expect(vx).toBeDefined();
    expect(vx?.x).toBe(10);
    expect(vx?.y).toBe(20);
    expect(vx?.tags).toEqual(['indoor', 'safe']);
  });

  it('serialized tags are independent copies (no shared reference)', () => {
    const g = new LevelGraph().addVertex('A', 0, 0, ['tag1']);
    const state = g.serialize();
    state.vertices[0].tags.push('extra');
    // original graph vertex should be unaffected
    expect(g.getVertex('A')?.tags).toEqual(['tag1']);
  });

  it('restore round-trips vertices correctly', () => {
    const original = buildLinear();
    const restored = LevelGraph.restore(original.serialize());
    expect(restored.vertexCount).toBe(original.vertexCount);
    expect(restored.getVertex('A')).toMatchObject({ id: 'A', x: 0, y: 0 });
    expect(restored.getVertex('D')).toMatchObject({ id: 'D', x: 300, y: 0 });
  });

  it('restore round-trips edges correctly', () => {
    const original = buildLinear();
    const restored = LevelGraph.restore(original.serialize());
    expect(restored.edgeCount).toBe(original.edgeCount);
    expect(restored.edgeWeight('A', 'B')).toBeCloseTo(100, 5);
    expect(restored.edgeWeight('B', 'A')).toBeCloseTo(100, 5);
  });

  it('findPath works on restored graph', () => {
    const original = buildLinear();
    const restored = LevelGraph.restore(original.serialize());
    expect(restored.findPath('A', 'D')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('restored graph has independent state from original', () => {
    const original = buildLinear();
    const restored = LevelGraph.restore(original.serialize());
    original.addVertex('E', 400, 0).addUndirectedEdge('D', 'E');
    expect(restored.hasVertex('E')).toBe(false);
    expect(restored.vertexCount).toBe(4);
  });

  it('serialize preserves custom edge weights', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 0, 0);
    g.addEdge('A', 'B', 42);
    const restored = LevelGraph.restore(g.serialize());
    expect(restored.edgeWeight('A', 'B')).toBe(42);
  });

  it('round-trip preserves vertex tags', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0, ['outdoor', 'danger']);
    const restored = LevelGraph.restore(g.serialize());
    expect(restored.getVertex('A')?.tags).toEqual(['outdoor', 'danger']);
  });
});
