// types/IPerceptionTypes.ts
// Value objects for the perception subsystem.

import type { Vec2 } from '@alife-sdk/core';

/**
 * An entity as perceived by the perception system.
 * Minimal data — host provides via IPerceptionProvider port.
 */
export interface IPerceivedEntity {
  readonly entityId: string;
  readonly position: Vec2;
  readonly factionId: string;
  readonly isAlive: boolean;
}

/**
 * Perception configuration constants.
 */
export interface IPerceptionConfig {
  /** Maximum vision distance (px). */
  readonly visionRange: number;
  /** Half-angle of the vision cone (radians). Full FOV = 2× this value. */
  readonly visionHalfAngle: number;
  /** Maximum hearing range (px). */
  readonly hearingRange: number;
  /** Gunshot sound propagation radius (px). */
  readonly weaponSoundRange: number;
}

/**
 * GOAP controller configuration constants.
 */
export interface IGOAPConfig {
  /** Time between periodic replans (ms). */
  readonly replanIntervalMs: number;
  /** Minimum NPC rank for GOAP eligibility. */
  readonly eliteRankThreshold: number;
  /** HP ratio below which the heal goal is prioritized. */
  readonly healHpThreshold: number;
  /** Maximum plan search depth. */
  readonly maxPlanDepth: number;
  /** Time after which danger memories are considered stale (ms). */
  readonly dangerMemoryMaxAge: number;
}

/**
 * World state property keys used by the GOAP subsystem.
 * String-based for compatibility with alife-core WorldState.
 */
export const WorldProperty = {
  ALIVE: 'alive',
  ENEMY_PRESENT: 'enemyPresent',
  SEE_ENEMY: 'seeEnemy',
  ENEMY_SEE_ME: 'enemySeeMe',
  HAS_WEAPON: 'hasWeapon',
  READY_TO_KILL: 'readyToKill',
  IN_COVER: 'inCover',
  CRITICALLY_WOUNDED: 'criticallyWounded',
  ENEMY_WOUNDED: 'enemyWounded',
  DANGER: 'danger',
  DANGER_GRENADE: 'dangerGrenade',
  HAS_AMMO: 'hasAmmo',
  LOOKED_OUT: 'lookedOut',
  POSITION_HELD: 'positionHeld',
  ENEMY_IN_RANGE: 'enemyInRange',
  AT_TARGET: 'atTarget',
  ANOMALY_NEAR: 'anomalyNear',
} as const;

export type WorldPropertyKey = (typeof WorldProperty)[keyof typeof WorldProperty];

/**
 * Snapshot of NPC data used to build GOAP world state.
 * All fields are readonly — the builder is a pure function.
 */
export interface INPCWorldSnapshot {
  readonly isAlive: boolean;
  readonly hpRatio: number;
  readonly hasWeapon: boolean;
  readonly hasAmmo: boolean;
  readonly inCover: boolean;
  readonly seeEnemy: boolean;
  readonly enemyPresent: boolean;
  readonly enemyInRange: boolean;
  readonly hasDanger: boolean;
  readonly hasDangerGrenade: boolean;
  readonly enemyWounded: boolean;
  readonly nearAnomalyZone: boolean;
}

/**
 * Priority band for goal selection.
 * Lower band number = higher priority.
 */
export const GoalPriority = {
  CRITICALLY_WOUNDED: 0,
  ENEMY_PRESENT: 1,
  DANGER: 2,
  ANOMALY_AVOID: 3,
  DEFAULT: 4,
} as const;

export type GoalPriorityLevel = (typeof GoalPriority)[keyof typeof GoalPriority];
