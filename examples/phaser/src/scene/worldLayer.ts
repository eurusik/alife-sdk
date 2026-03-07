import Phaser from 'phaser';
import { SmartTerrain } from '@alife-sdk/core';
import { BG_BOTTOM, BG_TOP, HUD_FONT } from './demoConfig';

export interface WorldLayerResult {
  factory: SmartTerrain;
  bunker: SmartTerrain;
  npcSpawnPos: Map<string, { x: number; y: number }>;
  playerSpawn: { x: number; y: number };
}

/**
 * Builds the static world art and logical terrain zones used by the simulation.
 */
export function createWorldLayer(
  scene: Phaser.Scene,
  viewport: { width: number; height: number },
): WorldLayerResult {
  const W = viewport.width;
  const H = viewport.height;
  const playWidth = Math.min(Math.round(W * 0.72), 1320);
  const playLeft = Math.round((W - playWidth) / 2);
  const playRight = playLeft + playWidth;
  const stageMidX = Math.round((playLeft + playRight) / 2);

  const bgGfx = scene.add.graphics().setDepth(0);
  bgGfx.fillGradientStyle(BG_TOP, BG_TOP, BG_BOTTOM, BG_BOTTOM, 1);
  bgGfx.fillRect(0, 0, W, H);
  bgGfx.fillStyle(0x2b5cff, 0.08);
  bgGfx.fillCircle(playLeft + Math.round(playWidth * 0.22), Math.round(H * 0.24), 180);
  bgGfx.fillStyle(0xff5b7f, 0.06);
  bgGfx.fillCircle(playLeft + Math.round(playWidth * 0.72), Math.round(H * 0.72), 220);
  bgGfx.fillStyle(0xffffff, 0.025);
  bgGfx.fillCircle(stageMidX, Math.round(H * 0.48), 160);
  bgGfx.lineStyle(1, 0xffffff, 0.03);
  for (let x = playLeft - 120; x <= playRight + 120; x += 120) {
    bgGfx.lineBetween(x, 0, x, H);
  }
  for (let y = 96; y <= H; y += 96) {
    bgGfx.lineBetween(playLeft - 120, y, playRight + 120, y);
  }

  const zonesGfx = scene.add.graphics();
  const tw = Math.round(playWidth * 0.26);
  const th = Math.round(H * 0.28);

  const fx = playLeft + Math.round(playWidth * 0.12);
  const fy = Math.round(H * 0.14);
  const factory = new SmartTerrain({
    id: 'factory',
    name: 'Abandoned Factory',
    bounds: { x: fx, y: fy, width: tw, height: th },
    capacity: 6,
    jobs: [
      { type: 'patrol', slots: 3 },
      { type: 'guard', slots: 3, position: { x: fx + tw / 2, y: fy + th / 2 } },
    ],
  });

  const bx = playLeft + Math.round(playWidth * 0.58);
  const by = Math.round(H * 0.56);
  const bunker = new SmartTerrain({
    id: 'bunker',
    name: 'Underground Bunker',
    bounds: { x: bx, y: by, width: tw, height: th },
    capacity: 6,
    jobs: [
      { type: 'patrol', slots: 3 },
      { type: 'guard', slots: 3, position: { x: bx + tw / 2, y: by + th / 2 } },
    ],
  });

  zonesGfx.lineStyle(3, 0x4c93ff, 0.7);
  zonesGfx.strokeRect(factory.bounds.x, factory.bounds.y, factory.bounds.width, factory.bounds.height);
  zonesGfx.fillStyle(0x4c93ff, 0.12);
  zonesGfx.fillRect(factory.bounds.x, factory.bounds.y, factory.bounds.width, factory.bounds.height);
  zonesGfx.lineStyle(1, 0x9abbff, 0.55);
  zonesGfx.strokeRect(factory.bounds.x + 12, factory.bounds.y + 12, factory.bounds.width - 24, factory.bounds.height - 24);
  zonesGfx.fillStyle(0x9abbff, 0.18);
  zonesGfx.fillRect(factory.bounds.x + 12, factory.bounds.y + 12, 40, 6);
  scene.add.text(factory.bounds.x + 16, factory.bounds.y + 12, 'Abandoned Factory', {
    fontSize: '16px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#b8d1ff',
  }).setDepth(2);

  zonesGfx.lineStyle(3, 0xff5f64, 0.7);
  zonesGfx.strokeRect(bunker.bounds.x, bunker.bounds.y, bunker.bounds.width, bunker.bounds.height);
  zonesGfx.fillStyle(0xff5f64, 0.12);
  zonesGfx.fillRect(bunker.bounds.x, bunker.bounds.y, bunker.bounds.width, bunker.bounds.height);
  zonesGfx.lineStyle(1, 0xff9c9c, 0.55);
  zonesGfx.strokeRect(bunker.bounds.x + 12, bunker.bounds.y + 12, bunker.bounds.width - 24, bunker.bounds.height - 24);
  zonesGfx.fillStyle(0xff9c9c, 0.18);
  zonesGfx.fillRect(bunker.bounds.x + 12, bunker.bounds.y + 12, 40, 6);
  scene.add.text(bunker.bounds.x + 16, bunker.bounds.y + 12, 'Underground Bunker', {
    fontSize: '16px',
    fontStyle: 'bold',
    fontFamily: HUD_FONT,
    color: '#ffb0b0',
  }).setDepth(2);

  const routeGfx = scene.add.graphics().setDepth(1);
  routeGfx.lineStyle(3, 0xffffff, 0.08);
  routeGfx.lineBetween(
    factory.bounds.x + factory.bounds.width * 0.9,
    factory.bounds.y + factory.bounds.height * 0.7,
    bunker.bounds.x + bunker.bounds.width * 0.1,
    bunker.bounds.y + bunker.bounds.height * 0.3,
  );
  routeGfx.fillStyle(0xffffff, 0.08);
  routeGfx.fillCircle(stageMidX, Math.round(H * 0.48), 18);
  routeGfx.fillCircle(factory.bounds.x + factory.bounds.width * 0.9, factory.bounds.y + factory.bounds.height * 0.7, 5);
  routeGfx.fillCircle(bunker.bounds.x + bunker.bounds.width * 0.1, bunker.bounds.y + bunker.bounds.height * 0.3, 5);

  const npcSpawnPos = new Map<string, { x: number; y: number }>();
  npcSpawnPos.set('stalker_wolf', { x: fx + 28, y: fy + 88 });
  npcSpawnPos.set('stalker_bear', { x: fx + 150, y: fy + 62 });
  npcSpawnPos.set('bandit_knife', { x: bx + 86, y: by + 82 });
  npcSpawnPos.set('bandit_razor', { x: bx + 144, y: by + 104 });

  const playerSpawn = {
    x: playLeft + Math.round(playWidth * 0.2),
    y: Math.round(H * 0.58),
  };

  return { factory, bunker, npcSpawnPos, playerSpawn };
}

