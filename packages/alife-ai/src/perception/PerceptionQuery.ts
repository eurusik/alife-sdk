// perception/PerceptionQuery.ts
// Pure math functions for spatial perception queries.
// No side effects, no state — all functions are deterministic.

import type { Vec2 } from '@alife-sdk/core';
import type { IPerceivedEntity, IPerceptionConfig } from '../types/IPerceptionTypes';

// ---------------------------------------------------------------------------
// Reusable scratch arrays — one per filter function.
// Single-threaded, safe to reuse between calls.
// ---------------------------------------------------------------------------
const _visibleScratch: IPerceivedEntity[] = [];
const _hearingScratch: IPerceivedEntity[] = [];
const _hostileScratch: IPerceivedEntity[] = [];
const _friendlyScratch: IPerceivedEntity[] = [];

/**
 * Check if a target is within a vision cone.
 *
 * Uses squared-distance for the range check (no sqrt).
 * The vision cone is defined by a half-angle from the facing direction.
 *
 * @returns true if target is within range AND within the cone angle
 */
export function isInFOV(
  origin: Vec2,
  facingAngle: number,
  target: Vec2,
  visionRange: number,
  visionHalfAngle: number,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dSq = dx * dx + dy * dy;

  if (dSq > visionRange * visionRange) return false;
  if (dSq === 0) return true;

  // Dot-product cone test — avoids Math.atan2 + normalizeAngle
  const facingDx = Math.cos(facingAngle);
  const facingDy = Math.sin(facingAngle);
  const dot = dx * facingDx + dy * facingDy;
  if (dot <= 0) return false;

  const cosHalfSq = Math.cos(visionHalfAngle) ** 2;
  return dot * dot >= cosHalfSq * dSq;
}

/**
 * Filter entities that are visible to the observer.
 *
 * Combines FOV cone test with alive check.
 * O(n) where n = candidate count.
 * Precomputes trig values once per call (same pattern as scanForEnemies).
 * Returns a reusable scratch array — do not hold a reference across calls.
 */
export function filterVisibleEntities(
  origin: Vec2,
  facingAngle: number,
  candidates: readonly IPerceivedEntity[],
  config: IPerceptionConfig,
): IPerceivedEntity[] {
  _visibleScratch.length = 0;

  const rangeSq = config.visionRange * config.visionRange;

  // Precompute trig once per observer — avoids per-entity cos/sin in isInFOV
  const facingDx = Math.cos(facingAngle);
  const facingDy = Math.sin(facingAngle);
  const cosHalfSq = Math.cos(config.visionHalfAngle) ** 2;

  for (const entity of candidates) {
    if (!entity.isAlive) continue;

    const dx = entity.position.x - origin.x;
    const dy = entity.position.y - origin.y;
    const dSq = dx * dx + dy * dy;

    if (dSq > rangeSq) continue;
    if (dSq === 0) {
      _visibleScratch.push(entity);
      continue;
    }

    // Dot-product cone test
    const dot = dx * facingDx + dy * facingDy;
    if (dot > 0 && dot * dot >= cosHalfSq * dSq) {
      _visibleScratch.push(entity);
    }
  }
  return _visibleScratch;
}

/**
 * Filter entities that can hear a sound from a source.
 *
 * Sound is omnidirectional — no cone test, just distance.
 * Uses squared-distance for performance.
 * Returns a reusable scratch array — do not hold a reference across calls.
 *
 * @param source - Sound origin point
 * @param soundRange - Maximum propagation range (px)
 * @param entities - All candidate listeners
 * @param hearingRange - Per-listener hearing range (overrides soundRange if smaller)
 */
export function filterHearingEntities(
  source: Vec2,
  soundRange: number,
  entities: readonly IPerceivedEntity[],
  hearingRange?: number,
): IPerceivedEntity[] {
  _hearingScratch.length = 0;

  const effectiveRange = hearingRange !== undefined
    ? Math.min(soundRange, hearingRange)
    : soundRange;
  const rangeSq = effectiveRange * effectiveRange;

  for (const entity of entities) {
    if (!entity.isAlive) continue;
    const dx = entity.position.x - source.x;
    const dy = entity.position.y - source.y;
    if (dx * dx + dy * dy <= rangeSq) {
      _hearingScratch.push(entity);
    }
  }
  return _hearingScratch;
}

/**
 * Filter entities by faction hostility.
 * Returns a reusable scratch array — do not hold a reference across calls.
 *
 * @param entities - Entity candidates
 * @param observerFactionId - The observer's faction
 * @param isHostile - Callback checking if two factions are hostile
 */
export function filterHostileEntities(
  entities: readonly IPerceivedEntity[],
  observerFactionId: string,
  isHostile: (factionA: string, factionB: string) => boolean,
): IPerceivedEntity[] {
  _hostileScratch.length = 0;
  for (const entity of entities) {
    if (entity.factionId === observerFactionId) continue;
    if (isHostile(observerFactionId, entity.factionId)) {
      _hostileScratch.push(entity);
    }
  }
  return _hostileScratch;
}

/**
 * Filter entities that are friendlies (same faction OR non-hostile).
 * Returns a reusable scratch array — do not hold a reference across calls.
 */
export function filterFriendlyEntities(
  entities: readonly IPerceivedEntity[],
  observerFactionId: string,
  isHostile: (factionA: string, factionB: string) => boolean,
): IPerceivedEntity[] {
  _friendlyScratch.length = 0;
  for (const entity of entities) {
    if (entity.factionId === observerFactionId) {
      _friendlyScratch.push(entity);
      continue;
    }
    if (!isHostile(observerFactionId, entity.factionId)) {
      _friendlyScratch.push(entity);
    }
  }
  return _friendlyScratch;
}

/**
 * Calculate squared distance between two points.
 * Avoid sqrt when only comparing relative distances.
 */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Find the closest entity to a position.
 * Returns null if array is empty.
 */
export function findClosest(
  origin: Vec2,
  entities: readonly IPerceivedEntity[],
): IPerceivedEntity | null {
  let best: IPerceivedEntity | null = null;
  let bestDist = Infinity;

  for (const entity of entities) {
    const dist = distanceSq(origin, entity.position);
    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }

  return best;
}

/**
 * Full perception scan: find visible hostile entities.
 *
 * Combines FOV filtering + faction filtering in a single pass.
 * This is the primary query used by GOAP world state building.
 */
export function scanForEnemies(
  origin: Vec2,
  facingAngle: number,
  candidates: readonly IPerceivedEntity[],
  observerFactionId: string,
  isHostile: (factionA: string, factionB: string) => boolean,
  config: IPerceptionConfig,
): IPerceivedEntity[] {
  const result: IPerceivedEntity[] = [];
  const rangeSq = config.visionRange * config.visionRange;

  // Precompute once per observer — avoid per-entity atan2
  const facingDx = Math.cos(facingAngle);
  const facingDy = Math.sin(facingAngle);
  const cosHalfSq = Math.cos(config.visionHalfAngle) ** 2;

  for (const entity of candidates) {
    if (!entity.isAlive) continue;
    if (entity.factionId === observerFactionId) continue;
    if (!isHostile(observerFactionId, entity.factionId)) continue;

    const dx = entity.position.x - origin.x;
    const dy = entity.position.y - origin.y;
    const dSq = dx * dx + dy * dy;

    if (dSq > rangeSq) continue;
    if (dSq === 0) {
      result.push(entity);
      continue;
    }

    // Dot-product cone test
    const dot = dx * facingDx + dy * facingDy;
    if (dot > 0 && dot * dot >= cosHalfSq * dSq) {
      result.push(entity);
    }
  }

  return result;
}
