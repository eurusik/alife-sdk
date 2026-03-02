// trade/GiftSession.ts
// Validates and executes item transfers without money (gifts, quest rewards, NPC handoffs).
// Pure logic — no rendering, no event emission (host handles events).
//
// Agnosticism guarantees:
//   - No money, faction, or player concepts.
//   - `canGive` is a plain boolean evaluated by the caller (quest state, relation,
//     NPC mood, or any other game-specific condition).
//   - Works with any two Inventory instances (player↔NPC, NPC↔NPC, chest↔NPC, etc.).

import { Inventory } from '../inventory/Inventory';

/**
 * Context for a gift/transfer operation.
 */
export interface IGiftContext {
  /** Inventory that gives the item. */
  readonly from: Inventory;
  /** Inventory that receives the item. */
  readonly to: Inventory;
  /** Item identifier to transfer. */
  readonly itemId: string;
  /** Number of units to transfer. Must be ≥ 1. */
  readonly quantity: number;
  /**
   * Pre-evaluated gate condition (faction relation, quest flag, NPC willingness, etc.).
   * Defaults to `true` when omitted — unconditioned transfer.
   */
  readonly canGive?: boolean;
}

/**
 * Result codes for a gift/transfer attempt.
 */
export const GiftResult = {
  /** All requested items transferred successfully. */
  SUCCESS: 'success',
  /** Transfer was blocked by the caller's `canGive` condition. */
  DECLINED: 'declined',
  /** Source inventory does not have enough of the item. */
  INSUFFICIENT_ITEMS: 'insufficient_items',
  /** Destination inventory is full — nothing was transferred. */
  INVENTORY_FULL: 'inventory_full',
  /**
   * Destination had partial space — some items transferred, rest returned to source.
   * Check `transferred` and `overflow` in the outcome for exact counts.
   */
  PARTIAL: 'partial',
} as const;

export type GiftResult = (typeof GiftResult)[keyof typeof GiftResult];

/**
 * Outcome of a gift/transfer attempt.
 */
export interface IGiftOutcome {
  readonly result: GiftResult;
  readonly itemId: string;
  /** Number of units that actually moved from `from` to `to`. */
  readonly transferred: number;
  /** Number of units that could not fit in `to` and were returned to `from`. */
  readonly overflow: number;
}

/**
 * Execute an item transfer without money (gift, quest reward, NPC handoff).
 *
 * Overflow handling: if `to` only has room for some of the requested quantity,
 * the remainder is returned to `from` and `GiftResult.PARTIAL` is returned.
 * If nothing could be transferred at all, `GiftResult.INVENTORY_FULL` is returned
 * and `from` is left unchanged.
 *
 * @param ctx - Transfer context.
 * @returns Outcome with result code and transfer counts.
 *
 * @example Quest reward — NPC gives player a medkit:
 * ```ts
 * const outcome = executeGift({
 *   from: npcInventory,
 *   to: playerInventory,
 *   itemId: 'medkit',
 *   quantity: 1,
 *   canGive: questCompleted && npcRelation > 0,
 * });
 * if (outcome.result === GiftResult.SUCCESS) startRewardCutscene();
 * ```
 */
export function executeGift(ctx: IGiftContext): IGiftOutcome {
  const { from, to, itemId, quantity, canGive = true } = ctx;

  if (!canGive) {
    return { result: GiftResult.DECLINED, itemId, transferred: 0, overflow: 0 };
  }

  if (!from.has(itemId, quantity)) {
    return { result: GiftResult.INSUFFICIENT_ITEMS, itemId, transferred: 0, overflow: 0 };
  }

  // Read source slot's maxStack before removing, so overflow is returned with the correct stack limit.
  const sourceMaxStack = from.getSlot(itemId)?.maxStack;

  // Remove from source, add to destination, put overflow back.
  from.remove(itemId, quantity);
  const overflow = to.add(itemId, quantity);
  if (overflow > 0) {
    from.add(itemId, overflow, sourceMaxStack);
  }

  const transferred = quantity - overflow;

  if (transferred === 0) {
    return { result: GiftResult.INVENTORY_FULL, itemId, transferred: 0, overflow: quantity };
  }

  return {
    result: overflow > 0 ? GiftResult.PARTIAL : GiftResult.SUCCESS,
    itemId,
    transferred,
    overflow,
  };
}
