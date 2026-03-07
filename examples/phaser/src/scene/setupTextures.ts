import Phaser from 'phaser';

function makeTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): void {
  const gfx = scene.make.graphics({} as never) as Phaser.GameObjects.Graphics;
  draw(gfx);
  gfx.generateTexture(key, w, h);
  gfx.destroy();
}

/**
 * Registers all demo sprite textures used by scene systems.
 */
export function setupTextures(scene: Phaser.Scene): void {
  makeTexture(scene, 'player', 32, 32, (g) => {
    g.fillStyle(0xeef3ff, 1);
    g.fillCircle(16, 16, 12);
    g.lineStyle(2, 0x8cf5ff, 0.95);
    g.strokeCircle(16, 16, 14);
    g.fillStyle(0x7ae3ff, 0.35);
    g.fillCircle(16, 16, 6);
  });

  makeTexture(scene, 'stalker', 30, 30, (g) => {
    g.fillStyle(0x2f80ed, 0.95);
    g.fillRoundedRect(5, 5, 20, 20, 4);
    g.lineStyle(2, 0x93c5ff, 0.95);
    g.strokeRoundedRect(5, 5, 20, 20, 4);
    g.fillStyle(0xa8d2ff, 0.5);
    g.fillRect(11, 3, 8, 4);
  });

  makeTexture(scene, 'bandit', 30, 30, (g) => {
    g.fillStyle(0xd44d5c, 0.95);
    g.fillRoundedRect(5, 5, 20, 20, 4);
    g.lineStyle(2, 0xff9aa6, 0.95);
    g.strokeRoundedRect(5, 5, 20, 20, 4);
    g.fillStyle(0xffb6be, 0.5);
    g.fillRect(11, 3, 8, 4);
  });

  makeTexture(scene, 'npc_bullet', 6, 6, (g) => {
    g.fillStyle(0xff3333);
    g.fillCircle(3, 3, 3);
  });

  makeTexture(scene, 'player_bullet', 6, 6, (g) => {
    g.fillStyle(0x00ffee);
    g.fillCircle(3, 3, 3);
  });
}

