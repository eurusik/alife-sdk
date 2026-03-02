/**
 * Terrain fitness evaluation with surge, morale, squad, and tag modifiers.
 *
 * Scores all candidate terrains for a given NPC and returns the best fit.
 * Accounts for faction acceptance, capacity, surge shelter filtering,
 * squad leader co-location bonuses, morale-based danger penalties,
 * and allowed terrain tag restrictions.
 */

import type { SmartTerrain, Vec2 } from '@alife-sdk/core';
import type { ITerrainSelectorConfig } from '../types/ISimulationConfig';

/** Context object bundling all inputs for terrain selection. */
export interface ITerrainQuery {
  readonly terrains: readonly SmartTerrain[];
  readonly npcFaction: string;
  readonly npcPos: Vec2;
  readonly npcRank: number;
  readonly morale: number;
  readonly surgeActive: boolean;
  readonly leaderTerrainId: string | null;
  readonly allowedTags: ReadonlySet<string> | null;
  readonly config: ITerrainSelectorConfig;
  readonly scoreModifier?: (terrain: SmartTerrain, score: number) => number;
  readonly occupantId?: string;
}

export class TerrainSelector {
  /**
   * Score all terrains and return the best one for the given NPC.
   * Returns null if no terrain is suitable.
   */
  static selectBest(query: ITerrainQuery): SmartTerrain | null {
    const {
      terrains, npcFaction, npcPos, npcRank, morale,
      surgeActive, leaderTerrainId, allowedTags, config,
      scoreModifier, occupantId,
    } = query;

    let best: SmartTerrain | null = null;
    let bestScore = -Infinity;

    for (const terrain of terrains) {
      if (!terrain.hasCapacity && !(occupantId && terrain.hasOccupant(occupantId))) continue;
      if (!terrain.acceptsFaction(npcFaction)) continue;
      if (allowedTags !== null && !TerrainSelector.passesTagFilter(terrain, allowedTags)) continue;
      if (surgeActive && !terrain.isShelter) continue;

      let score = terrain.scoreFitness(npcFaction, npcPos, npcRank);

      if (surgeActive && terrain.isShelter) {
        score *= config.surgeMultiplier;
      }

      if (leaderTerrainId !== null && terrain.id === leaderTerrainId) {
        score += config.squadLeaderBonus;
      }

      if (morale < 0) {
        score -= terrain.dangerLevel * config.moraleDangerPenalty;
      }

      if (scoreModifier !== undefined) {
        score = scoreModifier(terrain, score);
      }

      if (score > bestScore) {
        bestScore = score;
        best = terrain;
      }
    }

    return best;
  }

  /** Check whether a terrain has at least one tag in the filter set. */
  static passesTagFilter(
    terrain: SmartTerrain,
    tags: ReadonlySet<string>,
  ): boolean {
    if (tags.size === 0) return true;
    for (const tag of tags) {
      if (terrain.tags.has(tag)) return true;
    }
    return false;
  }
}
