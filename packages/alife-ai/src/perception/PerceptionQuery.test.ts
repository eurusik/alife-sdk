import { describe, it, expect } from 'vitest';
import {
  isInFOV,
  filterVisibleEntities,
  filterHearingEntities,
  filterHostileEntities,
  filterFriendlyEntities,
  distanceSq,
  findClosest,
  scanForEnemies,
} from './PerceptionQuery';
import type { IPerceivedEntity, IPerceptionConfig } from '../types/IPerceptionTypes';

const config: IPerceptionConfig = {
  visionRange: 300,
  visionHalfAngle: Math.PI / 3,
  hearingRange: 500,
  weaponSoundRange: 600,
};

function makeEntity(
  id: string,
  x: number,
  y: number,
  factionId = 'loner',
  isAlive = true,
): IPerceivedEntity {
  return { entityId: id, position: { x, y }, factionId, isAlive };
}

describe('isInFOV', () => {
  it('detects target directly ahead', () => {
    expect(isInFOV({ x: 0, y: 0 }, 0, { x: 100, y: 0 }, 300, Math.PI / 3)).toBe(true);
  });

  it('rejects target behind observer', () => {
    expect(isInFOV({ x: 0, y: 0 }, 0, { x: -100, y: 0 }, 300, Math.PI / 3)).toBe(false);
  });

  it('rejects target beyond range', () => {
    expect(isInFOV({ x: 0, y: 0 }, 0, { x: 400, y: 0 }, 300, Math.PI / 3)).toBe(false);
  });

  it('detects target at cone edge', () => {
    const angle = Math.PI / 3 - 0.01;
    const target = { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 };
    expect(isInFOV({ x: 0, y: 0 }, 0, target, 300, Math.PI / 3)).toBe(true);
  });

  it('rejects target just outside cone', () => {
    const angle = Math.PI / 3 + 0.1;
    const target = { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 };
    expect(isInFOV({ x: 0, y: 0 }, 0, target, 300, Math.PI / 3)).toBe(false);
  });

  it('detects target at zero distance', () => {
    expect(isInFOV({ x: 5, y: 5 }, 0, { x: 5, y: 5 }, 300, Math.PI / 3)).toBe(true);
  });

  it('handles non-zero facing angle', () => {
    expect(isInFOV({ x: 0, y: 0 }, Math.PI / 2, { x: 0, y: 100 }, 300, Math.PI / 3)).toBe(true);
    expect(isInFOV({ x: 0, y: 0 }, Math.PI / 2, { x: 100, y: 0 }, 300, Math.PI / 3)).toBe(false);
  });
});

describe('filterVisibleEntities', () => {
  it('returns entities in FOV', () => {
    const entities = [
      makeEntity('a', 100, 0),
      makeEntity('b', -100, 0),
      makeEntity('c', 50, 10),
    ];
    const result = filterVisibleEntities({ x: 0, y: 0 }, 0, entities, config);
    expect(result.map((e) => e.entityId)).toEqual(['a', 'c']);
  });

  it('excludes dead entities', () => {
    const entities = [makeEntity('a', 100, 0, 'loner', false)];
    const result = filterVisibleEntities({ x: 0, y: 0 }, 0, entities, config);
    expect(result).toHaveLength(0);
  });

  it('returns empty for no candidates', () => {
    expect(filterVisibleEntities({ x: 0, y: 0 }, 0, [], config)).toHaveLength(0);
  });
});

describe('filterHearingEntities', () => {
  it('detects entities within sound range', () => {
    const entities = [
      makeEntity('a', 100, 0),
      makeEntity('b', 700, 0),
    ];
    const result = filterHearingEntities({ x: 0, y: 0 }, 600, entities);
    expect(result.map((e) => e.entityId)).toEqual(['a']);
  });

  it('uses per-listener hearing range when smaller', () => {
    const entities = [makeEntity('a', 250, 0)];
    const result = filterHearingEntities({ x: 0, y: 0 }, 600, entities, 200);
    expect(result).toHaveLength(0);
  });

  it('excludes dead entities', () => {
    const entities = [makeEntity('a', 10, 0, 'loner', false)];
    const result = filterHearingEntities({ x: 0, y: 0 }, 600, entities);
    expect(result).toHaveLength(0);
  });

  it('detects entity at boundary', () => {
    const entities = [makeEntity('a', 600, 0)];
    const result = filterHearingEntities({ x: 0, y: 0 }, 600, entities);
    expect(result).toHaveLength(1);
  });
});

describe('filterHostileEntities', () => {
  const isHostile = (a: string, b: string) => {
    if (a === 'loner' && b === 'bandit') return true;
    if (a === 'bandit' && b === 'loner') return true;
    return false;
  };

  it('includes hostile factions', () => {
    const entities = [makeEntity('a', 0, 0, 'bandit')];
    const result = filterHostileEntities(entities, 'loner', isHostile);
    expect(result).toHaveLength(1);
  });

  it('excludes same faction', () => {
    const entities = [makeEntity('a', 0, 0, 'loner')];
    const result = filterHostileEntities(entities, 'loner', isHostile);
    expect(result).toHaveLength(0);
  });

  it('excludes non-hostile different faction', () => {
    const entities = [makeEntity('a', 0, 0, 'military')];
    const result = filterHostileEntities(entities, 'loner', isHostile);
    expect(result).toHaveLength(0);
  });
});

describe('filterFriendlyEntities', () => {
  const isHostile = (a: string, b: string) => a === 'loner' && b === 'bandit';

  it('includes same faction', () => {
    const entities = [makeEntity('a', 0, 0, 'loner')];
    const result = filterFriendlyEntities(entities, 'loner', isHostile);
    expect(result).toHaveLength(1);
  });

  it('includes non-hostile different faction', () => {
    const entities = [makeEntity('a', 0, 0, 'military')];
    const result = filterFriendlyEntities(entities, 'loner', isHostile);
    expect(result).toHaveLength(1);
  });

  it('excludes hostile faction', () => {
    const entities = [makeEntity('a', 0, 0, 'bandit')];
    const result = filterFriendlyEntities(entities, 'loner', isHostile);
    expect(result).toHaveLength(0);
  });
});

describe('distanceSq', () => {
  it('computes squared distance', () => {
    expect(distanceSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });

  it('returns 0 for same point', () => {
    expect(distanceSq({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
});

describe('findClosest', () => {
  it('finds closest entity', () => {
    const entities = [
      makeEntity('far', 200, 0),
      makeEntity('near', 50, 0),
      makeEntity('mid', 100, 0),
    ];
    expect(findClosest({ x: 0, y: 0 }, entities)?.entityId).toBe('near');
  });

  it('returns null for empty array', () => {
    expect(findClosest({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('scanForEnemies', () => {
  const isHostile = (a: string, b: string) => a !== b;

  it('finds visible hostile entities', () => {
    const entities = [
      makeEntity('enemy', 100, 0, 'bandit'),
      makeEntity('friend', 100, 0, 'loner'),
    ];
    const result = scanForEnemies(
      { x: 0, y: 0 }, 0, entities, 'loner', isHostile, config,
    );
    expect(result.map((e) => e.entityId)).toEqual(['enemy']);
  });

  it('excludes enemies behind observer', () => {
    const entities = [makeEntity('behind', -100, 0, 'bandit')];
    const result = scanForEnemies(
      { x: 0, y: 0 }, 0, entities, 'loner', isHostile, config,
    );
    expect(result).toHaveLength(0);
  });

  it('excludes dead enemies', () => {
    const entities = [makeEntity('dead', 100, 0, 'bandit', false)];
    const result = scanForEnemies(
      { x: 0, y: 0 }, 0, entities, 'loner', isHostile, config,
    );
    expect(result).toHaveLength(0);
  });

  it('excludes enemies beyond range', () => {
    const entities = [makeEntity('far', 500, 0, 'bandit')];
    const result = scanForEnemies(
      { x: 0, y: 0 }, 0, entities, 'loner', isHostile, config,
    );
    expect(result).toHaveLength(0);
  });

  it('includes enemy at zero distance', () => {
    const entities = [makeEntity('same_pos', 0, 0, 'bandit')];
    const result = scanForEnemies(
      { x: 0, y: 0 }, 0, entities, 'loner', isHostile, config,
    );
    expect(result).toHaveLength(1);
  });
});
