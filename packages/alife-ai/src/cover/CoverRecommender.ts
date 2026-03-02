// cover/CoverRecommender.ts
// Pure decision function: tactical situation → recommended CoverType.
// No side effects, no state — ideal for unit testing.

import { CoverType } from '../types/ICoverPoint';
import type { ICoverConfig } from '../types/IOnlineAIConfig';

/**
 * Tactical context for cover type recommendation.
 */
export interface ICoverSituation {
  /** Current HP / max HP in range [0, 1]. */
  readonly hpRatio: number;
  /** Current morale in range [-1, 1]. */
  readonly morale: number;
  /** Number of known active enemies. */
  readonly enemyCount: number;
  /** Whether the NPC has usable ammunition. */
  readonly hasAmmo: boolean;
}

/**
 * Recommend the best CoverType for a given tactical situation.
 *
 * Decision tree (priority order):
 *   1. No ammo → SAFE (no point being offensive).
 *   2. Critical HP → CLOSE (need cover NOW, closest available).
 *   3. Demoralized → FAR (distance = psychological safety).
 *   4. Outnumbered → SAFE (minimize exposure to multiple threats).
 *   5. Healthy + few enemies → AMBUSH (take offensive position).
 *   6. Default → BALANCED (balanced approach).
 *
 * @param situation - Tactical context describing the NPC's state.
 * @param config - Cover configuration for threshold values.
 * @returns The recommended CoverType.
 */
export function recommendCoverType(
  situation: ICoverSituation,
  config: ICoverConfig,
): CoverType {
  const { hpRatio, morale, enemyCount, hasAmmo } = situation;

  // No ammo: can't fight, maximize safety.
  if (!hasAmmo) {
    return CoverType.SAFE;
  }

  // Critical HP: get behind something immediately.
  if (hpRatio <= config.recommendHpCritical) {
    return CoverType.CLOSE;
  }

  // Demoralized: prefer distance for psychological recovery.
  if (morale <= config.recommendMoraleDemoralized) {
    return CoverType.FAR;
  }

  // Outnumbered: minimize aggregate threat.
  if (enemyCount >= config.recommendOutnumberedCount) {
    return CoverType.SAFE;
  }

  // Healthy and few enemies: take the initiative.
  if (hpRatio >= config.recommendHpHealthy && enemyCount <= 2) {
    return CoverType.AMBUSH;
  }

  // Default: balanced approach.
  return CoverType.BALANCED;
}
