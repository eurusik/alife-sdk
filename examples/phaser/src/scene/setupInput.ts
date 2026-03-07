import Phaser from 'phaser';

export interface InputSetupResult {
  cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  wasd: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  grenadeKey: Phaser.Input.Keyboard.Key;
  helpKey: Phaser.Input.Keyboard.Key;
}

/**
 * Creates all keyboard bindings used by the showcase scene.
 */
export function setupInput(scene: Phaser.Scene): InputSetupResult {
  return {
    cursors: scene.input.keyboard!.createCursorKeys(),
    wasd: {
      up: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    },
    grenadeKey: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G),
    helpKey: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.H),
  };
}

