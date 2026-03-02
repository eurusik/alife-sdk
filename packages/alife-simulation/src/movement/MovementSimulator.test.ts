import { EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { MovementSimulator } from './MovementSimulator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEvents(): EventBus<ALifeEventPayloads> {
  return new EventBus<ALifeEventPayloads>();
}

function createSimulator(events?: EventBus<ALifeEventPayloads>): MovementSimulator {
  return new MovementSimulator(events ?? createEvents());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MovementSimulator', () => {
  // -----------------------------------------------------------------------
  // addMovingNPC / isMoving
  // -----------------------------------------------------------------------

  describe('addMovingNPC', () => {
    it('creates a journey that is reported by isMoving', () => {
      const sim = createSimulator();

      sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });

      expect(sim.isMoving('npc_1')).toBe(true);
      expect(sim.activeCount).toBe(1);
    });

    it('skips zero-distance journeys', () => {
      const sim = createSimulator();

      sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', { x: 50, y: 50 }, { x: 50, y: 50 });

      expect(sim.isMoving('npc_1')).toBe(false);
      expect(sim.activeCount).toBe(0);
    });

    it('replaces an existing journey for the same NPC', () => {
      const sim = createSimulator();

      sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.addMovingNPC('npc_1', 'zone_b', 'zone_c', { x: 100, y: 0 }, { x: 200, y: 0 });

      expect(sim.activeCount).toBe(1);
      expect(sim.isMoving('npc_1')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // isMoving
  // -----------------------------------------------------------------------

  describe('isMoving', () => {
    it('returns false for an unknown NPC', () => {
      const sim = createSimulator();

      expect(sim.isMoving('unknown')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // cancelJourney
  // -----------------------------------------------------------------------

  describe('cancelJourney', () => {
    it('removes an active journey', () => {
      const sim = createSimulator();
      sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });

      sim.cancelJourney('npc_1');

      expect(sim.isMoving('npc_1')).toBe(false);
      expect(sim.activeCount).toBe(0);
    });

    it('is a no-op for an unknown NPC', () => {
      const sim = createSimulator();

      expect(() => sim.cancelJourney('ghost')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe('update', () => {
    it('emits NPC_MOVED when a journey completes', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: Array<{ npcId: string; fromZone: string; toZone: string }> = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      // 100px at 50px/s => 2000ms
      sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(2_000);
      events.flush();


      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        npcId: 'npc_1',
        fromZone: 'zone_a',
        toZone: 'zone_b',
      });
      expect(sim.isMoving('npc_1')).toBe(false);
    });

    it('does not emit when journey is still in progress', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: unknown[] = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      // 100px at 50px/s => 2000ms, advance only 1000ms
      sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(1_000);
      events.flush();

      expect(received).toHaveLength(0);
      expect(sim.isMoving('npc_1')).toBe(true);
    });

    it('handles multiple journeys completing in the same tick', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: Array<{ npcId: string }> = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      sim.addMovingNPC('npc_a', 'z1', 'z2', { x: 0, y: 0 }, { x: 50, y: 0 });  // 1000ms
      sim.addMovingNPC('npc_b', 'z3', 'z4', { x: 0, y: 0 }, { x: 100, y: 0 }); // 2000ms

      sim.update(2_000);
      events.flush();

      expect(received).toHaveLength(2);
      const ids = received.map((r) => r.npcId).sort();
      expect(ids).toEqual(['npc_a', 'npc_b']);
      expect(sim.activeCount).toBe(0);
    });

    it('completes one journey while another continues', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: Array<{ npcId: string }> = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      sim.addMovingNPC('fast', 'z1', 'z2', { x: 0, y: 0 }, { x: 50, y: 0 });  // 1000ms
      sim.addMovingNPC('slow', 'z3', 'z4', { x: 0, y: 0 }, { x: 200, y: 0 }); // 4000ms

      sim.update(1_500);
      events.flush();

      expect(received).toHaveLength(1);
      expect(received[0]!.npcId).toBe('fast');
      expect(sim.isMoving('slow')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getPosition
  // -----------------------------------------------------------------------

  describe('getPosition', () => {
    it('returns null when the NPC is not moving', () => {
      const sim = createSimulator();

      expect(sim.getPosition('nobody')).toBeNull();
    });

    it('returns the start position at elapsed 0', () => {
      const sim = createSimulator();
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });

      const pos = sim.getPosition('npc_1');

      expect(pos).toEqual({ x: 0, y: 0 });
    });

    it('returns interpolated position at 50% progress', () => {
      const sim = createSimulator();
      // 100px at 50px/s => 2000ms total
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });
      sim.update(1_000); // 50%

      const pos = sim.getPosition('npc_1');

      expect(pos).toEqual({ x: 50, y: 0 });
    });

    it('clamps t to 1 when elapsed exceeds travel time', () => {
      const sim = createSimulator();
      // 50px at 50px/s => 1000ms, but don't call update (which would delete it)
      // Instead, use custom speed to control timing
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 }, 100);
      // 100px at 100px/s => 1000ms; advance 500ms (halfway)
      sim.update(500);

      const pos = sim.getPosition('npc_1');

      expect(pos).toEqual({ x: 50, y: 0 });
    });

    it('returns null after journey completes and update runs', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });

      sim.update(5_000); // well past completion

      expect(sim.getPosition('npc_1')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Default speed
  // -----------------------------------------------------------------------

  describe('default speed', () => {
    it('uses 50 px/s when no speed is provided', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: unknown[] = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      // 100px at 50px/s => exactly 2000ms
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 });

      // At 1999ms should NOT be complete
      sim.update(1_999);
      events.flush();
      expect(received).toHaveLength(0);
      expect(sim.isMoving('npc_1')).toBe(true);

      // 1 more ms should complete it (total 2000ms)
      sim.update(1);
      events.flush();
      expect(received).toHaveLength(1);
    });

    it('respects custom speed', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: unknown[] = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      // 100px at 200px/s => 500ms
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 100, y: 0 }, 200);

      sim.update(500);
      events.flush();

      expect(received).toHaveLength(1);
    });

    it('speed = 0 does not create an infinite journey — clamps to minimum 1 px/s', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: unknown[] = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      // 10px at speed 0 — was Infinity travelTime before the fix
      sim.addMovingNPC('npc_1', 'z1', 'z2', { x: 0, y: 0 }, { x: 10, y: 0 }, 0);

      // Journey should complete eventually (at clamped 1 px/s, 10px = 10 000ms)
      expect(sim.isMoving('npc_1')).toBe(true);

      sim.update(10_000);
      events.flush();

      expect(received).toHaveLength(1);
      expect(sim.isMoving('npc_1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('removes all journeys without emitting events', () => {
      const events = createEvents();
      const sim = new MovementSimulator(events);
      const received: unknown[] = [];
      events.on(ALifeEvents.NPC_MOVED, (p) => received.push(p));

      sim.addMovingNPC('npc_a', 'z1', 'z2', { x: 0, y: 0 }, { x: 50, y: 0 });
      sim.addMovingNPC('npc_b', 'z3', 'z4', { x: 0, y: 0 }, { x: 100, y: 0 });

      sim.clear();
      events.flush();

      expect(sim.activeCount).toBe(0);
      expect(sim.isMoving('npc_a')).toBe(false);
      expect(sim.isMoving('npc_b')).toBe(false);
      expect(received).toHaveLength(0);
    });
  });
});
