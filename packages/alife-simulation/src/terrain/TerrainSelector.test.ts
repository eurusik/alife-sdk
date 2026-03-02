import { SmartTerrain, type ISmartTerrainConfig } from '@alife-sdk/core';
import { TerrainSelector } from './TerrainSelector';
import type { ITerrainSelectorConfig } from '../types/ISimulationConfig';

const defaultConfig: ITerrainSelectorConfig = {
  surgeMultiplier: 3.0,
  squadLeaderBonus: 20,
  moraleDangerPenalty: 15,
};

function makeTerrain(overrides?: Partial<ISmartTerrainConfig>): SmartTerrain {
  return new SmartTerrain({
    id: 'terrain_1',
    name: 'Default',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 5,
    ...overrides,
  });
}

describe('TerrainSelector', () => {
  // -----------------------------------------------------------------------
  // passesTagFilter
  // -----------------------------------------------------------------------
  describe('passesTagFilter', () => {
    it('returns true for empty tag set', () => {
      const t = makeTerrain({ tags: ['outdoor'] });
      expect(TerrainSelector.passesTagFilter(t, new Set())).toBe(true);
    });

    it('returns true when terrain has a matching tag', () => {
      const t = makeTerrain({ tags: ['outdoor', 'settlement'] });
      expect(TerrainSelector.passesTagFilter(t, new Set(['outdoor']))).toBe(true);
    });

    it('returns false when no tags match', () => {
      const t = makeTerrain({ tags: ['indoor'] });
      expect(TerrainSelector.passesTagFilter(t, new Set(['outdoor']))).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // selectBest — basic selection
  // -----------------------------------------------------------------------
  describe('selectBest', () => {
    it('returns the terrain with highest fitness', () => {
      const close = makeTerrain({
        id: 'close',
        bounds: { x: 80, y: 80, width: 40, height: 40 },
        capacity: 5,
      });
      const far = makeTerrain({
        id: 'far',
        bounds: { x: 1000, y: 1000, width: 200, height: 200 },
        capacity: 5,
      });

      const result = TerrainSelector.selectBest({
        terrains: [close, far],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBe(close);
    });

    it('returns null when no terrains have capacity', () => {
      const full = makeTerrain({ capacity: 1 });
      full.addOccupant('npc_1');

      const result = TerrainSelector.selectBest({
        terrains: [full],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBeNull();
    });

    it('returns null for empty terrain list', () => {
      const result = TerrainSelector.selectBest({
        terrains: [],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });
      expect(result).toBeNull();
    });

    it('filters by faction', () => {
      const dutyOnly = makeTerrain({
        id: 'duty_base',
        allowedFactions: ['duty'],
      });

      const result = TerrainSelector.selectBest({
        terrains: [dutyOnly],
        npcFaction: 'bandits',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Occupant exception (occupantId)
  // -----------------------------------------------------------------------
  describe('occupant capacity exception', () => {
    it('allows occupant to stay in full terrain via occupantId', () => {
      const lair = makeTerrain({ id: 'lair', capacity: 2 });
      lair.addOccupant('monster_1');
      lair.addOccupant('monster_2');

      const alternative = makeTerrain({
        id: 'alt',
        capacity: 5,
        bounds: { x: 500, y: 500, width: 200, height: 200 },
      });

      const result = TerrainSelector.selectBest({
        terrains: [lair, alternative],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
        occupantId: 'monster_1', // occupantId — this NPC is already in lair
      });

      expect(result).toBe(lair);
    });

    it('rejects full terrain when occupantId is not an occupant', () => {
      const lair = makeTerrain({ id: 'lair', capacity: 1 });
      lair.addOccupant('monster_1');

      const alternative = makeTerrain({
        id: 'alt',
        capacity: 5,
        bounds: { x: 500, y: 500, width: 200, height: 200 },
      });

      const result = TerrainSelector.selectBest({
        terrains: [lair, alternative],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
        occupantId: 'monster_2', // not an occupant of lair
      });

      expect(result).toBe(alternative);
    });

    it('still rejects full terrain when occupantId is not provided', () => {
      const full = makeTerrain({ id: 'full', capacity: 1 });
      full.addOccupant('npc_1');

      expect(
        TerrainSelector.selectBest({
          terrains: [full],
          npcFaction: 'stalkers',
          npcPos: { x: 100, y: 100 },
          npcRank: 3,
          morale: 0,
          surgeActive: false,
          leaderTerrainId: null,
          allowedTags: null,
          config: defaultConfig,
        }),
      ).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Surge
  // -----------------------------------------------------------------------
  describe('surge behavior', () => {
    it('only considers shelters during surge', () => {
      const shelter = makeTerrain({
        id: 'shelter',
        isShelter: true,
        bounds: { x: 500, y: 500, width: 200, height: 200 },
      });
      const open = makeTerrain({
        id: 'open',
        isShelter: false,
        bounds: { x: 80, y: 80, width: 40, height: 40 },
      });

      const result = TerrainSelector.selectBest({
        terrains: [shelter, open],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: true, // surge active
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBe(shelter);
    });

    it('applies surge multiplier to shelter scores', () => {
      const shelter1 = makeTerrain({
        id: 'shelter_near',
        isShelter: true,
        capacity: 5,
        bounds: { x: 80, y: 80, width: 40, height: 40 },
      });
      const shelter2 = makeTerrain({
        id: 'shelter_far',
        isShelter: true,
        capacity: 5,
        bounds: { x: 400, y: 400, width: 200, height: 200 },
      });

      // During surge both get multiplied, but nearer shelter still wins
      const result = TerrainSelector.selectBest({
        terrains: [shelter1, shelter2],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: true,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBe(shelter1);
    });
  });

  // -----------------------------------------------------------------------
  // Morale penalty
  // -----------------------------------------------------------------------
  describe('morale penalty', () => {
    it('penalizes dangerous terrains when morale is negative', () => {
      const dangerous = makeTerrain({
        id: 'danger',
        dangerLevel: 5,
        bounds: { x: 80, y: 80, width: 40, height: 40 },
        capacity: 5,
      });
      const safe = makeTerrain({
        id: 'safe',
        dangerLevel: 0,
        bounds: { x: 80, y: 80, width: 40, height: 40 },
        capacity: 5,
      });

      const result = TerrainSelector.selectBest({
        terrains: [dangerous, safe],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: -0.5, // negative morale
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      // danger gets penalty: 5 * 15 = 75, safe gets 0 penalty
      expect(result).toBe(safe);
    });

    it('does not penalize when morale is positive', () => {
      const dangerous = makeTerrain({
        id: 'danger',
        dangerLevel: 5,
        bounds: { x: 80, y: 80, width: 40, height: 40 },
        capacity: 5,
      });

      // With positive morale, no penalty applied
      const result = TerrainSelector.selectBest({
        terrains: [dangerous],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 5,
        morale: 0.5,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBe(dangerous);
    });
  });

  // -----------------------------------------------------------------------
  // Squad leader bonus
  // -----------------------------------------------------------------------
  describe('squad leader bonus', () => {
    it('boosts score for leader terrain', () => {
      const leaderTerrain = makeTerrain({
        id: 'leader_spot',
        bounds: { x: 500, y: 500, width: 200, height: 200 },
        capacity: 5,
      });
      const closerTerrain = makeTerrain({
        id: 'closer',
        bounds: { x: 80, y: 80, width: 40, height: 40 },
        capacity: 5,
      });

      // Without bonus, closer wins. With +20 bonus, leader might win.
      const result = TerrainSelector.selectBest({
        terrains: [leaderTerrain, closerTerrain],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: 'leader_spot',
        allowedTags: null,
        config: { ...defaultConfig, squadLeaderBonus: 100 },
      });

      expect(result).toBe(leaderTerrain);
    });
  });

  // -----------------------------------------------------------------------
  // Tag filtering
  // -----------------------------------------------------------------------
  describe('tag filtering', () => {
    it('filters terrains by allowed tags', () => {
      const indoor = makeTerrain({
        id: 'indoor',
        tags: ['indoor'],
        bounds: { x: 80, y: 80, width: 40, height: 40 },
      });
      const outdoor = makeTerrain({
        id: 'outdoor',
        tags: ['outdoor'],
        bounds: { x: 80, y: 80, width: 40, height: 40 },
      });

      const result = TerrainSelector.selectBest({
        terrains: [indoor, outdoor],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: new Set(['outdoor']),
        config: defaultConfig,
      });

      expect(result).toBe(outdoor);
    });

    it('accepts all terrains when allowedTags is null', () => {
      const t = makeTerrain({
        id: 'any',
        tags: ['indoor'],
        bounds: { x: 80, y: 80, width: 40, height: 40 },
      });

      const result = TerrainSelector.selectBest({
        terrains: [t],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: defaultConfig,
      });

      expect(result).toBe(t);
    });
  });
});
