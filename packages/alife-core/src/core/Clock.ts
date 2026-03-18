// core/Clock.ts
// Framework-agnostic game time manager — accelerated day/night cycle.
//
// Responsibilities:
//   - Advance an in-game clock decoupled from wall-clock time via a
//     configurable timeFactor (e.g. 10 = 10 game-seconds per real-second).
//   - Wrap at 24h and expose human-readable helpers (hour, minute, isDay).
//   - Invoke optional callbacks on hour boundaries and day/night transitions,
//     keeping Clock decoupled from any specific EventBus implementation.
//
// Design notes:
//   - All time arithmetic uses seconds (not milliseconds) to avoid large
//     intermediate values and keep the math readable.
//   - Day boundary detection uses a cached previousHour comparison —
//     no string formatting on the hot path.
//   - Zero external dependencies.

// ---------------------------------------------------------------------------
// Serialisation interface
// ---------------------------------------------------------------------------

/** Snapshot of Clock state for save/load. */
export interface IClockState {
  /** Total elapsed game-seconds since the simulation started. */
  readonly totalGameSeconds: number;
  /** Time acceleration factor at the moment of save. */
  readonly timeFactor: number;
  /** Whether the clock was paused at the moment of save. */
  readonly paused?: boolean;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration accepted by the Clock constructor. */
export interface IClockConfig {
  /** Game-seconds per real-second. Default: 10. */
  timeFactor?: number;
  /** Starting hour (0-23). Default: 8 (08:00). */
  startHour?: number;
  /** Starting day number (1-based). Default: 1. */
  startDay?: number;
  /** First hour considered daytime (0-23). Default: 6. */
  dayStartHour?: number;
  /** Last hour considered daytime, exclusive (0-23). Default: 21. */
  dayEndHour?: number;
  /** Called when the in-game hour changes. */
  onHourChanged?: (hour: number, day: number) => void;
  /** Called when the day/night state flips. */
  onDayNightChanged?: (isDay: boolean) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const DEFAULT_DAY_START_HOUR = 6;
const DEFAULT_DAY_END_HOUR = 21;
const DEFAULT_TIME_FACTOR = 10;
const DEFAULT_START_HOUR = 8;
const DEFAULT_START_DAY = 1;

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * Accelerated in-game clock with day/night cycle detection.
 *
 * Framework-agnostic: no dependency on Phaser, EventBus, or any renderer.
 * Transition notifications are delivered via optional callback functions
 * supplied at construction time.
 *
 * @example
 * ```ts
 * const clock = new Clock({
 *   timeFactor: 10,
 *   startHour: 8,
 *   onHourChanged: (h, d) => console.log(`Day ${d}, ${h}:00`),
 *   onDayNightChanged: (day) => console.log(day ? 'Dawn' : 'Dusk'),
 * });
 *
 * // Each frame:
 * clock.update(deltaMs);
 *
 * console.log(clock.hour);    // 8
 * console.log(clock.isDay);   // true
 * ```
 */
export class Clock {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * Total elapsed game-seconds since the simulation epoch (day 1, 00:00:00).
   * This is the single source of truth — hour, minute, day are all derived.
   */
  private gameSeconds: number;

  /** Game-seconds per real-second. */
  private _timeFactor: number;

  /** Cached hour for boundary detection. */
  private previousHour: number;

  /** Cached day/night state for transition detection. */
  private wasDaytime: boolean;

  /** When true, update() is a no-op — time stands still. */
  private _paused = false;

  /** First hour of daytime (inclusive). */
  private readonly dayStartHour: number = DEFAULT_DAY_START_HOUR;

  /** Last hour of daytime (exclusive). */
  private readonly dayEndHour: number = DEFAULT_DAY_END_HOUR;

  // Callbacks (kept as readonly to prevent accidental reassignment).
  private readonly onHourChanged?: (hour: number, day: number) => void;
  private readonly onDayNightChanged?: (isDay: boolean) => void;

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor(config: IClockConfig = {}) {
    const {
      timeFactor = DEFAULT_TIME_FACTOR,
      startHour = DEFAULT_START_HOUR,
      startDay = DEFAULT_START_DAY,
      dayStartHour = DEFAULT_DAY_START_HOUR,
      dayEndHour = DEFAULT_DAY_END_HOUR,
      onHourChanged,
      onDayNightChanged,
    } = config;

    if (timeFactor <= 0) {
      throw new RangeError(`Clock: timeFactor must be > 0, got ${timeFactor}`);
    }
    if (startHour < 0 || startHour > 23) {
      throw new RangeError(`Clock: startHour must be 0-23, got ${startHour}`);
    }
    if (startDay < 1) {
      throw new RangeError(`Clock: startDay must be >= 1, got ${startDay}`);
    }

    this._timeFactor = timeFactor;
    this.dayStartHour = dayStartHour;
    this.dayEndHour = dayEndHour;
    this.onHourChanged = onHourChanged;
    this.onDayNightChanged = onDayNightChanged;

    // Convert start parameters to total game-seconds.
    this.gameSeconds = (startDay - 1) * SECONDS_PER_DAY + startHour * SECONDS_PER_HOUR;

    // Initialize boundary-detection caches.
    this.previousHour = this.hour;
    this.wasDaytime = this.isDay;
  }

  // ---------------------------------------------------------------------------
  // Readonly properties
  // ---------------------------------------------------------------------------

  /** Current in-game hour (0-23). */
  get hour(): number {
    return Math.floor((this.gameSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  }

  /** Current in-game minute within the current hour (0-59). */
  get minute(): number {
    return Math.floor(
      (this.gameSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
    );
  }

  /** Current in-game day (1-based). */
  get day(): number {
    return Math.floor(this.gameSeconds / SECONDS_PER_DAY) + 1;
  }

  /** Total elapsed game-seconds since epoch. */
  get totalGameSeconds(): number {
    return this.gameSeconds;
  }

  /** True during daytime hours (configurable, default 06:00 - 20:59). */
  get isDay(): boolean {
    const h = this.hour;
    return h >= this.dayStartHour && h < this.dayEndHour;
  }

  /** True during nighttime hours (21:00 - 05:59). */
  get isNight(): boolean {
    return !this.isDay;
  }

  /** Current time acceleration factor. */
  get timeFactor(): number {
    return this._timeFactor;
  }

  /** `true` when the clock is paused — `update()` becomes a no-op. */
  get isPaused(): boolean {
    return this._paused;
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  /**
   * Advance the in-game clock by `deltaMs` real milliseconds multiplied by
   * the time factor. Call once per frame.
   *
   * Detects hour boundaries and day/night transitions, invoking the
   * corresponding callbacks when they occur.
   *
   * @param deltaMs - Real milliseconds elapsed since the previous frame.
   */
  update(deltaMs: number): void {
    if (this._paused) return;

    // Convert real ms to game-seconds and advance.
    this.gameSeconds += (deltaMs / 1000) * this._timeFactor;

    const currentHour = this.hour;

    // --- Hour boundaries (loop to fire every crossed hour, not just the last) ---
    if (currentHour !== this.previousHour) {
      // Walk each hour between previousHour (exclusive) and currentHour
      // (inclusive), wrapping at 24.  We derive the day number for each
      // boundary by back-computing the game-seconds at the exact start of that
      // hour, so midnight crossings always report the correct day.
      const hoursAdvanced = ((currentHour - this.previousHour) + 24) % 24;
      let h = this.previousHour;
      for (let step = 1; step <= hoursAdvanced; step++) {
        h = (h + 1) % 24;
        // game-seconds at the moment hour h began (i.e. step hours before now,
        // rounded to the hour boundary).
        const gsAtHour = this.gameSeconds - (hoursAdvanced - step) * SECONDS_PER_HOUR;
        const dayAtHour = Math.floor(gsAtHour / SECONDS_PER_DAY) + 1;
        this.onHourChanged?.(h, dayAtHour);
      }
      this.previousHour = currentHour;
    }

    // --- Day/night transition (inline to avoid recomputing hour via isDay getter) ---
    const nowIsDay = currentHour >= this.dayStartHour && currentHour < this.dayEndHour;
    if (nowIsDay !== this.wasDaytime) {
      this.wasDaytime = nowIsDay;
      this.onDayNightChanged?.(nowIsDay);
    }
  }

  // ---------------------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------------------

  /** Freeze time — `update()` becomes a no-op until `resume()` is called. */
  pause(): void {
    this._paused = true;
  }

  /** Resume time advancement after a `pause()`. */
  resume(): void {
    this._paused = false;
  }

  // ---------------------------------------------------------------------------
  // Manual override
  // ---------------------------------------------------------------------------

  /**
   * Set the in-game time to an exact hour (and optionally minute) on the
   * current day. Does not fire transition callbacks — the next `update()`
   * call will detect and emit any resulting transitions naturally.
   *
   * @param hour   - Target hour (0-23).
   * @param minute - Target minute (0-59). Default: 0.
   */
  setTime(hour: number, minute: number = 0): void {
    if (hour < 0 || hour > 23) {
      throw new RangeError(`Clock.setTime: hour must be 0-23, got ${hour}`);
    }
    if (minute < 0 || minute > 59) {
      throw new RangeError(`Clock.setTime: minute must be 0-59, got ${minute}`);
    }

    // Preserve the current day, replace only the time-of-day portion.
    const dayOffset = (this.day - 1) * SECONDS_PER_DAY;
    this.gameSeconds = dayOffset + hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE;

    // Update caches so the next update() doesn't spuriously fire events
    // for the transition we just caused.
    this.previousHour = this.hour;
    this.wasDaytime = this.isDay;
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  /** Capture the current clock state as a plain object for persistence. */
  serialize(): IClockState {
    return {
      totalGameSeconds: this.gameSeconds,
      timeFactor: this._timeFactor,
      paused: this._paused || undefined,
    };
  }

  /**
   * Restore a Clock from a previously serialised state.
   *
   * Callbacks must be re-supplied because functions are not serialisable.
   * If you need the same callbacks, pass them via the optional config parameter.
   *
   * @param state  - Snapshot previously returned by {@link serialize}.
   * @param config - Optional callbacks and overrides.
   */
  static fromState(
    state: IClockState,
    config?: Pick<IClockConfig, 'onHourChanged' | 'onDayNightChanged' | 'dayStartHour' | 'dayEndHour'>,
  ): Clock {
    const clock = new Clock({
      timeFactor: state.timeFactor,
      startHour: 0,
      startDay: 1,
      ...config,
    });
    // Override the computed gameSeconds with the saved value.
    if (!Number.isFinite(state.totalGameSeconds) || state.totalGameSeconds < 0) {
      throw new Error(`Clock.fromState: invalid totalGameSeconds (${state.totalGameSeconds})`);
    }
    clock.gameSeconds = state.totalGameSeconds;
    clock.previousHour = clock.hour;
    clock.wasDaytime = clock.isDay;
    if (state.paused) clock._paused = true;
    return clock;
  }
}
