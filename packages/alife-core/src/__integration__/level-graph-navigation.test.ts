// Integration tests: LevelGraph + NPCGraphMover end-to-end navigation
//
// Tests cover graph construction, A* pathfinding, mover movement lifecycle,
// terrain filtering, serialization round-trips, and multi-NPC isolation.
// No vi.fn() — all objects are real instances.

import { describe, it, expect, beforeEach } from 'vitest';
import { LevelGraph } from '../navigation/LevelGraph';
import { NPCGraphMover } from '../navigation/NPCGraphMover';

// ---------------------------------------------------------------------------
// Helper: build reusable graphs
// ---------------------------------------------------------------------------

/**
 * Linear graph: A(0,0) — B(100,0) — C(200,0) — D(300,0)
 * All edges undirected, weight = Euclidean distance (100 each).
 */
function buildLinear(): LevelGraph {
  return new LevelGraph()
    .addVertex('A', 0, 0)
    .addVertex('B', 100, 0)
    .addVertex('C', 200, 0)
    .addVertex('D', 300, 0)
    .addUndirectedEdge('A', 'B', 100)
    .addUndirectedEdge('B', 'C', 100)
    .addUndirectedEdge('C', 'D', 100);
}

/**
 * Diamond graph — two routes from S to T:
 *   S → L → T  (left, weight 50 + 50 = 100)
 *   S → R → T  (right, weight 200 + 200 = 400)
 */
function buildDiamond(): LevelGraph {
  return new LevelGraph()
    .addVertex('S', 0, 0)
    .addVertex('L', 100, -50)
    .addVertex('R', 100, 50)
    .addVertex('T', 200, 0)
    .addEdge('S', 'L', 50)
    .addEdge('L', 'T', 50)
    .addEdge('S', 'R', 200)
    .addEdge('R', 'T', 200);
}

/**
 * Tagged hazard graph:
 *   A → B(danger) → C   (short route via danger zone)
 *   A → D → C           (longer safe route)
 */
function buildHazardGraph(): LevelGraph {
  return new LevelGraph()
    .addVertex('A', 0, 0)
    .addVertex('B', 100, 0, ['danger', 'outdoor'])
    .addVertex('C', 200, 0)
    .addVertex('D', 100, 100, ['outdoor'])
    .addEdge('A', 'B', 100)
    .addEdge('B', 'C', 100)
    .addEdge('A', 'D', 150)
    .addEdge('D', 'C', 150);
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

describe('LevelGraph – construction integration', () => {
  it('builds a linear graph with correct vertex and edge counts', () => {
    const g = buildLinear();
    expect(g.vertexCount).toBe(4);
    expect(g.edgeCount).toBe(6); // 3 undirected → 6 directed
  });

  it('fluent API chains addVertex + addEdge correctly', () => {
    const g = new LevelGraph()
      .addVertex('X', 10, 20, ['indoor'])
      .addVertex('Y', 30, 40)
      .addEdge('X', 'Y', 25);

    expect(g.hasVertex('X')).toBe(true);
    expect(g.hasVertex('Y')).toBe(true);
    expect(g.edgeWeight('X', 'Y')).toBe(25);
    expect(g.edgeWeight('Y', 'X')).toBe(Infinity); // directed only
  });

  it('addUndirectedEdge creates symmetric edges with identical weight', () => {
    const g = new LevelGraph()
      .addVertex('P', 0, 0)
      .addVertex('Q', 30, 40); // distance = 50
    g.addUndirectedEdge('P', 'Q');

    expect(g.edgeWeight('P', 'Q')).toBeCloseTo(50, 3);
    expect(g.edgeWeight('Q', 'P')).toBeCloseTo(50, 3);
  });

  it('vertex tags are preserved and readable', () => {
    const g = new LevelGraph().addVertex('Z', 5, 10, ['indoor', 'shelter', 'safe']);
    const v = g.getVertex('Z');
    expect(v?.tags).toEqual(['indoor', 'shelter', 'safe']);
  });

  it('unknown vertex returns undefined from getVertex', () => {
    const g = new LevelGraph();
    expect(g.getVertex('missing')).toBeUndefined();
  });

  it('adding edge for unknown vertices is silently ignored', () => {
    const g = new LevelGraph().addVertex('A', 0, 0);
    g.addEdge('A', 'GHOST'); // GHOST does not exist
    expect(g.edgeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findPath — routing logic
// ---------------------------------------------------------------------------

describe('LevelGraph – findPath integration', () => {
  it('returns direct single-hop path', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    g.addEdge('A', 'B', 100);

    expect(g.findPath('A', 'B')).toEqual(['A', 'B']);
  });

  it('returns [start] when start equals goal', () => {
    const g = buildLinear();
    expect(g.findPath('C', 'C')).toEqual(['C']);
  });

  it('returns null when no path exists (no edges)', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    // Intentionally no edges
    expect(g.findPath('A', 'B')).toBeNull();
  });

  it('returns null for unknown start vertex', () => {
    const g = buildLinear();
    expect(g.findPath('MISSING', 'D')).toBeNull();
  });

  it('finds 4-hop path A → B → C → D in linear graph', () => {
    const g = buildLinear();
    expect(g.findPath('A', 'D')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('finds reverse path D → C → B → A in undirected linear graph', () => {
    const g = buildLinear();
    expect(g.findPath('D', 'A')).toEqual(['D', 'C', 'B', 'A']);
  });

  it('prefers cheaper path in diamond graph (left route is shorter)', () => {
    const g = buildDiamond();
    const path = g.findPath('S', 'T');
    // Left route (S→L→T, cost 100) must win over right route (S→R→T, cost 400)
    expect(path).toEqual(['S', 'L', 'T']);
  });
});

// ---------------------------------------------------------------------------
// findPath — terrain filter
// ---------------------------------------------------------------------------

describe('LevelGraph – findPath with terrain filter integration', () => {
  it('routes around danger-tagged vertex when filter excludes it', () => {
    const g = buildHazardGraph();
    const noDanger = (v: { tags: ReadonlyArray<string> }) => !v.tags.includes('danger');
    const path = g.findPath('A', 'C', noDanger);
    // B is filtered → must go A→D→C
    expect(path).toEqual(['A', 'D', 'C']);
  });

  it('returns null when filter blocks the only available route', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0, ['danger'])
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 100);
    g.addEdge('B', 'C', 100);
    // No alternative route
    const noDanger = (v: { tags: ReadonlyArray<string> }) => !v.tags.includes('danger');
    expect(g.findPath('A', 'C', noDanger)).toBeNull();
  });

  it('goal vertex tagged "danger" is still reachable (goal is never filtered)', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('GOAL', 100, 0, ['danger']);
    g.addEdge('A', 'GOAL', 100);
    const noDanger = (v: { tags: ReadonlyArray<string> }) => !v.tags.includes('danger');
    expect(g.findPath('A', 'GOAL', noDanger)).toEqual(['A', 'GOAL']);
  });
});

// ---------------------------------------------------------------------------
// NPCGraphMover — movement lifecycle
// ---------------------------------------------------------------------------

describe('NPCGraphMover – movement lifecycle integration', () => {
  let graph: LevelGraph;

  beforeEach(() => {
    graph = buildLinear();
  });

  it('is idle at start (not moving, walkedDistance=0, no events)', () => {
    const mover = new NPCGraphMover(graph, 'A', 100);
    expect(mover.isMoving).toBe(false);
    expect(mover.walkedDistance).toBe(0);
    expect(mover.events).toHaveLength(0);
    expect(mover.currentVertexId).toBe('A');
  });

  it('moveTo returns true and starts movement for valid destination', () => {
    const mover = new NPCGraphMover(graph, 'A', 100);
    const started = mover.moveTo('D');
    expect(started).toBe(true);
    expect(mover.isMoving).toBe(true);
    expect(mover.nextVertexId).toBe('B');
  });

  it('moveTo returns false and emits no_path when no route exists', () => {
    const isolated = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    const mover = new NPCGraphMover(isolated, 'A', 100);
    const started = mover.moveTo('B');
    expect(started).toBe(false);
    expect(mover.events).toHaveLength(1);
    expect(mover.events[0].type).toBe('no_path');
  });

  it('advance(deltaMs) moves NPC partial distance along edge', () => {
    // speed=100 px/s, edge weight=100, deltaMs=500 → walked=50
    const mover = new NPCGraphMover(graph, 'A', 100);
    mover.moveTo('D');
    mover.update(500);
    expect(mover.walkedDistance).toBeCloseTo(50, 3);
    expect(mover.currentVertexId).toBe('A');
    expect(mover.isMoving).toBe(true);
  });

  it('advance reaches next vertex and emits arrived event', () => {
    // speed=100, edge=100, deltaMs=1000 → arrives at B
    const mover = new NPCGraphMover(graph, 'A', 100);
    mover.moveTo('D');
    mover.update(1000);
    expect(mover.currentVertexId).toBe('B');
    expect(mover.walkedDistance).toBe(0);
    expect(mover.events.some((e) => e.type === 'arrived')).toBe(true);
  });

  it('NPC reaches final destination and emits completed event', () => {
    // A→B, deltaMs=1000 → arrives at B and completes (B is goal)
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('B');
    mover.update(1000);

    expect(mover.currentVertexId).toBe('B');
    expect(mover.isMoving).toBe(false);
    expect(mover.events.some((e) => e.type === 'completed')).toBe(true);
  });

  it('traverses full A→B→C→D path across 3 separate update() calls', () => {
    const mover = new NPCGraphMover(graph, 'A', 100);
    mover.moveTo('D');

    mover.update(1000); // A → B
    expect(mover.currentVertexId).toBe('B');

    mover.update(1000); // B → C
    expect(mover.currentVertexId).toBe('C');

    mover.update(1000); // C → D
    expect(mover.currentVertexId).toBe('D');
    expect(mover.isMoving).toBe(false);
  });

  it('overshoot: single large update traverses entire path', () => {
    const mover = new NPCGraphMover(graph, 'A', 100);
    mover.moveTo('D');
    mover.update(3000); // 3s × 100 px/s = 300 units = 3 edges
    expect(mover.currentVertexId).toBe('D');
    expect(mover.isMoving).toBe(false);
    const arrived = mover.events.filter((e) => e.type === 'arrived');
    const completed = mover.events.filter((e) => e.type === 'completed');
    expect(arrived).toHaveLength(2); // B and C
    expect(completed).toHaveLength(1); // D
  });

  it('events are cleared at the start of each update()', () => {
    const mover = new NPCGraphMover(graph, 'A', 100);
    mover.moveTo('D');
    mover.update(1000); // emits arrived@B
    expect(mover.events.length).toBeGreaterThan(0);
    mover.update(500);  // partial advance, no new vertex crossings
    expect(mover.events).toHaveLength(0);
  });

  it('worldPosition interpolates correctly at midpoint of edge', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 200, 0);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('B');
    mover.update(500); // 50 units into 100-unit edge → t=0.5 → x=100
    const pos = mover.worldPosition;
    expect(pos.x).toBeCloseTo(100, 3);
    expect(pos.y).toBeCloseTo(0, 3);
  });
});

// ---------------------------------------------------------------------------
// NPCGraphMover — terrain filter during pathfinding
// ---------------------------------------------------------------------------

describe('NPCGraphMover – terrain-filtered moveTo integration', () => {
  it('moveTo with filter avoids danger vertex and uses alternate route', () => {
    const g = buildHazardGraph();
    const mover = new NPCGraphMover(g, 'A', 100);
    const noDanger = (v: { tags: ReadonlyArray<string> }) => !v.tags.includes('danger');
    const ok = mover.moveTo('C', noDanger);
    expect(ok).toBe(true);
    // Path should go A→D→C, so next vertex is D (not B)
    expect(mover.nextVertexId).toBe('D');
  });

  it('moveTo with filter returns false when only path is blocked', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0, ['danger'])
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 100);
    g.addEdge('B', 'C', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    const noDanger = (v: { tags: ReadonlyArray<string> }) => !v.tags.includes('danger');
    expect(mover.moveTo('C', noDanger)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NPCGraphMover — serialization round-trip
// ---------------------------------------------------------------------------

describe('NPCGraphMover – serialize/restore integration', () => {
  it('serializes and restores mid-path state, then continues to destination', () => {
    const graph = buildLinear();
    const mover = new NPCGraphMover(graph, 'A', 100);
    mover.moveTo('D');
    mover.update(1500); // crosses A→B (1000ms), 500ms into B→C

    const state = mover.serialize();
    expect(state.currentVertexId).toBe('B');
    expect(state.nextVertexId).toBe('C');
    expect(state.walkedDistance).toBeCloseTo(50, 3);

    const mover2 = new NPCGraphMover(graph, 'A', 1); // different initial speed, will be overwritten
    mover2.restore(state);

    expect(mover2.currentVertexId).toBe('B');
    expect(mover2.isMoving).toBe(true);
    expect(mover2.speed).toBe(100); // speed from serialized state

    // Needs 500ms to finish B→C then 1000ms for C→D = 1500ms
    mover2.update(1500);
    expect(mover2.currentVertexId).toBe('D');
    expect(mover2.isMoving).toBe(false);
  });

  it('restored mover with timeFactor=2 moves at double speed', () => {
    const graph = buildLinear();
    const mover = new NPCGraphMover(graph, 'A', 100, 2);
    mover.moveTo('D');
    mover.update(500); // 0.5s × 2 × 100 = 100 units → crosses A→B

    const state = mover.serialize();
    const mover2 = new NPCGraphMover(graph, 'X', 50, 1); // will be overwritten by restore
    mover2.restore(state);

    // Both speed=100 and timeFactor=2 should be restored
    expect(mover2.speed).toBe(100);

    // Now at B with remaining path B→C→D; at timeFactor=2:
    // 1000ms × 2 × 100 = 200 units → crosses B→C (100) then crosses C→D (100) → arrives at D
    mover2.update(1000);
    expect(mover2.currentVertexId).toBe('D');
  });
});

// ---------------------------------------------------------------------------
// Multiple NPCGraphMovers — independent state (no cross-contamination)
// ---------------------------------------------------------------------------

describe('Multiple NPCGraphMovers on same graph — isolation', () => {
  it('two NPCGraphMovers move independently on the same graph', () => {
    const graph = buildLinear();

    const npc1 = new NPCGraphMover(graph, 'A', 100); // starts at A
    const npc2 = new NPCGraphMover(graph, 'D', 100); // starts at D

    npc1.moveTo('D'); // A → B → C → D
    npc2.moveTo('A'); // D → C → B → A

    npc1.update(1000); // npc1 crosses to B
    npc2.update(1000); // npc2 crosses to C

    expect(npc1.currentVertexId).toBe('B');
    expect(npc2.currentVertexId).toBe('C');

    npc1.update(2000); // npc1 finishes: B→C→D
    npc2.update(2000); // npc2 finishes: C→B→A

    expect(npc1.currentVertexId).toBe('D');
    expect(npc1.isMoving).toBe(false);
    expect(npc2.currentVertexId).toBe('A');
    expect(npc2.isMoving).toBe(false);
  });

  it('teleporting one NPC does not affect the other', () => {
    const graph = buildLinear();
    const npc1 = new NPCGraphMover(graph, 'A', 100);
    const npc2 = new NPCGraphMover(graph, 'A', 100);

    npc1.moveTo('D');
    npc2.moveTo('D');

    // Advance both 500ms so npc2 has non-zero walkedDistance
    npc1.update(500);
    npc2.update(500); // npc2 walked 50px independently

    // Teleport npc1 — npc2 must be unaffected
    npc1.teleport('C');

    expect(npc1.currentVertexId).toBe('C');
    expect(npc1.isMoving).toBe(false);
    expect(npc2.walkedDistance).toBeCloseTo(50, 3); // npc2 unchanged by npc1's teleport
    expect(npc2.currentVertexId).toBe('A');
  });
});
