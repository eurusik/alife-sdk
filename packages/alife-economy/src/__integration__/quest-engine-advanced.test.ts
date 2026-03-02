/**
 * Integration test: "Quest engine + trade edge-cases".
 *
 * Exercises scenarios not covered by the basic trade pipeline test:
 *   1. Quest auto-complete via updateObjectiveProgress → terrain effects
 *   2. Multiple terrain effects on a single on_complete trigger
 *   3. failQuest does NOT fire terrain effects
 *   4. Re-register after start preserves active state
 *   5. Serialize/restore round-trip for FAILED quest
 *   6. Ally discount boundary (relation=50 → strict >)
 *   7. executeSell blocked by insufficient trader money
 *   8. Weighted bonus pool selection
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import type { IRandom } from '@alife-sdk/core';
import { QuestEngine, type ITerrainLockAdapter } from '../quest/QuestEngine';
import { QuestStatus, ObjectiveType } from '../types/IEconomyTypes';
import type { IQuestDefinition, IQuestObjective } from '../types/IEconomyTypes';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';
import { calculateBuyPrice } from '../trade/PricingEngine';
import { executeSell, TradeResult } from '../trade/TradeSession';
import { TraderInventory } from '../trade/TraderInventory';
import { Inventory } from '../inventory/Inventory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const config = createDefaultEconomyConfig();

const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

function makeObjective(
  id: string,
  type: ObjectiveType = ObjectiveType.KILL,
  count = 3,
): IQuestObjective {
  return {
    id,
    type,
    target: 'target_' + id,
    description: 'Test objective',
    count,
    current: 0,
    completed: false,
  };
}

/** Tracks setLocked calls for assertions. */
function createTrackingAdapter(): { adapter: ITerrainLockAdapter; calls: Array<{ terrainId: string; locked: boolean }> } {
  const calls: Array<{ terrainId: string; locked: boolean }> = [];
  return {
    adapter: {
      setLocked(terrainId: string, locked: boolean) {
        calls.push({ terrainId, locked });
      },
    },
    calls,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Quest engine + trade edge-cases (integration)', () => {
  // -----------------------------------------------------------------------
  // Quest auto-complete chain
  // -----------------------------------------------------------------------

  describe('quest auto-complete + terrain effects', () => {
    it('kill quest: updateObjectiveProgress auto-completes → on_complete terrain unlock', () => {
      const { adapter, calls } = createTrackingAdapter();
      const engine = new QuestEngine(adapter);

      const def: IQuestDefinition = {
        id: 'q_kill',
        name: 'Kill Quest',
        description: 'Kill 3 enemies',
        objectives: [makeObjective('kill_obj', ObjectiveType.KILL, 3)],
        terrainEffects: [
          { terrainId: 'secret_zone', action: 'unlock', trigger: 'on_complete' },
        ],
      };

      engine.registerQuest(def);
      engine.startQuest('q_kill');
      expect(engine.getQuestState('q_kill')?.status).toBe(QuestStatus.ACTIVE);

      // Progress 2 of 3 — not yet complete
      engine.updateObjectiveProgress('q_kill', 'kill_obj', 2);
      expect(engine.getQuestState('q_kill')?.status).toBe(QuestStatus.ACTIVE);
      expect(calls).toHaveLength(0);

      // Final kill → auto-complete objective → auto-complete quest → terrain unlock
      engine.updateObjectiveProgress('q_kill', 'kill_obj', 1);
      expect(engine.getQuestState('q_kill')?.status).toBe(QuestStatus.COMPLETED);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ terrainId: 'secret_zone', locked: false });
    });

    it('multiple terrain effects on single on_complete trigger', () => {
      const { adapter, calls } = createTrackingAdapter();
      const engine = new QuestEngine(adapter);

      const def: IQuestDefinition = {
        id: 'q_multi',
        name: 'Multi Terrain',
        description: 'Unlocks two zones',
        objectives: [makeObjective('reach_obj', ObjectiveType.REACH_ZONE, 1)],
        terrainEffects: [
          { terrainId: 'zone_a', action: 'unlock', trigger: 'on_complete' },
          { terrainId: 'zone_b', action: 'unlock', trigger: 'on_complete' },
        ],
      };

      engine.registerQuest(def);
      engine.startQuest('q_multi');
      engine.completeObjective('q_multi', 'reach_obj');

      expect(engine.getQuestState('q_multi')?.status).toBe(QuestStatus.COMPLETED);
      expect(calls).toHaveLength(2);
      expect(calls.map(c => c.terrainId).sort()).toEqual(['zone_a', 'zone_b']);
    });

    it('failQuest does NOT trigger on_complete terrain effects', () => {
      const { adapter, calls } = createTrackingAdapter();
      const engine = new QuestEngine(adapter);

      const def: IQuestDefinition = {
        id: 'q_fail',
        name: 'Fail Quest',
        description: 'Will fail',
        objectives: [makeObjective('obj_1')],
        terrainEffects: [
          { terrainId: 'zone_locked', action: 'unlock', trigger: 'on_complete' },
          // No on_fail effect here — only on_complete should be ignored
        ],
      };

      engine.registerQuest(def);
      engine.startQuest('q_fail');
      engine.failQuest('q_fail');

      expect(engine.getQuestState('q_fail')?.status).toBe(QuestStatus.FAILED);
      expect(calls).toHaveLength(0); // on_complete effects must NOT fire on fail
    });
  });

  // -----------------------------------------------------------------------
  // Quest registration + serialization
  // -----------------------------------------------------------------------

  describe('quest state management', () => {
    it('re-register after start does NOT reset active state', () => {
      const engine = new QuestEngine();
      const def: IQuestDefinition = {
        id: 'q_reregister',
        name: 'Re-register Test',
        description: 'Test',
        objectives: [makeObjective('obj_1')],
      };

      engine.registerQuest(def);
      engine.startQuest('q_reregister');
      expect(engine.getQuestState('q_reregister')?.status).toBe(QuestStatus.ACTIVE);

      // Re-register — should NOT reset to AVAILABLE
      engine.registerQuest(def);
      expect(engine.getQuestState('q_reregister')?.status).toBe(QuestStatus.ACTIVE);
    });

    it('serialize/restore: FAILED quest with partial progress round-trips', () => {
      const engine1 = new QuestEngine();

      const def: IQuestDefinition = {
        id: 'q_partial',
        name: 'Partial Progress',
        description: 'Will be failed mid-progress',
        objectives: [
          makeObjective('kill_3', ObjectiveType.KILL, 5),
          makeObjective('reach_zone', ObjectiveType.REACH_ZONE, 1),
        ],
      };

      engine1.registerQuest(def);
      engine1.startQuest('q_partial');
      engine1.updateObjectiveProgress('q_partial', 'kill_3', 2);
      engine1.failQuest('q_partial');

      const snapshot = engine1.serialize();

      // Restore into a fresh engine (must re-register def first)
      const engine2 = new QuestEngine();
      engine2.registerQuest(def);
      engine2.restore(snapshot);

      const state = engine2.getQuestState('q_partial');
      expect(state).toBeDefined();
      expect(state!.status).toBe(QuestStatus.FAILED);
      expect(state!.objectives[0].current).toBe(2);
      expect(state!.objectives[0].completed).toBe(false);
      expect(state!.objectives[1].current).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Pricing boundary
  // -----------------------------------------------------------------------

  describe('ally discount boundary', () => {
    it('relation=50 (exact threshold) → NO discount (strict >)', () => {
      const price = calculateBuyPrice(100, 50, config.trade);
      const noDiscountPrice = Math.round(100 * config.trade.buyPriceMultiplier);
      expect(price).toBe(noDiscountPrice);
    });

    it('relation=51 → ally discount applied', () => {
      const price = calculateBuyPrice(100, 51, config.trade);
      const discountPrice = Math.round(100 * config.trade.buyPriceMultiplier * config.trade.allyDiscount);
      expect(price).toBe(discountPrice);
    });
  });

  // -----------------------------------------------------------------------
  // Trade edge-cases
  // -----------------------------------------------------------------------

  describe('trade session edge-cases', () => {
    it('executeSell blocked when trader has insufficient money', () => {
      const traders = new TraderInventory(config.trade, SEEDED_RANDOM);
      traders.register('poor_trader', 'loner', 1); // Only 1 money
      const playerInv = new Inventory(config.inventory);
      playerInv.add('rifle', 1);

      const { receipt } = executeSell({
        playerInventory: playerInv, playerMoney: 1000, traders,
        traderId: 'poor_trader', itemId: 'rifle', basePrice: 200, // basePrice 200 -> sell price = round(200 x 0.5) = 100
        factionRelation: 60, config: config.trade,
      });

      expect(receipt.result).toBe(TradeResult.TRADER_INSUFFICIENT_FUNDS);
      // Player should still have the item
      expect(playerInv.has('rifle')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Weighted bonus pool
  // -----------------------------------------------------------------------

  describe('trader bonus pool', () => {
    it('weighted selection is proportional to weights', () => {
      // Use a random that returns specific values for the two random.next() calls in restock:
      // 1st call: bonusItemChance check (0.25 < 0.4 = true)
      // 2nd call: weighted selection
      let callIdx = 0;
      const values = [0.1, 0.1]; // Both low — will pick first item (weight 10 out of 11)
      const testRandom: IRandom = {
        next: () => values[callIdx++ % values.length],
        nextInt: (min: number, max: number) => Math.floor(0.5 * (max - min + 1)) + min,
        nextFloat: (min: number, max: number) => 0.5 * (max - min) + min,
      };

      const traders = new TraderInventory(config.trade, testRandom);
      traders.register('bonus_trader', 'loner', 5_000);
      traders.addStock('bonus_trader', 'medkit', 5);
      traders.setBonusPool([
        { itemId: 'rare_artefact', weight: 10 },
        { itemId: 'common_junk', weight: 1 },
      ]);

      // Trigger restock — should add bonus item
      traders.restock(config.trade.restockIntervalMs + 1);

      const trader = traders.getTrader('bonus_trader');
      expect(trader).toBeDefined();
      // With low random value (0.1), weighted selection should pick rare_artefact (weight 10/11)
      expect(traders.hasStock('bonus_trader', 'rare_artefact')).toBe(true);
    });

    it('high random skips bonus item (above bonusItemChance)', () => {
      const highRandom: IRandom = {
        next: () => 0.9, // 0.9 > 0.4 = no bonus
        nextInt: (min: number, max: number) => Math.floor(0.9 * (max - min + 1)) + min,
        nextFloat: (min: number, max: number) => 0.9 * (max - min) + min,
      };

      const traders = new TraderInventory(config.trade, highRandom);
      traders.register('no_bonus', 'loner', 5_000);
      traders.addStock('no_bonus', 'medkit', 5);
      traders.setBonusPool([
        { itemId: 'rare_artefact', weight: 10 },
      ]);

      traders.restock(config.trade.restockIntervalMs + 1);

      // No bonus item should be added
      expect(traders.hasStock('no_bonus', 'rare_artefact')).toBe(false);
    });
  });
});
