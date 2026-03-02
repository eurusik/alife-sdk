import { describe, it, expect } from 'vitest';
import { recommendCoverType } from './CoverRecommender';
import { CoverType } from '../types/ICoverPoint';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig().cover;

describe('recommendCoverType', () => {
  it('returns SAFE when no ammo', () => {
    const result = recommendCoverType(
      { hpRatio: 1.0, morale: 0.5, enemyCount: 1, hasAmmo: false },
      config,
    );
    expect(result).toBe(CoverType.SAFE);
  });

  it('returns CLOSE when HP is critical', () => {
    const result = recommendCoverType(
      { hpRatio: 0.15, morale: 0, enemyCount: 1, hasAmmo: true },
      config,
    );
    expect(result).toBe(CoverType.CLOSE);
  });

  it('returns FAR when demoralized', () => {
    const result = recommendCoverType(
      { hpRatio: 0.5, morale: -0.6, enemyCount: 1, hasAmmo: true },
      config,
    );
    expect(result).toBe(CoverType.FAR);
  });

  it('returns SAFE when outnumbered', () => {
    const result = recommendCoverType(
      { hpRatio: 0.5, morale: 0, enemyCount: 4, hasAmmo: true },
      config,
    );
    expect(result).toBe(CoverType.SAFE);
  });

  it('returns AMBUSH when healthy vs few enemies', () => {
    const result = recommendCoverType(
      { hpRatio: 0.8, morale: 0.3, enemyCount: 1, hasAmmo: true },
      config,
    );
    expect(result).toBe(CoverType.AMBUSH);
  });

  it('returns BALANCED as default', () => {
    const result = recommendCoverType(
      { hpRatio: 0.5, morale: 0, enemyCount: 2, hasAmmo: true },
      config,
    );
    expect(result).toBe(CoverType.BALANCED);
  });

  it('no-ammo takes priority over critical HP', () => {
    const result = recommendCoverType(
      { hpRatio: 0.1, morale: -0.8, enemyCount: 5, hasAmmo: false },
      config,
    );
    expect(result).toBe(CoverType.SAFE);
  });

  it('critical HP takes priority over demoralized', () => {
    const result = recommendCoverType(
      { hpRatio: 0.15, morale: -0.8, enemyCount: 1, hasAmmo: true },
      config,
    );
    expect(result).toBe(CoverType.CLOSE);
  });
});
