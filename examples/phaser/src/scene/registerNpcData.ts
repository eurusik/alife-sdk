import Phaser from 'phaser';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter, PhaserSimulationBridge, IArcadeSprite } from '@alife-sdk/phaser';

interface NpcDef {
  entityId: string;
  factionId: string;
  hp: number;
  combatPower: number;
  rank: number;
}

interface RegisterNpcDataParams {
  scene: Phaser.Scene;
  simulation: SimulationPlugin;
  entityAdapter: PhaserEntityAdapter;
  bridge: PhaserSimulationBridge;
  hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  npcSpawnPos: Map<string, { x: number; y: number }>;
  npcDefs: ReadonlyArray<NpcDef>;
  tickMs: number;
}

/**
 * Registers showcase NPCs in both render layer and simulation layer.
 *
 * The function keeps bridge hp records aligned with simulation hp at creation.
 */
export function registerNpcData(params: RegisterNpcDataParams): void {
  const {
    scene,
    simulation,
    entityAdapter,
    bridge,
    hpRecords,
    npcSpawnPos,
    npcDefs,
    tickMs,
  } = params;

  for (const def of npcDefs) {
    const pos = npcSpawnPos.get(def.entityId) ?? { x: 0, y: 0 };
    const key = def.factionId === 'stalker' ? 'stalker' : 'bandit';
    const sprite = scene.physics.add.sprite(pos.x, pos.y, key);
    sprite.name = def.entityId;
    sprite.setAlpha(0.35);

    entityAdapter.register(def.entityId, sprite as unknown as IArcadeSprite);

    const hpRecord = { currentHp: def.hp, maxHp: def.hp };
    hpRecords.set(def.entityId, hpRecord);
    bridge.register(def.entityId, hpRecord);

    simulation.registerNPC({
      entityId: def.entityId,
      factionId: def.factionId,
      position: pos,
      rank: def.rank,
      combatPower: def.combatPower,
      currentHp: def.hp,
      behaviorConfig: createDefaultBehaviorConfig({
        aggression: 0.8,
        retreatThreshold: 0.15,
        panicThreshold: -0.8,
        searchIntervalMs: tickMs,
        dangerTolerance: 4,
      }),
      options: { type: 'human' },
    });
  }
}
