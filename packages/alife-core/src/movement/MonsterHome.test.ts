import { MonsterHome } from './MonsterHome';
import { SeededRandom } from '../ports/IRandom';

describe('MonsterHome', () => {
  const defaultConfig = {
    anchor: { x: 100, y: 100 },
    innerRadius: 20,
    patrolRadius: 60,
    outerRadius: 120,
  };

  // -----------------------------------------------------------------------
  // Zone classification
  // -----------------------------------------------------------------------
  describe('zone classification', () => {
    it('classifies a point in the inner zone', () => {
      const home = new MonsterHome(defaultConfig);
      const point = { x: 110, y: 100 }; // 10px from anchor
      expect(home.isInInnerZone(point)).toBe(true);
      expect(home.isInPatrolZone(point)).toBe(false);
      expect(home.isInOuterZone(point)).toBe(true);
      expect(home.isOutOfTerritory(point)).toBe(false);
    });

    it('classifies a point in the patrol zone (between inner and patrol)', () => {
      const home = new MonsterHome(defaultConfig);
      const point = { x: 140, y: 100 }; // 40px from anchor
      expect(home.isInInnerZone(point)).toBe(false);
      expect(home.isInPatrolZone(point)).toBe(true);
      expect(home.isInOuterZone(point)).toBe(true);
      expect(home.isOutOfTerritory(point)).toBe(false);
    });

    it('classifies a point in the outer zone (between patrol and outer)', () => {
      const home = new MonsterHome(defaultConfig);
      const point = { x: 180, y: 100 }; // 80px from anchor
      expect(home.isInInnerZone(point)).toBe(false);
      expect(home.isInPatrolZone(point)).toBe(false);
      expect(home.isInOuterZone(point)).toBe(true);
      expect(home.isOutOfTerritory(point)).toBe(false);
    });

    it('classifies a point outside the territory', () => {
      const home = new MonsterHome(defaultConfig);
      const point = { x: 300, y: 100 }; // 200px from anchor
      expect(home.isInInnerZone(point)).toBe(false);
      expect(home.isInPatrolZone(point)).toBe(false);
      expect(home.isInOuterZone(point)).toBe(false);
      expect(home.isOutOfTerritory(point)).toBe(true);
    });

    it('classifies the anchor point itself as inner zone', () => {
      const home = new MonsterHome(defaultConfig);
      expect(home.isInInnerZone({ x: 100, y: 100 })).toBe(true);
    });

    it('classifies point exactly on inner radius boundary as inner zone', () => {
      const home = new MonsterHome(defaultConfig);
      // Exactly 20px away
      expect(home.isInInnerZone({ x: 120, y: 100 })).toBe(true);
    });

    it('classifies point exactly on outer radius boundary as in outer zone', () => {
      const home = new MonsterHome(defaultConfig);
      // Exactly 120px away
      expect(home.isInOuterZone({ x: 220, y: 100 })).toBe(true);
      expect(home.isOutOfTerritory({ x: 220, y: 100 })).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Radius hierarchy validation
  // -----------------------------------------------------------------------
  describe('radius hierarchy enforcement', () => {
    it('enforces inner < patrol < outer when given invalid values', () => {
      // All set to same value: should clamp to 1, 2, 3 minimum hierarchy
      const home = new MonsterHome({
        anchor: { x: 0, y: 0 },
        innerRadius: 0,
        patrolRadius: 0,
        outerRadius: 0,
      });

      // inner clamps to max(1, 0) = 1
      // patrol clamps to max(1+1, 0) = 2
      // outer clamps to max(2+1, 0) = 3
      // Point at distance 1 should be in inner zone
      expect(home.isInInnerZone({ x: 1, y: 0 })).toBe(true);
      // Point at distance 2 should be in patrol zone
      expect(home.isInPatrolZone({ x: 2, y: 0 })).toBe(true);
      // Point at distance 3 should be in outer zone
      expect(home.isInOuterZone({ x: 3, y: 0 })).toBe(true);
      // Point at distance 4 should be out of territory
      expect(home.isOutOfTerritory({ x: 4, y: 0 })).toBe(true);
    });

    it('enforces patrol > inner when patrol is too small', () => {
      const home = new MonsterHome({
        anchor: { x: 0, y: 0 },
        innerRadius: 50,
        patrolRadius: 30, // smaller than inner
        outerRadius: 200,
      });

      // patrol should be clamped to at least inner(50)+1 = 51
      // Point at 50.5 from anchor should be in patrol zone, not inner
      // Use Pythagorean: sqrt(50.5^2) = 50.5
      const pointInPatrol = { x: 51, y: 0 };
      expect(home.isInInnerZone(pointInPatrol)).toBe(false);
      expect(home.isInPatrolZone(pointInPatrol)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getRandomPatrolPoint
  // -----------------------------------------------------------------------
  describe('getRandomPatrolPoint', () => {
    it('returns a point within the patrol annulus', () => {
      const home = new MonsterHome(defaultConfig);

      // Run multiple times to increase confidence
      for (let i = 0; i < 50; i++) {
        const point = home.getRandomPatrolPoint();
        const dsq = home.distanceFromAnchorSq(point);
        const innerSq = 20 * 20;
        const patrolSq = 60 * 60;

        // Should be >= innerRadius and <= patrolRadius from anchor
        expect(dsq).toBeGreaterThanOrEqual(innerSq);
        expect(dsq).toBeLessThanOrEqual(patrolSq);
      }
    });

    it('produces deterministic results with SeededRandom', () => {
      const home1 = new MonsterHome(defaultConfig, new SeededRandom(42));
      const home2 = new MonsterHome(defaultConfig, new SeededRandom(42));

      const p1 = home1.getRandomPatrolPoint();
      const p2 = home2.getRandomPatrolPoint();

      expect(p1.x).toBe(p2.x);
      expect(p1.y).toBe(p2.y);
    });

    it('produces uniform area distribution (sqrt sampling), not center-biased', () => {
      const home = new MonsterHome(defaultConfig, new SeededRandom(12345));
      const innerR = 20;
      const patrolR = 60;
      const N = 1000;

      let distanceSum = 0;
      for (let i = 0; i < N; i++) {
        const point = home.getRandomPatrolPoint();
        const dx = point.x - defaultConfig.anchor.x;
        const dy = point.y - defaultConfig.anchor.y;
        distanceSum += Math.sqrt(dx * dx + dy * dy);
      }
      const meanDist = distanceSum / N;

      // For a uniform distribution over an annulus [r1, r2], the expected
      // mean radius is: E[r] = (2/3) * (r2^3 - r1^3) / (r2^2 - r1^2)
      // This is the geometric mean for area-uniform sampling.
      const expectedUniform =
        (2 / 3) * (patrolR ** 3 - innerR ** 3) / (patrolR ** 2 - innerR ** 2);

      // For a linear (biased) distribution, E[r] = (r1 + r2) / 2 = arithmetic mean.
      const biasedArithmetic = (innerR + patrolR) / 2;

      // The mean should be closer to the uniform expectation than to the biased one.
      const errorUniform = Math.abs(meanDist - expectedUniform);
      const errorBiased = Math.abs(meanDist - biasedArithmetic);

      expect(errorUniform).toBeLessThan(errorBiased);

      // Additionally, with N=1000, the mean should be within a reasonable
      // tolerance of the theoretical value (~44.6 for these radii).
      expect(meanDist).toBeGreaterThan(expectedUniform - 3);
      expect(meanDist).toBeLessThan(expectedUniform + 3);
    });
  });

  // -----------------------------------------------------------------------
  // distanceFromAnchorSq
  // -----------------------------------------------------------------------
  describe('distanceFromAnchorSq', () => {
    it('returns squared Euclidean distance from anchor', () => {
      const home = new MonsterHome(defaultConfig);
      // anchor = (100, 100), point = (103, 104)
      // dx=3, dy=4, dsq = 9+16 = 25
      expect(home.distanceFromAnchorSq({ x: 103, y: 104 })).toBe(25);
    });

    it('returns 0 for the anchor point itself', () => {
      const home = new MonsterHome(defaultConfig);
      expect(home.distanceFromAnchorSq({ x: 100, y: 100 })).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Anchor
  // -----------------------------------------------------------------------
  describe('anchor', () => {
    it('exposes the anchor point', () => {
      const home = new MonsterHome(defaultConfig);
      expect(home.anchor).toEqual({ x: 100, y: 100 });
    });
  });
});
