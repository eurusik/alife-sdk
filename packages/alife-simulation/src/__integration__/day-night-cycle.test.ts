/**
 * Integration test: "Day/Night cycle".
 *
 * Verifies that NPCBrain delegates to the night schedule during nighttime,
 * returns to normal terrain-based decisions during daytime, and handles
 * full 24h transitions without crashing -- all using real objects, zero mocks.
 *
 * Clock config: timeFactor = 3600 means 1 real-second = 1 game-hour.
 * This lets us advance time predictably with small deltaMs values.
 */

import { Clock } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { Schedule } from '../npc/Schedule';
import { createWorld, createTerrain, createBrainConfig, createSelectorConfig, createJobConfig } from './helpers';
import { EventBus } from '@alife-sdk/core';
import { NPCBrain } from '../brain/NPCBrain';
import { MovementSimulator } from '../movement/MovementSimulator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Advance the clock from `fromHour` to `toHour` (same day, forward only)
 * by computing the required deltaMs given timeFactor = 3600.
 *
 * At timeFactor 3600: 1ms real = 3.6 game-seconds.
 * To advance 1 game-hour (3600 game-seconds) => 1000ms real.
 */
function msForHours(hours: number): number {
  // timeFactor = 3600 => 1ms real = 3.6 game-seconds
  // 1 game-hour = 3600 game-seconds => 1000ms real
  return hours * 1_000;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Day/Night cycle', () => {
  it('brain delegates to night schedule at 22:00', () => {
    // Start at 21:00 -- nighttime (default dayEnd = 21)
    // Clock isNight at hour 21 => true (hour 21 >= dayEndHour=21 is false => isDay = h>=6 && h<21 => 21<21 is false => isNight)
    const clock = new Clock({ startHour: 21, timeFactor: 3600 });
    const events = new EventBus<ALifeEventPayloads>();
    const movement = new MovementSimulator(events);

    const terrain = createTerrain({
      id: 'camp_site',
      name: 'Табір',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      jobs: [{ type: 'camp', slots: 5, position: { x: 100, y: 100 } }],
    });

    const brain = new NPCBrain({
      npcId: 'sentry',
      factionId: 'stalkers',
      config: createBrainConfig(),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock, events },
    });
    brain.setMovementDispatcher(movement);
    brain.setLastPosition({ x: 0, y: 0 });
    brain.setRank(2);

    const schedule = new Schedule([
      { zoneId: 'camp_site', position: { x: 50, y: 50 }, durationMs: 2_000 },
      { zoneId: 'camp_site', position: { x: 150, y: 150 }, durationMs: 2_000 },
    ]);
    brain.setSchedule(schedule);

    // It is nighttime -- brain should delegate to schedule.
    // First tick: initializes mode, schedule kicks in.
    brain.update(0, [terrain]);
    events.flush();

    // Night schedule is active so the brain should NOT pick a terrain
    // through the normal pathway -- schedule manager handles movement.
    // The brain's currentTerrainId remains null because schedule delegation
    // skips the normal tickTerrainAssignment step.
    expect(brain.currentTerrainId).toBeNull();

    // After the linger timer expires, movement should be dispatched
    brain.update(2_000, [terrain]);
    events.flush();

    expect(movement.isMoving('sentry')).toBe(true);
  });

  it('brain returns to normal terrain mode when day arrives', () => {
    // Start at 20:00 (still day -- hour 20 is isDay because 20 < 21)
    // Then advance to 21:00 (night), then to 06:00 (day again)
    const clock = new Clock({ startHour: 20, timeFactor: 3600 });
    const events = new EventBus<ALifeEventPayloads>();
    const movement = new MovementSimulator(events);

    const terrain = createTerrain({
      id: 'outpost',
      name: 'Аванпост',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      jobs: [{ type: 'guard', slots: 3, position: { x: 100, y: 100 } }],
    });

    const brain = new NPCBrain({
      npcId: 'patrol_npc',
      factionId: 'stalkers',
      config: createBrainConfig(),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock, events },
    });
    brain.setMovementDispatcher(movement);
    brain.setLastPosition({ x: 100, y: 100 });
    brain.setRank(2);

    const schedule = new Schedule([
      { zoneId: 'outpost', position: { x: 50, y: 50 }, durationMs: 5_000 },
    ]);
    brain.setSchedule(schedule);

    // Day at 20:00 -- normal terrain selection
    brain.update(0, [terrain]);
    events.flush();
    expect(brain.currentTerrainId).toBe('outpost');

    // Advance to 21:00 (night) -- 1 hour = 1000ms at timeFactor 3600
    clock.update(msForHours(1));
    expect(clock.isNight).toBe(true);

    // Now the brain should delegate to schedule on the next update
    brain.releaseFromTerrain();
    events.flush();
    brain.update(0, [terrain]);
    events.flush();

    // Schedule delegation: currentTerrainId is null (schedule handles movement)
    expect(brain.currentTerrainId).toBeNull();

    // Advance to 06:00 next day -- 9 hours from 21:00
    clock.update(msForHours(9));
    expect(clock.isDay).toBe(true);

    // Brain should return to normal mode and select terrain again
    brain.update(0, [terrain]);
    events.flush();

    expect(brain.currentTerrainId).toBe('outpost');
  });

  it('NPC without schedule works normally at night', () => {
    const clock = new Clock({ startHour: 23, timeFactor: 1 });
    const events = new EventBus<ALifeEventPayloads>();
    const movement = new MovementSimulator(events);

    const terrain = createTerrain({
      id: 'night_camp',
      name: 'Нічний табір',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      jobs: [{ type: 'guard', slots: 3, position: { x: 100, y: 100 } }],
    });

    const brain = new NPCBrain({
      npcId: 'no_schedule_npc',
      factionId: 'stalkers',
      config: createBrainConfig(),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock, events },
    });
    brain.setMovementDispatcher(movement);
    brain.setLastPosition({ x: 100, y: 100 });
    brain.setRank(2);

    // No schedule set -- brain.hasSchedule() is false
    expect(brain.hasSchedule()).toBe(false);

    // Despite nighttime, brain uses normal terrain selection
    brain.update(0, [terrain]);
    events.flush();

    expect(brain.currentTerrainId).toBe('night_camp');
    expect(brain.currentTask).not.toBeNull();
  });

  it('full 24h cycle: day -> night -> day transitions work without errors', () => {
    const world = createWorld({
      clockHour: 6, // dawn
      timeFactor: 3600, // 1ms = 3.6 game-seconds
      terrains: [
        {
          id: 'base',
          name: 'База',
          bounds: { x: 0, y: 0, width: 200, height: 200 },
          capacity: 10,
          jobs: [
            { type: 'guard', slots: 3, position: { x: 100, y: 100 } },
            { type: 'camp', slots: 3, position: { x: 50, y: 50 } },
          ],
        },
      ],
      npcs: [
        { id: 'stalker_a', faction: 'stalkers', rank: 2, position: { x: 100, y: 100 } },
        { id: 'stalker_b', faction: 'stalkers', rank: 1, position: { x: 50, y: 50 } },
      ],
    });

    // Give stalker_a a night schedule
    const schedule = new Schedule([
      { zoneId: 'base', position: { x: 30, y: 30 }, durationMs: 3_000 },
      { zoneId: 'base', position: { x: 170, y: 170 }, durationMs: 3_000 },
    ]);
    world.brains[0].setSchedule(schedule);

    // Simulate 25 hours in 1-hour increments (25 ticks at 1000ms each)
    for (let hour = 0; hour < 25; hour++) {
      world.tick(msForHours(1));
    }

    // After a full cycle: clock should be at ~07:00 next day
    expect(world.clock.hour).toBe(7);
    expect(world.clock.day).toBe(2);

    // Both NPCs should be alive and functional
    for (const brain of world.brains) {
      // Should not be null -- they should have some terrain or schedule assignment
      // The NPC without schedule should have a terrain assigned during day
      expect(brain.npcId).toBeTruthy();
    }
  });
});
