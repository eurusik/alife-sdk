import { SmartTerrain, type ISmartTerrainConfig } from './SmartTerrain';
import { SeededRandom } from '../ports/IRandom';

function makeConfig(overrides?: Partial<ISmartTerrainConfig>): ISmartTerrainConfig {
  return {
    id: 'terrain_bar',
    name: 'Bar',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 5,
    dangerLevel: 3,
    ...overrides,
  };
}

describe('SmartTerrain', () => {
  // -----------------------------------------------------------------------
  // scoreFitness
  // -----------------------------------------------------------------------
  describe('scoreFitness', () => {
    it('returns base score = capacity minus occupants for an NPC at the center', () => {
      const t = new SmartTerrain(makeConfig());
      // NPC at exact center (100,100) => distance = 0, no distance penalty
      // base = capacity(5) - occupants(0) = 5
      // rank(5) >= dangerLevel(3) => +10
      // not shelter => no bonus
      // total = 5 + 10 = 15
      const score = t.scoreFitness('stalkers', { x: 100, y: 100 }, 5);
      expect(score).toBe(15);
    });

    it('applies distance penalty proportional to distance / 100', () => {
      const t = new SmartTerrain(makeConfig());
      // center = (100, 100), NPC at (200, 100) => dist = 100
      // base = 5, penalty = -100/100 = -1, rank bonus +10
      // total = 5 - 1 + 10 = 14
      const score = t.scoreFitness('stalkers', { x: 200, y: 100 }, 5);
      expect(score).toBe(14);
    });

    it('applies shelter bonus when isShelter is true', () => {
      const t = new SmartTerrain(makeConfig({ isShelter: true }));
      // center = (100,100), NPC at center => dist 0
      // base = 5, shelter bonus = 50, rank(5) >= danger(3) => +10
      // total = 5 + 50 + 10 = 65
      const score = t.scoreFitness('stalkers', { x: 100, y: 100 }, 5);
      expect(score).toBe(65);
    });

    it('does not apply shelter bonus when isShelter is false', () => {
      const t = new SmartTerrain(makeConfig({ isShelter: false }));
      const score = t.scoreFitness('stalkers', { x: 100, y: 100 }, 5);
      expect(score).toBe(15); // 5 + 10, no shelter
    });

    it('applies rank match bonus when npcRank >= dangerLevel', () => {
      const t = new SmartTerrain(makeConfig({ dangerLevel: 3 }));
      const score = t.scoreFitness('stalkers', { x: 100, y: 100 }, 3);
      expect(score).toBe(15); // 5 + 10
    });

    it('does not apply rank match bonus when npcRank < dangerLevel', () => {
      const t = new SmartTerrain(makeConfig({ dangerLevel: 5 }));
      const score = t.scoreFitness('stalkers', { x: 100, y: 100 }, 2);
      expect(score).toBe(5); // 5 only, no rank bonus
    });

    it('returns -Infinity for a disallowed faction', () => {
      const t = new SmartTerrain(
        makeConfig({ allowedFactions: ['duty', 'freedom'] }),
      );
      const score = t.scoreFitness('bandits', { x: 100, y: 100 }, 5);
      expect(score).toBe(-Infinity);
    });

    it('decreases base score as occupants increase', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 3 }));
      t.addOccupant('npc1');
      t.addOccupant('npc2');
      // base = 3 - 2 = 1, rank(5)>=danger(3) +10 => 11
      const score = t.scoreFitness('stalkers', { x: 100, y: 100 }, 5);
      expect(score).toBe(11);
    });

    it('uses injected IRandom for deterministic jitter', () => {
      const rng = new SeededRandom(42);
      const t = new SmartTerrain(
        makeConfig({ scoring: { scoringJitter: 10 }, random: rng }),
      );

      const score1 = t.scoreFitness('stalkers', { x: 100, y: 100 }, 5);

      // Same seed → same score
      const rng2 = new SeededRandom(42);
      const t2 = new SmartTerrain(
        makeConfig({ scoring: { scoringJitter: 10 }, random: rng2 }),
      );
      const score2 = t2.scoreFitness('stalkers', { x: 100, y: 100 }, 5);

      expect(score1).toBe(score2);
    });

    it('uses squared distance when useSquaredDistance is true', () => {
      const t = new SmartTerrain(
        makeConfig({
          scoring: { useSquaredDistance: true },
        }),
      );
      // center = (100,100), NPC at (200,100) => dist = 100, distSq = 10000
      // default distancePenaltySqDivisor = 100² = 10000
      // base = 5, penalty = -10000/10000 = -1, rank(5)>=danger(3) +10
      // total = 5 - 1 + 10 = 14
      const score = t.scoreFitness('stalkers', { x: 200, y: 100 }, 5);
      expect(score).toBe(14);
    });

    it('uses custom distancePenaltySqDivisor with squared distance', () => {
      const t = new SmartTerrain(
        makeConfig({
          scoring: {
            useSquaredDistance: true,
            distancePenaltySqDivisor: 5000,
          },
        }),
      );
      // center = (100,100), NPC at (200,100) => distSq = 10000
      // penalty = -10000/5000 = -2
      // base = 5, rank +10 => 5 - 2 + 10 = 13
      const score = t.scoreFitness('stalkers', { x: 200, y: 100 }, 5);
      expect(score).toBe(13);
    });

    it('squared distance penalizes far NPCs more than linear', () => {
      const tLinear = new SmartTerrain(makeConfig());
      const tSquared = new SmartTerrain(
        makeConfig({ scoring: { useSquaredDistance: true } }),
      );
      // NPC at (400, 100) => dist = 300, distSq = 90000
      // Linear penalty: -300/100 = -3
      // Squared penalty: -90000/10000 = -9
      const scoreLinear = tLinear.scoreFitness('stalkers', { x: 400, y: 100 }, 5);
      const scoreSquared = tSquared.scoreFitness('stalkers', { x: 400, y: 100 }, 5);
      expect(scoreSquared).toBeLessThan(scoreLinear);
    });

    it('respects custom scoring config', () => {
      const t = new SmartTerrain(
        makeConfig({
          isShelter: true,
          scoring: {
            distancePenaltyDivisor: 50,
            shelterBonus: 100,
            rankMatchBonus: 20,
          },
        }),
      );
      // center = (100,100), NPC at (200,100) => dist = 100
      // base = 5, penalty = -100/50 = -2, shelter +100, rank +20
      // total = 5 - 2 + 100 + 20 = 123
      const score = t.scoreFitness('stalkers', { x: 200, y: 100 }, 5);
      expect(score).toBe(123);
    });
  });

  // -----------------------------------------------------------------------
  // acceptsFaction
  // -----------------------------------------------------------------------
  describe('acceptsFaction', () => {
    it('accepts any faction when allowedFactions is empty', () => {
      const t = new SmartTerrain(makeConfig({ allowedFactions: undefined }));
      expect(t.acceptsFaction('bandits')).toBe(true);
      expect(t.acceptsFaction('stalkers')).toBe(true);
    });

    it('accepts only listed factions', () => {
      const t = new SmartTerrain(
        makeConfig({ allowedFactions: ['duty', 'stalkers'] }),
      );
      expect(t.acceptsFaction('duty')).toBe(true);
      expect(t.acceptsFaction('stalkers')).toBe(true);
      expect(t.acceptsFaction('bandits')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Occupant tracking
  // -----------------------------------------------------------------------
  describe('occupant tracking', () => {
    it('starts with zero occupants and has capacity', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 3 }));
      expect(t.occupantCount).toBe(0);
      expect(t.hasCapacity).toBe(true);
    });

    it('adds occupants and tracks count', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 2 }));
      expect(t.addOccupant('npc1')).toBe(true);
      expect(t.occupantCount).toBe(1);
      expect(t.hasOccupant('npc1')).toBe(true);
    });

    it('returns false when adding beyond capacity', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 1 }));
      expect(t.addOccupant('npc1')).toBe(true);
      expect(t.addOccupant('npc2')).toBe(false);
      expect(t.occupantCount).toBe(1);
      expect(t.hasCapacity).toBe(false);
    });

    it('removes occupants and frees capacity', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 1 }));
      t.addOccupant('npc1');
      t.removeOccupant('npc1');
      expect(t.occupantCount).toBe(0);
      expect(t.hasCapacity).toBe(true);
      expect(t.hasOccupant('npc1')).toBe(false);
    });

    it('removing a non-existent occupant is a no-op', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 2 }));
      t.removeOccupant('ghost');
      expect(t.occupantCount).toBe(0);
    });

    it('getOccupants() returns empty set when no occupants', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 3 }));
      const occ = t.getOccupants();
      expect(occ.size).toBe(0);
    });

    it('getOccupants() returns set with correct occupants', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 3 }));
      t.addOccupant('npc1');
      t.addOccupant('npc2');
      const occ = t.getOccupants();
      expect(occ.size).toBe(2);
      expect(occ.has('npc1')).toBe(true);
      expect(occ.has('npc2')).toBe(true);
      expect(occ.has('npc3')).toBe(false);
    });

    it('getOccupants() reflects removals', () => {
      const t = new SmartTerrain(makeConfig({ capacity: 3 }));
      t.addOccupant('npc1');
      t.addOccupant('npc2');
      t.removeOccupant('npc1');
      const occ = t.getOccupants();
      expect(occ.size).toBe(1);
      expect(occ.has('npc1')).toBe(false);
      expect(occ.has('npc2')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Inherited Zone behavior
  // -----------------------------------------------------------------------
  describe('inherits Zone', () => {
    it('contains works correctly', () => {
      const t = new SmartTerrain(makeConfig());
      expect(t.contains({ x: 100, y: 100 })).toBe(true);
      expect(t.contains({ x: 300, y: 300 })).toBe(false);
    });

    it('center is correct', () => {
      const t = new SmartTerrain(makeConfig());
      expect(t.center).toEqual({ x: 100, y: 100 });
    });
  });

  // -----------------------------------------------------------------------
  // Tags & patrol routes
  // -----------------------------------------------------------------------
  describe('tags', () => {
    it('stores tags as a set', () => {
      const t = new SmartTerrain(makeConfig({ tags: ['indoor', 'settlement'] }));
      expect(t.tags.has('indoor')).toBe(true);
      expect(t.tags.has('settlement')).toBe(true);
      expect(t.tags.has('outdoor')).toBe(false);
    });
  });

  describe('patrol routes', () => {
    it('indexes patrol routes by id', () => {
      const route = {
        id: 'r1',
        routeType: 'loop' as const,
        waypoints: [{ x: 10, y: 20 }],
      };
      const t = new SmartTerrain(makeConfig({ patrolRoutes: [route] }));
      expect(t.patrolRoutes.get('r1')).toEqual(route);
      expect(t.patrolRoutes.size).toBe(1);
    });
  });
});
