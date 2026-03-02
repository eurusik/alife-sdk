// adapters/PhaserSimulationBridge.ts
// ISimulationBridge implementation backed by NPC record HP tracking.

import type { ISimulationBridge } from '@alife-sdk/simulation';
import type { ILogger } from '@alife-sdk/core';

/**
 * HP record for an entity tracked by the simulation bridge.
 * The bridge reads and mutates currentHp on damage.
 */
export interface IHPRecord {
  currentHp: number;
  readonly maxHp: number;
}

/**
 * Immunity lookup: given an entityId and damageTypeId, returns a
 * resistance factor [0, 1] where 0 = no resistance and 1 = full immunity.
 */
export type ImmunityLookup = (entityId: string, damageTypeId: string) => number;

/**
 * Morale adjustment callback: called when the simulation needs to
 * adjust an NPC's morale (e.g., hit penalty, kill bonus, surge fear).
 */
export type MoraleCallback = (entityId: string, delta: number, reason: string) => void;

/**
 * ISimulationBridge implementation for Phaser games.
 *
 * Tracks entity HP via a registry of IHPRecord objects. The host
 * registers records when entities are created and provides optional
 * immunity and morale callbacks for damage calculation.
 *
 * Pass an optional {@link ILogger} to receive warnings when operations
 * target unregistered entities (useful during development).
 *
 * @example
 * ```ts
 * const bridge = new PhaserSimulationBridge(kernel.logger);
 * bridge.register('npc_1', { currentHp: 100, maxHp: 100 });
 * bridge.setImmunityLookup((id, type) => immunityProfile.get(type) ?? 0);
 * bridge.setMoraleCallback((id, delta, reason) => brain.adjustMorale(delta));
 * ```
 */
export class PhaserSimulationBridge implements ISimulationBridge {
  private readonly records = new Map<string, IHPRecord>();
  private immunityLookup: ImmunityLookup | null = null;
  private moraleCallback: MoraleCallback | null = null;
  private readonly logger: ILogger | null;

  constructor(logger?: ILogger) {
    this.logger = logger ?? null;
  }

  register(entityId: string, record: IHPRecord): void {
    this.records.set(entityId, record);
  }

  unregister(entityId: string): void {
    this.records.delete(entityId);
  }

  has(entityId: string): boolean {
    return this.records.has(entityId);
  }

  get size(): number {
    return this.records.size;
  }

  setImmunityLookup(lookup: ImmunityLookup): void {
    this.immunityLookup = lookup;
  }

  setMoraleCallback(callback: MoraleCallback): void {
    this.moraleCallback = callback;
  }

  // ---------------------------------------------------------------------------
  // ISimulationBridge
  // ---------------------------------------------------------------------------

  isAlive(entityId: string): boolean {
    const record = this.records.get(entityId);
    return record !== undefined && record.currentHp > 0;
  }

  applyDamage(entityId: string, amount: number, damageTypeId: string): boolean {
    const record = this.records.get(entityId);
    if (!record) {
      this.logger?.warn('PhaserSimulationBridge', `applyDamage: record not found for "${entityId}", treating as dead`);
      return true; // Unknown entity treated as dead
    }

    const effective = this.getEffectiveDamage(entityId, amount, damageTypeId);
    record.currentHp = Math.max(0, record.currentHp - effective);
    return record.currentHp <= 0;
  }

  getEffectiveDamage(entityId: string, rawDamage: number, damageTypeId: string): number {
    if (!this.immunityLookup) return rawDamage;

    const resistance = this.immunityLookup(entityId, damageTypeId);
    return rawDamage * (1 - Math.min(1, Math.max(0, resistance)));
  }

  adjustMorale(entityId: string, delta: number, reason: string): void {
    this.moraleCallback?.(entityId, delta, reason);
  }
}
