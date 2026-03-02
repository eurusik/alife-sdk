// campfire/IGatheringFSM.ts
// Generic interface for gathering/campfire FSM implementations.

import type { IBubbleRequest } from '../types/ISocialTypes';

/**
 * Generic interface for a gathering FSM — controls social interactions
 * during group gathering activities (campfire, tavern, cantina, etc.).
 *
 * Implement this interface to replace the built-in CampfireFSM with
 * your own gathering behavior.
 *
 * @example
 * ```ts
 * class TavernFSM implements IGatheringFSM {
 *   update(deltaMs: number): IBubbleRequest[] { ... }
 *   setParticipants(npcIds: readonly string[]): boolean { ... }
 *   clear(): void { ... }
 * }
 * ```
 */
export interface IGatheringFSM {
  /**
   * Called each update tick with delta time in milliseconds.
   * Returns bubble requests to display for this frame.
   */
  update(deltaMs: number): IBubbleRequest[];

  /**
   * Update the participant list.
   * Returns false if there are not enough participants.
   */
  setParticipants(npcIds: readonly string[]): boolean;

  /**
   * Release all internal state. Called when the session ends.
   */
  clear(): void;
}
