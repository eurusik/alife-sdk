import { getRankMultiplier, RANK_MULTIPLIERS, isNPCRecordAlive, createDefaultBehaviorConfig } from './INPCRecord';
import type { INPCRecord, INPCBehaviorConfig } from './INPCRecord';
import type { IEntityQuery } from '@alife-sdk/core';

describe('createDefaultBehaviorConfig', () => {
  it('returns all 5 defaults when called with no arguments', () => {
    const config = createDefaultBehaviorConfig();
    expect(config.retreatThreshold).toBe(0.1);
    expect(config.panicThreshold).toBe(-0.7);
    expect(config.searchIntervalMs).toBe(5_000);
    expect(config.dangerTolerance).toBe(3);
    expect(config.aggression).toBe(0.5);
  });

  it('overrides only aggression, leaving the rest as defaults', () => {
    const config = createDefaultBehaviorConfig({ aggression: 0.9 });
    expect(config.aggression).toBe(0.9);
    expect(config.retreatThreshold).toBe(0.1);
    expect(config.panicThreshold).toBe(-0.7);
    expect(config.searchIntervalMs).toBe(5_000);
    expect(config.dangerTolerance).toBe(3);
  });

  it('overrides all 5 fields simultaneously', () => {
    const config = createDefaultBehaviorConfig({
      retreatThreshold: 0.3,
      panicThreshold: -0.5,
      searchIntervalMs: 2_000,
      dangerTolerance: 5,
      aggression: 0.8,
    });
    expect(config.retreatThreshold).toBe(0.3);
    expect(config.panicThreshold).toBe(-0.5);
    expect(config.searchIntervalMs).toBe(2_000);
    expect(config.dangerTolerance).toBe(5);
    expect(config.aggression).toBe(0.8);
  });

  it('return type satisfies INPCBehaviorConfig', () => {
    // TypeScript compile-time check: assignment must not error.
    const config: INPCBehaviorConfig = createDefaultBehaviorConfig();
    expect(config).toBeDefined();
  });
});

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
