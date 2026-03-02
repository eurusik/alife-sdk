// cover/LoopholeGenerator.ts
// Generates peek-fire positions (loopholes) around cover points.
// Pure geometry — no framework dependencies.

import type { ICoverPoint, ILoophole } from '../types/ICoverPoint';
import type { ICoverConfig } from '../types/IOnlineAIConfig';
import type { IRandom } from '@alife-sdk/core';

/**
 * Generates and caches loophole positions for cover points.
 *
 * Loopholes are evenly distributed around the cover center at a fixed
 * offset distance, each with a firing arc of configurable width.
 * A seeded random source ensures deterministic generation.
 */
export class LoopholeGenerator {
  private readonly cache = new Map<string, readonly ILoophole[]>();
  private readonly offsetDistance: number;
  private readonly fireArc: number;
  private readonly maxPerCover: number;
  private readonly random: IRandom;

  constructor(config: ICoverConfig, random: IRandom) {
    this.offsetDistance = config.loopholeOffsetDistance;
    this.fireArc = config.loopholeFireArc;
    this.maxPerCover = config.loopholeMaxPerCover;
    this.random = random;
  }

  /**
   * Get loopholes for a cover point, generating them on first access.
   * Results are cached by cover point ID for the lifetime of this generator.
   */
  getLoopholes(cover: ICoverPoint): readonly ILoophole[] {
    const cached = this.cache.get(cover.id);
    if (cached) return cached;

    const loopholes = this.generate(cover);
    this.cache.set(cover.id, loopholes);
    return loopholes;
  }

  /** Clear the generation cache. Call on scene reset. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Generate loopholes for a single cover point.
   *
   * Count is randomized in [1, maxPerCover]. Loopholes are distributed
   * evenly around the cover center with angular jitter for natural feel.
   */
  private generate(_cover: ICoverPoint): readonly ILoophole[] {
    const count = 1 + Math.floor(this.random.next() * this.maxPerCover);
    const baseAngleStep = (2 * Math.PI) / count;
    const startAngle = this.random.next() * 2 * Math.PI;

    const loopholes: ILoophole[] = [];

    for (let i = 0; i < count; i++) {
      // Base angle with small random jitter.
      const jitter = (this.random.next() - 0.5) * baseAngleStep * 0.3;
      const angle = startAngle + i * baseAngleStep + jitter;

      const offsetX = Math.cos(angle) * this.offsetDistance;
      const offsetY = Math.sin(angle) * this.offsetDistance;

      const halfArc = this.fireArc / 2;
      loopholes.push({
        offsetX,
        offsetY,
        angleMin: angle - halfArc,
        angleMax: angle + halfArc,
      });
    }

    return loopholes;
  }
}

/**
 * Find the loophole whose firing arc best covers the angle to an enemy.
 *
 * @param loopholes - Available loopholes on the cover point.
 * @param coverX - Cover point world X.
 * @param coverY - Cover point world Y.
 * @param enemyX - Enemy world X.
 * @param enemyY - Enemy world Y.
 * @returns The best matching loophole, or null if none covers the angle.
 */
export function findBestLoophole(
  loopholes: readonly ILoophole[],
  coverX: number,
  coverY: number,
  enemyX: number,
  enemyY: number,
): ILoophole | null {
  if (loopholes.length === 0) return null;

  const enemyAngle = Math.atan2(enemyY - coverY, enemyX - coverX);

  let best: ILoophole | null = null;
  let bestDelta = Infinity;

  for (const lh of loopholes) {
    const arcCenter = (lh.angleMin + lh.angleMax) / 2;

    let delta = enemyAngle - arcCenter;
    // Normalize to [-PI, PI] for wrap-around.
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    const absDelta = Math.abs(delta);
    const halfArc = (lh.angleMax - lh.angleMin) / 2;

    if (absDelta <= halfArc && absDelta < bestDelta) {
      bestDelta = absDelta;
      best = lh;
    }
  }

  return best;
}
