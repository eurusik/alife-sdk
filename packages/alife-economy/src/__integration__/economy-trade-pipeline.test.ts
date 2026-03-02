/**
 * Integration test: "Economy trade pipeline".
 *
 * Exercises the full trade lifecycle end-to-end:
 *   1. Register trader -> stock -> buy/sell
 *   2. Faction-based pricing (ally discount, hostile refusal)
 *   3. Restock cycle
 *   4. Quest engine -> terrain effects
 *   5. Serialize/restore round-trip
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ALifeKernel, Ports } from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';
import { EconomyPlugin } from '../plugin/EconomyPlugin';
import { executeBuy, executeSell, TradeResult } from '../trade/TradeSession';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';
import { QuestStatus, ObjectiveType } from '../types/IEconomyTypes';
import type { ITerrainLockAdapter } from '../quest/QuestEngine';
import { EconomyPorts } from '../ports/EconomyPorts';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

function stubPorts() {
  return {
    entityAdapter: {
      getPosition: () => ({ x: 0, y: 0 }),
      isAlive: () => true,
      hasComponent: () => false,
      getComponentValue: () => null,
      setPosition: () => {},
      setActive: () => {},
      setVisible: () => {},
      setVelocity: () => {},
      getVelocity: () => ({ x: 0, y: 0 }),
      setRotation: () => {},
      teleport: () => {},
      disablePhysics: () => {},
      setAlpha: () => {},
      playAnimation: () => {},
      hasAnimation: () => false,
    },
    playerPosition: { getPlayerPosition: () => ({ x: 0, y: 0 }) },
    entityFactory: {
      createNPC: () => 'stub',
      createMonster: () => 'stub',
      destroyEntity: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Economy: trade pipeline (integration)', () => {
  const config = createDefaultEconomyConfig();
  let plugin: EconomyPlugin;

  beforeEach(() => {
    plugin = new EconomyPlugin(SEEDED_RANDOM);

    // Register a trader with stock.
    plugin.traders.register('trader_1', 'loner', 5_000);
    plugin.traders.addStock('trader_1', 'medkit', 10);
    plugin.traders.addStock('trader_1', 'ammo_9x19', 50);
  });

  // -----------------------------------------------------------------------
  // Buy / Sell
  // -----------------------------------------------------------------------

  it('player buys medkit -- trader stock down, player inventory up', () => {
    const { receipt, newPlayerMoney } = executeBuy({
      playerInventory: plugin.playerInventory, playerMoney: 1_000, traders: plugin.traders,
      traderId: 'trader_1', itemId: 'medkit', basePrice: 400, factionRelation: 0, config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.SUCCESS);
    expect(receipt.totalPrice).toBe(520); // 400 x 1.3 = 520
    expect(newPlayerMoney).toBe(480); // 1000 - 520
    expect(plugin.playerInventory.getQuantity('medkit')).toBe(1);
    expect(plugin.traders.hasStock('trader_1', 'medkit')).toBe(true);
  });

  it('player sells item -- trader receives, player inventory down', () => {
    plugin.playerInventory.add('artefact_flame', 1);

    const { receipt, newPlayerMoney } = executeSell({
      playerInventory: plugin.playerInventory, playerMoney: 500, traders: plugin.traders,
      traderId: 'trader_1', itemId: 'artefact_flame', basePrice: 1_000, factionRelation: 0, config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.SUCCESS);
    expect(receipt.totalPrice).toBe(500); // 1000 x 0.5 = 500
    expect(newPlayerMoney).toBe(1_000); // 500 + 500
    expect(plugin.playerInventory.has('artefact_flame')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Faction pricing
  // -----------------------------------------------------------------------

  it('ally faction gets discounted buy price', () => {
    const { receipt } = executeBuy({
      playerInventory: plugin.playerInventory, playerMoney: 10_000, traders: plugin.traders,
      traderId: 'trader_1', itemId: 'medkit', basePrice: 400, factionRelation: 60, config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.SUCCESS);
    expect(receipt.totalPrice).toBe(416); // 400 x 1.3 x 0.8 = 416
  });

  it('hostile faction cannot trade', () => {
    const { receipt } = executeBuy({
      playerInventory: plugin.playerInventory, playerMoney: 10_000, traders: plugin.traders,
      traderId: 'trader_1', itemId: 'medkit', basePrice: 400, factionRelation: -50, config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.RELATION_TOO_LOW);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('inventory full blocks buy', () => {
    // Fill up the inventory with unique items.
    for (let i = 0; i < config.inventory.maxSlots; i++) {
      plugin.playerInventory.add(`item_${i}`, 1);
    }

    const { receipt } = executeBuy({
      playerInventory: plugin.playerInventory, playerMoney: 10_000, traders: plugin.traders,
      traderId: 'trader_1', itemId: 'medkit', basePrice: 400, factionRelation: 0, config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.INVENTORY_FULL);
  });

  // -----------------------------------------------------------------------
  // Restock
  // -----------------------------------------------------------------------

  it('restock restores baseline stock after interval', () => {
    // Drain all medkits.
    for (let i = 0; i < 10; i++) {
      plugin.traders.deductStock('trader_1', 'medkit', 1);
    }
    expect(plugin.traders.hasStock('trader_1', 'medkit')).toBe(false);

    // Trigger restock after interval (300_000ms default).
    plugin.traders.restock(400_000);

    expect(plugin.traders.hasStock('trader_1', 'medkit')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Quest + terrain lock
  // -----------------------------------------------------------------------

  it('quest start locks terrain, quest complete unlocks', () => {
    const locked = new Set<string>();
    const terrainAdapter: ITerrainLockAdapter = {
      setLocked(terrainId, isLocked) {
        if (isLocked) locked.add(terrainId);
        else locked.delete(terrainId);
      },
    };

    // Build kernel with terrain adapter port.
    const kernel = new ALifeKernel();
    const ports = stubPorts();
    kernel.provide(Ports.EntityAdapter, ports.entityAdapter);
    kernel.provide(Ports.PlayerPosition, ports.playerPosition);
    kernel.provide(Ports.EntityFactory, ports.entityFactory);
    kernel.provide(EconomyPorts.TerrainLock, terrainAdapter);

    const econ = new EconomyPlugin(SEEDED_RANDOM);
    kernel.use(econ);
    kernel.init();

    econ.quests.registerQuest({
      id: 'q_rescue',
      name: 'Rescue',
      description: 'Rescue the guide',
      objectives: [
        { id: 'obj_reach', type: ObjectiveType.REACH_ZONE, target: 'zone_lab', description: 'Reach the lab', count: 1, current: 0, completed: false },
      ],
      terrainEffects: [
        { terrainId: 'terrain_lab', action: 'lock', trigger: 'on_start' },
        { terrainId: 'terrain_lab', action: 'unlock', trigger: 'on_complete' },
      ],
    });

    econ.quests.startQuest('q_rescue');
    expect(locked.has('terrain_lab')).toBe(true);

    econ.quests.completeObjective('q_rescue', 'obj_reach');
    expect(locked.has('terrain_lab')).toBe(false);

    kernel.destroy();
  });

  // -----------------------------------------------------------------------
  // Serialize / Restore
  // -----------------------------------------------------------------------

  it('serialize/restore preserves player inventory and quest state', () => {
    plugin.playerInventory.add('medkit', 3);
    plugin.playerInventory.add('ammo_9x19', 20);

    // Build a kernel to test plugin serialization.
    const kernel = new ALifeKernel();
    const ports = stubPorts();
    kernel.provide(Ports.EntityAdapter, ports.entityAdapter);
    kernel.provide(Ports.PlayerPosition, ports.playerPosition);
    kernel.provide(Ports.EntityFactory, ports.entityFactory);

    const econ = new EconomyPlugin(SEEDED_RANDOM);
    kernel.use(econ);
    kernel.init();

    econ.playerInventory.add('medkit', 5);
    econ.quests.registerQuest({
      id: 'q_test',
      name: 'Test',
      description: 'Test quest',
      objectives: [
        { id: 'obj_kill', type: ObjectiveType.KILL, target: 'bandit', description: 'Kill bandits', count: 3, current: 0, completed: false },
      ],
    });
    econ.quests.startQuest('q_test');
    econ.quests.updateObjectiveProgress('q_test', 'obj_kill', 2);

    // Serialize.
    const state = kernel.serialize();

    // Restore into a new kernel.
    const kernel2 = new ALifeKernel();
    kernel2.provide(Ports.EntityAdapter, ports.entityAdapter);
    kernel2.provide(Ports.PlayerPosition, ports.playerPosition);
    kernel2.provide(Ports.EntityFactory, ports.entityFactory);

    const econ2 = new EconomyPlugin(SEEDED_RANDOM);
    kernel2.use(econ2);
    kernel2.init();

    // Quest definitions must be re-registered before restore (definitions are not serialized).
    econ2.quests.registerQuest({
      id: 'q_test',
      name: 'Test',
      description: 'Test quest',
      objectives: [
        { id: 'obj_kill', type: ObjectiveType.KILL, target: 'bandit', description: 'Kill bandits', count: 3, current: 0, completed: false },
      ],
    });

    kernel2.restoreState(state);

    expect(econ2.playerInventory.getQuantity('medkit')).toBe(5);
    expect(econ2.quests.getQuestState('q_test')?.status).toBe(QuestStatus.ACTIVE);

    kernel.destroy();
    kernel2.destroy();
  });
});
