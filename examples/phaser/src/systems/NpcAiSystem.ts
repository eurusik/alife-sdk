import Phaser from 'phaser';
import { DangerManager, GOAPPlanner, MemoryBank, MemoryChannel, StateMachine, WorldState } from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter } from '@alife-sdk/phaser';

type GoapMode = 'attack' | 'cover';

export interface INpcAiBundle {
  entity: { x: number; y: number };
  memory: MemoryBank;
  fsm: StateMachine;
  currentPlan: string[];
  dangerLevel: number;
}

interface INpcAiSystemDeps {
  dangerManager: DangerManager;
  goapPlanner: GOAPPlanner;
  simulation: SimulationPlugin;
  entityAdapter: PhaserEntityAdapter;
  npcAI: Map<string, INpcAiBundle>;
  npcStateLabels: Map<string, Phaser.GameObjects.Text>;
  locallyDeadNpcs: Set<string>;
  npcSpawnPos: Map<string, { x: number; y: number }>;
  aiOverlay: Phaser.GameObjects.Text;
  getPlayerState: () => { x: number; y: number; isDead: boolean };
  fireNpcBullet: (npcId: string, targetX: number, targetY: number, spriteX: number, spriteY: number) => void;
  detectionRange: number;
  coverThreatThreshold: number;
  coverMoveSpeed: number;
}

/**
 * Orchestrates online NPC behavior with a hybrid model:
 * - FSM controls top-level states.
 * - GOAP flips tactical mode between attack and cover in COMBAT.
 *
 * This keeps GameScene focused on wiring and update order.
 */
export class NpcAiSystem {
  private readonly dangerManager: DangerManager;
  private readonly goapPlanner: GOAPPlanner;
  private readonly simulation: SimulationPlugin;
  private readonly entityAdapter: PhaserEntityAdapter;
  private readonly npcAI: Map<string, INpcAiBundle>;
  private readonly npcStateLabels: Map<string, Phaser.GameObjects.Text>;
  private readonly locallyDeadNpcs: Set<string>;
  private readonly npcSpawnPos: Map<string, { x: number; y: number }>;
  private readonly aiOverlay: Phaser.GameObjects.Text;
  private readonly getPlayerState: () => { x: number; y: number; isDead: boolean };
  private readonly fireNpcBulletFn: (npcId: string, targetX: number, targetY: number, spriteX: number, spriteY: number) => void;
  private readonly detectionRange: number;
  private readonly coverThreatThreshold: number;
  private readonly coverMoveSpeed: number;
  private readonly npcGoapMode = new Map<string, GoapMode>();

  constructor(deps: INpcAiSystemDeps) {
    this.dangerManager = deps.dangerManager;
    this.goapPlanner = deps.goapPlanner;
    this.simulation = deps.simulation;
    this.entityAdapter = deps.entityAdapter;
    this.npcAI = deps.npcAI;
    this.npcStateLabels = deps.npcStateLabels;
    this.locallyDeadNpcs = deps.locallyDeadNpcs;
    this.npcSpawnPos = deps.npcSpawnPos;
    this.aiOverlay = deps.aiOverlay;
    this.getPlayerState = deps.getPlayerState;
    this.fireNpcBulletFn = deps.fireNpcBullet;
    this.detectionRange = deps.detectionRange;
    this.coverThreatThreshold = deps.coverThreatThreshold;
    this.coverMoveSpeed = deps.coverMoveSpeed;
  }

  update(delta: number): void {
    const deltaSec = delta / 1000;
    const rows: string[] = [];
    const player = this.getPlayerState();

    for (const [id, ai] of this.npcAI) {
      const record = this.simulation.getAllNPCRecords().get(id);
      const alive = record && record.currentHp > 0 && !this.locallyDeadNpcs.has(id);

      if (!alive) {
        this.npcGoapMode.delete(id);
        rows.push(`[${id.slice(0, 12).padEnd(12)}] DEAD`);
        this.npcStateLabels.get(id)?.setText('');
        continue;
      }

      const sprite = this.entityAdapter.getSprite(id);
      if (!sprite) continue;

      // 1. Sync entity position
      ai.entity.x = sprite.x;
      ai.entity.y = sprite.y;

      // 2. Perception update
      const dist = Phaser.Math.Distance.Between(player.x, player.y, sprite.x, sprite.y);
      if (dist < this.detectionRange) {
        const conf = Math.max(0.25, 1 - dist / this.detectionRange);
        ai.memory.remember({
          sourceId: 'player',
          channel: MemoryChannel.VISUAL,
          position: { x: player.x, y: player.y },
          confidence: conf,
        });
      }

      // 3. FSM update
      ai.fsm.update(deltaSec);

      // 4. Threat sampling
      ai.dangerLevel = this.dangerManager.getThreatAt({ x: sprite.x, y: sprite.y });

      // 5. GOAP mode flip only when threat state changes.
      if (ai.fsm.state === 'COMBAT') {
        const underFire = ai.dangerLevel >= this.coverThreatThreshold;
        const desiredMode: GoapMode = underFire ? 'cover' : 'attack';
        const currentMode = this.npcGoapMode.get(id);
        if (currentMode !== desiredMode) {
          const ws = new WorldState();
          ws.set('hasAmmo', true);
          if (underFire) ws.set('underFire', true);
          const goal = new WorldState();
          goal.set('targetEliminated', true);
          const plan = this.goapPlanner.plan(ws, goal);
          ai.currentPlan = plan ? plan.map(a => a.id) : [];
          this.npcGoapMode.set(id, desiredMode);
        }
      }

      const underFire = ai.dangerLevel >= this.coverThreatThreshold;
      const hasCoverPlan = ai.currentPlan.includes('FindCover') || ai.currentPlan.includes('AttackFromCover');
      let takingCover = false;

      // 6. Execute FindCover via safe-direction movement.
      const arcadeSprite = sprite as unknown as Phaser.Physics.Arcade.Sprite;
      if (!arcadeSprite.body) continue;
      if (record.isOnline && ai.fsm.state === 'COMBAT' && hasCoverPlan && underFire) {
        const safeDir = this.dangerManager.getSafeDirection({ x: sprite.x, y: sprite.y });
        if (safeDir.x !== 0 || safeDir.y !== 0) {
          arcadeSprite.setVelocity(safeDir.x * this.coverMoveSpeed, safeDir.y * this.coverMoveSpeed);
          takingCover = true;
        } else {
          arcadeSprite.setVelocity(0, 0);
        }
      }

      // 7. Normal locomotion when not actively retreating.
      const lastKnown = ai.memory.getMostConfident();
      if (record.isOnline && !takingCover && lastKnown) {
        const isCombat = ai.fsm.state === 'COMBAT';
        const speed = isCombat ? (hasCoverPlan ? 58 : 70) : 45;
        const stopDist = isCombat ? (hasCoverPlan ? 120 : 90) : 20;
        const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, lastKnown.position.x, lastKnown.position.y);
        const dx = lastKnown.position.x - sprite.x;
        const dy = lastKnown.position.y - sprite.y;
        const distToTarget = Math.sqrt(dx * dx + dy * dy);
        if (distToTarget > stopDist) {
          arcadeSprite.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        } else {
          arcadeSprite.setVelocity(0, 0);
          if (isCombat && !player.isDead && (!hasCoverPlan || !underFire)) {
            this.fireNpcBulletFn(id, player.x, player.y, sprite.x, sprite.y);
          }
        }
      } else if (record.isOnline && !takingCover && ai.fsm.state === 'PATROL') {
        const spawn = this.npcSpawnPos.get(id);
        if (spawn) {
          const dx = spawn.x - sprite.x;
          const dy = spawn.y - sprite.y;
          const distToSpawn = Math.sqrt(dx * dx + dy * dy);
          if (distToSpawn > 20) {
            const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, spawn.x, spawn.y);
            arcadeSprite.setVelocity(Math.cos(angle) * 60, Math.sin(angle) * 60);
          } else {
            arcadeSprite.setVelocity(0, 0);
          }
        } else {
          arcadeSprite.setVelocity(0, 0);
        }
      } else if (record.isOnline && !takingCover) {
        arcadeSprite.setVelocity(0, 0);
      }

      // 8. Floating state icon + debug row
      const icon = takingCover ? '[CV]' : ai.fsm.state === 'COMBAT' ? '[C]' : ai.fsm.state === 'ALERT' ? '[A]' : '';
      this.npcStateLabels.get(id)?.setPosition(sprite.x - 10, sprite.y - 42).setText(icon);

      const conf = ai.memory.getMostConfident()?.confidence ?? 0;
      const dLvl = ai.dangerLevel > 0.5 ? 'HIGH' : ai.dangerLevel > 0.1 ? 'MED' : 'LOW';
      const plan = ai.currentPlan.length ? ai.currentPlan.join('→') : '—';
      const shortId = id.slice(0, 12).padEnd(12);
      const stateLabel = ai.fsm.state.padEnd(6);
      rows.push(`[${shortId}] ${stateLabel} | mem:${conf.toFixed(2)} | ${dLvl}\n  plan: ${plan}`);
    }

    this.aiOverlay.setText(rows.join('\n'));
  }
}
