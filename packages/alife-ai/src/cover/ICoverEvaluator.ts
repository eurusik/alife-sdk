// cover/ICoverEvaluator.ts
// Strategy interface for cover point evaluation.

import type { ICoverPoint, ICoverEvalContext } from '../types/ICoverPoint';

/**
 * Strategy interface for scoring a cover point.
 *
 * Each evaluator optimizes for a different tactical priority (proximity,
 * safety, flanking, etc.). Evaluators are stateless pure functions —
 * they read the cover point and context, return a normalized score.
 *
 * @returns Score in range [0, 1] where 1 is the best possible cover.
 */
export interface ICoverEvaluator {
  readonly type: string;
  evaluate(point: ICoverPoint, context: ICoverEvalContext): number;
}
