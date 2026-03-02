import type { Vec2 } from '@alife-sdk/core';
import type { IMovementDispatcher } from '../brain/BrainScheduleManager';

/**
 * Common contract for movement simulator implementations.
 * Both MovementSimulator and GraphMovementSimulator satisfy this shape.
 */
export interface IMovementSimulator extends IMovementDispatcher {
  /** Advance all active journeys by `deltaMs`. */
  update(deltaMs: number): void;
  /** Current interpolated position for an NPC in transit, or null if idle. */
  getPosition(npcId: string): Vec2 | null;
  /** Number of NPCs currently in transit. */
  readonly activeCount: number;
  /** Remove all active journeys without emitting events. */
  clear(): void;
}
