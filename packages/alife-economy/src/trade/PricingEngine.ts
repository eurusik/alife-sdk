import type { ITradeConfig } from '../types/IEconomyConfig';

/**
 * Context passed to a price modifier function.
 */
export interface IPriceContext {
  /** The item's base price before any multipliers. */
  readonly basePrice: number;
  /** Faction relation [-100, 100]. Available for relation-aware modifiers. */
  readonly factionRelation: number;
}

/**
 * Optional price modifier hook for `calculateBuyPrice` / `calculateSellPrice`.
 *
 * Receives the computed price (after standard formula) and the raw context.
 * Returns the final price (will be clamped to min 1 and rounded).
 *
 * @example
 * ```ts
 * // Quest bonus: 20% discount on buy
 * const questDiscount: IPriceModifier = (price) => price * 0.8;
 *
 * // Faction-specific: bandits pay more for ammo
 * const banditAmmoModifier: IPriceModifier = (price, { basePrice }) =>
 *   basePrice > 50 ? price * 1.5 : price;
 *
 * // Dynamic pricing by relation intensity
 * const dynamicModifier: IPriceModifier = (price, { factionRelation }) =>
 *   factionRelation > 80 ? price * 0.7 : price;
 *
 * calculateBuyPrice(100, 30, config, questDiscount);
 * ```
 */
export type IPriceModifier = (price: number, context: IPriceContext) => number;

/**
 * Calculate the buy price for an item.
 *
 * Formula: `round(basePrice × buyPriceMultiplier × allyModifier × modifier?)`
 * Ally discount applies when faction relation exceeds allyThreshold.
 *
 * @param basePrice - Item's base price.
 * @param factionRelation - Relation value [-100, 100].
 * @param config - Trade configuration.
 * @param modifier - Optional price modifier (quest bonuses, faction perks, etc.).
 * @returns Integer buy price, minimum 1.
 */
export function calculateBuyPrice(
  basePrice: number,
  factionRelation: number,
  config: ITradeConfig,
  modifier?: IPriceModifier,
): number {
  const allyModifier =
    factionRelation > config.allyThreshold ? config.allyDiscount : 1.0;
  let price = Math.round(basePrice * config.buyPriceMultiplier * allyModifier);
  if (modifier) {
    price = Math.round(modifier(price, { basePrice, factionRelation }));
  }
  return Math.max(1, price);
}

/**
 * Calculate the sell price for an item.
 *
 * Formula: `round(basePrice × sellPriceMultiplier × modifier?)`
 * No ally bonus on sell — flat markup regardless of relation.
 *
 * @param basePrice - Item's base price.
 * @param factionRelation - Relation value [-100, 100]. Passed to modifier for relation-aware adjustments.
 * @param config - Trade configuration.
 * @param modifier - Optional price modifier (quest bonuses, surge penalties, etc.).
 * @returns Integer sell price, minimum 1.
 */
export function calculateSellPrice(
  basePrice: number,
  factionRelation: number,
  config: ITradeConfig,
  modifier?: IPriceModifier,
): number {
  let price = Math.round(basePrice * config.sellPriceMultiplier);
  if (modifier) {
    price = Math.round(modifier(price, { basePrice, factionRelation }));
  }
  return Math.max(1, price);
}

/**
 * Check if trading is allowed based on faction relation.
 */
export function canTrade(
  factionRelation: number,
  config: ITradeConfig,
): boolean {
  return factionRelation >= config.minRelationToTrade;
}
