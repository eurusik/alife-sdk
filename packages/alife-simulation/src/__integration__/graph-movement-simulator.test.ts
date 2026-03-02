/**
 * Integration test: "GraphMovementSimulator full pipeline".
 *
 * Tests the GraphMovementSimulator end-to-end:
 *   LevelGraph construction → NPCGraphMover traversal → EventBus NPC_MOVED
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LevelGraph, EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { GraphMovementSimulator } from '../movement/GraphMovementSimulator';

// ---------------------------------------------------------------------------
// Helpers — plain stubs, no vi.fn()
// ---------------------------------------------------------------------------

type MovedPayload = { npcId: string; fromZone: string; toZone: string };

function makeLinearGraph(): LevelGraph {
  // A(0,0) → B(100,0) → C(200,0) straight line
  return new LevelGraph()
    .addVertex('A', 0, 0)
    .addVertex('B', 100, 0)
    .addVertex('C', 200, 0)
    .addUndirectedEdge('A', 'B')
    .addUndirectedEdge('B', 'C');
}

function makeTriangleGraph(): LevelGraph {
  // A(0,0) → B(100,0) → C(50,100) with all edges
  return new LevelGraph()
    .addVertex('A', 0, 0)
    .addVertex('B', 100, 0)
    .addVertex('C', 50, 100)
    .addUndirectedEdge('A', 'B')
    .addUndirectedEdge('B', 'C')
    .addUndirectedEdge('A', 'C');
}

function makeSim(graph = makeLinearGraph(), speed = 100): {
  sim: GraphMovementSimulator;
  events: EventBus<ALifeEventPayloads>;
  moved: MovedPayload[];
} {
  const events = new EventBus<ALifeEventPayloads>();
  const moved: MovedPayload[] = [];
  events.on(ALifeEvents.NPC_MOVED, (p) => moved.push(p as MovedPayload));
  const sim = new GraphMovementSimulator(graph, events, speed);
  return { sim, events, moved };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphMovementSimulator (integration)', () => {

  // -------------------------------------------------------------------------
  // Test 1: NPC traverses waypoints A→B→C
  // -------------------------------------------------------------------------
  it('NPC traverses full path A→B→C and emits NPC_MOVED at destination', () => {
    const { sim, events, moved } = makeSim(makeLinearGraph(), 100);

    // A(0,0)→C(200,0): two edges of 100px each at 100px/s = 2000ms total
    sim.addMovingNPC('npc_1', 'zone_a', 'zone_c', { x: 0, y: 0 }, { x: 200, y: 0 });

    expect(sim.isMoving('npc_1')).toBe(true);

    // Not finished after 1500ms (only 1.5 edges done)
    sim.update(1_500);
    events.flush();
    expect(moved).toHaveLength(0);
    expect(sim.isMoving('npc_1')).toBe(true);

    // Finished after remaining 500ms
    sim.update(500);
    events.flush();
    expect(moved).toHaveLength(1);
    expect(moved[0]!.npcId).toBe('npc_1');
    expect(moved[0]!.fromZone).toBe('zone_a');
    expect(moved[0]!.toZone).toBe('zone_c');
    expect(sim.isMoving('npc_1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: Arrival detection — NPC reaches the first waypoint (A→B) and continues
  // -------------------------------------------------------------------------
  it('NPC reaches waypoint B and continues to C without stopping', () => {
    const { sim, events, moved } = makeSim(makeLinearGraph(), 100);

    sim.addMovingNPC('npc_2', 'zone_a', 'zone_c', { x: 0, y: 0 }, { x: 200, y: 0 });

    // After exactly 1000ms NPC should be at B but not yet completed (still going to C)
    sim.update(1_000);
    events.flush();
    expect(moved).toHaveLength(0); // not done yet
    expect(sim.isMoving('npc_2')).toBe(true);

    // After another 1000ms (total 2000ms) NPC reaches C
    sim.update(1_000);
    events.flush();
    expect(moved).toHaveLength(1);
    expect(moved[0]!.npcId).toBe('npc_2');
  });

  // -------------------------------------------------------------------------
  // Test 3: advance(deltaMs) — progress proportional to time
  // -------------------------------------------------------------------------
  it('advance(deltaMs) moves NPC proportionally: 500ms = half of A→B edge', () => {
    const { sim } = makeSim(makeLinearGraph(), 100);

    // A(0,0)→B(100,0) at 100px/s: 500ms should be halfway
    sim.addMovingNPC('npc_3', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });

    sim.update(500);
    const pos = sim.getPosition('npc_3');
    expect(pos).not.toBeNull();
    // x should be approximately 50 (halfway between 0 and 100)
    expect(pos!.x).toBeCloseTo(50, 0);
    expect(pos!.y).toBeCloseTo(0, 0);
  });

  // -------------------------------------------------------------------------
  // Test 4: NPC reaches the final waypoint → isMoving = false
  // -------------------------------------------------------------------------
  it('NPC reaches final waypoint → isMoving() returns false', () => {
    const { sim, events } = makeSim(makeLinearGraph(), 100);

    sim.addMovingNPC('npc_4', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(sim.isMoving('npc_4')).toBe(true);

    sim.update(2_000); // plenty of time to complete
    events.flush();

    expect(sim.isMoving('npc_4')).toBe(false);
    expect(sim.getPosition('npc_4')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 5: Multiple NPCs move concurrently, each tracked independently
  // -------------------------------------------------------------------------
  it('multiple NPCs move concurrently with independent positions', () => {
    const { sim, events, moved } = makeSim(makeLinearGraph(), 100);

    // npc_fast on A→B (100px), npc_slow on A→B but will take 2x as long?
    // Actually both at same speed, just different routes
    sim.addMovingNPC('npc_a', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 }); // 1000ms
    sim.addMovingNPC('npc_c', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 }); // 2000ms

    expect(sim.activeCount).toBe(2);

    // After 1000ms: npc_a finishes, npc_c is at B
    sim.update(1_000);
    events.flush();
    expect(moved).toHaveLength(1);
    expect(moved[0]!.npcId).toBe('npc_a');
    expect(sim.isMoving('npc_a')).toBe(false);
    expect(sim.isMoving('npc_c')).toBe(true);

    // npc_c is at position B (100,0) at this point
    const posMid = sim.getPosition('npc_c');
    // It should be at or near B (100,0) — intermediate snap
    expect(posMid).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 6: Position interpolation at t=0.25, t=0.75
  // -------------------------------------------------------------------------
  it('getPosition returns correctly interpolated position along edge', () => {
    const { sim } = makeSim(makeLinearGraph(), 100);

    sim.addMovingNPC('npc_interp', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });

    // t = 0.25 → x = 25
    sim.update(250);
    const pos25 = sim.getPosition('npc_interp');
    expect(pos25).not.toBeNull();
    expect(pos25!.x).toBeCloseTo(25, 0);

    // t = 0.75 → x = 75
    sim.update(500); // total 750ms
    const pos75 = sim.getPosition('npc_interp');
    expect(pos75).not.toBeNull();
    expect(pos75!.x).toBeCloseTo(75, 0);
  });

  // -------------------------------------------------------------------------
  // Test 7: cancelJourney stops NPC and no NPC_MOVED is emitted
  // -------------------------------------------------------------------------
  it('cancelJourney stops progression and suppresses NPC_MOVED', () => {
    const { sim, events, moved } = makeSim(makeLinearGraph(), 100);

    sim.addMovingNPC('npc_cancel', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });
    sim.update(500); // partway through

    expect(sim.isMoving('npc_cancel')).toBe(true);
    sim.cancelJourney('npc_cancel');

    expect(sim.isMoving('npc_cancel')).toBe(false);
    expect(sim.getPosition('npc_cancel')).toBeNull();

    // Extra update after cancel should not emit
    sim.update(5_000);
    events.flush();
    expect(moved).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 8: Fallback — no graph vertices → NPC_MOVED emitted immediately
  // -------------------------------------------------------------------------
  it('empty graph fallback: NPC_MOVED emitted immediately without update()', () => {
    const emptyGraph = new LevelGraph();
    const events = new EventBus<ALifeEventPayloads>();
    const moved: MovedPayload[] = [];
    events.on(ALifeEvents.NPC_MOVED, (p) => moved.push(p as MovedPayload));
    const sim = new GraphMovementSimulator(emptyGraph, events, 100);

    sim.addMovingNPC('npc_teleport', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 500, y: 500 });
    events.flush();

    expect(moved).toHaveLength(1);
    expect(moved[0]!.npcId).toBe('npc_teleport');
    expect(sim.isMoving('npc_teleport')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 9: Fallback — disconnected graph → NPC_MOVED emitted immediately
  // -------------------------------------------------------------------------
  it('disconnected graph: no path between vertices → NPC_MOVED emitted immediately', () => {
    const graph = new LevelGraph()
      .addVertex('island_a', 0, 0)
      .addVertex('island_b', 1000, 1000);
    // No edges between them

    const events = new EventBus<ALifeEventPayloads>();
    const moved: MovedPayload[] = [];
    events.on(ALifeEvents.NPC_MOVED, (p) => moved.push(p as MovedPayload));
    const sim = new GraphMovementSimulator(graph, events, 100);

    sim.addMovingNPC('npc_nopath', 'za', 'zb', { x: 0, y: 0 }, { x: 1000, y: 1000 });
    events.flush();

    expect(moved).toHaveLength(1);
    expect(sim.isMoving('npc_nopath')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 10: Replacing an active journey updates destination correctly
  // -------------------------------------------------------------------------
  it('replacing active journey mid-transit changes destination', () => {
    const { sim, events, moved } = makeSim(makeLinearGraph(), 100);

    // Start journey A→C (2000ms)
    sim.addMovingNPC('npc_reroute', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });

    // 500ms in → reroute to just A→B (overwrite)
    sim.update(500);
    expect(sim.isMoving('npc_reroute')).toBe(true);

    // Replace with shorter route (B is close to current position at 500ms mark)
    sim.addMovingNPC('npc_reroute', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(sim.activeCount).toBe(1); // still one journey

    // Complete the new shorter journey
    sim.update(2_000); // enough for any route
    events.flush();

    expect(moved).toHaveLength(1);
    expect(moved[0]!.toZone).toBe('zb'); // new destination
  });

  // -------------------------------------------------------------------------
  // Test 11: clear() removes all NPCs without emitting NPC_MOVED
  // -------------------------------------------------------------------------
  it('clear() removes all active journeys and emits no NPC_MOVED events', () => {
    const { sim, events, moved } = makeSim(makeLinearGraph(), 100);

    sim.addMovingNPC('npc_x', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
    sim.addMovingNPC('npc_y', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });

    expect(sim.activeCount).toBe(2);

    sim.clear();
    events.flush();

    expect(sim.activeCount).toBe(0);
    expect(moved).toHaveLength(0);
    expect(sim.isMoving('npc_x')).toBe(false);
    expect(sim.isMoving('npc_y')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 12: Triangle graph — NPC routes via A→C direct edge (shortest path)
  // -------------------------------------------------------------------------
  it('triangle graph: A→C uses direct edge when it is shorter', () => {
    const graph = makeTriangleGraph();
    // A(0,0)→C(50,100): Euclidean ~111px
    // A(0,0)→B(100,0)→C(50,100): 100px + ~112px ≈ 212px
    // Direct A→C is shorter

    const events = new EventBus<ALifeEventPayloads>();
    const moved: MovedPayload[] = [];
    events.on(ALifeEvents.NPC_MOVED, (p) => moved.push(p as MovedPayload));
    const sim = new GraphMovementSimulator(graph, events, 100);

    sim.addMovingNPC('npc_tri', 'zone_a', 'zone_c', { x: 0, y: 0 }, { x: 50, y: 100 });

    // Direct path A→C: ~111px at 100px/s ≈ 1110ms
    // Via B: ~212px ≈ 2120ms
    sim.update(1_200); // enough for direct, not enough for via-B
    events.flush();

    expect(moved).toHaveLength(1); // arrived via direct path
    expect(moved[0]!.npcId).toBe('npc_tri');
  });

  // -------------------------------------------------------------------------
  // Test 13: Speed override per addMovingNPC call
  // -------------------------------------------------------------------------
  it('per-call speed override makes NPC travel faster than default speed', () => {
    const events = new EventBus<ALifeEventPayloads>();
    const moved: MovedPayload[] = [];
    events.on(ALifeEvents.NPC_MOVED, (p) => moved.push(p as MovedPayload));

    // Default speed = 50px/s → A→B (100px) takes 2000ms
    const sim = new GraphMovementSimulator(makeLinearGraph(), events, 50);

    // Override to 200px/s → A→B (100px) takes 500ms
    sim.addMovingNPC('npc_fast', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 }, 200);

    // At default 50px/s, 700ms = only 35px covered — not done.
    // At override 200px/s, 700ms = 140px covered — done.
    sim.update(700);
    events.flush();
    expect(moved).toHaveLength(1); // arrived (would NOT have arrived at default speed)

    // Verify a second NPC at default speed (50px/s) is NOT done at 700ms
    const moved2: MovedPayload[] = [];
    events.on(ALifeEvents.NPC_MOVED, (p) => moved2.push(p as MovedPayload));
    sim.addMovingNPC('npc_slow', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 }); // no override → 50px/s
    sim.update(700); // 50px/s * 0.7s = 35px → NOT finished
    events.flush();
    expect(moved2).toHaveLength(0); // still traveling
  });
});
