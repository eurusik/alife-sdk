import { describe, it, expect, vi } from 'vitest';
import { LevelGraph, EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { GraphMovementSimulator } from './GraphMovementSimulator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(): LevelGraph {
  return new LevelGraph()
    .addVertex('a', 0, 0)
    .addVertex('b', 100, 0)
    .addVertex('c', 200, 0)
    .addUndirectedEdge('a', 'b')
    .addUndirectedEdge('b', 'c');
}

function makeEvents(): EventBus<ALifeEventPayloads> {
  return new EventBus<ALifeEventPayloads>();
}

function makeSim(
  graph = makeGraph(),
  events = makeEvents(),
  speed = 100,
): { sim: GraphMovementSimulator; events: EventBus<ALifeEventPayloads> } {
  return { sim: new GraphMovementSimulator(graph, events, speed), events };
}

type MovedPayload = { npcId: string; fromZone: string; toZone: string };

function collectMoved(events: EventBus<ALifeEventPayloads>): MovedPayload[] {
  const out: MovedPayload[] = [];
  events.on(ALifeEvents.NPC_MOVED, (p) => out.push(p));
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphMovementSimulator', () => {

  // -----------------------------------------------------------------------
  // addMovingNPC / isMoving
  // -----------------------------------------------------------------------

  describe('addMovingNPC', () => {
    it('starts a journey that isMoving reports as active', () => {
      const { sim } = makeSim();
      // a=(0,0) → c=(200,0); snap fromPos=(0,0)→vertex a, toPos=(200,0)→vertex c
      sim.addMovingNPC('npc', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });

      expect(sim.isMoving('npc')).toBe(true);
      expect(sim.activeCount).toBe(1);
    });

    it('snaps to nearest vertex even for non-exact positions', () => {
      const { sim } = makeSim();
      // fromPos close to 'a', toPos close to 'c'
      sim.addMovingNPC('npc', 'za', 'zc', { x: 5, y: 5 }, { x: 195, y: 5 });

      expect(sim.isMoving('npc')).toBe(true);
    });

    it('replaces an active journey for the same NPC', () => {
      const { sim } = makeSim();
      sim.addMovingNPC('npc', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });
      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });

      expect(sim.activeCount).toBe(1);
    });

    it('completes immediately when graph is empty', () => {
      const graph = new LevelGraph();
      const events = makeEvents();
      const moved = collectMoved(events);
      const sim = new GraphMovementSimulator(graph, events);

      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
      events.flush();

      expect(moved).toHaveLength(1);
      expect(moved[0]!.npcId).toBe('npc');
      expect(sim.isMoving('npc')).toBe(false);
    });

    it('completes immediately when no path exists between nearest vertices', () => {
      // Two disconnected vertices — no edges
      const graph = new LevelGraph()
        .addVertex('x', 0, 0)
        .addVertex('y', 100, 0);
      const events = makeEvents();
      const moved = collectMoved(events);
      const sim = new GraphMovementSimulator(graph, events);

      sim.addMovingNPC('npc', 'zx', 'zy', { x: 0, y: 0 }, { x: 100, y: 0 });
      events.flush();

      expect(moved).toHaveLength(1);
      expect(sim.isMoving('npc')).toBe(false);
    });

    it('completes immediately when fromPos and toPos snap to same vertex', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events);

      // Both positions snap to vertex 'a' (0,0)
      sim.addMovingNPC('npc', 'za', 'za', { x: 0, y: 0 }, { x: 1, y: 1 });
      events.flush();

      expect(moved).toHaveLength(1);
      expect(sim.isMoving('npc')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isMoving
  // -----------------------------------------------------------------------

  describe('isMoving', () => {
    it('returns false for unknown NPC', () => {
      const { sim } = makeSim();
      expect(sim.isMoving('ghost')).toBe(false);
    });

    it('returns false after journey completes', () => {
      const { sim } = makeSim();
      // 100px at 100px/s => 1000ms
      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(2_000);

      expect(sim.isMoving('npc')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // cancelJourney
  // -----------------------------------------------------------------------

  describe('cancelJourney', () => {
    it('removes an active journey', () => {
      const { sim } = makeSim();
      sim.addMovingNPC('npc', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });
      sim.cancelJourney('npc');

      expect(sim.isMoving('npc')).toBe(false);
      expect(sim.activeCount).toBe(0);
    });

    it('is a no-op for an unknown NPC', () => {
      const { sim } = makeSim();
      expect(() => sim.cancelJourney('ghost')).not.toThrow();
    });

    it('mid-journey: stops progression and does not emit NPC_MOVED', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events, 100);

      // a(0,0) → c(200,0): multi-edge journey via b(100,0); 100px/s
      sim.addMovingNPC('npc', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });

      // Advance halfway through first edge — NPC is still moving.
      sim.update(500);
      expect(sim.isMoving('npc')).toBe(true);
      expect(sim.getPosition('npc')).not.toBeNull();

      // Cancel mid-journey.
      sim.cancelJourney('npc');

      expect(sim.isMoving('npc')).toBe(false);
      expect(sim.activeCount).toBe(0);
      expect(sim.getPosition('npc')).toBeNull();

      // Subsequent update must not emit NPC_MOVED.
      sim.update(2_000);
      events.flush();
      expect(moved).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // update / NPC_MOVED
  // -----------------------------------------------------------------------

  describe('update', () => {
    it('emits NPC_MOVED when journey completes', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events, 100);

      // a(0,0) → b(100,0): 100px at 100px/s = 1000ms
      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(1_500);
      events.flush();

      expect(moved).toHaveLength(1);
      expect(moved[0]).toEqual({ npcId: 'npc', fromZone: 'za', toZone: 'zb' });
      expect(sim.isMoving('npc')).toBe(false);
    });

    it('does not emit while journey is in progress', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events, 100);

      // a → c = two edges, each 100px at 100px/s = 1000ms each = 2000ms total
      sim.addMovingNPC('npc', 'za', 'zc', { x: 0, y: 0 }, { x: 200, y: 0 });
      sim.update(500); // still moving
      events.flush();

      expect(moved).toHaveLength(0);
      expect(sim.isMoving('npc')).toBe(true);
    });

    it('emits for multiple NPCs completing in the same tick', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events, 100);

      sim.addMovingNPC('npc_a', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 }); // 1000ms
      sim.addMovingNPC('npc_b', 'zb', 'zc', { x: 100, y: 0 }, { x: 200, y: 0 }); // 1000ms
      sim.update(1_500);
      events.flush();

      expect(moved).toHaveLength(2);
      const ids = moved.map((p) => p.npcId).sort();
      expect(ids).toEqual(['npc_a', 'npc_b']);
    });

    it('preserves terrain zone IDs in NPC_MOVED payload', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events, 100);

      sim.addMovingNPC('npc', 'terrain_alpha', 'terrain_beta', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(2_000);
      events.flush();

      expect(moved[0]!.fromZone).toBe('terrain_alpha');
      expect(moved[0]!.toZone).toBe('terrain_beta');
    });
  });

  // -----------------------------------------------------------------------
  // getPosition
  // -----------------------------------------------------------------------

  describe('getPosition', () => {
    it('returns null for an unknown NPC', () => {
      const { sim } = makeSim();
      expect(sim.getPosition('ghost')).toBeNull();
    });

    it('returns interpolated position while moving', () => {
      const { sim } = makeSim(makeGraph(), makeEvents(), 100);
      // a(0,0)→b(100,0): 100px at 100px/s = 1000ms. At 500ms → t=0.5 → x=50
      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(500);

      const pos = sim.getPosition('npc');
      expect(pos).not.toBeNull();
      expect(pos!.x).toBeCloseTo(50, 0);
    });

    it('returns null after journey completes', () => {
      const { sim } = makeSim(makeGraph(), makeEvents(), 100);
      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(2_000);

      expect(sim.getPosition('npc')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('removes all journeys without emitting events', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      const { sim } = makeSim(makeGraph(), events, 100);

      sim.addMovingNPC('a', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.addMovingNPC('b', 'z2', 'z3', { x: 100, y: 0 }, { x: 200, y: 0 });
      sim.clear();
      events.flush();

      expect(sim.activeCount).toBe(0);
      expect(moved).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // activeCount
  // -----------------------------------------------------------------------

  describe('activeCount', () => {
    it('tracks number of in-flight journeys', () => {
      const { sim } = makeSim();
      expect(sim.activeCount).toBe(0);

      sim.addMovingNPC('a', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(sim.activeCount).toBe(1);

      sim.addMovingNPC('b', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(sim.activeCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Default speed
  // -----------------------------------------------------------------------

  describe('defaultSpeed', () => {
    it('uses constructor default speed', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      // 100px/s → 100px edge takes exactly 1000ms
      const sim = new GraphMovementSimulator(makeGraph(), events, 100);

      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 });

      sim.update(999);
      events.flush();
      expect(moved).toHaveLength(0);

      sim.update(1);
      events.flush();
      expect(moved).toHaveLength(1);
    });

    it('respects per-call speed override', () => {
      const events = makeEvents();
      const moved = collectMoved(events);
      // Override to 200px/s → 100px edge takes 500ms
      const sim = new GraphMovementSimulator(makeGraph(), events, 50);

      sim.addMovingNPC('npc', 'za', 'zb', { x: 0, y: 0 }, { x: 100, y: 0 }, 200);
      sim.update(500);
      events.flush();

      expect(moved).toHaveLength(1);
    });
  });
});
