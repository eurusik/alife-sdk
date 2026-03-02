// adapters/PhaserNPCSocialProvider.ts
// INPCSocialProvider backed by entity adapter + simulation plugin data.

import type { ISocialNPC } from '@alife-sdk/social';
import type { INPCSocialProvider } from '@alife-sdk/social';

/**
 * Callback-based INPCSocialProvider implementation.
 *
 * Bridges between the social plugin's data needs and the host game's
 * entity/faction systems.
 *
 * @example
 * ```ts
 * const provider = new PhaserNPCSocialProvider({
 *   getOnlineNPCs: () => {
 *     return Array.from(onlineNPCs).map(npc => ({
 *       id: npc.id,
 *       position: { x: npc.x, y: npc.y },
 *       factionId: npc.factionId,
 *       state: npc.currentState,
 *     }));
 *   },
 *   areFactionsFriendly: (a, b) => factionSystem.isAlly(a, b),
 *   areFactionsHostile: (a, b) => factionSystem.isHostile(a, b),
 *   getNPCTerrainId: (npcId) => simulationPlugin.getNPCBrain(npcId)?.currentTerrainId ?? null,
 * });
 * ```
 */
export class PhaserNPCSocialProvider implements INPCSocialProvider {
  private readonly handlers: {
    getOnlineNPCs: () => readonly ISocialNPC[];
    areFactionsFriendly: (factionA: string, factionB: string) => boolean;
    areFactionsHostile: (factionA: string, factionB: string) => boolean;
    getNPCTerrainId: (npcId: string) => string | null;
  };

  constructor(handlers: {
    getOnlineNPCs: () => readonly ISocialNPC[];
    areFactionsFriendly: (factionA: string, factionB: string) => boolean;
    areFactionsHostile: (factionA: string, factionB: string) => boolean;
    getNPCTerrainId: (npcId: string) => string | null;
  }) {
    this.handlers = handlers;
  }

  getOnlineNPCs(): readonly ISocialNPC[] {
    return this.handlers.getOnlineNPCs();
  }

  areFactionsFriendly(factionA: string, factionB: string): boolean {
    return this.handlers.areFactionsFriendly(factionA, factionB);
  }

  areFactionsHostile(factionA: string, factionB: string): boolean {
    return this.handlers.areFactionsHostile(factionA, factionB);
  }

  getNPCTerrainId(npcId: string): string | null {
    return this.handlers.getNPCTerrainId(npcId);
  }
}
