// ---------------------------------------------------------------------------
// Stimulus types
// ---------------------------------------------------------------------------

/**
 * Named constants for the built-in suspicion stimuli.
 *
 * Using these avoids magic strings, but any string is a valid
 * {@link SuspicionStimulus}.
 */
export const SuspicionStimuli = {
  /** Gunshot, explosion sound heard nearby. */
  SOUND:         'sound',
  /** Enemy glimpsed briefly — partial FOV or behind cover. */
  PARTIAL_SIGHT: 'partial_sight',
  /** Footstep sounds detected. */
  FOOTSTEP:      'footstep',
  /** Explosion in vicinity. */
  EXPLOSION:     'explosion',
  /** NPC discovered a dead body in the area. */
  BODY_FOUND:    'body_found',
} as const;

/**
 * Open suspicion stimulus type.
 *
 * Derived from {@link SuspicionStimuli} so the type and constants stay in sync.
 * Any string is valid — games can add their own stimuli without touching the SDK.
 *
 * @example
 * accumulator.add(SuspicionStimuli.SOUND, 0.4, gunX, gunY);
 * accumulator.add('psi_interference', 0.3);
 */
export type SuspicionStimulus =
  | (typeof SuspicionStimuli)[keyof typeof SuspicionStimuli]
  | (string & {});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Tuning parameters for a {@link SuspicionAccumulator}.
 * All fields have defaults via {@link createDefaultSuspicionConfig}.
 */
export interface ISuspicionConfig {
  /**
   * How fast suspicion decays (level/second) when no stimuli are added.
   * A value of 0.08 means a fully saturated accumulator empties in ~12.5s.
   * @default 0.08
   */
  readonly decayRate: number;

  /**
   * Maximum suspicion level. Levels are clamped to `[0, maxLevel]`.
   * @default 1.0
   */
  readonly maxLevel?: number;
}

/**
 * Create an {@link ISuspicionConfig} with production defaults.
 * Pass a partial override object to tune individual values.
 *
 * @example
 * const cfg = createDefaultSuspicionConfig({ decayRate: 0.03 });
 */
export function createDefaultSuspicionConfig(
  overrides?: Partial<ISuspicionConfig>,
): ISuspicionConfig {
  return { decayRate: 0.08, ...overrides };
}

// ---------------------------------------------------------------------------
// SuspicionAccumulator
// ---------------------------------------------------------------------------

/**
 * Per-NPC suspicion/alertness accumulator.
 *
 * Tracks cumulative threat intensity for an NPC by accumulating stimuli
 * (sounds, partial sightings, discovered bodies) over time, with continuous
 * decay toward zero when no new threats are detected.
 *
 * When the level exceeds a configurable threshold (set in {@link IStateConfig}
 * via `suspicionAlertThreshold`), state handlers transition to ALERT.
 *
 * ### Wiring example (host layer)
 * ```ts
 * const suspicion = new SuspicionAccumulator({ decayRate: 0.05 });
 *
 * const ctx: INPCContext = {
 *   // ...
 *   suspicion,  // SuspicionAccumulator structurally satisfies ISuspicionAccess
 * };
 *
 * // Per-frame update (before the state machine tick):
 * suspicion.update(deltaMs / 1000);
 *
 * // Game event handlers:
 * onGunshot(x, y) {
 *   suspicionFor(nearNpcId).add(SuspicionStimuli.SOUND, 0.4, x, y);
 * }
 * // NPCSensors integration:
 * for (const event of sensors.detectSound(pos, range, id, faction, hearers)) {
 *   suspicionFor(event.observerId).add(
 *     SuspicionStimuli.SOUND,
 *     event.confidence * 0.5,
 *     pos.x, pos.y,
 *   );
 * }
 * ```
 *
 * ### Opt-in / opt-out
 * - **Full feature**: wire as shown above, call `add()` on stimuli.
 * - **Read only**: implement seam without calling `add()` — no accumulation.
 * - **Fully disabled**: leave `ctx.suspicion = null` — all state handler
 *   checks are no-ops via `ctx.suspicion?.hasReachedAlert(...)`.
 */
export class SuspicionAccumulator {
  private readonly config: Required<ISuspicionConfig>;
  private level: number = 0;
  private lastKnownX: number | null = null;
  private lastKnownY: number | null = null;

  constructor(config?: Partial<ISuspicionConfig>) {
    const merged = createDefaultSuspicionConfig(config);
    this.config = {
      decayRate: merged.decayRate,
      maxLevel:  merged.maxLevel ?? 1.0,
    };
  }

  // ---------------------------------------------------------------------------
  // Write (host use only)
  // ---------------------------------------------------------------------------

  /**
   * Add suspicion from a stimulus event.
   *
   * **Host use only.** State handlers read via {@link hasReachedAlert} /
   * {@link getLevel} only. Stimuli are driven by the host layer (gunshots,
   * partial sightings, discovered bodies, etc.).
   *
   * @param stimulus - Type of stimulus (semantic label — does not affect storage).
   * @param amount   - Positive amount to add. Negative values are ignored.
   * @param x        - Optional threat X position; becomes {@link getLastKnownPosition}.
   * @param y        - Optional threat Y position; becomes {@link getLastKnownPosition}.
   */
  add(stimulus: SuspicionStimulus, amount: number, x?: number, y?: number): void {
    if (!(amount > 0)) return; // rejects NaN and ≤ 0
    this.level = Math.min(this.level + amount, this.config.maxLevel);
    if (x !== undefined && y !== undefined) {
      this.lastKnownX = x;
      this.lastKnownY = y;
    }
    // Stimulus parameter is accepted for semantic clarity and future auditing,
    // but the accumulator stores a single aggregate level (not per-stimulus).
    void stimulus;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Current suspicion level in `[0, maxLevel]`.
   * Returns `0` initially or after the level has fully decayed.
   */
  getLevel(): number {
    return this.level;
  }

  /**
   * Returns `true` if the current level is **strictly greater than** the
   * given threshold.
   *
   * When `threshold` is omitted, falls back to the configured `maxLevel`.
   * Since `add()` clamps `level` to `maxLevel`, `level > maxLevel` is always
   * `false` — the no-arg form **never** triggers. Always pass an explicit
   * threshold (e.g. `IStateConfig.suspicionAlertThreshold`).
   *
   * @param threshold - Exclusive comparison value. @default config.maxLevel
   */
  hasReachedAlert(threshold?: number): boolean {
    return this.level > (threshold ?? this.config.maxLevel);
  }

  /**
   * Last threat position associated with a suspicion stimulus.
   * Returns `null` if no position has been provided via {@link add}.
   */
  getLastKnownPosition(): { x: number; y: number } | null {
    if (this.lastKnownX === null || this.lastKnownY === null) return null;
    return { x: this.lastKnownX, y: this.lastKnownY };
  }

  // ---------------------------------------------------------------------------
  // Time-based decay
  // ---------------------------------------------------------------------------

  /**
   * Apply time-based decay to the suspicion level.
   *
   * The host calls this each game frame with `deltaMs / 1000`.
   * Suspicion decays by `decayRate * deltaSec` each frame until it reaches zero.
   *
   * @param deltaSec - Elapsed time since last update, in seconds.
   */
  update(deltaSec: number): void {
    if (!(deltaSec > 0)) return; // rejects NaN and negative (would increase level)
    const next = this.level - this.config.decayRate * deltaSec;
    this.level = next <= 0 ? 0 : next;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clear the stored threat position without resetting the suspicion level.
   *
   * Useful when the host wants to discard a stale position
   * while keeping the accumulated level intact.
   */
  clearPosition(): void {
    this.lastKnownX = null;
    this.lastKnownY = null;
  }

  /**
   * Reset suspicion level and threat position.
   *
   * State handlers call this after triggering an ALERT transition so
   * the NPC starts fresh in the new state rather than re-triggering
   * immediately on re-entry to PATROL/IDLE.
   */
  clear(): void {
    this.level = 0;
    this.lastKnownX = null;
    this.lastKnownY = null;
  }
}
