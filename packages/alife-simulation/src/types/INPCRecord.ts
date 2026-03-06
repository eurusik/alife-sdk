/**
 * NPC record types for A-Life simulation.
 *
 * INPCRecord is the authoritative offline representation of an NPC --
 * position, faction, rank, HP, and behavior config. The simulation layer
 * owns these records; the rendering layer reads them via ports.
 */

import type { Vec2, IEntityQuery } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Behavior config
// ---------------------------------------------------------------------------

/** Per-NPC tunable behavior parameters. Loaded from data, never mutated. */
export interface INPCBehaviorConfig {
  /** HP fraction [0-1] at which NPC attempts retreat. */
  readonly retreatThreshold: number;
  /** Morale value [-1,0] at which NPC panics. */
  readonly panicThreshold: number;
  /** Time between search-state scans (ms). */
  readonly searchIntervalMs: number;
  /** Maximum danger level NPC will tolerate before fleeing. */
  readonly dangerTolerance: number;
  /** Aggression factor [0-1]. Higher = prefer offensive actions. */
  readonly aggression: number;
}

/**
 * Create an {@link INPCBehaviorConfig} with sensible defaults.
 * Override only the fields you need.
 *
 * @example
 * registerNPC({
 *   entityId: 'npc_01',
 *   // ...
 *   behaviorConfig: createDefaultBehaviorConfig({ aggression: 0.9 }),
 * });
 */
export function createDefaultBehaviorConfig(
  overrides?: Partial<INPCBehaviorConfig>,
): INPCBehaviorConfig {
  return {
    retreatThreshold:  0.1,
    panicThreshold:    -0.7,
    searchIntervalMs:  5_000,
    dangerTolerance:   3,
    aggression:        0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// NPC Record
// ---------------------------------------------------------------------------

/** Mutable runtime record for a single NPC in the A-Life simulation. */
export interface INPCRecord {
  readonly entityId: string;
  readonly factionId: string;
  combatPower: number;
  currentHp: number;
  rank: number;
  readonly behaviorConfig: INPCBehaviorConfig;
  lastPosition: Vec2;
  isOnline: boolean;
}

// ---------------------------------------------------------------------------
// Rank system
// ---------------------------------------------------------------------------

/** Combat power multiplier per rank (1-5). Index 0 = rank 1. */
export const RANK_MULTIPLIERS: readonly number[] = [0.8, 0.9, 1.0, 1.2, 1.5];

/** Clamp rank to [1,5] and return the corresponding power multiplier. */
export function getRankMultiplier(rank: number): number {
  const idx = Math.max(0, Math.min(4, rank - 1));
  return RANK_MULTIPLIERS[idx] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Job context
// ---------------------------------------------------------------------------

/** Lightweight snapshot of NPC state passed to job scoring functions. */
export interface INPCJobContext {
  readonly npcId: string;
  readonly factionId: string;
  readonly rank: number;
  readonly position: Vec2;
  readonly weaponType?: string;
  readonly equipmentPrefs?: {
    readonly aggressiveness: number;
    readonly cautiousness: number;
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Check NPC liveness via the entity query port. */
export function isNPCRecordAlive(
  record: INPCRecord,
  entityQuery: IEntityQuery,
): boolean {
  return entityQuery.isAlive(record.entityId);
}
