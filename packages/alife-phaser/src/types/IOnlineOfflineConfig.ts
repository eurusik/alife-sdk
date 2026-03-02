// types/IOnlineOfflineConfig.ts
// Configuration for hysteresis-based online/offline switching.

/**
 * Online/offline switching configuration.
 *
 * Online threshold = switchDistance × (1 - hysteresisFactor)
 * Offline threshold = switchDistance × (1 + hysteresisFactor)
 *
 * The gap prevents rapid flickering at the boundary.
 */
export interface IOnlineOfflineConfig {
  /** Base distance for online/offline switching (px). */
  readonly switchDistance: number;
  /** Hysteresis factor (0-1). Higher = wider dead zone. */
  readonly hysteresisFactor: number;
}

export function createDefaultOnlineOfflineConfig(
  overrides?: Partial<IOnlineOfflineConfig>,
): IOnlineOfflineConfig {
  return {
    switchDistance: overrides?.switchDistance ?? 700,
    hysteresisFactor: overrides?.hysteresisFactor ?? 0.15,
  };
}

/**
 * Record representing an NPC for online/offline evaluation.
 * The manager reads these but does NOT mutate them.
 */
export interface IOnlineRecord {
  readonly entityId: string;
  readonly x: number;
  readonly y: number;
  readonly isOnline: boolean;
  readonly isAlive: boolean;
}

/** Resolves squad membership for an NPC. Returns member IDs or null. */
export type SquadResolver = (npcId: string) => readonly string[] | null;

/** Result of an online/offline evaluation pass. */
export interface ITransitionResult {
  readonly goOnline: readonly string[];
  readonly goOffline: readonly string[];
}
