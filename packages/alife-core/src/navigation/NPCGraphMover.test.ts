import { describe, it, expect } from 'vitest';
import { LevelGraph } from './LevelGraph';
import { NPCGraphMover } from './NPCGraphMover';

// ---------------------------------------------------------------------------
// Helper: build a linear graph  A(0,0) → B(100,0) → C(200,0) → D(300,0)
// All edges have weight 100.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
describe('NPCGraphMover – initial state', () => {
  it('starts at the given vertex, not moving', () => {
    const mover = new NPCGraphMover(buildLinear(), 'A', 80);
    expect(mover.currentVertexId).toBe('A');
    expect(mover.nextVertexId).toBeNull();
    expect(mover.isMoving).toBe(false);
    expect(mover.walkedDistance).toBe(0);
    expect(mover.events).toHaveLength(0);
  });

  it('exposes stored speed', () => {
    const mover = new NPCGraphMover(buildLinear(), 'A', 80);
    expect(mover.speed).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// moveTo – basic
// ---------------------------------------------------------------------------
describe('NPCGraphMover – moveTo', () => {
  it('returns true and stays idle when destination equals current vertex', () => {
    const mover = new NPCGraphMover(buildLinear(), 'B', 80);
    const result = mover.moveTo('B');
    expect(result).toBe(true);
    expect(mover.isMoving).toBe(false);
  });

  it('returns true and begins moving when a valid path exists', () => {
    const mover = new NPCGraphMover(buildLinear(), 'A', 80);
    const result = mover.moveTo('D');
    expect(result).toBe(true);
    expect(mover.isMoving).toBe(true);
    expect(mover.nextVertexId).toBe('B');
  });

  it('returns false and emits no_path event when no path exists', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    // no edges
    const mover = new NPCGraphMover(g, 'A', 80);
    const result = mover.moveTo('B');
    expect(result).toBe(false);
    const events = mover.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('no_path');
    if (events[0].type === 'no_path') {
      expect(events[0].from).toBe('A');
      expect(events[0].to).toBe('B');
    }
  });

  it('accepts optional terrain filter', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0, ['danger'])
      .addVertex('C', 200, 0);
    g.addEdge('A', 'B', 100);
    g.addEdge('B', 'C', 100);
    g.addEdge('A', 'C', 300);

    const mover = new NPCGraphMover(g, 'A', 100);
    // filter blocks B: must go A→C directly
    const ok = mover.moveTo('C', v => !v.tags.includes('danger'));
    expect(ok).toBe(true);
    expect(mover.nextVertexId).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// update – partial advance
// ---------------------------------------------------------------------------
describe('NPCGraphMover – update advances walkedDistance', () => {
  it('advances by the expected distance for a partial tick', () => {
    // speed=100 px/s, timeFactor=1, edge weight=100, deltaMs=500 → walked=50
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.moveTo('D');
    mover.update(500); // 0.5s × 1 × 100 px/s = 50 px
    expect(mover.walkedDistance).toBeCloseTo(50, 5);
    expect(mover.currentVertexId).toBe('A');
    expect(mover.isMoving).toBe(true);
    expect(mover.events).toHaveLength(0);
  });

  it('does not advance when speed=0', () => {
    const mover = new NPCGraphMover(buildLinear(), 'A', 0);
    mover.moveTo('D');
    mover.update(5000);
    expect(mover.walkedDistance).toBe(0);
    expect(mover.currentVertexId).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// update – crosses a single edge
// ---------------------------------------------------------------------------
describe('NPCGraphMover – update crosses one edge', () => {
  it('emits arrived event and updates currentVertexId when edge fully traversed', () => {
    // speed=100, weight=100, deltaMs=1000 → exactly reaches B
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.moveTo('D');
    mover.update(1000);
    expect(mover.currentVertexId).toBe('B');
    expect(mover.walkedDistance).toBe(0);
    const events = mover.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('arrived');
    if (events[0].type === 'arrived') {
      expect(events[0].vertexId).toBe('B');
    }
  });
});

// ---------------------------------------------------------------------------
// update – reaches destination
// ---------------------------------------------------------------------------
describe('NPCGraphMover – update reaches destination', () => {
  it('emits completed event and stops when final vertex reached', () => {
    // A→B distance 100, speed 100, deltaMs 1000 → exactly reaches B (which is goal)
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('B');
    mover.update(1000);

    expect(mover.currentVertexId).toBe('B');
    expect(mover.isMoving).toBe(false);
    const events = mover.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('completed');
    if (events[0].type === 'completed') {
      expect(events[0].vertexId).toBe('B');
    }
  });
});

// ---------------------------------------------------------------------------
// update – multi-hop with multiple calls
// ---------------------------------------------------------------------------
describe('NPCGraphMover – multi-hop movement', () => {
  it('traverses A→B→C→D across multiple update() calls', () => {
    // speed=100, edges weight=100 each, deltaMs=1000 per call
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.moveTo('D');

    // tick 1: A→B
    mover.update(1000);
    expect(mover.currentVertexId).toBe('B');
    expect(mover.events.some(e => e.type === 'arrived')).toBe(true);

    // tick 2: B→C
    mover.update(1000);
    expect(mover.currentVertexId).toBe('C');

    // tick 3: C→D
    mover.update(1000);
    expect(mover.currentVertexId).toBe('D');
    expect(mover.isMoving).toBe(false);
    expect(mover.events.some(e => e.type === 'completed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// update – overshoot (large deltaMs covers multiple edges)
// ---------------------------------------------------------------------------
describe('NPCGraphMover – overshoot', () => {
  it('crosses A→B→C→D in a single large update', () => {
    // speed=100, edges weight=100 each, deltaMs=3000 → moves 300 units = 3 edges
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.moveTo('D');
    mover.update(3000);

    expect(mover.currentVertexId).toBe('D');
    expect(mover.isMoving).toBe(false);
    // should have 2 'arrived' events (B, C) + 1 'completed' event (D)
    const events = mover.events;
    const arrived = events.filter(e => e.type === 'arrived');
    const completed = events.filter(e => e.type === 'completed');
    expect(arrived).toHaveLength(2);
    expect(completed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// update – timeFactor (Fix C2: timeFactor multiplies movement, not divides)
// ---------------------------------------------------------------------------
describe('NPCGraphMover – timeFactor in constructor', () => {
  it('timeFactor=2 causes DOUBLE the movement compared to timeFactor=1', () => {
    const g = buildLinear();

    const moverNormal = new NPCGraphMover(g, 'A', 100, 1);
    moverNormal.moveTo('D');
    moverNormal.update(500); // 0.5s × 1 × 100 = 50 units → still on A→B

    const moverDouble = new NPCGraphMover(g, 'A', 100, 2);
    moverDouble.moveTo('D');
    moverDouble.update(500); // 0.5s × 2 × 100 = 100 units → crosses A→B exactly

    // timeFactor=1: 50 units walked, still at A
    expect(moverNormal.walkedDistance).toBeCloseTo(50, 5);
    expect(moverNormal.currentVertexId).toBe('A');
    // timeFactor=2: 100 units = crossed A→B, now at B
    expect(moverDouble.currentVertexId).toBe('B');
    expect(moverDouble.walkedDistance).toBe(0);
  });

  it('timeFactor=10, speed=100, deltaMs=1000 → moves 1000 units', () => {
    // 1s × 10 × 100 px/s = 1000 units = 10 edges of weight 100
    // Graph only has 3 edges (A→B→C→D = 300 units), so NPC reaches D and stops
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100, 10);
    mover.moveTo('D');
    mover.update(1000);
    // Reached destination (300 units < 1000, so completed)
    expect(mover.currentVertexId).toBe('D');
    expect(mover.isMoving).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setSpeed
// ---------------------------------------------------------------------------
describe('NPCGraphMover – setSpeed', () => {
  it('changes speed returned by getter', () => {
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.setSpeed(200);
    expect(mover.speed).toBe(200);
  });

  it('affects movement distance after speed change', () => {
    // Start at speed 100, walk 500ms = 50px, then change to 200, walk 500ms = 100px more
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.moveTo('D');
    mover.update(500); // walks 50px
    expect(mover.walkedDistance).toBeCloseTo(50, 5);

    mover.setSpeed(200);
    mover.update(500); // walks 100px more → 50+100 = 150px across two edges
    // After A→B (100px), then 50px into B→C
    expect(mover.currentVertexId).toBe('B');
    expect(mover.walkedDistance).toBeCloseTo(50, 5);
  });

  it('setting speed to 0 stops movement', () => {
    const mover = new NPCGraphMover(buildLinear(), 'A', 100);
    mover.moveTo('D');
    mover.update(500); // walk 50px
    mover.setSpeed(0);
    mover.update(5000); // should not move
    expect(mover.walkedDistance).toBeCloseTo(50, 5);
    expect(mover.currentVertexId).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// worldPosition
// ---------------------------------------------------------------------------
describe('NPCGraphMover – worldPosition', () => {
  it('returns start vertex position when idle (not moving)', () => {
    const g = new LevelGraph()
      .addVertex('A', 50, 75)
      .addVertex('B', 150, 75);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    expect(mover.worldPosition).toEqual({ x: 50, y: 75 });
  });

  it('returns position at t=0 (walk=0) just after moveTo', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 0);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('B');
    // walkedDistance is 0, so should return A position
    expect(mover.worldPosition).toEqual({ x: 0, y: 0 });
  });

  it('returns correct midpoint position at t=0.5', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 200, 100);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('B');
    // Advance 50 units on a 100-unit edge → t=0.5
    mover.update(500);
    const pos = mover.worldPosition;
    expect(pos.x).toBeCloseTo(100, 4);
    expect(pos.y).toBeCloseTo(50, 4);
  });

  it('returns destination vertex position after completing path', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 100, 50);
    g.addEdge('A', 'B', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('B');
    mover.update(2000); // overshoot, should arrive at B
    expect(mover.worldPosition).toEqual({ x: 100, y: 50 });
  });
});

// ---------------------------------------------------------------------------
// teleport
// ---------------------------------------------------------------------------
describe('NPCGraphMover – teleport', () => {
  it('changes current vertex and clears all movement state', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('D');
    mover.update(500);

    mover.teleport('C');
    expect(mover.currentVertexId).toBe('C');
    expect(mover.nextVertexId).toBeNull();
    expect(mover.isMoving).toBe(false);
    expect(mover.walkedDistance).toBe(0);
    expect(mover.events).toHaveLength(0);
  });

  it('can resume movement after teleport', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100);
    mover.teleport('C');
    const ok = mover.moveTo('A');
    expect(ok).toBe(true);
    expect(mover.isMoving).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// serialize / restore
// ---------------------------------------------------------------------------
describe('NPCGraphMover – serialize / restore', () => {
  it('round-trips state correctly (including speed, timeFactor, and pathCursor)', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100, 2);
    mover.moveTo('D');
    mover.update(500); // partial advance: 0.5s × 2 × 100 = 100 units → crosses A→B

    const state = mover.serialize();
    // After 100 units at timeFactor=2: crosses A→B (100 units), now at B with walkedDistance=0
    expect(state.currentVertexId).toBe('B');
    expect(state.nextVertexId).toBe('C');
    expect(state.walkedDistance).toBe(0);
    expect(Array.isArray(state.remainingPath)).toBe(true);
    expect(typeof state.pathCursor).toBe('number');
    expect(state.speed).toBe(100);
    expect(state.timeFactor).toBe(2);

    // restore into a new mover
    const mover2 = new NPCGraphMover(g, 'A', 1); // different initial speed
    mover2.restore(state);
    expect(mover2.currentVertexId).toBe('B');
    expect(mover2.nextVertexId).toBe('C');
    expect(mover2.walkedDistance).toBe(0);
    expect(mover2.isMoving).toBe(true);
    expect(mover2.speed).toBe(100); // restored
  });

  it('restored mover continues movement correctly', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('D');
    mover.update(500); // walk 50 units on A→B edge (timeFactor=1)

    const mover2 = new NPCGraphMover(g, 'A', 1);
    mover2.restore(mover.serialize());

    // Need 500 more ms to finish A→B, then 1000ms for B→C, then 1000ms for C→D
    mover2.update(2500); // should reach D
    expect(mover2.currentVertexId).toBe('D');
    expect(mover2.isMoving).toBe(false);
  });

  it('restores idle state (nextVertexId=null)', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'B', 80);
    const state = mover.serialize();

    expect(state.nextVertexId).toBeNull();
    expect(state.walkedDistance).toBe(0);
    expect(state.speed).toBe(80);
    expect(state.timeFactor).toBe(1);
    expect(state.pathCursor).toBe(0);

    const mover2 = new NPCGraphMover(g, 'A', 1);
    mover2.restore(state);
    expect(mover2.currentVertexId).toBe('B');
    expect(mover2.isMoving).toBe(false);
  });

  it('serialize includes timeFactor when custom value provided', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 50, 3);
    const state = mover.serialize();
    expect(state.speed).toBe(50);
    expect(state.timeFactor).toBe(3);
  });

  it('serialize mid-path includes pathCursor and restore resumes from correct position', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('D');
    // Walk exactly to B (1000ms × 1 × 100 = 100 units = first edge)
    mover.update(1000);
    expect(mover.currentVertexId).toBe('B');
    // Now mid-path: on B→C segment
    mover.update(500); // walk 50 units into B→C
    expect(mover.walkedDistance).toBeCloseTo(50, 5);

    const state = mover.serialize();
    expect(state.currentVertexId).toBe('B');
    expect(state.nextVertexId).toBe('C');
    expect(state.pathCursor).toBeGreaterThanOrEqual(0);

    const mover2 = new NPCGraphMover(g, 'A', 1);
    mover2.restore(state);
    expect(mover2.currentVertexId).toBe('B');
    expect(mover2.walkedDistance).toBeCloseTo(50, 5);

    // Need 500ms more to finish B→C, then 1000ms for C→D
    mover2.update(1500);
    expect(mover2.currentVertexId).toBe('D');
    expect(mover2.isMoving).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// events are cleared each update
// ---------------------------------------------------------------------------
describe('NPCGraphMover – events reset each update', () => {
  it('pending events are cleared at the start of each update call', () => {
    const g = buildLinear();
    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('D');

    // First update: crosses A→B, emits 'arrived'
    mover.update(1000);
    expect(mover.events.length).toBeGreaterThan(0);

    // Second update: partial advance, no new events
    mover.update(500);
    expect(mover.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// edge case: zero-distance edge
// ---------------------------------------------------------------------------
describe('NPCGraphMover – edge with weight 0', () => {
  it('advances immediately through zero-weight edge without infinite loop', () => {
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 0, 0) // same position
      .addVertex('C', 100, 0);
    g.addEdge('A', 'B', 0);
    g.addEdge('B', 'C', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('C');
    // Even a tiny update should skip the zero-weight edge immediately
    mover.update(1000);
    expect(mover.currentVertexId).toBe('C');
    expect(mover.isMoving).toBe(false);
  });

  it('consecutive zero-weight edges do not cause infinite loop', () => {
    // A→B and B→C both have weight=0 (co-located waypoints)
    const g = new LevelGraph()
      .addVertex('A', 0, 0)
      .addVertex('B', 0, 0)
      .addVertex('C', 0, 0)
      .addVertex('D', 100, 0);
    g.addEdge('A', 'B', 0);
    g.addEdge('B', 'C', 0);
    g.addEdge('C', 'D', 100);

    const mover = new NPCGraphMover(g, 'A', 100);
    mover.moveTo('D');
    // Must complete without hanging; update(16) is a typical game frame
    mover.update(16);
    // NPC should have passed through A→B→C (weight=0) and started moving on C→D
    // After 0.016s × 1 × 100 = 1.6 units into C→D edge
    expect(mover.currentVertexId).toBe('C');
    expect(mover.isMoving).toBe(true);
  });
});
