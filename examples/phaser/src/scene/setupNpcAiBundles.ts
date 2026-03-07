import Phaser from 'phaser';
import { MemoryBank, type DangerManager, type GOAPPlanner } from '@alife-sdk/core';
import { HUD_FONT } from './demoConfig';
import { buildNpcFSM, NpcAI, NpcEntity } from './npcAiModel';

interface NpcDefRef {
  entityId: string;
}

interface SetupNpcAiBundlesParams {
  scene: Phaser.Scene;
  npcDefs: ReadonlyArray<NpcDefRef>;
  dangerManager: DangerManager;
  goapPlanner: GOAPPlanner;
  npcAI: Map<string, NpcAI>;
  npcStateLabels: Map<string, Phaser.GameObjects.Text>;
}

/**
 * Creates per-NPC AI bundles and floating state labels.
 */
export function setupNpcAiBundles(params: SetupNpcAiBundlesParams): void {
  const { scene, npcDefs, dangerManager, goapPlanner, npcAI, npcStateLabels } = params;

  for (const def of npcDefs) {
    const entity = new NpcEntity(def.entityId);
    const memory = new MemoryBank({ timeFn: () => Date.now() });

    const bundle: NpcAI = {
      entity,
      memory,
      fsm: null!,
      currentPlan: [],
      dangerLevel: 0,
    };
    bundle.fsm = buildNpcFSM(entity, memory, dangerManager, goapPlanner, bundle);
    npcAI.set(def.entityId, bundle);

    const label = scene.add.text(0, 0, '', {
      fontSize: '12px',
      fontFamily: HUD_FONT,
      fontStyle: 'bold',
      color: '#ffe36d',
    }).setDepth(10);
    npcStateLabels.set(def.entityId, label);
  }
}

