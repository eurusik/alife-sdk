/**
 * Convenience re-exports from AIStateRegistry for clean import paths.
 *
 * Consumers can import directly from this module:
 *   import type { IStateHandler } from '../ai/IStateHandler';
 */

export type {
  IStateHandler,
  ITransitionCondition,
  IAIStateDefinition,
} from '../registry/AIStateRegistry';
