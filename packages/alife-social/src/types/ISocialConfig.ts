// types/ISocialConfig.ts
// Configuration for all social subsystems.

import type { IGatheringFSM } from '../campfire/IGatheringFSM';

/**
 * Meet/greeting subsystem configuration.
 */
export interface IMeetConfig {
  /** Greeting trigger distance (px). */
  readonly meetDistance: number;
  /** Per-NPC greeting cooldown (ms). */
  readonly meetCooldownMs: number;
  /** How often to check for greetable NPCs (ms). */
  readonly meetCheckIntervalMs: number;
  /**
   * Custom NPC state → greeting category map.
   * Overrides the default `{ camp: 'greeting_evening', sleep: 'greeting_evening' }`.
   * Only provided states are overridden — omitted states fall through to faction logic.
   */
  readonly stateGreetingMap?: Readonly<Record<string, string>>;
}

/**
 * Default NPC states that are eligible to deliver ambient remarks.
 * Used as the fallback when IRemarkConfig.eligibleStates is not set.
 *
 * Override via IRemarkConfig.eligibleStates to add game-specific states
 * (e.g. 'sleep', 'guard') without modifying this constant.
 */
export const DEFAULT_REMARK_ELIGIBLE_STATES: readonly string[] = ['idle', 'patrol', 'camp'];

/**
 * Default terrain remark lock duration (ms).
 * Used as the fallback when IRemarkConfig.terrainLockDurationMs is not set.
 */
export const DEFAULT_REMARK_TERRAIN_LOCK_MS = 10_000;

/**
 * Remark subsystem configuration.
 */
export interface IRemarkConfig {
  /** Minimum per-NPC remark cooldown (ms). */
  readonly remarkCooldownMinMs: number;
  /** Maximum per-NPC remark cooldown (ms). */
  readonly remarkCooldownMaxMs: number;
  /** How often to check for remark opportunities (ms). */
  readonly remarkCheckIntervalMs: number;
  /** Probability of remark per eligible NPC per check. */
  readonly remarkChance: number;
  /** Weight for zone remarks (0..1). */
  readonly weightZone: number;
  /** Cumulative weight for weather (zone + weather, 0..1). */
  readonly weightWeatherCumulative: number;
  /** NPC states eligible for remarks. Default: ['idle', 'patrol', 'camp']. */
  readonly eligibleStates?: readonly string[];
  /** Duration before a terrain remark lock expires (ms). Default: 10_000. */
  readonly terrainLockDurationMs?: number;
}

/**
 * Campfire subsystem configuration.
 */
export interface ICampfireConfig {
  /** NPC states that count as "gathering" for campfire session eligibility. Default: ['camp']. */
  readonly gatheringStates?: readonly string[];
  /** Idle duration range before next activity (ms). */
  readonly idleDurationMinMs: number;
  readonly idleDurationMaxMs: number;
  /** Story narration duration range (ms). */
  readonly storyDurationMinMs: number;
  readonly storyDurationMaxMs: number;
  /** Joke duration range (ms). */
  readonly jokeDurationMinMs: number;
  readonly jokeDurationMaxMs: number;
  /** Eating duration range (ms). */
  readonly eatingDurationMinMs: number;
  readonly eatingDurationMaxMs: number;
  /** Reaction duration range (ms). */
  readonly reactionDurationMinMs: number;
  readonly reactionDurationMaxMs: number;
  /** Stagger delay between audience reactions (ms). */
  readonly reactionStaggerMs: number;
  /** Minimum participants to start a campfire session. */
  readonly minParticipants: number;
  /** How often to sync campfire participants (ms). */
  readonly syncIntervalMs: number;
  /** Probability each participant shows eating bubble. */
  readonly eatingChance: number;
  /** Weight for story in idle→next transition (0..1). */
  readonly weightStory: number;
  /** Cumulative weight for joke (story + joke, 0..1). */
  readonly weightJokeCumulative: number;
}

/**
 * Root social configuration.
 */
export interface ISocialConfig {
  readonly meet: IMeetConfig;
  readonly remark: IRemarkConfig;
  readonly campfire: ICampfireConfig;

  /**
   * Optional factory for creating a gathering FSM per terrain session.
   * Defaults to the built-in CampfireFSM.
   *
   * Use this to replace the campfire-specific behavior with your own
   * gathering logic (tavern, cantina, squad bonding, etc.).
   *
   * The factory receives the terrain ID and returns a new IGatheringFSM
   * instance. The plugin calls `setParticipants()` right after creation
   * and `update()` each tick.
   *
   * @example
   * ```ts
   * const config: ISocialConfig = {
   *   // ...
   *   createGatheringFSM: (terrainId) => new TavernFSM(terrainId, tavernConfig),
   * };
   * ```
   */
  readonly createGatheringFSM?: (terrainId: string) => IGatheringFSM;
}

/**
 * Partial overrides for social configuration sections.
 * Used by createDefaultSocialConfig and ISocialPluginConfig.
 */
export interface ISocialConfigOverrides {
  readonly meet?: Partial<IMeetConfig>;
  readonly remark?: Partial<IRemarkConfig>;
  readonly campfire?: Partial<ICampfireConfig>;
  /** Optional factory override — see ISocialConfig.createGatheringFSM. */
  readonly createGatheringFSM?: (terrainId: string) => IGatheringFSM;
}

/**
 * Create default social configuration with production values.
 */
export function createDefaultSocialConfig(
  overrides?: ISocialConfigOverrides,
): ISocialConfig {
  return {
    meet: {
      meetDistance: 150,
      meetCooldownMs: 60_000,
      meetCheckIntervalMs: 500,
      ...overrides?.meet,
    },
    remark: {
      remarkCooldownMinMs: 30_000,
      remarkCooldownMaxMs: 60_000,
      remarkCheckIntervalMs: 5_000,
      remarkChance: 0.3,
      weightZone: 0.4,
      weightWeatherCumulative: 0.7,
      terrainLockDurationMs: DEFAULT_REMARK_TERRAIN_LOCK_MS,
      ...overrides?.remark,
    },
    campfire: {
      idleDurationMinMs: 10_000,
      idleDurationMaxMs: 20_000,
      storyDurationMinMs: 8_000,
      storyDurationMaxMs: 15_000,
      jokeDurationMinMs: 5_000,
      jokeDurationMaxMs: 8_000,
      eatingDurationMinMs: 5_000,
      eatingDurationMaxMs: 10_000,
      reactionDurationMinMs: 3_000,
      reactionDurationMaxMs: 5_000,
      reactionStaggerMs: 500,
      minParticipants: 2,
      syncIntervalMs: 3_000,
      eatingChance: 0.6,
      weightStory: 0.35,
      weightJokeCumulative: 0.65,
      ...overrides?.campfire,
    },
    ...(overrides?.createGatheringFSM !== undefined
      ? { createGatheringFSM: overrides.createGatheringFSM }
      : {}),
  };
}
