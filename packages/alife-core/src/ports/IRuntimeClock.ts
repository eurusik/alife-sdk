/**
 * Real-time clock for cooldown timers and memory aging.
 *
 * Distinct from {@link Clock} which provides accelerated game-time (timeFactor).
 * IRuntimeClock returns monotonic real elapsed ms — maps to Phaser's scene.time.now.
 *
 * @example
 * // Phaser adapter
 * const runtimeClock: IRuntimeClock = { now: () => scene.time.now };
 *
 * // Test stub
 * const runtimeClock: IRuntimeClock = { now: () => Date.now() };
 */
export interface IRuntimeClock {
  /** Monotonic real-time milliseconds since session start. */
  now(): number;
}
