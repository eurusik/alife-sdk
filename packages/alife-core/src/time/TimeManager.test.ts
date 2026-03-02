import { describe, it, expect, vi } from 'vitest';
import { TimeManager } from './TimeManager';
import { ALifeEvents } from '../events/ALifeEvents';
import { Clock } from '../core/Clock';

// Minimal EventBus mock
function makeMockBus() {
  return { emit: vi.fn(), flush: vi.fn() } as any;
}

// Advance time by exactly N hours (real ms with timeFactor=10 default)
// timeFactor=10: 1 hour = 3600 game-seconds = 3600/10 * 1000 = 360_000 ms
const ONE_HOUR_MS = 360_000;

describe('TimeManager', () => {
  it('creates a clock without config', () => {
    const tm = new TimeManager();
    expect(tm.clock).toBeInstanceOf(Clock);
    expect(tm.clock.hour).toBeGreaterThanOrEqual(0);
    expect(tm.clock.day).toBeGreaterThanOrEqual(1);
  });

  it('respects startHour from clockConfig', () => {
    const tm = new TimeManager({ clockConfig: { startHour: 12 } });
    expect(tm.clock.hour).toBe(12);
  });

  it('advances the clock on update()', () => {
    const tm = new TimeManager({ clockConfig: { startHour: 0 } });
    expect(tm.clock.hour).toBe(0);
    // advance 2 hours
    tm.update(ONE_HOUR_MS * 2);
    expect(tm.clock.hour).toBe(2);
  });

  it('emits HOUR_CHANGED with { hour, day, isDay } when crossing an hour boundary', () => {
    const bus = makeMockBus();
    // start at 7:59 — will cross into hour 8 after a small advance
    // startHour=7, then update just over 1 minute to cross into 8
    const tm = new TimeManager({
      events: bus,
      clockConfig: { startHour: 7, timeFactor: 10 },
    });
    bus.emit.mockClear();

    // advance just over 1 hour to cross from 7 to 8
    tm.update(ONE_HOUR_MS + 1);

    const calls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const hourChangedCall = calls.find((c: any[]) => c[0] === ALifeEvents.HOUR_CHANGED);
    expect(hourChangedCall).toBeDefined();
    const payload = hourChangedCall![1];
    expect(payload).toMatchObject({
      hour: expect.any(Number),
      day: expect.any(Number),
      isDay: expect.any(Boolean),
    });
    expect(payload.hour).toBeGreaterThanOrEqual(8);
    expect(payload.day).toBe(1);
  });

  it('emits DAY_NIGHT_CHANGED when crossing dusk (hour 21)', () => {
    const bus = makeMockBus();
    // start at hour 20 (daytime), advance 2 hours to cross into night (21+)
    const tm = new TimeManager({
      events: bus,
      clockConfig: { startHour: 20, timeFactor: 10 },
    });
    bus.emit.mockClear();

    tm.update(ONE_HOUR_MS * 2);

    const calls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const dayNightCall = calls.find((c: any[]) => c[0] === ALifeEvents.DAY_NIGHT_CHANGED);
    expect(dayNightCall).toBeDefined();
    expect(dayNightCall![1]).toEqual({ isDay: false });
  });

  it('does not throw when no EventBus is provided', () => {
    const tm = new TimeManager({ clockConfig: { startHour: 10 } });
    expect(() => tm.update(ONE_HOUR_MS * 2)).not.toThrow();
  });

  it('serialize() returns valid IClockState', () => {
    const tm = new TimeManager({ clockConfig: { startHour: 6, timeFactor: 5 } });
    const state = tm.serialize();
    expect(typeof state.totalGameSeconds).toBe('number');
    expect(typeof state.timeFactor).toBe('number');
    expect(state.timeFactor).toBe(5);
  });

  it('restore() sets clock to the serialized state', () => {
    const tm = new TimeManager({ clockConfig: { startHour: 8 } });
    // advance a bit so the state is non-trivial
    tm.update(ONE_HOUR_MS * 5);
    const state = tm.serialize();
    const hour = tm.clock.hour;

    // Create a fresh manager and restore
    const tm2 = new TimeManager({ clockConfig: { startHour: 0 } });
    tm2.restore(state);
    expect(tm2.clock.hour).toBe(hour);
    expect(tm2.clock.totalGameSeconds).toBe(state.totalGameSeconds);
  });

  it('EventBus continues to receive events after restore()', () => {
    const bus = makeMockBus();
    const tm = new TimeManager({
      events: bus,
      clockConfig: { startHour: 5, timeFactor: 10 },
    });
    // advance a bit
    tm.update(ONE_HOUR_MS);
    const state = tm.serialize();

    bus.emit.mockClear();
    tm.restore(state);

    // After restore, advance to cross another hour boundary
    tm.update(ONE_HOUR_MS + 1);

    const calls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const hourChangedCall = calls.find((c: any[]) => c[0] === ALifeEvents.HOUR_CHANGED);
    expect(hourChangedCall).toBeDefined();
    const payload = hourChangedCall![1];
    expect(payload).toHaveProperty('hour');
    expect(payload).toHaveProperty('day');
    expect(payload).toHaveProperty('isDay');
  });

  it('clock getter returns a Clock instance', () => {
    const tm = new TimeManager();
    expect(tm.clock).toBeInstanceOf(Clock);
  });

  it('isDay reflects day/night state in HOUR_CHANGED payload', () => {
    const bus = makeMockBus();
    // start at hour 5 (nighttime, before dayStartHour=6)
    // advance exactly 1 hour so we land at hour 6 (daytime)
    const tm = new TimeManager({
      events: bus,
      clockConfig: { startHour: 5, timeFactor: 10, dayStartHour: 6, dayEndHour: 21 },
    });
    bus.emit.mockClear();

    // advance exactly 1 hour — clock goes from hour 5 to hour 6 (daytime)
    tm.update(ONE_HOUR_MS);

    const calls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const hourChangedCalls = calls.filter((c: any[]) => c[0] === ALifeEvents.HOUR_CHANGED);
    // Should have emitted HOUR_CHANGED for hour 6
    expect(hourChangedCalls.length).toBeGreaterThanOrEqual(1);
    const payload = hourChangedCalls[hourChangedCalls.length - 1][1];
    expect(payload.hour).toBe(6);
    // At hour 6 with dayStartHour=6, isDay should be true
    expect(payload.isDay).toBe(true);
  });
});
