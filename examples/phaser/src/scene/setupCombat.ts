import type Phaser from 'phaser';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter } from '@alife-sdk/phaser';
import { CombatSystem } from '../systems/CombatSystem';

interface SetupCombatParams {
  scene: Phaser.Scene;
  simulation: SimulationPlugin;
  entityAdapter: PhaserEntityAdapter;
  hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  locallyDeadNpcs: Set<string>;
  npcStateLabels: Map<string, Phaser.GameObjects.Text>;
  player: Phaser.Physics.Arcade.Sprite;
  isPlayerDead: () => boolean;
  onPlayerHit: (damage: number) => void;
}

/**
 * Creates combat system and binds player click-to-shoot input.
 */
export function setupCombat(params: SetupCombatParams): CombatSystem {
  const combatSystem = new CombatSystem({
    scene: params.scene,
    simulation: params.simulation,
    entityAdapter: params.entityAdapter,
    hpRecords: params.hpRecords,
    locallyDeadNpcs: params.locallyDeadNpcs,
    npcStateLabels: params.npcStateLabels,
    onPlayerHit: params.onPlayerHit,
  });
  combatSystem.init(params.player);

  params.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    combatSystem.shootPlayerBullet(
      params.player,
      pointer.worldX,
      pointer.worldY,
      params.isPlayerDead(),
    );
  });

  return combatSystem;
}

