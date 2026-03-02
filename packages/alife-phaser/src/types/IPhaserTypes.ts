// types/IPhaserTypes.ts
// Duck-typed interfaces matching Phaser 3 objects.
// Uses structural typing so real Phaser objects satisfy these interfaces
// without importing Phaser at compile time.

// ---------------------------------------------------------------------------
// Arcade Physics body
// ---------------------------------------------------------------------------

/** Minimal interface matching Phaser.Physics.Arcade.Body. */
export interface IArcadeBody {
  enable: boolean;
  velocity: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Animation manager
// ---------------------------------------------------------------------------

/** Minimal interface matching Phaser sprite's anims property. */
export interface IArcadeAnims {
  play(key: string, ignoreIfPlaying?: boolean): unknown;
  getName(): string;
}

// ---------------------------------------------------------------------------
// Arcade Sprite
// ---------------------------------------------------------------------------

/**
 * Minimal interface matching Phaser.Physics.Arcade.Sprite.
 *
 * Any Phaser Arcade Sprite satisfies this interface via structural typing.
 * Tests use plain objects that implement these members.
 */
export interface IArcadeSprite {
  x: number;
  y: number;
  active: boolean;
  visible: boolean;
  body: IArcadeBody | null;
  name: string;
  rotation: number;
  alpha: number;
  anims?: IArcadeAnims;
  setActive(value: boolean): unknown;
  setVisible(value: boolean): unknown;
  setPosition(x: number, y?: number): unknown;
  setVelocity(x: number, y?: number): unknown;
  setAlpha(value: number): unknown;
  setRotation(radians: number): unknown;
  destroy(): void;
}
