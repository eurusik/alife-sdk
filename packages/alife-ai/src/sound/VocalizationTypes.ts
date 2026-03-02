// sound/VocalizationTypes.ts
// Type-safe vocalization system for NPC sounds.
// No audio playback — the host implements the actual sound renderer.

/**
 * All possible NPC vocalization types.
 * The host maps these to actual audio assets.
 */
export const VocalizationType = {
  IDLE: 'idle',
  ALERT: 'alert',
  COMBAT: 'combat',
  WOUNDED: 'wounded',
  DEATH: 'death',
  FLEE: 'flee',
  GRENADE_THROW: 'grenade_throw',
  GRENADE_WARNING: 'grenade_warning',
  RELOAD: 'reload',
  SPOTTED_ENEMY: 'spotted_enemy',
  LOST_TARGET: 'lost_target',
  KILL_CONFIRMED: 'kill_confirmed',
  FRIENDLY_FIRE: 'friendly_fire',
  HELP: 'help',
  ACKNOWLEDGE: 'acknowledge',
  REMARK: 'remark',
  KAMP_SOCIAL: 'kamp_social',
} as const;

export type VocalizationType = (typeof VocalizationType)[keyof typeof VocalizationType];

/**
 * Configuration for vocalization cooldowns per type.
 * Prevents overlapping/spamming sounds.
 */
export interface IVocalizationConfig {
  readonly cooldowns: Readonly<Record<VocalizationType, number>>;
}

/** Default production cooldowns (ms). */
export function createDefaultVocalizationConfig(): IVocalizationConfig {
  return {
    cooldowns: {
      [VocalizationType.IDLE]: 15_000,
      [VocalizationType.ALERT]: 5_000,
      [VocalizationType.COMBAT]: 3_000,
      [VocalizationType.WOUNDED]: 4_000,
      [VocalizationType.DEATH]: 0,
      [VocalizationType.FLEE]: 5_000,
      [VocalizationType.GRENADE_THROW]: 1_000,
      [VocalizationType.GRENADE_WARNING]: 2_000,
      [VocalizationType.RELOAD]: 3_000,
      [VocalizationType.SPOTTED_ENEMY]: 5_000,
      [VocalizationType.LOST_TARGET]: 5_000,
      [VocalizationType.KILL_CONFIRMED]: 3_000,
      [VocalizationType.FRIENDLY_FIRE]: 5_000,
      [VocalizationType.HELP]: 4_000,
      [VocalizationType.ACKNOWLEDGE]: 2_000,
      [VocalizationType.REMARK]: 10_000,
      [VocalizationType.KAMP_SOCIAL]: 8_000,
    },
  };
}

/**
 * Per-NPC vocalization cooldown tracker.
 *
 * Tracks last play time per type. The host calls `canPlay()` before
 * triggering audio and `markPlayed()` after.
 *
 * @example
 * ```ts
 * const tracker = new VocalizationTracker(config);
 * if (tracker.canPlay(VocalizationType.COMBAT, gameTime)) {
 *   tracker.markPlayed(VocalizationType.COMBAT, gameTime);
 *   audioSystem.play(npcId, VocalizationType.COMBAT);
 * }
 * ```
 */
export class VocalizationTracker {
  private readonly lastPlayed = new Map<VocalizationType, number>();
  private readonly config: IVocalizationConfig;

  constructor(config: IVocalizationConfig) {
    this.config = config;
  }

  canPlay(type: VocalizationType, currentTimeMs: number): boolean {
    const cooldown = this.config.cooldowns[type] ?? 0;
    if (cooldown === 0) return true;

    const last = this.lastPlayed.get(type);
    if (last === undefined) return true;

    return currentTimeMs - last >= cooldown;
  }

  markPlayed(type: VocalizationType, currentTimeMs: number): void {
    this.lastPlayed.set(type, currentTimeMs);
  }

  reset(): void {
    this.lastPlayed.clear();
  }
}
