// goap/WorldStateBuilder.ts
// Pure function to build a GOAP world state snapshot from NPC data.
// No side effects — caller provides all inputs as a snapshot.

import { WorldState } from '@alife-sdk/core';
import { WorldProperty, type INPCWorldSnapshot } from '../types/IPerceptionTypes';

/**
 * A single world state property builder.
 * Each builder is responsible for computing one boolean property from the snapshot.
 */
export interface IWorldPropertyBuilder {
  readonly key: string;
  build(snapshot: INPCWorldSnapshot): boolean;
}

/**
 * Default property builders corresponding to the original 16 hardcoded assignments.
 * Order matches the original buildWorldState implementation.
 */
export const DEFAULT_WORLD_PROPERTY_BUILDERS: readonly IWorldPropertyBuilder[] = [
  // Direct properties
  { key: WorldProperty.ALIVE, build: (s) => s.isAlive },
  { key: WorldProperty.CRITICALLY_WOUNDED, build: (s) => s.hpRatio <= (s.healHpThreshold ?? 0.3) },
  { key: WorldProperty.HAS_WEAPON, build: (s) => s.hasWeapon },
  { key: WorldProperty.HAS_AMMO, build: (s) => s.hasAmmo },
  { key: WorldProperty.IN_COVER, build: (s) => s.inCover },
  { key: WorldProperty.SEE_ENEMY, build: (s) => s.seeEnemy },
  { key: WorldProperty.ENEMY_PRESENT, build: (s) => s.enemyPresent },
  { key: WorldProperty.ENEMY_IN_RANGE, build: (s) => s.enemyInRange },
  { key: WorldProperty.DANGER, build: (s) => s.hasDanger },
  { key: WorldProperty.DANGER_GRENADE, build: (s) => s.hasDangerGrenade },
  { key: WorldProperty.ENEMY_WOUNDED, build: (s) => s.enemyWounded },
  { key: WorldProperty.ANOMALY_NEAR, build: (s) => s.nearAnomalyZone },
  // Derived properties
  { key: WorldProperty.ENEMY_SEE_ME, build: (s) => s.enemySeeMe ?? s.seeEnemy },
  {
    key: WorldProperty.READY_TO_KILL,
    build: (s) => s.hasWeapon && s.hasAmmo && s.seeEnemy && s.enemyInRange,
  },
  { key: WorldProperty.POSITION_HELD, build: (s) => s.inCover && !s.seeEnemy },
  { key: WorldProperty.LOOKED_OUT, build: () => false },
  { key: WorldProperty.AT_TARGET, build: (s) => !s.enemyPresent && !s.hasDanger },
];

/**
 * Build a GOAP WorldState from an NPC data snapshot.
 *
 * This is a pure function: same input → same output.
 * The snapshot captures all relevant NPC data at a single point in time.
 *
 * @param snapshot - Pre-computed NPC data (health, perception, loadout, etc.)
 * @param builders - Optional custom property builders. Defaults to DEFAULT_WORLD_PROPERTY_BUILDERS.
 * @returns A new WorldState populated with properties from the builders
 */
export function buildWorldState(
  snapshot: INPCWorldSnapshot,
  builders?: readonly IWorldPropertyBuilder[],
): WorldState {
  const state = new WorldState();

  for (const b of (builders ?? DEFAULT_WORLD_PROPERTY_BUILDERS)) {
    state.set(b.key, b.build(snapshot));
  }

  return state;
}
