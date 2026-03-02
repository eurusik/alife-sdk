// trade/TraderInventory.ts
// Per-trader stock management with restock lifecycle.

import type { ITraderStockEntry } from '../types/IEconomyTypes';
import type { ITradeConfig } from '../types/IEconomyConfig';
import type { IRandom } from '@alife-sdk/core';

/**
 * A registered trader with stock and money.
 */
export interface ITraderRecord {
  readonly traderId: string;
  readonly factionId: string;
  stock: Map<string, ITraderStockEntry>;
  money: number;
  readonly initialMoney: number;
  readonly restockBaseline: Map<string, number>;
  lastRestockTime: number;
  isActive: boolean;
}

/**
 * Public readonly view of a trader (no direct mutation).
 * Use TraderInventory methods to modify state.
 */
export interface ITraderSnapshot {
  readonly traderId: string;
  readonly factionId: string;
  readonly money: number;
  readonly stock: ReadonlyMap<string, ITraderStockEntry>;
  readonly isActive: boolean;
}

/**
 * Weighted bonus item for random restock additions.
 */
export interface IBonusItem {
  readonly itemId: string;
  readonly weight: number;
}

/**
 * Manages per-trader stock, money, and restock timers.
 *
 * @example
 * ```ts
 * const traders = new TraderInventory(config.trade, random);
 * traders.register('trader_1', 'loner', 5000);
 * traders.addStock('trader_1', 'medkit', 5);
 * traders.restock(currentTime);
 * ```
 */
export class TraderInventory {
  private readonly traders = new Map<string, ITraderRecord>();
  private readonly config: ITradeConfig;
  private readonly random: IRandom;
  private bonusPool: readonly IBonusItem[] = [];

  // P37: cached getTraderIds() — dirty-flag invalidation on register/clear.
  private _cachedTraderIds: readonly string[] = [];
  private _traderIdsDirty = false;

  constructor(config: ITradeConfig, random: IRandom) {
    this.config = config;
    this.random = random;
  }

  /**
   * Register a new trader.
   */
  register(traderId: string, factionId: string, initialMoney: number): void {
    this.traders.set(traderId, {
      traderId,
      factionId,
      stock: new Map(),
      money: initialMoney,
      initialMoney,
      restockBaseline: new Map(),
      lastRestockTime: 0,
      isActive: false,
    });
    this._traderIdsDirty = true;
  }

  /**
   * Add stock to a trader. Also records the baseline for restocking.
   */
  addStock(traderId: string, itemId: string, quantity: number): void {
    if (quantity < 0) throw new Error(`TraderInventory.addStock: quantity must be >= 0, got ${quantity}`);
    const trader = this.traders.get(traderId);
    if (!trader) return;

    const existing = trader.stock.get(itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      trader.stock.set(itemId, { itemId, quantity });
    }

    // Accumulate restock baseline.
    const baseline = trader.restockBaseline.get(itemId) ?? 0;
    trader.restockBaseline.set(itemId, baseline + quantity);
  }

  /**
   * Set the bonus item pool for restock additions.
   */
  setBonusPool(items: readonly IBonusItem[]): void {
    this.bonusPool = items;
  }

  /**
   * Check stock availability.
   */
  hasStock(traderId: string, itemId: string, quantity = 1): boolean {
    const trader = this.traders.get(traderId);
    if (!trader) return false;
    const entry = trader.stock.get(itemId);
    return entry !== undefined && entry.quantity >= quantity;
  }

  /**
   * Deduct stock (after a sale to the player).
   */
  deductStock(traderId: string, itemId: string, quantity: number): boolean {
    const trader = this.traders.get(traderId);
    if (!trader) return false;
    const entry = trader.stock.get(itemId);
    if (!entry || entry.quantity < quantity) return false;
    entry.quantity -= quantity;
    if (entry.quantity <= 0) trader.stock.delete(itemId);
    return true;
  }

  /**
   * Add stock (when player sells an item to the trader).
   */
  receiveItem(traderId: string, itemId: string, quantity: number): void {
    if (quantity < 0) throw new Error(`TraderInventory.receiveItem: quantity must be >= 0, got ${quantity}`);
    const trader = this.traders.get(traderId);
    if (!trader) return;
    const existing = trader.stock.get(itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      trader.stock.set(itemId, { itemId, quantity });
    }
  }

  /** Get a readonly snapshot of a trader (defensive copy — callers cannot mutate internal state). */
  getTrader(traderId: string): ITraderSnapshot | undefined {
    const trader = this.traders.get(traderId);
    if (!trader) return undefined;
    return {
      traderId: trader.traderId,
      factionId: trader.factionId,
      money: trader.money,
      stock: new Map(trader.stock),
      isActive: trader.isActive,
    };
  }

  /**
   * Adjust a trader's money by a delta (positive or negative).
   * @returns `true` if the trader exists.
   */
  adjustMoney(traderId: string, delta: number): boolean {
    const trader = this.traders.get(traderId);
    if (!trader) return false;
    trader.money = Math.max(0, trader.money + delta);
    return true;
  }

  /** Mark a trader as active (trade session open). Suppresses restock. */
  setActive(traderId: string, active: boolean): void {
    const trader = this.traders.get(traderId);
    if (trader) trader.isActive = active;
  }

  /**
   * Restock all eligible traders.
   *
   * Skips traders currently in an active trade session.
   * Restores stock to baseline quantities and resets money.
   * Has a configurable chance (default 40%) to add one random bonus item.
   */
  restock(currentTimeMs: number): void {
    for (const trader of this.traders.values()) {
      if (trader.isActive) continue;
      if (currentTimeMs - trader.lastRestockTime < this.config.restockIntervalMs) continue;

      // Restore baseline stock.
      for (const [itemId, baseQty] of trader.restockBaseline) {
        const entry = trader.stock.get(itemId);
        if (entry) {
          entry.quantity = baseQty;
        } else {
          trader.stock.set(itemId, { itemId, quantity: baseQty });
        }
      }

      // Restore money.
      trader.money = trader.initialMoney;

      // Configurable chance for a bonus item.
      if (this.bonusPool.length > 0 && this.random.next() < this.config.bonusItemChance) {
        const bonus = this.selectWeightedRandom(this.bonusPool);
        if (bonus) {
          this.receiveItem(trader.traderId, bonus.itemId, 1);
        }
      }

      trader.lastRestockTime = currentTimeMs;
    }
  }

  /** Get all trader IDs (cached, rebuilt on register/clear). */
  getTraderIds(): readonly string[] {
    if (this._traderIdsDirty) {
      this._cachedTraderIds = [...this.traders.keys()];
      this._traderIdsDirty = false;
    }
    return this._cachedTraderIds;
  }

  /** Total number of registered traders. */
  get size(): number {
    return this.traders.size;
  }

  /**
   * Serialize mutable trader state for save/load.
   * Returns JSON-compatible data (no Maps — uses arrays of [key, value] pairs).
   */
  serialize(): Record<string, unknown> {
    const traders: Array<{
      traderId: string;
      factionId: string;
      money: number;
      initialMoney: number;
      lastRestockTime: number;
      isActive: boolean;
      stock: Array<[string, ITraderStockEntry]>;
      restockBaseline: Array<[string, number]>;
    }> = [];

    for (const trader of this.traders.values()) {
      traders.push({
        traderId: trader.traderId,
        factionId: trader.factionId,
        money: trader.money,
        initialMoney: trader.initialMoney,
        lastRestockTime: trader.lastRestockTime,
        isActive: trader.isActive,
        stock: [...trader.stock.entries()],
        restockBaseline: [...trader.restockBaseline.entries()],
      });
    }

    return { traders };
  }

  /**
   * Restore mutable trader state from a previously serialized snapshot.
   * Clears existing state before restoring.
   */
  restore(state: Record<string, unknown>): void {
    this.traders.clear();
    this._traderIdsDirty = true;

    const traders = state.traders as Array<{
      traderId: string;
      factionId: string;
      money: number;
      initialMoney: number;
      lastRestockTime: number;
      isActive: boolean;
      stock: Array<[string, ITraderStockEntry]>;
      restockBaseline: Array<[string, number]>;
    }> | undefined;

    if (!traders) return;

    for (const t of traders) {
      this.traders.set(t.traderId, {
        traderId: t.traderId,
        factionId: t.factionId,
        money: t.money,
        initialMoney: t.initialMoney,
        lastRestockTime: t.lastRestockTime,
        isActive: t.isActive,
        stock: new Map(t.stock),
        restockBaseline: new Map(t.restockBaseline),
      });
    }
  }

  /** Clear all traders. */
  clear(): void {
    this.traders.clear();
    this._traderIdsDirty = true;
  }

  private selectWeightedRandom(items: readonly IBonusItem[]): IBonusItem | null {
    let totalWeight = 0;
    for (const item of items) totalWeight += item.weight;
    if (totalWeight <= 0) return null;

    let roll = this.random.next() * totalWeight;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }
}
