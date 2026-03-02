import { getRankMultiplier, RANK_MULTIPLIERS, isNPCRecordAlive } from './INPCRecord';
import type { INPCRecord } from './INPCRecord';
import type { IEntityQuery } from '@alife-sdk/core';

describe('getRankMultiplier', () => {
  it('returns correct multiplier for ranks 1-5', () => {
    expect(getRankMultiplier(1)).toBe(0.8);
    expect(getRankMultiplier(2)).toBe(0.9);
    expect(getRankMultiplier(3)).toBe(1.0);
    expect(getRankMultiplier(4)).toBe(1.2);
    expect(getRankMultiplier(5)).toBe(1.5);
  });

  it('clamps rank below 1 to rank 1 multiplier', () => {
    expect(getRankMultiplier(0)).toBe(RANK_MULTIPLIERS[0]);
    expect(getRankMultiplier(-5)).toBe(RANK_MULTIPLIERS[0]);
  });

  it('clamps rank above 5 to rank 5 multiplier', () => {
    expect(getRankMultiplier(6)).toBe(RANK_MULTIPLIERS[4]);
    expect(getRankMultiplier(100)).toBe(RANK_MULTIPLIERS[4]);
  });
});

describe('RANK_MULTIPLIERS', () => {
  it('has 5 entries', () => {
    expect(RANK_MULTIPLIERS).toHaveLength(5);
  });

  it('values are ascending', () => {
    for (let i = 1; i < RANK_MULTIPLIERS.length; i++) {
      expect(RANK_MULTIPLIERS[i]).toBeGreaterThanOrEqual(RANK_MULTIPLIERS[i - 1]);
    }
  });
});

describe('isNPCRecordAlive', () => {
  const mockRecord: INPCRecord = {
    entityId: 'npc_1',
    factionId: 'loners',
    combatPower: 10,
    currentHp: 100,
    rank: 2,
    behaviorConfig: {
      retreatThreshold: 0.3,
      panicThreshold: -0.7,
      searchIntervalMs: 5000,
      dangerTolerance: 3,
      aggression: 0.5,
    },
    lastPosition: { x: 100, y: 200 },
    isOnline: false,
  };

  it('delegates to entityQuery.isAlive with entityId', () => {
    const calls: string[] = [];
    const query: IEntityQuery = {
      getPosition: () => null,
      isAlive: (id) => { calls.push(id); return true; },
      hasComponent: () => false,
      getComponentValue: () => null,
    };

    const result = isNPCRecordAlive(mockRecord, query);
    expect(result).toBe(true);
    expect(calls).toEqual(['npc_1']);
  });

  it('returns false when entity is dead', () => {
    const query: IEntityQuery = {
      getPosition: () => null,
      isAlive: () => false,
      hasComponent: () => false,
      getComponentValue: () => null,
    };

    expect(isNPCRecordAlive(mockRecord, query)).toBe(false);
  });
});
