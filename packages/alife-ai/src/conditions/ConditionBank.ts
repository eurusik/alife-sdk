// conditions/ConditionBank.ts
// Per-NPC condition state — HP-independent channels (radiation, bleeding, etc.)
//
// Design principles:
//   • Pure class — no INPCContext dependency, no Phaser references.
//   • Multi-channel storage with per-channel decay rates (mirrors MemoryBank).
//   • update(deltaSec) called by the host each frame; state handlers only read.
//   • Open string channel type — SDK provides named constants, game can add its own.
//   • maxLevel is configurable so games can use [0..1] or [0..100] as they prefer.

// ---------------------------------------------------------------------------
// Channel types
// ---------------------------------------------------------------------------

/**
 * Named constants for the built-in condition channels.
 *
 * Using these avoids magic strings in your code, but they are purely
 * convenience — any string is a valid {@link ConditionChannel}.
 */
export const ConditionChannels = {
  /** Haemorrhage — damage over time from wounds. */
  BLEEDING:     'bleeding',
  /** Ionising radiation from anomalies or contaminated zones. */
  RADIATION:    'radiation',
  /** Hunger / food deprivation. */
  HUNGER:       'hunger',
  /** Fatigue / physical tiredness (stamina depletion). */
  STAMINA:      'stamina',
  /** Alcohol or drug intoxication. */
  INTOXICATION: 'intoxication',
} as const;

/**
 * Open condition channel type.
 *
 * Derived from {@link ConditionChannels} so the type and constants stay in sync.
 * Any string is valid — games can extend with their own channels without
 * touching the SDK.
 *
 * @example
 * // Using a built-in channel:
 * bank.apply(ConditionChannels.RADIATION, 0.1);
 *
 * // Using a custom game-specific channel:
 * bank.apply('psi_overload', 0.3);
 */
export type ConditionChannel =
  | (typeof ConditionChannels)[keyof typeof ConditionChannels]
  | (string & {});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Tuning parameters for a {@link ConditionBank}.
 * All fields have defaults via {@link createDefaultConditionBankConfig}.
 */
export interface IConditionBankConfig {
  /**
   * How fast all channels recover (level/second) when no per-channel rate
   * is set.  A value of 0.01 means a fully saturated channel recovers in ~100s.
   * @default 0.01
   */
  readonly defaultDecayRate: number;

  /**
   * Per-channel decay-rate overrides.
   *
   * Radiation lingers longer than alcohol — set `{ radiation: 0.002 }` to
   * slow its recovery to ~500s while keeping the default for other channels.
   *
   * @example
   * { radiation: 0.002, bleeding: 0.05 }
   */
  readonly channelDecayRates?: Readonly<Partial<Record<string, number>>>;

  /**
   * Maximum intensity value for any channel.
   * Intensities are clamped to `[0, maxLevel]` by {@link ConditionBank.apply}.
   *
   * @default 1.0
   */
  readonly maxLevel?: number;
}

/**
 * Create an {@link IConditionBankConfig} with production defaults.
 * Pass a partial override object to tune individual values.
 *
 * @example
 * const cfg = createDefaultConditionBankConfig({ channelDecayRates: { radiation: 0.002 } });
 */
export function createDefaultConditionBankConfig(
  overrides?: Partial<IConditionBankConfig>,
): IConditionBankConfig {
  return { defaultDecayRate: 0.01, ...overrides };
}

// ---------------------------------------------------------------------------
// ConditionBank
// ---------------------------------------------------------------------------

/**
 * Per-NPC condition state store.
 *
 * Tracks HP-independent condition intensities ([0, maxLevel]) for an NPC.
 * The host allocates one `ConditionBank` per NPC, calls `update(deltaSec)`
 * each game frame, and exposes it to state handlers via the
 * {@link IConditionAccess} seam on `INPCContext`.
 *
 * ### Wiring example (host layer)
 * ```ts
 * const bank = new ConditionBank({ channelDecayRates: { radiation: 0.002 } });
 *
 * const ctx: INPCContext = {
 *   // ...
 *   conditions: bank,
 * };
 *
 * // Per-frame update (before the state machine tick):
 * bank.update(deltaMs / 1000);
 *
 * // Game event handlers:
 * onRadiationExposure(npcId) { bankFor(npcId).apply('radiation', 0.02); }
 * onNPCRested(npcId)         { bankFor(npcId).recover('stamina', 0.5);  }
 * ```
 *
 * ### Opt-in / opt-out
 * - **Full feature**: implement `ctx.conditions` as shown above.
 * - **Write only**: implement without wiring to state handlers.
 * - **Fully disabled**: leave `ctx.conditions = null` — all state handler
 *   checks are no-ops via `ctx.conditions?.hasCondition(...)`.
 */
export class ConditionBank {
  private readonly config: Required<IConditionBankConfig>;

  /** Inner store: channel → current intensity. Only non-zero channels are kept. */
  private readonly store = new Map<string, number>();

  /** Scratch array for two-pass channel eviction in {@link update}. */
  private readonly _toDelete: string[] = [];

  constructor(config?: Partial<IConditionBankConfig>) {
    const merged = createDefaultConditionBankConfig(config);
    this.config = {
      defaultDecayRate:   merged.defaultDecayRate,
      channelDecayRates:  merged.channelDecayRates ?? {},
      maxLevel:           merged.maxLevel          ?? 1.0,
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Increase the intensity of a condition channel.
   *
   * The new level is clamped to `[0, maxLevel]`.
   * Calling `apply` multiple times accumulates — the channel does not reset.
   *
   * **Host use only.** State handlers must not call `apply()` — conditions
   * are external inputs driven by the host layer (anomaly damage, bleeding
   * events, etc.). State handlers read via `hasCondition()` / `getLevel()`.
   *
   * @param channel - Target condition channel.
   * @param amount  - Positive amount to add (e.g. 0.1 per radiation burst).
   *                  Negative values are ignored (use {@link recover} instead).
   */
  apply(channel: ConditionChannel, amount: number): void {
    if (!(amount > 0)) return; // rejects NaN and ≤ 0
    const current = this.store.get(channel) ?? 0;
    this.store.set(channel, Math.min(current + amount, this.config.maxLevel));
  }

  /**
   * Decrease the intensity of a condition channel.
   *
   * The new level is clamped to `[0, ...]`. Use this for instant recovery
   * events (e.g. anti-rad item use). For time-based recovery use `update()`.
   *
   * @param channel - Target condition channel.
   * @param amount  - Positive amount to remove.
   *                  Negative values are ignored (use {@link apply} instead).
   */
  recover(channel: ConditionChannel, amount: number): void {
    if (!(amount > 0)) return; // rejects NaN and ≤ 0
    const current = this.store.get(channel) ?? 0;
    if (current <= 0) return;
    const next = current - amount;
    if (next <= 0) {
      this.store.delete(channel);
    } else {
      this.store.set(channel, next);
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Current intensity of the given channel in `[0, maxLevel]`.
   * Returns `0` if the channel has never been applied or has fully recovered.
   *
   * @param channel - Condition channel to query.
   */
  getLevel(channel: ConditionChannel): number {
    return this.store.get(channel) ?? 0;
  }

  /**
   * Returns `true` if the channel's intensity is **strictly greater than**
   * the given threshold.
   *
   * @param channel   - Condition channel to check.
   * @param threshold - Comparison threshold (exclusive). @default 0
   */
  hasCondition(channel: ConditionChannel, threshold = 0): boolean {
    return (this.store.get(channel) ?? 0) > threshold;
  }

  /**
   * All channels whose current intensity is greater than zero.
   *
   * Returns a read-only snapshot — do not hold references across frames.
   */
  getActiveChannels(): ReadonlyArray<{ channel: ConditionChannel; level: number }> {
    const result: Array<{ channel: ConditionChannel; level: number }> = [];
    for (const [channel, level] of this.store) {
      result.push({ channel, level });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Time-based decay
  // ---------------------------------------------------------------------------

  /**
   * Apply time-based decay to all active condition channels.
   *
   * The host calls this each game frame with `deltaMs / 1000`.
   * Each channel decays by its configured rate (level/second) until it reaches zero,
   * at which point it is removed from the active set.
   *
   * @param deltaSec - Elapsed time since last update, in seconds.
   */
  update(deltaSec: number): void {
    if (!(deltaSec > 0)) return; // rejects NaN and negative (would increase levels)
    this._toDelete.length = 0;

    for (const [channel, level] of this.store) {
      const rate = (this.config.channelDecayRates as Record<string, number>)[channel]
                 ?? this.config.defaultDecayRate;
      const next = level - rate * deltaSec;
      if (next <= 0) {
        this._toDelete.push(channel);
      } else {
        this.store.set(channel, next);
      }
    }

    for (let i = 0; i < this._toDelete.length; i++) {
      this.store.delete(this._toDelete[i]);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clear one condition channel or all channels.
   *
   * Pass `channel` to clear a single condition (e.g. after an anti-rad cure).
   * Omit `channel` to clear all conditions (e.g. on NPC reset or respawn).
   *
   * @param channel - Channel to clear, or undefined to clear everything.
   */
  clear(channel?: ConditionChannel): void {
    if (channel === undefined) {
      this.store.clear();
    } else {
      this.store.delete(channel);
    }
  }
}
