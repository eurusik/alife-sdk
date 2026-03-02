// online/OnlineOfflineManager.ts
// Pure algorithm for hysteresis-based online/offline NPC switching.
// No Phaser dependency — operates on abstract records and returns transition lists.

import type {
  IOnlineOfflineConfig,
  IOnlineRecord,
  ITransitionResult,
  SquadResolver,
} from '../types/IOnlineOfflineConfig';
import { createDefaultOnlineOfflineConfig } from '../types/IOnlineOfflineConfig';

/**
 * Evaluates which NPCs should transition between online and offline states
 * based on distance to the player, with hysteresis to prevent flickering.
 *
 * Features:
 * - Hysteresis band: online distance < offline distance (configurable gap)
 * - Squad-aware atomic switching: if ANY member is in online range, ALL go online
 * - Dead entities are skipped
 * - Returns transition lists — does NOT apply changes (caller decides how)
 *
 * @example
 * ```ts
 * const manager = new OnlineOfflineManager();
 * const { goOnline, goOffline } = manager.evaluate(
 *   playerX, playerY, npcRecords, squadResolver,
 * );
 * for (const id of goOnline) bringOnline(id);
 * for (const id of goOffline) bringOffline(id);
 * ```
 */
export class OnlineOfflineManager {
  private readonly onlineDistSq: number;
  private readonly offlineDistSq: number;
  private readonly _onlineDist: number;
  private readonly _offlineDist: number;

  // Scratch fields — reused every evaluate() call to avoid per-frame allocations
  private readonly _recordMap = new Map<string, IOnlineRecord>();
  private readonly _processedSquads = new Set<string>();
  private readonly _goOnline: string[] = [];
  private readonly _goOffline: string[] = [];
  private readonly _squadKeyScratch: string[] = [];

  constructor(config?: Partial<IOnlineOfflineConfig>) {
    const merged = createDefaultOnlineOfflineConfig(config);
    this._onlineDist = merged.switchDistance * (1 - merged.hysteresisFactor);
    this._offlineDist = merged.switchDistance * (1 + merged.hysteresisFactor);
    this.onlineDistSq = this._onlineDist * this._onlineDist;
    this.offlineDistSq = this._offlineDist * this._offlineDist;
  }

  /** Distance threshold below which offline NPCs go online (px). */
  get onlineDistance(): number {
    return this._onlineDist;
  }

  /** Distance threshold above which online NPCs go offline (px). */
  get offlineDistance(): number {
    return this._offlineDist;
  }

  /**
   * Evaluate all records and return lists of entity IDs that should transition.
   *
   * NPCs in the hysteresis band (between online and offline thresholds)
   * maintain their current state — no transition occurs.
   */
  evaluate(
    playerX: number,
    playerY: number,
    records: Iterable<IOnlineRecord>,
    squadResolver?: SquadResolver,
  ): ITransitionResult {
    this._goOnline.length = 0;
    this._goOffline.length = 0;
    this._processedSquads.clear();
    this._recordMap.clear();

    for (const record of records) {
      this._recordMap.set(record.entityId, record);
    }

    for (const record of this._recordMap.values()) {
      if (!record.isAlive) continue;

      const squadMembers = squadResolver?.(record.entityId);

      if (squadMembers && squadMembers.length > 1) {
        this.evaluateSquad(
          playerX, playerY, squadMembers, this._recordMap,
          this._processedSquads, this._goOnline, this._goOffline,
        );
      } else {
        this.evaluateIndividual(
          playerX, playerY, record, this._goOnline, this._goOffline,
        );
      }
    }

    return { goOnline: [...this._goOnline], goOffline: [...this._goOffline] };
  }

  private evaluateSquad(
    playerX: number,
    playerY: number,
    squadMembers: readonly string[],
    recordMap: ReadonlyMap<string, IOnlineRecord>,
    processedSquads: Set<string>,
    goOnline: string[],
    goOffline: string[],
  ): void {
    // Dedup: sort member IDs for canonical squad key (reuse scratch array)
    const squadKey = this.buildSquadKey(squadMembers);
    if (processedSquads.has(squadKey)) return;
    processedSquads.add(squadKey);

    let anyInOnlineRange = false;
    let allBeyondOfflineRange = true;

    for (const memberId of squadMembers) {
      const member = recordMap.get(memberId);
      if (!member || !member.isAlive) continue;

      const dSq = distSq(playerX, playerY, member.x, member.y);
      if (dSq < this.onlineDistSq) anyInOnlineRange = true;
      if (dSq < this.offlineDistSq) allBeyondOfflineRange = false;
    }

    if (anyInOnlineRange) {
      // Entire squad goes online
      for (const memberId of squadMembers) {
        const member = recordMap.get(memberId);
        if (member && member.isAlive && !member.isOnline) {
          goOnline.push(memberId);
        }
      }
    } else if (allBeyondOfflineRange) {
      // Entire squad goes offline
      for (const memberId of squadMembers) {
        const member = recordMap.get(memberId);
        if (member && member.isAlive && member.isOnline) {
          goOffline.push(memberId);
        }
      }
    }
    // In hysteresis band: maintain current state (no transition)
  }

  private buildSquadKey(members: readonly string[]): string {
    this._squadKeyScratch.length = 0;
    for (const m of members) this._squadKeyScratch.push(m);
    this._squadKeyScratch.sort();
    return this._squadKeyScratch.join(',');
  }

  private evaluateIndividual(
    playerX: number,
    playerY: number,
    record: IOnlineRecord,
    goOnline: string[],
    goOffline: string[],
  ): void {
    const dSq = distSq(playerX, playerY, record.x, record.y);

    if (record.isOnline && dSq > this.offlineDistSq) {
      goOffline.push(record.entityId);
    } else if (!record.isOnline && dSq < this.onlineDistSq) {
      goOnline.push(record.entityId);
    }
  }
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
