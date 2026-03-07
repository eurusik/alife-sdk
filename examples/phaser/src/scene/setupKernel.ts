import Phaser from 'phaser';
import type { ALifeKernel, SmartTerrain } from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import {
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserPlayerPosition,
  PhaserSimulationBridge,
  OnlineOfflineManager,
  createPhaserKernel,
} from '@alife-sdk/phaser';
import type { IArcadeSprite } from '@alife-sdk/phaser';

interface SetupKernelParams {
  scene: Phaser.Scene;
  player: Phaser.Physics.Arcade.Sprite;
  terrains: SmartTerrain[];
  onlineDistance: number;
  tickMs: number;
}

export interface SetupKernelResult {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  onlineOffline: OnlineOfflineManager;
  entityAdapter: PhaserEntityAdapter;
  bridge: PhaserSimulationBridge;
}

/**
 * Creates Phaser ports and boots the SDK kernel for the showcase scene.
 */
export function setupKernel(params: SetupKernelParams): SetupKernelResult {
  const { scene, player, terrains, onlineDistance, tickMs } = params;

  const entityAdapter = new PhaserEntityAdapter();
  const bridge = new PhaserSimulationBridge();
  let npcCount = 0;

  const entityFactory = new PhaserEntityFactory({
    createNPC: (req) => {
      const id = (req.metadata?.['entityId'] as string) ?? `npc_${++npcCount}`;
      const key = req.factionId === 'stalker' ? 'stalker' : 'bandit';
      const sprite = scene.physics.add.sprite(req.x, req.y, key);
      sprite.name = id;
      entityAdapter.register(id, sprite as unknown as IArcadeSprite);
      bridge.register(id, { currentHp: 100, maxHp: 100 });
      return id;
    },
    createMonster: (req) => `monster_${++npcCount}_${req.monsterTypeId}`,
    destroyEntity: (id) => {
      entityAdapter.getSprite(id)?.destroy();
      entityAdapter.unregister(id);
      bridge.unregister(id);
    },
  });

  const playerPosition = new PhaserPlayerPosition(player);
  const result = createPhaserKernel({
    ports: {
      entityAdapter,
      playerPosition,
      entityFactory,
      simulationBridge: bridge,
    },
    data: {
      factions: [
        { id: 'stalker', relations: { bandit: -80 } },
        { id: 'bandit', relations: { stalker: -80 } },
      ],
      terrains,
    },
    plugins: {
      simulation: {
        tickIntervalMs: tickMs,
        simulation: {
          offlineCombat: {
            detectionProbability: 100,
            maxResolutionsPerTick: 4,
            damageTypeId: 'physical',
          },
        },
      },
    },
    config: {
      preset: 'simulation',
      onlineOffline: {
        switchDistance: onlineDistance,
        hysteresisFactor: 0.15,
      },
    },
  });

  result.kernel.init();
  result.kernel.start();

  return {
    kernel: result.kernel,
    simulation: result.simulation!,
    onlineOffline: result.onlineOffline,
    entityAdapter,
    bridge,
  };
}

