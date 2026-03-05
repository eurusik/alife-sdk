// ---------------------------------------------------------------------------
// IALifeConfig — all tunable A-Life constants grouped by domain.
// ---------------------------------------------------------------------------

export interface ITickConfig {
  /** Milliseconds between A-Life simulation ticks. */
  readonly intervalMs: number;
  /** Maximum offline NPC brains updated per tick (round-robin). */
  readonly maxBrainUpdatesPerTick: number;
  /** Maximum hostile faction-pair combat resolutions per tick. */
  readonly maxCombatResolutionsPerTick: number;
  /** Wall-clock budget (ms) for a full tick; warns if exceeded. */
  readonly budgetWarningMs: number;
  /** Run redundancy cleanup every N ticks. */
  readonly redundancyCleanupInterval: number;
  /** Game-time delay (ms) after death before an offline NPC is purged. */
  readonly redundancyCleanupDelayMs: number;
}

export interface ISimulationConfig {
  /** NPC goes online when closer than this distance (px). */
  readonly onlineRadius: number;
  /** NPC goes offline when farther than this distance (px). */
  readonly offlineRadius: number;
  /** Cell size (px) for the spatial hash grid. */
  readonly spatialGridCellSize: number;
}

export interface ITimeConfig {
  /** Game-time acceleration factor. 1 real second = timeFactor game seconds. */
  readonly timeFactor: number;
  /** In-game hour at which the simulation starts (0-23). */
  readonly startHour: number;
  /** First hour considered daytime. */
  readonly dayStartHour: number;
  /** Last hour considered daytime (exclusive). */
  readonly dayEndHour: number;
}

export interface ICombatConfig {
  /** Minimum time (ms) between consecutive melee attacks. */
  readonly meleeCooldownMs: number;
  /** Minimum time (ms) before switching between NPC targets. */
  readonly enemyInertiaMs: number;
}

/** Morale range is [-1, 1]. All deltas and thresholds use this range. */
export interface IMoraleConfig {
  /** Morale delta [-1, 0] when an NPC takes a hit. E.g. -0.15. */
  readonly hitPenalty: number;
  /** Morale delta [-1, 0] when a squad ally dies. E.g. -0.25. */
  readonly allyDiedPenalty: number;
  /** Morale delta [-1, 0] when the squad leader dies (replaces allyDiedPenalty). */
  readonly leaderDiedPenalty: number;
  /** Morale delta [0, 1] when this NPC kills an enemy. E.g. 0.2. */
  readonly enemyKilledBonus: number;
  /** Morale delta [-1, 0] during an active surge event. */
  readonly surgePenalty: number;
  /** Passive morale recovery (per second) in SHAKEN state. E.g. 0.01/s. */
  readonly shakenRecoveryRate: number;
  /** Passive morale recovery (per second) in STABLE state (toward 0). E.g. 0.005/s. */
  readonly stableRecoveryRate: number;
  /** Morale threshold [-1, 1] below which the NPC enters SHAKEN. E.g. -0.3. */
  readonly shakenThreshold: number;
  /** Morale threshold [-1, 1] at or below which the NPC enters PANICKED. E.g. -0.7. */
  readonly panicThreshold: number;
}

export interface ISpawnConfig {
  /** Default cooldown (ms) after spawning before the same point can spawn again. */
  readonly defaultCooldownMs: number;
}

export interface IMemoryConfig {
  /** Confidence decay rate (per ms) for the VISUAL channel. E.g. 0.001 = full decay in ~1s. */
  readonly visualDecayRate: number;
  /** Confidence decay rate (per ms) for the SOUND channel. */
  readonly soundDecayRate: number;
  /** Confidence decay rate (per ms) for the HIT channel. */
  readonly hitDecayRate: number;
  /** Confidence decay rate (per ms) for the DANGER channel. */
  readonly dangerDecayRate: number;
  /** Maximum memory entries kept per channel per NPC. */
  readonly maxEntriesPerChannel: number;
  /** Confidence [0, 1] below which a memory record is pruned. E.g. 0.1. */
  readonly confidenceThreshold: number;
}

export interface ISurgeConfig {
  /** Duration (ms) of the warning phase before the surge hits. */
  readonly warningDurationMs: number;
  /** Duration (ms) of the active surge (damage ticking). */
  readonly activeDurationMs: number;
  /** Duration (ms) of the aftermath cooldown after the surge ends. */
  readonly aftermathDurationMs: number;
  /** PSI damage dealt per second to outdoor NPCs during the active phase. */
  readonly psiDamagePerSecond: number;
}

export interface IMonsterConfig {
  /** Wind-up duration (ms) before a boar charge releases. */
  readonly chargeWindupMs: number;
  /** Damage multiplier applied when a charge connects. */
  readonly chargeDamageMult: number;
  /** Distance (px) within which a bloodsucker exits stealth. */
  readonly stalkApproachDist: number;
  /** Sprite alpha [0, 1] while fully invisible during STALK state. E.g. 0.08. */
  readonly stalkAlphaInvisible: number;
  /** Wind-up duration (ms) before a snork leap launches. */
  readonly leapWindupMs: number;
  /** Duration (ms) the snork is airborne during a leap. */
  readonly leapAirtimeMs: number;
  /** Channel duration (ms) of the controller PSI attack. */
  readonly psiChannelMs: number;
}

export interface ITradeConfig {
  /** Pixel radius within which the player can interact with a trader. */
  readonly interactionRadius: number;
  /** Price modifier for allied factions (< 1 = discount). */
  readonly allyDiscount: number;
  /** How often (ms) trader inventories restock. */
  readonly restockIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Aggregate config interface
// ---------------------------------------------------------------------------

export interface IALifeConfig {
  readonly tick: ITickConfig;
  readonly simulation: ISimulationConfig;
  readonly time: ITimeConfig;
  readonly combat: ICombatConfig;
  readonly morale: IMoraleConfig;
  readonly spawn: ISpawnConfig;
  readonly memory: IMemoryConfig;
  readonly surge: ISurgeConfig;
  readonly monster: IMonsterConfig;
  readonly trade: ITradeConfig;
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

/**
 * Creates a complete IALifeConfig populated with production-grade defaults.
 *
 * Values are sourced from the original game's Constants module and represent
 * the tuned baseline for the Chornobyl: The Lost Zone simulation.
 */
export function createDefaultConfig(): IALifeConfig {
  return {
    tick: {
      intervalMs: 5_000,
      maxBrainUpdatesPerTick: 20,
      maxCombatResolutionsPerTick: 10,
      budgetWarningMs: 50,
      redundancyCleanupInterval: 3,
      redundancyCleanupDelayMs: 30_000,
    },

    simulation: {
      onlineRadius: 600,
      offlineRadius: 800,
      spatialGridCellSize: 200,
    },

    time: {
      timeFactor: 10,
      startHour: 8,
      dayStartHour: 6,
      dayEndHour: 21,
    },

    combat: {
      meleeCooldownMs: 1_000,
      enemyInertiaMs: 3_000,
    },

    morale: {
      hitPenalty: -0.15,
      allyDiedPenalty: -0.25,
      leaderDiedPenalty: -0.4,
      enemyKilledBonus: 0.2,
      surgePenalty: -0.3,
      shakenRecoveryRate: 0.01,
      stableRecoveryRate: 0.005,
      shakenThreshold: -0.3,
      panicThreshold: -0.7,
    },

    spawn: {
      defaultCooldownMs: 30_000,
    },

    memory: {
      visualDecayRate: 0.001,
      soundDecayRate: 0.003,
      hitDecayRate: 0.0005,
      dangerDecayRate: 0.002,
      maxEntriesPerChannel: 20,
      confidenceThreshold: 0.1,
    },

    surge: {
      warningDurationMs: 30_000,
      activeDurationMs: 60_000,
      aftermathDurationMs: 15_000,
      psiDamagePerSecond: 5,
    },

    monster: {
      chargeWindupMs: 600,
      chargeDamageMult: 2,
      stalkApproachDist: 80,
      stalkAlphaInvisible: 0.08,
      leapWindupMs: 400,
      leapAirtimeMs: 350,
      psiChannelMs: 2_000,
    },

    trade: {
      interactionRadius: 150,
      allyDiscount: 0.8,
      restockIntervalMs: 300_000,
    },
  };
}
