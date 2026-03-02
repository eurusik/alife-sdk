import { Clock } from './Clock';

describe('Clock', () => {
  // ---------------------------------------------------------------------------
  // Constructor defaults
  // ---------------------------------------------------------------------------
  describe('constructor defaults', () => {
    it('starts at hour 8, day 1 by default', () => {
      const clock = new Clock();
      expect(clock.hour).toBe(8);
      expect(clock.day).toBe(1);
      expect(clock.minute).toBe(0);
    });

    it('uses timeFactor 10 by default', () => {
      const clock = new Clock();
      expect(clock.timeFactor).toBe(10);
    });

    it('reports isDay=true at hour 8 (default dayStart=6, dayEnd=21)', () => {
      const clock = new Clock();
      expect(clock.isDay).toBe(true);
      expect(clock.isNight).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Constructor validation
  // ---------------------------------------------------------------------------
  describe('constructor validation', () => {
    it('throws on timeFactor <= 0', () => {
      expect(() => new Clock({ timeFactor: 0 })).toThrow(RangeError);
      expect(() => new Clock({ timeFactor: -1 })).toThrow(RangeError);
    });

    it('throws on startHour out of range', () => {
      expect(() => new Clock({ startHour: -1 })).toThrow(RangeError);
      expect(() => new Clock({ startHour: 24 })).toThrow(RangeError);
    });

    it('throws on startDay < 1', () => {
      expect(() => new Clock({ startDay: 0 })).toThrow(RangeError);
    });

    it('accepts valid edge values', () => {
      expect(() => new Clock({ startHour: 0 })).not.toThrow();
      expect(() => new Clock({ startHour: 23 })).not.toThrow();
      expect(() => new Clock({ startDay: 1 })).not.toThrow();
      expect(() => new Clock({ timeFactor: 0.001 })).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // update() with timeFactor
  // ---------------------------------------------------------------------------
  describe('update()', () => {
    it('advances game time by deltaMs * timeFactor / 1000', () => {
      const clock = new Clock({ timeFactor: 10, startHour: 0, startDay: 1 });
      const initialSeconds = clock.totalGameSeconds;

      // 1000ms real = 10 game-seconds at factor 10
      clock.update(1000);
      expect(clock.totalGameSeconds).toBe(initialSeconds + 10);
    });

    it('advances hour after enough real time', () => {
      // timeFactor 3600 means 1 real-second = 1 game-hour
      const clock = new Clock({ timeFactor: 3600, startHour: 0, startDay: 1 });
      expect(clock.hour).toBe(0);

      clock.update(1000); // 1 real second = 1 game hour
      expect(clock.hour).toBe(1);
    });

    it('wraps hour at 24 and increments day', () => {
      // timeFactor = 86400 → 1 real second = 1 game day
      const clock = new Clock({ timeFactor: 86400, startHour: 23, startDay: 1 });
      expect(clock.hour).toBe(23);
      expect(clock.day).toBe(1);

      clock.update(1000); // advance 1 full day
      expect(clock.day).toBe(2);
      expect(clock.hour).toBe(23);
    });
  });

  // ---------------------------------------------------------------------------
  // isDay / isNight transitions
  // ---------------------------------------------------------------------------
  describe('isDay / isNight transitions', () => {
    it('is night at hour 5 (before default dayStart=6)', () => {
      const clock = new Clock({ startHour: 5 });
      expect(clock.isDay).toBe(false);
      expect(clock.isNight).toBe(true);
    });

    it('is day at hour 6 (dayStart boundary)', () => {
      const clock = new Clock({ startHour: 6 });
      expect(clock.isDay).toBe(true);
    });

    it('is day at hour 20 (just before dayEnd=21)', () => {
      const clock = new Clock({ startHour: 20 });
      expect(clock.isDay).toBe(true);
    });

    it('is night at hour 21 (dayEnd boundary)', () => {
      const clock = new Clock({ startHour: 21 });
      expect(clock.isDay).toBe(false);
      expect(clock.isNight).toBe(true);
    });

    it('respects custom dayStartHour and dayEndHour', () => {
      const clock = new Clock({ startHour: 7, dayStartHour: 8, dayEndHour: 20 });
      expect(clock.isDay).toBe(false); // 7 < 8

      const clock2 = new Clock({ startHour: 8, dayStartHour: 8, dayEndHour: 20 });
      expect(clock2.isDay).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------
  describe('onHourChanged callback', () => {
    it('fires when the hour changes during update', () => {
      const calls: Array<{ hour: number; day: number }> = [];
      // timeFactor = 3600 → 1 real second = 1 game hour
      const clock = new Clock({
        timeFactor: 3600,
        startHour: 10,
        startDay: 1,
        onHourChanged: (hour, day) => calls.push({ hour, day }),
      });

      clock.update(1000); // +1 hour → hour 11
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ hour: 11, day: 1 });
    });

    it('does not fire when the hour stays the same', () => {
      let called = false;
      const clock = new Clock({
        timeFactor: 1,
        startHour: 10,
        onHourChanged: () => { called = true; },
      });

      clock.update(100); // only 0.1 game-seconds — same hour
      expect(called).toBe(false);
    });
  });

  describe('onDayNightChanged callback', () => {
    it('fires when transitioning from day to night', () => {
      const calls: boolean[] = [];
      // Start at hour 20 (day), advance 1 hour to 21 (night)
      const clock = new Clock({
        timeFactor: 3600,
        startHour: 20,
        onDayNightChanged: (isDay) => calls.push(isDay),
      });

      clock.update(1000); // hour 20 → 21 (night)
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(false);
    });

    it('fires when transitioning from night to day', () => {
      const calls: boolean[] = [];
      const clock = new Clock({
        timeFactor: 3600,
        startHour: 5,
        onDayNightChanged: (isDay) => calls.push(isDay),
      });

      clock.update(1000); // hour 5 → 6 (day)
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // setTime
  // ---------------------------------------------------------------------------
  describe('setTime()', () => {
    it('sets the time on the current day', () => {
      const clock = new Clock({ startHour: 10, startDay: 3 });
      clock.setTime(15, 30);

      expect(clock.hour).toBe(15);
      expect(clock.minute).toBe(30);
      expect(clock.day).toBe(3);
    });

    it('throws on invalid hour', () => {
      const clock = new Clock();
      expect(() => clock.setTime(-1)).toThrow(RangeError);
      expect(() => clock.setTime(24)).toThrow(RangeError);
    });

    it('throws on invalid minute', () => {
      const clock = new Clock();
      expect(() => clock.setTime(12, -1)).toThrow(RangeError);
      expect(() => clock.setTime(12, 60)).toThrow(RangeError);
    });
  });

  // ---------------------------------------------------------------------------
  // pause / resume
  // ---------------------------------------------------------------------------
  describe('pause / resume', () => {
    it('isPaused is false by default', () => {
      const clock = new Clock();
      expect(clock.isPaused).toBe(false);
    });

    it('pause() makes update() a no-op', () => {
      const clock = new Clock({ timeFactor: 10, startHour: 0, startDay: 1 });
      const before = clock.totalGameSeconds;

      clock.pause();
      clock.update(1000);

      expect(clock.totalGameSeconds).toBe(before);
      expect(clock.isPaused).toBe(true);
    });

    it('resume() restores update() behavior', () => {
      const clock = new Clock({ timeFactor: 10, startHour: 0, startDay: 1 });
      clock.pause();
      clock.update(1000);
      const afterPause = clock.totalGameSeconds;

      clock.resume();
      clock.update(1000);

      expect(clock.totalGameSeconds).toBe(afterPause + 10);
      expect(clock.isPaused).toBe(false);
    });

    it('serialize includes paused state', () => {
      const clock = new Clock();
      clock.pause();
      const state = clock.serialize();

      expect(state.paused).toBe(true);
    });

    it('serialize omits paused when not paused', () => {
      const clock = new Clock();
      const state = clock.serialize();

      expect(state.paused).toBeUndefined();
    });

    it('fromState restores paused state', () => {
      const clock = new Clock();
      clock.pause();
      const state = clock.serialize();

      const restored = Clock.fromState(state);
      expect(restored.isPaused).toBe(true);

      restored.update(1000);
      expect(restored.totalGameSeconds).toBe(clock.totalGameSeconds);
    });
  });

  // ---------------------------------------------------------------------------
  // serialize / fromState roundtrip
  // ---------------------------------------------------------------------------
  describe('serialize / fromState', () => {
    it('roundtrips totalGameSeconds and timeFactor', () => {
      const original = new Clock({ timeFactor: 5, startHour: 14, startDay: 3 });
      original.update(2000); // advance some time

      const state = original.serialize();
      const restored = Clock.fromState(state);

      expect(restored.totalGameSeconds).toBe(original.totalGameSeconds);
      expect(restored.timeFactor).toBe(original.timeFactor);
      expect(restored.hour).toBe(original.hour);
      expect(restored.day).toBe(original.day);
    });

    it('preserves callbacks when supplied to fromState', () => {
      const original = new Clock({ timeFactor: 3600, startHour: 20 });
      const state = original.serialize();

      const calls: boolean[] = [];
      const restored = Clock.fromState(state, {
        onDayNightChanged: (isDay) => calls.push(isDay),
      });

      restored.update(1000); // hour 20 → 21 (night transition)
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('serialized state contains expected shape', () => {
      const clock = new Clock({ timeFactor: 7, startHour: 12 });
      const state = clock.serialize();

      expect(state).toHaveProperty('totalGameSeconds');
      expect(state).toHaveProperty('timeFactor');
      expect(typeof state.totalGameSeconds).toBe('number');
      expect(state.timeFactor).toBe(7);
    });

    it('fromState throws on negative totalGameSeconds (bug audit fix)', () => {
      expect(() =>
        Clock.fromState({ totalGameSeconds: -100, timeFactor: 10 }),
      ).toThrow('invalid totalGameSeconds');
    });

    it('fromState throws on NaN totalGameSeconds (bug audit fix)', () => {
      expect(() =>
        Clock.fromState({ totalGameSeconds: NaN, timeFactor: 10 }),
      ).toThrow('invalid totalGameSeconds');
    });

    it('fromState throws on Infinity totalGameSeconds', () => {
      expect(() =>
        Clock.fromState({ totalGameSeconds: Infinity, timeFactor: 10 }),
      ).toThrow('invalid totalGameSeconds');
    });

    it('fromState accepts zero totalGameSeconds', () => {
      const clock = Clock.fromState({ totalGameSeconds: 0, timeFactor: 10 });
      expect(clock.totalGameSeconds).toBe(0);
      expect(clock.hour).toBe(0);
    });
  });
});
