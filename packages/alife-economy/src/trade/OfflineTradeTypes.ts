// trade/OfflineTradeTypes.ts
// Types and configuration for the offline NPC-NPC trade system.

// ---------------------------------------------------------------------------
// Co-location port — boundary between economy and simulation layers
// ---------------------------------------------------------------------------

/**
 * Lightweight projection of an NPC visible to the offline trade system.
 *
 * Economy does not import INPCRecord. This is the minimal data it needs.
 */
export interface ITradeableNPC {
  readonly npcId: string;
  readonly factionId: string;
  readonly terrainId: string;
  /** Rank determines buyer preferences and seller stock quality. */
  readonly rank: number;
}

/**
 * NPCs grouped by terrain.
 * Key = terrainId, value = NPCs currently occupying that terrain.
 */
export type ICoLocationMap = ReadonlyMap<string, readonly ITradeableNPC[]>;

/**
 * Host-provided port that bridges the simulation layer to the trade system.
 *
 * Economy declares the interface; the host (or glue layer) implements it by
 * reading `brain.currentTerrainId` from `SimulationPlugin`.
 *
 * **Filtering contract**: the adapter must only return NPCs that are:
 * - Alive (hp > 0)
 * - Offline (not currently in the online rendering zone)
 * - Registered as traders in `TraderInventory`
 * - Assigned to a terrain (terrainId !== null)
 *
 * @example
 * ```ts
 * const coLocation: ICoLocationSource = {
 *   getCoLocatedTraders() {
 *     const map = new Map<string, ITradeableNPC[]>();
 *     for (const [id, record] of sim.getAllNPCRecords()) {
 *       if (!traderIds.has(id) || !record.isAlive || record.isOnline) continue;
 *       const terrainId = brains.get(id)?.currentTerrainId;
 *       if (!terrainId) continue;
 *       const group = map.get(terrainId) ?? [];
 *       group.push({ npcId: id, factionId: record.factionId, terrainId, rank: record.rank });
 *       map.set(terrainId, group);
 *     }
 *     return map;
 *   },
 *   getFactionRelation: (a, b) => factionSystem.getRelation(a, b),
 *   getPersonalGoodwill: (from, to) => relationRegistry.getGoodwill(from, to),
 * };
 * ```
 */
export interface ICoLocationSource {
  /**
   * Build and return the current terrain co-location map.
   * Called at most once per trade tick.
   */
  getCoLocatedTraders(): ICoLocationMap;

  /**
   * Faction relation between two factions in [-100, +100].
   */
  getFactionRelation(factionA: string, factionB: string): number;

  /**
   * Personal goodwill from `fromId` toward `toId` in [-100, +100].
   * Return 0 if no personal relation exists.
   */
  getPersonalGoodwill(fromId: string, toId: string): number;
}

// ---------------------------------------------------------------------------
// Item catalogue port
// ---------------------------------------------------------------------------

/**
 * Host-provided base price lookup.
 *
 * @example
 * ```ts
 * const catalogue: IItemCatalogue = {
 *   getBasePrice: (id) => ITEM_DB[id]?.basePrice,
 * };
 * ```
 */
export interface IItemCatalogue {
  /** Returns the base price for `itemId`, or `undefined` if not tradeable. */
  getBasePrice(itemId: string): number | undefined;
}

// ---------------------------------------------------------------------------
// Trade preference strategy
// ---------------------------------------------------------------------------

/**
 * An item available for purchase from a seller's stock.
 */
export interface IAvailableItem {
  readonly itemId: string;
  readonly quantity: number;
  readonly basePrice: number;
}

/**
 * Callback that scores how much a buyer NPC wants a specific item.
 *
 * Return a positive number to express desire; 0 or negative = no interest.
 * The resolver picks the item with the highest score.
 *
 * @example
 * ```ts
 * // Rank-aware preference: medkits for low-rank, weapons for high-rank
 * const preference: ITradePreference = (buyer, item) => {
 *   if (item.itemId === 'medkit')           return 10;
 *   if (item.itemId === 'rifle_ak74' && buyer.rank >= 3) return 20;
 *   if (item.itemId === 'bandage')          return 5;
 *   return 0;
 * };
 * ```
 */
export type ITradePreference = (
  buyerNpc: ITradeableNPC,
  item: IAvailableItem,
) => number;

// ---------------------------------------------------------------------------
// Trade result
// ---------------------------------------------------------------------------

/**
 * Outcome of a single NPC-NPC trade attempt.
 */
export interface IOfflineTradeResult {
  readonly buyerId: string;
  readonly sellerId: string;
  /** The item that was (or would have been) traded. Empty string on early-exit failures. */
  readonly itemId: string;
  readonly price: number;
  readonly success: boolean;
  /** Reason for failure, undefined on success. */
  readonly failReason?: string;
}

// ---------------------------------------------------------------------------
// Scheduler configuration
// ---------------------------------------------------------------------------

/**
 * Tuning parameters for `OfflineTradeScheduler`.
 */
export interface IOfflineTradeConfig {
  /**
   * Minimum time between trade participation per NPC (ms).
   * Acts as both the cooldown per NPC and the scheduler's own tick interval.
   * @default 60_000
   */
  readonly tradeIntervalMs: number;

  /**
   * Minimum combined attitude (factionRelation + personalGoodwill) to allow trade.
   * @default -30
   */
  readonly minAttitudeToTrade: number;

  /**
   * Maximum fraction of buyer's money they will spend on a single item.
   * Prevents an NPC from spending all their money in one transaction.
   * @default 0.5
   */
  readonly maxSpendRatio: number;

  /**
   * Price multiplier applied to base prices for NPC-NPC transactions.
   * Represents a "wholesale" rate — lower than the player buy price.
   * @default 0.8
   */
  readonly npcPriceMultiplier: number;

  /**
   * Maximum trades resolved per scheduler tick across all terrains.
   * Prevents CPU spikes when many NPCs are co-located.
   * @default 10
   */
  readonly maxTradesPerTick: number;

  /**
   * Prune expired cooldowns when the map grows beyond this size.
   * Keeps memory bounded in games with many unique trading NPCs.
   * @default 200
   */
  readonly cooldownMapPruneThreshold?: number;
}

/**
 * Creates a config with production defaults.
 * Pass `overrides` to tune any parameter for your game.
 */
export function createDefaultOfflineTradeConfig(
  overrides?: Partial<IOfflineTradeConfig>,
): IOfflineTradeConfig {
  return {
    tradeIntervalMs: 60_000,
    minAttitudeToTrade: -30,
    maxSpendRatio: 0.5,
    npcPriceMultiplier: 0.8,
    maxTradesPerTick: 10,
    ...overrides,
  };
}
