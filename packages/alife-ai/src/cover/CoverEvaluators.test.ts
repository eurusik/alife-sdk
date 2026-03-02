import { describe, it, expect } from 'vitest';
import {
  CloseCoverEvaluator,
  FarCoverEvaluator,
  BalancedCoverEvaluator,
  AmbushCoverEvaluator,
  SafeCoverEvaluator,
  createCoverEvaluators,
} from './CoverEvaluators';
import { CoverType } from '../types/ICoverPoint';
import type { ICoverPoint, ICoverEvalContext } from '../types/ICoverPoint';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig().cover;

function makePoint(x: number, y: number): ICoverPoint {
  return { id: `test_${x}_${y}`, x, y, radius: 24, occupiedBy: null, loopholes: [] };
}

function makeContext(
  npcX: number,
  npcY: number,
  enemies: Array<{ x: number; y: number }>,
): ICoverEvalContext {
  return {
    npcPosition: { x: npcX, y: npcY },
    enemies,
    maxRadiusSq: 400 * 400,
  };
}

describe('CloseCoverEvaluator', () => {
  const evaluator = new CloseCoverEvaluator(config);

  it('scores nearby cover higher than far cover', () => {
    const ctx = makeContext(100, 100, [{ x: 400, y: 400 }]);
    const near = makePoint(110, 110);
    const far = makePoint(300, 300);

    expect(evaluator.evaluate(near, ctx)).toBeGreaterThan(evaluator.evaluate(far, ctx));
  });

  it('returns score in [0, 1]', () => {
    const ctx = makeContext(0, 0, [{ x: 500, y: 500 }]);
    const point = makePoint(50, 50);
    const score = evaluator.evaluate(point, ctx);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores zero-distance cover as 1.0', () => {
    const ctx = makeContext(100, 100, [{ x: 300, y: 300 }]);
    const point = makePoint(100, 100);

    expect(evaluator.evaluate(point, ctx)).toBeCloseTo(1.0);
  });
});

describe('FarCoverEvaluator', () => {
  const evaluator = new FarCoverEvaluator(config);

  it('scores far-from-enemy cover higher', () => {
    const ctx = makeContext(100, 100, [{ x: 100, y: 100 }]);
    const near = makePoint(120, 120);
    const far = makePoint(500, 500);

    expect(evaluator.evaluate(far, ctx)).toBeGreaterThan(evaluator.evaluate(near, ctx));
  });

  it('returns 0.5 when no enemies', () => {
    const ctx = makeContext(100, 100, []);
    const point = makePoint(200, 200);

    expect(evaluator.evaluate(point, ctx)).toBe(0.5);
  });
});

describe('BalancedCoverEvaluator', () => {
  const evaluator = new BalancedCoverEvaluator();

  it('produces scores in [0, 1]', () => {
    const ctx = makeContext(100, 100, [{ x: 400, y: 400 }]);
    const point = makePoint(200, 200);
    const score = evaluator.evaluate(point, ctx);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0.5 when no enemies', () => {
    const ctx = makeContext(100, 100, []);
    const point = makePoint(200, 200);

    expect(evaluator.evaluate(point, ctx)).toBe(0.5);
  });
});

describe('AmbushCoverEvaluator', () => {
  const evaluator = new AmbushCoverEvaluator(config);

  it('scores flanking positions higher than head-on', () => {
    const enemyPos = { x: 400, y: 200 };
    const npcPos = { x: 100, y: 200 };
    const ctx = makeContext(npcPos.x, npcPos.y, [enemyPos]);

    // Flanking position: offset perpendicular to enemy line.
    const flank = makePoint(250, 350);
    // Head-on: directly between NPC and enemy.
    const headOn = makePoint(250, 200);

    expect(evaluator.evaluate(flank, ctx)).toBeGreaterThan(evaluator.evaluate(headOn, ctx));
  });

  it('returns 0 when no enemies', () => {
    const ctx = makeContext(100, 100, []);
    const point = makePoint(200, 200);

    expect(evaluator.evaluate(point, ctx)).toBe(0);
  });
});

describe('SafeCoverEvaluator', () => {
  const evaluator = new SafeCoverEvaluator();

  it('scores far-from-all-enemies cover higher', () => {
    const enemies = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
    const ctx = makeContext(300, 300, enemies);

    const farFromAll = makePoint(500, 500);
    const nearSome = makePoint(150, 150);

    expect(evaluator.evaluate(farFromAll, ctx)).toBeGreaterThan(evaluator.evaluate(nearSome, ctx));
  });

  it('returns 1.0 when no enemies', () => {
    const ctx = makeContext(100, 100, []);
    const point = makePoint(200, 200);

    expect(evaluator.evaluate(point, ctx)).toBe(1.0);
  });
});

describe('createCoverEvaluators', () => {
  it('creates all 5 evaluator types', () => {
    const evaluators = createCoverEvaluators(config);

    expect(evaluators.size).toBe(5);
    expect(evaluators.has(CoverType.CLOSE)).toBe(true);
    expect(evaluators.has(CoverType.FAR)).toBe(true);
    expect(evaluators.has(CoverType.BALANCED)).toBe(true);
    expect(evaluators.has(CoverType.AMBUSH)).toBe(true);
    expect(evaluators.has(CoverType.SAFE)).toBe(true);
  });

  it('each evaluator has correct type tag', () => {
    const evaluators = createCoverEvaluators(config);

    for (const [type, evaluator] of evaluators) {
      expect(evaluator.type).toBe(type);
    }
  });
});
