// states/eat-corpse/IEatCorpseConfig.ts
// Configuration for EatCorpseState and withEatCorpseGuard.

/**
 * Tuning parameters for the EAT_CORPSE state handler.
 *
 * All distances are in world pixels; all durations in milliseconds.
 */
export interface IEatCorpseConfig {
  /**
   * Radius (px) to search for corpses on `enter()`.
   * @default 250
   */
  readonly searchRadius: number;

  /**
   * How long the NPC spends eating before the corpse is consumed (ms).
   * @default 4_000
   */
  readonly eatDurationMs: number;

  /**
   * Approach speed toward the corpse (px/s).
   * When omitted, falls back to `IStateConfig.approachSpeed`.
   */
  readonly approachSpeed?: number;

  /**
   * Distance threshold at which the NPC is considered "at" the corpse (px).
   * @default 24
   */
  readonly arriveThreshold: number;

  /**
   * Additive morale bonus applied on successful consumption.
   * Clamped to [-1, 1] after addition.
   * @default 0.15
   */
  readonly moraleBoost: number;
}

export function createDefaultEatCorpseConfig(
  overrides?: Partial<IEatCorpseConfig>,
): IEatCorpseConfig {
  return {
    searchRadius: 250,
    eatDurationMs: 4_000,
    arriveThreshold: 24,
    moraleBoost: 0.15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Guard config
// ---------------------------------------------------------------------------

/**
 * Tuning parameters for `withEatCorpseGuard()`.
 */
export interface IEatCorpseGuardConfig {
  /**
   * Interval between hunger checks (ms). Controls how often `findCorpses` is
   * called from within calm states (IDLE / PATROL).
   * @default 5_000
   */
  readonly checkIntervalMs: number;

  /**
   * HP fraction at or below which the NPC considers eating.
   * 1.0 = always hungry; 0.0 = never hungry.
   * @default 0.7
   */
  readonly hungerHpThreshold: number;

  /**
   * Probability [0, 1) of transitioning to EAT_CORPSE when conditions are met.
   * Sampled via `ctx.random()`.
   * @default 0.4
   */
  readonly eatProbability: number;

  /**
   * Radius (px) used in the guard's pre-flight `findCorpses` check.
   * Should match or exceed `IEatCorpseConfig.searchRadius`.
   * @default 250
   */
  readonly searchRadius: number;

  /**
   * State ID to transition to when the guard triggers.
   * @default 'EAT_CORPSE'
   */
  readonly eatStateId: string;

  /**
   * Entity types allowed to trigger the guard, or null to allow all.
   * @default null
   */
  readonly allowedEntityTypes: ReadonlyArray<string> | null;
}

export function createDefaultEatCorpseGuardConfig(
  overrides?: Partial<IEatCorpseGuardConfig>,
): IEatCorpseGuardConfig {
  return {
    checkIntervalMs: 5_000,
    hungerHpThreshold: 0.7,
    eatProbability: 0.4,
    searchRadius: 250,
    eatStateId: 'EAT_CORPSE',
    allowedEntityTypes: null,
    ...overrides,
  };
}
