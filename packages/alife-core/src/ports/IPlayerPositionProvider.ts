import type { Vec2 } from '../core/Vec2';

/**
 * Provides the player's current world position to the A-Life kernel.
 *
 * The kernel reads this every tick for online/offline radius checks.
 * Implement with a live reference to your player entity's coordinates.
 */
export interface IPlayerPositionProvider {
  /** Return the player's current world position (px). Must never return null. */
  getPlayerPosition(): Vec2;
}

/**
 * Create a no-op {@link IPlayerPositionProvider} that always returns origin.
 *
 * @example
 * // Unit-testing kernel logic without a game engine:
 * kernel.provide(Ports.PlayerPosition, createNoOpPlayerPosition());
 */
export function createNoOpPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 0, y: 0 }) };
}
