// plugin/EconomyPlugin.ts
// A-Life Economy plugin — trade, inventory, and quests.

import type { IALifePlugin, ALifeKernel, IRandom } from '@alife-sdk/core';
import type { IEconomyConfig } from '../types/IEconomyConfig';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';
import { Inventory } from '../inventory/Inventory';
import { TraderInventory } from '../trade/TraderInventory';
import { QuestEngine } from '../quest/QuestEngine';
import type { IQuestStateSnapshot } from '../quest/QuestEngine';
import { EconomyPorts } from '../ports/EconomyPorts';

/**
 * A-Life Economy Plugin.
 *
 * Provides:
 * - Player Inventory
 * - Trader Inventory management with restock
 * - Quest Engine with terrain effects
 *
 * Optional port: ITerrainLockAdapter for quest terrain effects.
 *
 * @example
 * ```ts
 * const econ = new EconomyPlugin(random);
 * kernel.use(econ);
 *
 * econ.playerInventory.add('medkit', 3);
 * econ.traders.register('trader_1', 'loner', 5000);
 * econ.quests.startQuest('q_first_steps');
 * ```
 */
export class EconomyPlugin implements IALifePlugin {
  readonly name = 'economy';
  readonly dependencies = [] as const;

  readonly playerInventory: Inventory;
  readonly traders: TraderInventory;
  readonly quests: QuestEngine;
  readonly config: IEconomyConfig;

  private kernel: ALifeKernel | null = null;

  constructor(random: IRandom, config?: Partial<IEconomyConfig>) {
    this.config = createDefaultEconomyConfig(config);

    this.playerInventory = new Inventory(this.config.inventory);
    this.traders = new TraderInventory(this.config.trade, random);
    this.quests = new QuestEngine(); // Adapter set in init()
  }

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    // Validate config.
    const logger = this.kernel?.logger ?? null;
    const { trade, inventory } = this.config;
    if (trade.buyPriceMultiplier <= 0) logger?.warn('economy', 'trade.buyPriceMultiplier must be > 0');
    if (trade.sellPriceMultiplier <= 0) logger?.warn('economy', 'trade.sellPriceMultiplier must be > 0');
    if (trade.sellPriceMultiplier >= trade.buyPriceMultiplier) logger?.warn('economy', 'trade.sellPriceMultiplier >= buyPriceMultiplier — traders will lose money');
    if (trade.restockIntervalMs <= 0) logger?.warn('economy', 'trade.restockIntervalMs must be > 0');
    if (inventory.maxSlots <= 0) logger?.warn('economy', 'inventory.maxSlots must be > 0');

    // Wire terrain lock adapter if provided.
    const adapter = this.kernel?.portRegistry.tryGet(EconomyPorts.TerrainLock);
    if (adapter) {
      this.quests.setTerrainAdapter(adapter);
    }

    // Forward quest events into the kernel's EventBus so external systems
    // (UI, analytics, social) can subscribe via kernel.events.on(...).
    if (this.kernel) {
      const bus = this.kernel.events;
      this.quests.setEventForwarder((type, payload) => bus.emit(type as never, payload as never));
    }
  }

  destroy(): void {
    this.quests.destroy();
    this.playerInventory.destroy();
    this.playerInventory.clear();
    this.traders.clear();
    this.kernel = null;
  }

  serialize(): Record<string, unknown> {
    return {
      playerInventory: this.playerInventory.serialize(),
      traders: this.traders.serialize(),
      quests: this.quests.serialize(),
    };
  }

  restore(state: Record<string, unknown>): void {
    const invData = state.playerInventory as Array<{
      itemId: string;
      quantity: number;
      maxStack: number;
    }> | undefined;
    if (invData) {
      this.playerInventory.restore(invData);
    }

    const tradersData = state.traders as Record<string, unknown> | undefined;
    if (tradersData) {
      this.traders.restore(tradersData);
    }

    const questData = state.quests as IQuestStateSnapshot[] | undefined;
    if (questData) {
      this.quests.restore(questData);
    }
  }
}
