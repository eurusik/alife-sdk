// adapters/PhaserPlayerPosition.ts
// IPlayerPositionProvider that reads position from a live reference.

import type { Vec2 } from '@alife-sdk/core';
import type { IPlayerPositionProvider } from '@alife-sdk/core';

/**
 * Minimal interface for anything that has x/y coordinates.
 * Satisfied by Phaser sprites, plain objects, scene registry, etc.
 */
export interface IPositionSource {
  readonly x: number;
  readonly y: number;
}

/**
 * IPlayerPositionProvider that reads from a live position source.
 *
 * @example
 * ```ts
 * // From a Phaser sprite:
 * const provider = new PhaserPlayerPosition(player);
 *
 * // From scene registry:
 * const provider = new PhaserPlayerPosition({
 *   get x() { return scene.registry.get('playerX') as number; },
 *   get y() { return scene.registry.get('playerY') as number; },
 * });
 * ```
 */
export class PhaserPlayerPosition implements IPlayerPositionProvider {
  private source: IPositionSource;

  constructor(source: IPositionSource) {
    this.source = source;
  }

  getPlayerPosition(): Vec2 {
    return { x: this.source.x, y: this.source.y };
  }

  setSource(source: IPositionSource): void {
    this.source = source;
  }
}
