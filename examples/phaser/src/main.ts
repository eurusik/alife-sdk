/**
 * main.ts — Phaser game entry point.
 *
 * Creates a Phaser.Game instance and registers the GameScene.
 * All A-Life SDK logic lives in GameScene.ts.
 */

import Phaser from 'phaser';
import { GameScene } from './GameScene';
// import { MinimalIntegrationScene } from './minimal/MinimalIntegrationScene';

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#0b1024',
  scale: {
    // RESIZE fills the entire browser window and stays sharp —
    // no CSS upscaling, no black bars.
    mode: Phaser.Scale.RESIZE,
    width:  window.innerWidth,
    height: window.innerHeight,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [GameScene],
  // scene: [MinimalIntegrationScene],
});
