import { Clock } from '@alife-sdk/core';
import { Schedule } from '../npc/Schedule';
import { BrainScheduleManager } from './BrainScheduleManager';
import type { IMovementDispatcher } from './BrainScheduleManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDispatcher(): IMovementDispatcher & {
  addMovingNPC: ReturnType<typeof vi.fn>;
  isMoving: ReturnType<typeof vi.fn>;
  cancelJourney: ReturnType<typeof vi.fn>;
} {
  return {
    addMovingNPC: vi.fn(),
    isMoving: vi.fn().mockReturnValue(false),
    cancelJourney: vi.fn(),
  };
}

function createNightClock(): Clock {
  return new Clock({ startHour: 23, timeFactor: 1 });
}

function createDayClock(): Clock {
  return new Clock({ startHour: 12, timeFactor: 1 });
}

function createTestSchedule(): Schedule {
  return new Schedule([
    { zoneId: 'camp_a', position: { x: 100, y: 100 }, durationMs: 5_000 },
    { zoneId: 'camp_b', position: { x: 200, y: 200 }, durationMs: 3_000 },
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrainScheduleManager', () => {
  // -----------------------------------------------------------------------
  // Mode transitions
  // -----------------------------------------------------------------------
  describe('checkModeTransition', () => {
    it('returns no transition when night state is unchanged', () => {
      const mgr = new BrainScheduleManager();
      const clock = createNightClock();
      mgr.seedNightState(true);

      const result = mgr.checkModeTransition(clock);

      expect(result.transitioned).toBe(false);
      expect(result.isNight).toBe(true);
    });

    it('detects day-to-night transition', () => {
      const mgr = new BrainScheduleManager();
      const nightClock = createNightClock();
      mgr.seedNightState(false); // was day

      const result = mgr.checkModeTransition(nightClock);

      expect(result.transitioned).toBe(true);
      expect(result.isNight).toBe(true);
    });

    it('detects night-to-day transition and resets schedule', () => {
      const mgr = new BrainScheduleManager();
      const schedule = createTestSchedule();
      mgr.setSchedule(schedule);
      mgr.seedNightState(true); // was night

      // Advance the schedule so index !== 0
      schedule.advance();
      expect(schedule.index).toBe(1);

      const dayClock = createDayClock();
      const result = mgr.checkModeTransition(dayClock);

      expect(result.transitioned).toBe(true);
      expect(result.isNight).toBe(false);
      expect(schedule.index).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Night schedule
  // -----------------------------------------------------------------------
  describe('updateNightSchedule', () => {
    it('counts down waypoint linger timer', () => {
      const mgr = new BrainScheduleManager();
      const schedule = createTestSchedule();
      mgr.setSchedule(schedule);

      const dispatcher = createMockDispatcher();

      // Advance 2000ms of 5000ms linger -- should NOT advance
      mgr.updateNightSchedule(2_000, 'npc_1', 'camp_a', { x: 0, y: 0 }, dispatcher);

      expect(schedule.index).toBe(0);
      expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
    });

    it('advances schedule and dispatches movement when timer expires', () => {
      const mgr = new BrainScheduleManager();
      const schedule = createTestSchedule();
      mgr.setSchedule(schedule);

      const dispatcher = createMockDispatcher();

      // Exhaust the 5000ms linger on waypoint 0
      mgr.updateNightSchedule(5_000, 'npc_1', 'camp_a', { x: 50, y: 50 }, dispatcher);

      expect(schedule.index).toBe(1);
      expect(dispatcher.addMovingNPC).toHaveBeenCalledOnce();
      expect(dispatcher.addMovingNPC).toHaveBeenCalledWith(
        'npc_1',
        'camp_a',
        'camp_b',
        { x: 50, y: 50 },
        { x: 200, y: 200 },
      );
    });

    it('suppresses linger update when NPC is mid-journey', () => {
      const mgr = new BrainScheduleManager();
      const schedule = createTestSchedule();
      mgr.setSchedule(schedule);

      const dispatcher = createMockDispatcher();
      dispatcher.isMoving.mockReturnValue(true);

      // Even with large delta, should not advance
      mgr.updateNightSchedule(100_000, 'npc_1', 'camp_a', { x: 0, y: 0 }, dispatcher);

      expect(schedule.index).toBe(0);
      expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
    });

    it('is a no-op when no schedule is set', () => {
      const mgr = new BrainScheduleManager();
      const dispatcher = createMockDispatcher();

      // Should not throw
      mgr.updateNightSchedule(5_000, 'npc_1', 'camp_a', { x: 0, y: 0 }, dispatcher);

      expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Schedule management
  // -----------------------------------------------------------------------
  describe('schedule management', () => {
    it('hasSchedule returns false initially', () => {
      const mgr = new BrainScheduleManager();
      expect(mgr.hasSchedule()).toBe(false);
    });

    it('hasSchedule returns true after setSchedule', () => {
      const mgr = new BrainScheduleManager();
      mgr.setSchedule(createTestSchedule());
      expect(mgr.hasSchedule()).toBe(true);
    });

    it('resetWaypointTimer clears accumulated time', () => {
      const mgr = new BrainScheduleManager();
      const schedule = createTestSchedule();
      mgr.setSchedule(schedule);

      const dispatcher = createMockDispatcher();

      // Accumulate 4900ms (just under 5000 threshold)
      mgr.updateNightSchedule(4_900, 'npc_1', 'camp_a', { x: 0, y: 0 }, dispatcher);

      // Reset the timer
      mgr.resetWaypointTimer();

      // Another 200ms should NOT trigger advance (was at 4900 + 200 = 5100)
      mgr.updateNightSchedule(200, 'npc_1', 'camp_a', { x: 0, y: 0 }, dispatcher);

      expect(schedule.index).toBe(0);
      expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // seedNightState
  // -----------------------------------------------------------------------
  describe('seedNightState', () => {
    it('does not produce a transition on first checkModeTransition when seeded', () => {
      const mgr = new BrainScheduleManager();
      const nightClock = createNightClock();
      mgr.seedNightState(true);

      const result = mgr.checkModeTransition(nightClock);
      expect(result.transitioned).toBe(false);
    });

    it('auto-seeds on first check if seedNightState was not called', () => {
      const mgr = new BrainScheduleManager();
      const nightClock = createNightClock();

      // First call auto-initializes -- no transition
      const result = mgr.checkModeTransition(nightClock);
      expect(result.transitioned).toBe(false);
      expect(result.isNight).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Edge: null terrainId
  // -----------------------------------------------------------------------
  it('dispatches with empty fromTerrainId when currentTerrainId is null', () => {
    const mgr = new BrainScheduleManager();
    const schedule = createTestSchedule();
    mgr.setSchedule(schedule);

    const dispatcher = createMockDispatcher();

    mgr.updateNightSchedule(5_000, 'npc_1', null, { x: 0, y: 0 }, dispatcher);

    expect(dispatcher.addMovingNPC).toHaveBeenCalledWith(
      'npc_1',
      '',
      'camp_b',
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    );
  });
});
