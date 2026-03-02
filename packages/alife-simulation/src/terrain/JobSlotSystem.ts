/**
 * Job slot runtime management -- build, score, assign, and release NPC slots.
 *
 * Wraps static job definitions from SmartTerrain into runtime slots with
 * NPC tracking. Handles precondition checks (rank, day/night, faction),
 * fitness scoring (rank bonus, distance penalty, equipment match), and
 * assignment/release lifecycle.
 */

import type { SmartTerrain, IJobSlot } from '@alife-sdk/core';
import type { INPCJobContext } from '../types/INPCRecord';
import type { IJobScoringConfig } from '../types/ISimulationConfig';
import type { TerrainState } from './TerrainStateManager';

// ---------------------------------------------------------------------------
// Runtime slot with NPC tracking
// ---------------------------------------------------------------------------

export interface IJobSlotRuntime extends IJobSlot {
  readonly assignedNPCs: Set<string>;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export class JobSlotSystem {
  /** Create runtime slot wrappers for a terrain's job definitions. */
  static buildSlots(terrain: SmartTerrain): IJobSlotRuntime[] {
    return terrain.jobs.map((job) => ({
      type: job.type,
      slots: job.slots,
      position: job.position,
      routeId: job.routeId,
      preconditions: job.preconditions,
      assignedNPCs: new Set<string>(),
    }));
  }

  /** Clear all slot assignments without rebuilding the slot objects. */
  static clearSlots(slots: IJobSlotRuntime[]): void {
    for (const slot of slots) slot.assignedNPCs.clear();
  }

  /**
   * Pick the best available slot for the given NPC context.
   * Returns null if no suitable slot is available.
   */
  static pickBestSlot(
    slots: readonly IJobSlotRuntime[],
    ctx: INPCJobContext,
    isNight: boolean,
    terrainState: TerrainState,
    config: IJobScoringConfig,
  ): IJobSlotRuntime | null {
    let best: IJobSlotRuntime | null = null;
    let bestScore = -Infinity;

    for (const slot of slots) {
      if (slot.assignedNPCs.size >= slot.slots) continue;
      if (!JobSlotSystem.meetsPreconditions(slot, ctx, isNight, terrainState)) continue;

      const score = JobSlotSystem.scoreSlot(slot, ctx, config);
      if (score > bestScore) {
        bestScore = score;
        best = slot;
      }
    }

    return best;
  }

  /** Assign an NPC to a slot. Returns false if already full. */
  static assignNPC(slot: IJobSlotRuntime, npcId: string): boolean {
    if (slot.assignedNPCs.size >= slot.slots) return false;
    slot.assignedNPCs.add(npcId);
    return true;
  }

  /** Release an NPC from a slot. */
  static releaseNPC(slot: IJobSlotRuntime, npcId: string): void {
    slot.assignedNPCs.delete(npcId);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private static meetsPreconditions(
    slot: IJobSlotRuntime,
    ctx: INPCJobContext,
    isNight: boolean,
    _terrainState: TerrainState,
  ): boolean {
    const pre = slot.preconditions;
    if (!pre) return true;
    if (pre.minRank !== undefined && ctx.rank < pre.minRank) return false;
    if (pre.dayOnly && isNight) return false;
    if (pre.nightOnly && !isNight) return false;
    if (pre.factions && pre.factions.length > 0 && !pre.factions.includes(ctx.factionId)) return false;
    return true;
  }

  private static scoreSlot(
    slot: IJobSlotRuntime,
    ctx: INPCJobContext,
    config: IJobScoringConfig,
  ): number {
    let score = 0;
    if (slot.preconditions?.minRank !== undefined && ctx.rank >= slot.preconditions.minRank) {
      score += config.rankBonus;
    }
    if (slot.position) {
      const dx = slot.position.x - ctx.position.x;
      const dy = slot.position.y - ctx.position.y;
      score -= Math.sqrt(dx * dx + dy * dy) * config.distancePenalty;
    }
    return score;
  }
}
