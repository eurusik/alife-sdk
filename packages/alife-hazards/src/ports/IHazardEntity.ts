import type { Vec2 } from '@alife-sdk/core';

/**
 * Minimal entity interface for hazard zone damage calculation.
 *
 * `immunity` is an optional map of damage-type-id → resistance [0, 1].
 * Resistance 1.0 = full immunity (no damage, no event).
 * Resistance 0.5 = 50% reduction.
 * Damage type id matches `IHazardZoneConfig.type`.
 */
export interface IHazardEntity {
  readonly id: string;
  readonly position: Vec2;
  readonly immunity?: ReadonlyMap<string, number>;
  isAlive?(): boolean;
}
