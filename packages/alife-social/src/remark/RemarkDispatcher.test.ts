import { describe, it, expect, beforeEach } from 'vitest';
import { RemarkDispatcher, DEFAULT_REMARK_ELIGIBLE_STATES } from './RemarkDispatcher';
import { ContentPool } from '../content/ContentPool';
import { SocialCategory } from '../types/ISocialTypes';
import type { ISocialNPC } from '../types/ISocialTypes';
import type { IRemarkConfig } from '../types/ISocialConfig';

const config: IRemarkConfig = {
  remarkCooldownMinMs: 30_000,
  remarkCooldownMaxMs: 60_000,
  remarkCheckIntervalMs: 5_000,
  remarkChance: 1.0, // Always remark in tests
  weightZone: 0.4,
  weightWeatherCumulative: 0.7,
};

function makeRandom(values: number[] = [0.1]) {
  let idx = 0;
  return {
    next: () => values[idx++ % values.length],
    nextInt: (min: number, max: number) => min + Math.floor(values[idx++ % values.length] * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + values[idx++ % values.length] * (max - min),
  };
}

function makeNPC(id: string, state = 'idle', factionId = 'loner'): ISocialNPC {
  return { id, position: { x: 0, y: 0 }, factionId, state };
}

const defaultTerrainId = (id: string) => `terrain_${id}`;

describe('RemarkDispatcher', () => {
  let pool: ContentPool;
  let dispatcher: RemarkDispatcher;

  beforeEach(() => {
    const random = makeRandom([0.1]);
    pool = new ContentPool(random);
    pool.addLines(SocialCategory.REMARK_ZONE, ['Zone remark']);
    pool.addLines(SocialCategory.REMARK_WEATHER, ['Weather remark']);
    pool.addLines(ContentPool.gossipKey('loner'), ['Gossip remark']);
    dispatcher = new RemarkDispatcher(pool, random, config);
  });

  it('emits no bubbles before check interval', () => {
    const npcs = [makeNPC('a')];
    const result = dispatcher.update(1000, npcs, defaultTerrainId);
    expect(result).toHaveLength(0);
  });

  it('emits remark when interval fires', () => {
    const npcs = [makeNPC('a')];
    const result = dispatcher.update(6000, npcs, defaultTerrainId);
    expect(result).toHaveLength(1);
    expect(result[0].npcId).toBe('a');
  });

  it('only emits one remark per check', () => {
    const npcs = [makeNPC('a'), makeNPC('b')];
    const result = dispatcher.update(6000, npcs, defaultTerrainId);
    expect(result).toHaveLength(1);
  });

  it('skips non-eligible states', () => {
    const npcs = [makeNPC('a', 'combat')];
    const result = dispatcher.update(6000, npcs, defaultTerrainId);
    expect(result).toHaveLength(0);
  });

  it('allows idle, patrol, camp states', () => {
    for (const state of ['idle', 'patrol', 'camp']) {
      const d = new RemarkDispatcher(pool, makeRandom([0.1]), config);
      const npcs = [makeNPC('a', state)];
      const result = d.update(6000, npcs, defaultTerrainId);
      expect(result).toHaveLength(1);
    }
  });

  it('respects terrain lock', () => {
    const random = makeRandom([0.1]);
    const d = new RemarkDispatcher(pool, random, config);
    const sameTerrain = () => 'same_terrain';
    const npcs = [makeNPC('a'), makeNPC('b')];

    // First NPC locks terrain
    d.update(6000, npcs, sameTerrain);
    // Only one remark per check anyway, but terrain is now locked by 'a'
    // On next check, 'b' can't speak at same terrain
    const result = d.update(6000, [makeNPC('b')], sameTerrain);
    expect(result).toHaveLength(0);
  });

  it('selects zone category for low random', () => {
    const d = new RemarkDispatcher(pool, makeRandom([0.1, 0.1]), config);
    const result = d.update(6000, [makeNPC('a')], defaultTerrainId);
    expect(result[0].category).toBe(SocialCategory.REMARK_ZONE);
  });

  it('selects weather category for medium random', () => {
    const d = new RemarkDispatcher(pool, makeRandom([0.1, 0.5]), config);
    const result = d.update(6000, [makeNPC('a')], defaultTerrainId);
    expect(result[0].category).toBe(SocialCategory.REMARK_WEATHER);
  });

  it('clear resets state', () => {
    dispatcher.update(6000, [makeNPC('a')], defaultTerrainId);
    dispatcher.clear();
    // After clear, should be able to remark again
    const result = dispatcher.update(6000, [makeNPC('a')], defaultTerrainId);
    expect(result).toHaveLength(1);
  });

  it('skips when remarkChance is 0', () => {
    const noChance: IRemarkConfig = { ...config, remarkChance: 0 };
    const d = new RemarkDispatcher(pool, makeRandom([0.1]), noChance);
    const result = d.update(6000, [makeNPC('a')], defaultTerrainId);
    expect(result).toHaveLength(0);
  });

  it('uses custom eligibleStates from config', () => {
    const customConfig: IRemarkConfig = {
      ...config,
      eligibleStates: ['guard', 'lookout'],
    };
    const d = new RemarkDispatcher(pool, makeRandom([0.1]), customConfig);

    // 'guard' is eligible in custom config
    const result1 = d.update(6000, [makeNPC('a', 'guard')], defaultTerrainId);
    expect(result1).toHaveLength(1);

    d.clear();

    // 'idle' is NOT eligible in custom config (only guard/lookout)
    const result2 = d.update(6000, [makeNPC('b', 'idle')], defaultTerrainId);
    expect(result2).toHaveLength(0);

    // 'patrol' is NOT eligible in custom config
    const result3 = d.update(6000, [makeNPC('c', 'patrol')], defaultTerrainId);
    expect(result3).toHaveLength(0);
  });

  it('DEFAULT_REMARK_ELIGIBLE_STATES matches original hardcoded values', () => {
    expect(DEFAULT_REMARK_ELIGIBLE_STATES).toEqual(['idle', 'patrol', 'camp']);
  });
});
