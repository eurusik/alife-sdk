// ports/EconomyPorts.ts
// Port tokens for the economy plugin.

import { createPortToken } from '@alife-sdk/core';
import type { ITerrainLockAdapter } from '../quest/QuestEngine';
import type { ICoLocationSource } from '../trade/OfflineTradeTypes';
import type { IItemCatalogue } from '../trade/OfflineTradeTypes';

/**
 * Economy subsystem port tokens.
 */
export const EconomyPorts = {
  TerrainLock: createPortToken<ITerrainLockAdapter>(
    'terrainLock',
    'Adapter for quest-driven terrain lock/unlock',
  ),

  /**
   * Provides terrain co-location data for NPC-NPC offline trading.
   * Implemented by the host (or glue layer) using SimulationPlugin.
   */
  CoLocationSource: createPortToken<ICoLocationSource>(
    'economy.coLocation',
    'Provides terrain co-location data for offline NPC-NPC trading',
  ),

  /**
   * Base price lookup for items in the offline trade catalogue.
   * Implemented by the host using their item database.
   */
  ItemCatalogue: createPortToken<IItemCatalogue>(
    'economy.itemCatalogue',
    'Base price lookup for tradeable items',
  ),
} as const;
