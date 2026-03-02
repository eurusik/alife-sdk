/**
 * Simulation configuration interfaces.
 *
 * All tunable parameters for the offline A-Life tick loop live here.
 * Every section has a factory default so callers can override selectively.
 */

// ---------------------------------------------------------------------------
// Sub-configs
// ---------------------------------------------------------------------------

/** Terrain state machine (Gulag) timing. */
export interface ITerrainStateConfig {
  /** Ms before COMBAT decays to ALERT. */
  readonly combatDecayMs: number;
  /** Ms before ALERT decays to PEACEFUL. */
  readonly alertDecayMs: number;
}

/** NPCBrain tick parameters. */
export interface IBrainConfig {
  /** Interval between search-state scans (ms). */
  readonly searchIntervalMs: number;
  /** Interval between scheme re-evaluation (ms). */
  readonly schemeCheckIntervalMs: number;
  /** Morale threshold [-1, 1] that triggers flee behavior. E.g. -0.5. */
  readonly moraleFleeThreshold: number;
  /** Interval between terrain re-evaluation (ms). */
  readonly reEvaluateIntervalMs: number;
  /** Maximum terrain danger level the NPC will tolerate without fleeing. */
  readonly dangerTolerance: number;
}

/** TerrainSelector scoring weights. */
export interface ITerrainSelectorConfig {
  /** Shelter fitness multiplier during surge. */
  readonly surgeMultiplier: number;
  /** Bonus when terrain matches squad leader's terrain. */
  readonly squadLeaderBonus: number;
  /** Penalty per danger level when NPC morale is negative. */
  readonly moraleDangerPenalty: number;
}

/** JobSlotSystem scoring weights. */
export interface IJobScoringConfig {
  /** Bonus for rank match (NPC rank >= job minRank). */
  readonly rankBonus: number;
  /** Penalty per pixel (px) of distance from job position. E.g. 0.01/px. */
  readonly distancePenalty: number;
}

/** Offline combat resolution tuning. */
export interface IOfflineCombatConfig {
  /** Max faction-pair exchanges per tick (round-robin budget). */
  readonly maxResolutionsPerTick: number;
  /** Chance [0-100] that two factions detect each other per tick. */
  readonly detectionProbability: number;
  /** Base victory probability factor (0.5 = even match at equal power). */
  readonly victoryBase: number;
  /** Minimum jitter multiplier on raw attack damage. */
  readonly powerJitterMin: number;
  /** Maximum jitter multiplier on raw attack damage. */
  readonly powerJitterMax: number;
  /** Duration (ms) of combat lock after an exchange. */
  readonly combatLockMs: number;
  /** Morale penalty per hit received. */
  readonly moraleHitPenalty: number;
  /** Morale bonus for killing an enemy. */
  readonly moraleKillBonus: number;
  /** Morale penalty applied to allies when a squad member dies. */
  readonly moraleAllyDeathPenalty: number;
  /** Damage type used for offline combat exchanges. Defaults to 'physical'. */
  readonly damageTypeId?: string;
  /** Minimum victory probability clamp. Default 0.05. */
  readonly victoryProbMin: number;
  /** Maximum victory probability clamp. Default 0.95. */
  readonly victoryProbMax: number;
  /** Maximum squad size advantage multiplier. Default 2.0. */
  readonly maxSizeAdvantage: number;
}

/** Goodwill event constants for faction relation adjustments. */
export interface IGoodwillConfig {
  /** Goodwill penalty to the dead NPC's faction on player kill. */
  readonly killPenalty: number;
  /** Goodwill bonus to factions hostile to the dead NPC's faction. */
  readonly killEnemyBonus: number;
  /** Goodwill bonus to trader's faction per completed trade. */
  readonly tradeBonus: number;
  /** Goodwill bonus to quest-giver's faction per quest completion. */
  readonly questBonus: number;
  /** Goodwill decay rate per in-game hour (toward 0). */
  readonly decayRatePerHour: number;
}

/** Surge lifecycle timing and damage tuning. */
export interface ISurgeConfig {
  /** Minimum interval between surges (ms). */
  readonly intervalMinMs: number;
  /** Maximum interval between surges (ms). */
  readonly intervalMaxMs: number;
  /** Warning phase duration (ms). */
  readonly warningDurationMs: number;
  /** Active phase duration (ms). */
  readonly activeDurationMs: number;
  /** Aftermath phase duration (ms). */
  readonly aftermathDurationMs: number;
  /** PSI damage per tick during active phase. */
  readonly damagePerTick: number;
  /** Interval between damage ticks (ms). */
  readonly damageTickIntervalMs: number;
  /** Morale penalty per damage tick. */
  readonly moralePenalty: number;
  /** Morale restore per survivor at aftermath. */
  readonly moraleRestore: number;
  /** Damage type applied during surge active phase. Defaults to 'psi'. */
  readonly damageTypeId?: string;
}

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

/** Root simulation configuration. All sections are required. */
export interface ISimulationConfig {
  readonly terrainState: ITerrainStateConfig;
  readonly brain: IBrainConfig;
  readonly terrainSelector: ITerrainSelectorConfig;
  readonly jobScoring: IJobScoringConfig;
  readonly offlineCombat: IOfflineCombatConfig;
  readonly surge: ISurgeConfig;
  readonly goodwill: IGoodwillConfig;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a complete config with production-tuned defaults. */
export function createDefaultSimulationConfig(
  overrides?: Partial<{
    terrainState: Partial<ITerrainStateConfig>;
    brain: Partial<IBrainConfig>;
    terrainSelector: Partial<ITerrainSelectorConfig>;
    jobScoring: Partial<IJobScoringConfig>;
    offlineCombat: Partial<IOfflineCombatConfig>;
    surge: Partial<ISurgeConfig>;
    goodwill: Partial<IGoodwillConfig>;
  }>,
): ISimulationConfig {
  return {
    terrainState: {
      combatDecayMs: 30_000,
      alertDecayMs: 15_000,
      ...overrides?.terrainState,
    },
    brain: {
      searchIntervalMs: 5_000,
      schemeCheckIntervalMs: 3_000,
      moraleFleeThreshold: -0.5,
      reEvaluateIntervalMs: 30_000,
      dangerTolerance: 3,
      ...overrides?.brain,
    },
    terrainSelector: {
      surgeMultiplier: 3.0,
      squadLeaderBonus: 20,
      moraleDangerPenalty: 15,
      ...overrides?.terrainSelector,
    },
    jobScoring: {
      rankBonus: 5,
      distancePenalty: 0.01,
      ...overrides?.jobScoring,
    },
    offlineCombat: {
      maxResolutionsPerTick: 10,
      detectionProbability: 70,
      victoryBase: 0.5,
      powerJitterMin: 0.5,
      powerJitterMax: 1.5,
      combatLockMs: 15_000,
      moraleHitPenalty: -0.15,
      moraleKillBonus: 0.1,
      moraleAllyDeathPenalty: -0.15,
      victoryProbMin: 0.05,
      victoryProbMax: 0.95,
      maxSizeAdvantage: 2.0,
      ...overrides?.offlineCombat,
    },
    surge: {
      intervalMinMs: 180_000,
      intervalMaxMs: 360_000,
      warningDurationMs: 30_000,
      activeDurationMs: 30_000,
      aftermathDurationMs: 10_000,
      damagePerTick: 25,
      damageTickIntervalMs: 1_000,
      moralePenalty: -0.3,
      moraleRestore: 0.15,
      ...overrides?.surge,
    },
    goodwill: {
      killPenalty: -20,
      killEnemyBonus: 5,
      tradeBonus: 3,
      questBonus: 15,
      decayRatePerHour: 0.5,
      ...overrides?.goodwill,
    },
  };
}
