// types/IAnimationTypes.ts
// Animation key resolution types for NPC sprite systems.

/**
 * Eight cardinal/intercardinal directions for sprite animation.
 * Values are string keys used in animation name composition.
 */
export const AnimDirection = {
  DOWN: 'down',
  DOWN_LEFT: 'down_left',
  DOWN_RIGHT: 'down_right',
  LEFT: 'left',
  RIGHT: 'right',
  UP: 'up',
  UP_LEFT: 'up_left',
  UP_RIGHT: 'up_right',
} as const;

export type AnimDirection = (typeof AnimDirection)[keyof typeof AnimDirection];

/**
 * Resolved animation key ready for sprite playback.
 * Contains the full key string and optional metadata.
 */
export interface IAnimKeyResult {
  /** Full animation key, e.g. 'walk_rifle_down_left'. */
  readonly key: string;
  /** Direction component for flip/mirror logic. */
  readonly direction: AnimDirection;
  /** Whether the sprite should be horizontally flipped. */
  readonly flipX: boolean;
}
