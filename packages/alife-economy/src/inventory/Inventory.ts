import type { IInventorySlot } from '../types/IEconomyTypes';
import type { IInventoryConfig } from '../types/IEconomyConfig';

/**
 * Typed event payload map for Inventory.on() / off().
 *
 * @example
 * ```ts
 * inv.on('item:added',   ({ itemId, quantity, newTotal }) => ui.updateSlot(itemId, newTotal));
 * inv.on('item:removed', ({ itemId, quantity, newTotal }) => ui.updateSlot(itemId, newTotal));
 * inv.on('inventory:cleared', () => ui.resetAll());
 * ```
 */
export type InventoryEventMap = {
  /** Fired after items are successfully added (quantity > 0 actually added). */
  'item:added': { itemId: string; quantity: number; newTotal: number };
  /** Fired after items are successfully removed. */
  'item:removed': { itemId: string; quantity: number; newTotal: number };
  /** Fired after clear(). NOT fired by restore(). */
  'inventory:cleared': Record<string, never>;
};

/**
 * Generic inventory container with configurable capacity and stacking.
 *
 * @example
 * ```ts
 * const inv = new Inventory({ maxSlots: 30, defaultMaxStack: 99 });
 *
 * inv.on('item:added', ({ itemId, newTotal }) => ui.updateSlot(itemId, newTotal));
 *
 * const overflow = inv.add('medkit', 3, 10);
 * inv.remove('medkit', 1);
 * ```
 */
export class Inventory {
  private readonly slots = new Map<string, IInventorySlot>();
  private readonly config: IInventoryConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _listeners = new Map<string, Set<(data: any) => void>>();

  // P36: cached getAllSlots() — dirty-flag invalidation on mutations.
  private _cachedSlots: readonly IInventorySlot[] = [];
  private _slotsDirty = false;

  constructor(config: IInventoryConfig) {
    this.config = config;
  }

  /**
   * Subscribe to an inventory event.
   * Multiple listeners per event are supported.
   */
  on<K extends keyof InventoryEventMap>(event: K, cb: (data: InventoryEventMap[K]) => void): void {
    let set = this._listeners.get(event as string);
    if (!set) { set = new Set(); this._listeners.set(event as string, set); }
    set.add(cb);
  }

  /**
   * Unsubscribe from an inventory event.
   * Pass the same callback reference used in on().
   */
  off<K extends keyof InventoryEventMap>(event: K, cb: (data: InventoryEventMap[K]) => void): void {
    this._listeners.get(event as string)?.delete(cb);
  }

  /**
   * Add items to inventory.
   *
   * If the item already exists, increments its quantity (capped at maxStack).
   * If the item is new, creates a slot if capacity allows.
   *
   * @param itemId - Item identifier.
   * @param quantity - Number of items to add.
   * @param maxStack - Stack limit for this item type (uses config default if omitted).
   * @returns Number of items that couldn't be added (overflow). 0 means all added.
   */
  add(itemId: string, quantity: number, maxStack?: number): number {
    if (quantity <= 0) return quantity;
    const effectiveMax = maxStack ?? this.config.defaultMaxStack;
    const existing = this.slots.get(itemId);

    if (existing) {
      const canFit = effectiveMax - existing.quantity;
      const toAdd = Math.min(quantity, canFit);
      if (toAdd > 0) {
        existing.quantity += toAdd;
        this._slotsDirty = true;
        this.emit('item:added', { itemId, quantity: toAdd, newTotal: existing.quantity });
      }
      return quantity - toAdd;
    }

    if (this.slots.size >= this.config.maxSlots) {
      return quantity;
    }

    const toAdd = Math.min(quantity, effectiveMax);
    this.slots.set(itemId, {
      itemId,
      quantity: toAdd,
      maxStack: effectiveMax,
    });
    this._slotsDirty = true;
    this.emit('item:added', { itemId, quantity: toAdd, newTotal: toAdd });
    return quantity - toAdd;
  }

  /**
   * Remove items from inventory.
   *
   * @returns `true` if the removal was successful, `false` if insufficient.
   */
  remove(itemId: string, quantity: number): boolean {
    const slot = this.slots.get(itemId);
    if (!slot || slot.quantity < quantity) return false;

    slot.quantity -= quantity;
    const newTotal = slot.quantity;
    if (slot.quantity <= 0) {
      this.slots.delete(itemId);
    }
    this._slotsDirty = true;
    this.emit('item:removed', { itemId, quantity, newTotal });
    return true;
  }

  /** Check if the inventory has at least `quantity` of an item. */
  has(itemId: string, quantity = 1): boolean {
    const slot = this.slots.get(itemId);
    return slot !== undefined && slot.quantity >= quantity;
  }

  /** Get the quantity of an item, or 0 if absent. */
  getQuantity(itemId: string): number {
    return this.slots.get(itemId)?.quantity ?? 0;
  }

  /**
   * Get a read-only view of a specific slot.
   *
   * Returns a read-only view of the internal slot. Do not mutate the returned
   * object directly — use add/remove to modify inventory state.
   */
  getSlot(itemId: string): Readonly<IInventorySlot> | undefined {
    return this.slots.get(itemId);
  }

  /** Whether the inventory has reached maximum slot capacity. */
  get isFull(): boolean {
    return this.slots.size >= this.config.maxSlots;
  }

  /** Number of occupied slots. */
  get usedSlots(): number {
    return this.slots.size;
  }

  /** Maximum slot capacity. */
  get capacity(): number {
    return this.config.maxSlots;
  }

  /** All occupied slots (cached snapshot, rebuilt on mutation). */
  getAllSlots(): readonly IInventorySlot[] {
    if (this._slotsDirty) {
      this._cachedSlots = [...this.slots.values()];
      this._slotsDirty = false;
    }
    return this._cachedSlots;
  }

  /** Clear all listeners. */
  destroy(): void {
    this._listeners.clear();
  }

  /** Clear all items. Emits `inventory:cleared`. */
  clear(): void {
    this._clearSlots();
    this.emit('inventory:cleared', {});
  }

  /** Serialize to a plain object for save/load. */
  serialize(): Array<{ itemId: string; quantity: number; maxStack: number }> {
    return this.getAllSlots().map((s) => ({
      itemId: s.itemId,
      quantity: s.quantity,
      maxStack: s.maxStack,
    }));
  }

  /** Restore from serialized data. Does NOT emit any events — query getAllSlots() afterward. */
  restore(data: readonly { itemId: string; quantity: number; maxStack: number }[]): void {
    this._clearSlots();
    for (const entry of data) {
      this.slots.set(entry.itemId, {
        itemId: entry.itemId,
        quantity: entry.quantity,
        maxStack: entry.maxStack,
      });
    }
    this._slotsDirty = true;
  }

  private _clearSlots(): void {
    this.slots.clear();
    this._slotsDirty = true;
  }

  private emit<K extends keyof InventoryEventMap>(event: K, data: InventoryEventMap[K]): void {
    this._listeners.get(event as string)?.forEach((cb) => cb(data));
  }
}
