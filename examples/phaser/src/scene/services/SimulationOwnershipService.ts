import Phaser from 'phaser';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter, OnlineOfflineManager } from '@alife-sdk/phaser';
import type { NpcAI } from '../npcAiModel';

interface SimulationOwnershipServiceParams {
  simulation: SimulationPlugin;
  entityAdapter: PhaserEntityAdapter;
  onlineOffline: OnlineOfflineManager;
  npcAI: Map<string, NpcAI>;
  npcSpawnPos: Map<string, { x: number; y: number }>;
  hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  locallyDeadNpcs: Set<string>;
}

/**
 * Keeps clear ownership boundaries between offline simulation and online sprites.
 *
 * This isolates all online/offline handoff rules from scene rendering code.
 */
export class SimulationOwnershipService {
  private readonly simulation: SimulationPlugin;
  private readonly entityAdapter: PhaserEntityAdapter;
  private readonly onlineOffline: OnlineOfflineManager;
  private readonly npcAI: Map<string, NpcAI>;
  private readonly npcSpawnPos: Map<string, { x: number; y: number }>;
  private readonly hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  private readonly locallyDeadNpcs: Set<string>;
  private readonly wanderTargets = new Map<string, { x: number; y: number }>();

  constructor(params: SimulationOwnershipServiceParams) {
    this.simulation = params.simulation;
    this.entityAdapter = params.entityAdapter;
    this.onlineOffline = params.onlineOffline;
    this.npcAI = params.npcAI;
    this.npcSpawnPos = params.npcSpawnPos;
    this.hpRecords = params.hpRecords;
    this.locallyDeadNpcs = params.locallyDeadNpcs;
  }

  syncBridgeHP(): void {
    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (this.locallyDeadNpcs.has(record.entityId)) continue;
      const hpRec = this.hpRecords.get(record.entityId);
      if (hpRec) hpRec.currentHp = Math.max(0, record.currentHp);
    }
  }

  handleOnlineOffline(playerX: number, playerY: number): void {
    const records = [...this.simulation.getAllNPCRecords().values()];
    const onlineRecords = records.map(record => {
      const sprite = this.entityAdapter.getSprite(record.entityId);
      return {
        entityId: record.entityId,
        x: sprite?.x ?? record.lastPosition.x,
        y: sprite?.y ?? record.lastPosition.y,
        isOnline: record.isOnline,
        isAlive: record.currentHp > 0,
      };
    });

    const { goOnline, goOffline } = this.onlineOffline.evaluate(playerX, playerY, onlineRecords);

    for (const id of goOnline) {
      this.simulation.setNPCOnline(id, true);
      this.entityAdapter.getSprite(id)?.setAlpha(1.0);
    }

    for (const id of goOffline) {
      const offSprite = this.entityAdapter.getSprite(id) as unknown as Phaser.Physics.Arcade.Sprite;
      if (offSprite) {
        const record = this.simulation.getNPCRecord(id);
        if (record) record.lastPosition = { x: offSprite.x, y: offSprite.y };
      }

      this.simulation.setNPCOnline(id, false);
      offSprite?.setAlpha(0.35);
      offSprite?.setVelocity(0, 0);

      const aiBundle = this.npcAI.get(id);
      const spawn = this.npcSpawnPos.get(id);
      if (aiBundle && spawn && (aiBundle.fsm.state === 'ALERT' || aiBundle.fsm.state === 'COMBAT')) {
        this.wanderTargets.set(id, { x: spawn.x, y: spawn.y });
      } else {
        this.wanderTargets.delete(id);
      }
    }
  }

  syncOfflineNPCPositions(deltaMs: number): void {
    const dt = deltaMs / 1000;
    const OFFLINE_SPEED = 55;

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.isOnline || record.currentHp <= 0 || this.locallyDeadNpcs.has(record.entityId)) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      const brain = this.simulation.getNPCBrain(record.entityId);
      const terrainId = brain?.currentTerrainId;
      if (!terrainId) continue;

      const terrain = this.simulation.getAllTerrains().get(terrainId);
      if (!terrain) continue;

      let wander = this.wanderTargets.get(record.entityId);
      if (!wander || (Math.abs(sprite.x - wander.x) < 4 && Math.abs(sprite.y - wander.y) < 4)) {
        const { x, y, width, height } = terrain.bounds;
        wander = { x: x + Math.random() * width, y: y + Math.random() * height };
        this.wanderTargets.set(record.entityId, wander);
      }

      const dx = wander.x - sprite.x;
      const dy = wander.y - sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 4) continue;

      const move = Math.min(OFFLINE_SPEED * dt, dist);
      sprite.setPosition(sprite.x + (dx / dist) * move, sprite.y + (dy / dist) * move);
    }
  }
}

