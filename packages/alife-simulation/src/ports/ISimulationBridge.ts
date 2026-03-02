/**
 * Port interface bridging the offline simulation with the host game engine.
 *
 * The simulation layer (OfflineCombatResolver, SurgeManager) needs to query
 * entity liveness, apply damage, and adjust morale — all operations that
 * touch game-engine components (HealthComponent, ALifeComponent).
 *
 * This port keeps the simulation package free of framework imports
 * (dep-no-framework-imports, frame-domain-purity).
 *
 * The game layer provides a concrete implementation that delegates to
 * its own component system.
 */
export interface ISimulationBridge {
  /** Check whether the entity exists and is alive. */
  isAlive(entityId: string): boolean;

  /**
   * Apply typed damage to an entity.
   * @returns `true` if the entity died from this hit.
   */
  applyDamage(entityId: string, amount: number, damageTypeId: string): boolean;

  /**
   * Calculate immunity-adjusted effective damage without applying it.
   * Used by offline combat to pre-compute damage before HP mutation.
   */
  getEffectiveDamage(entityId: string, rawDamage: number, damageTypeId: string): number;

  /** Adjust morale for an NPC (e.g. hit penalty, kill bonus, surge fear). */
  adjustMorale(entityId: string, delta: number, reason: string): void;
}

/**
 * Create a no-op {@link ISimulationBridge} with safe default behaviour.
 *
 * Safe defaults:
 * - `isAlive` returns `true` — all entities are considered alive.
 * - `applyDamage` returns `false` — no entity dies, no HP mutation.
 * - `getEffectiveDamage` returns `0` — no effective damage is computed.
 * - `adjustMorale` does nothing — morale is unchanged.
 *
 * @example
 * // Unit-testing an OfflineCombatResolver without a full game engine:
 * import { createNoOpBridge } from '@alife-sdk/simulation';
 *
 * const bridge = createNoOpBridge();
 * const resolver = new OfflineCombatResolver(config, bridge, random);
 * // resolver.resolve(npcA, npcB) now runs without touching any entity system
 *
 * @example
 * // Rapid prototyping — wire a SimulationPlugin before the engine adapter is ready:
 * kernel.provide(SimulationPorts.SimulationBridge, createNoOpBridge());
 */
export function createNoOpBridge(): ISimulationBridge {
  return {
    isAlive: (_entityId: string) => true,
    applyDamage: (_entityId: string, _amount: number, _damageTypeId: string) => false,
    getEffectiveDamage: (_entityId: string, _rawDamage: number, _damageTypeId: string) => 0,
    adjustMorale: (_entityId: string, _delta: number, _reason: string) => {},
  };
}
