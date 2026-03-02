// ports/INPCSocialProvider.ts
// Port interface for NPC social data from the host.

import type { ISocialNPC } from '../types/ISocialTypes';

/**
 * Host-side provider for NPC data needed by social systems.
 *
 * The SDK queries this to determine:
 * - Which NPCs are online and in range
 * - Faction relationships
 * - Current NPC states (for greeting/remark eligibility)
 *
 * @example
 * ```ts
 * const provider: INPCSocialProvider = {
 *   getOnlineNPCs() {
 *     return Array.from(onlineNPCs.values()).map(e => ({
 *       id: e.getData('npcId'),
 *       position: { x: e.x, y: e.y },
 *       factionId: e.getData('factionId'),
 *       state: e.getData('aiState'),
 *     }));
 *   },
 *   areFactionsFriendly(a, b) {
 *     return factionManager.getRelation(a, b) > 0;
 *   },
 *   areFactionsHostile(a, b) {
 *     return factionManager.getRelation(a, b) < -30;
 *   },
 *   getNPCTerrainId(npcId) {
 *     return brainManager.getBrain(npcId)?.currentTerrainId ?? null;
 *   },
 * };
 * ```
 */
export interface INPCSocialProvider {
  /** Get all online NPCs. */
  getOnlineNPCs(): readonly ISocialNPC[];

  /** Check if two factions are friendly (ally or same). */
  areFactionsFriendly(factionA: string, factionB: string): boolean;

  /** Check if two factions are hostile. */
  areFactionsHostile(factionA: string, factionB: string): boolean;

  /** Get the terrain ID where an NPC is assigned (null if unassigned). */
  getNPCTerrainId(npcId: string): string | null;
}
