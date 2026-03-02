/**
 * Integration tests for SchemeResolver (condlist).
 *
 * Covers:
 *   - Simple condition always true (day/night/peaceful/alert/combat) → first match wins
 *   - Condition false → falls through to next scheme
 *   - Multiple conditions: first-match (AND logic within one entry via customPredicate)
 *   - Fallback: no condition matches → returns null
 *   - Custom predicate: further filters a matching built-in condition
 *   - Combined day + customPredicate for terrain state
 *   - Scheme resolves to correct scheme string and optional params
 *   - TerrainState values (PEACEFUL / ALERT / COMBAT) in condlist
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * Predicate tracking via plain arrays.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from '../terrain/SchemeResolver';
import { TerrainState } from '../terrain/TerrainStateManager';
import type { ISchemeConditionConfig, ISchemeParams } from '../terrain/SchemeResolver';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SchemeResolver.resolve() — built-in conditions', () => {

  it('day condition resolves when isNight=false', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'patrol_day' },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result).not.toBeNull();
    expect(result!.scheme).toBe('patrol_day');
  });

  it('day condition does NOT resolve when isNight=true', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'patrol_day' },
    ];

    const result = resolve(conditions, true, TerrainState.PEACEFUL);
    expect(result).toBeNull();
  });

  it('night condition resolves when isNight=true', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'sleep_camp' },
    ];

    const result = resolve(conditions, true, TerrainState.PEACEFUL);
    expect(result).not.toBeNull();
    expect(result!.scheme).toBe('sleep_camp');
  });

  it('night condition does NOT resolve when isNight=false', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'sleep_camp' },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result).toBeNull();
  });

  it('peaceful condition resolves when terrainState=PEACEFUL', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'peaceful', scheme: 'idle_patrol' },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result).not.toBeNull();
    expect(result!.scheme).toBe('idle_patrol');
  });

  it('peaceful condition does NOT resolve when terrainState=ALERT', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'peaceful', scheme: 'idle_patrol' },
    ];

    const result = resolve(conditions, false, TerrainState.ALERT);
    expect(result).toBeNull();
  });

  it('alert condition resolves for both ALERT and COMBAT terrain states', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'alert', scheme: 'alert_cover' },
    ];

    // ALERT state
    expect(resolve(conditions, false, TerrainState.ALERT)?.scheme).toBe('alert_cover');
    // COMBAT state (>= ALERT)
    expect(resolve(conditions, false, TerrainState.COMBAT)?.scheme).toBe('alert_cover');
  });

  it('combat condition resolves only for COMBAT terrain state', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'combat', scheme: 'assault' },
    ];

    expect(resolve(conditions, false, TerrainState.PEACEFUL)).toBeNull();
    expect(resolve(conditions, false, TerrainState.ALERT)).toBeNull();
    expect(resolve(conditions, false, TerrainState.COMBAT)?.scheme).toBe('assault');
  });
});

// ---------------------------------------------------------------------------

describe('SchemeResolver.resolve() — first-match semantics', () => {

  it('returns the first matching condition when multiple could match', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'first' },
      { when: 'day', scheme: 'second' }, // also matches but should be skipped
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result!.scheme).toBe('first');
  });

  it('falls through to the next condition when the first does not match', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'night_scheme' },
      { when: 'day', scheme: 'day_scheme' },
    ];

    // isNight = false → night condition skipped, day condition matches
    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result!.scheme).toBe('day_scheme');
  });

  it('returns null when no condition in the list matches', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'night_scheme' },
      { when: 'combat', scheme: 'assault' },
    ];

    // Day + peaceful: neither condition matches
    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result).toBeNull();
  });

  it('empty condlist always returns null', () => {
    expect(resolve([], false, TerrainState.PEACEFUL)).toBeNull();
    expect(resolve([], true, TerrainState.COMBAT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('SchemeResolver.resolve() — params forwarding', () => {

  it('resolved scheme carries the params from the matching condition', () => {
    const params: ISchemeParams = { scanArc: 120, engageRange: 300, alertness: 0.8 };
    const conditions: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'guard_post', params },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result!.params).toEqual(params);
  });

  it('params is null when the matching condition provides no params', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'simple_patrol' },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result!.params).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('SchemeResolver.resolve() — customPredicate (AND logic)', () => {

  it('customPredicate returning true allows the built-in condition to pass', () => {
    const predicateCalls: Array<{ isNight: boolean; terrainState: TerrainState }> = [];

    const conditions: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'sniper_guard',
        customPredicate(ctx) {
          predicateCalls.push({ isNight: ctx.isNight, terrainState: ctx.terrainState });
          return true; // always accept
        },
      },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    expect(result!.scheme).toBe('sniper_guard');
    expect(predicateCalls).toHaveLength(1);
    expect(predicateCalls[0].isNight).toBe(false);
    expect(predicateCalls[0].terrainState).toBe(TerrainState.PEACEFUL);
  });

  it('customPredicate returning false causes the condition to be skipped', () => {
    const conditions: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'blocked_scheme',
        customPredicate: () => false, // always reject
      },
      { when: 'day', scheme: 'fallback_scheme' },
    ];

    const result = resolve(conditions, false, TerrainState.PEACEFUL);
    // First entry rejected by predicate → falls through to second
    expect(result!.scheme).toBe('fallback_scheme');
  });

  it('customPredicate is NOT called when built-in condition already fails', () => {
    const predicateCalls: number[] = [];

    const conditions: ISchemeConditionConfig[] = [
      {
        when: 'night',  // will not match (isNight = false)
        scheme: 'night_guard',
        customPredicate() {
          predicateCalls.push(1);
          return true;
        },
      },
    ];

    resolve(conditions, false, TerrainState.PEACEFUL);
    // Predicate should not be evaluated if the built-in condition fails first
    expect(predicateCalls).toHaveLength(0);
  });

  it('customPredicate can inspect terrainState to differentiate day-peaceful vs day-combat', () => {
    const conditions: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'day_combat_rush',
        customPredicate: (ctx) => ctx.terrainState === TerrainState.COMBAT,
      },
      {
        when: 'day',
        scheme: 'day_patrol',
      },
    ];

    // Day + COMBAT → first entry
    expect(resolve(conditions, false, TerrainState.COMBAT)?.scheme).toBe('day_combat_rush');
    // Day + PEACEFUL → first predicate fails, second matches
    expect(resolve(conditions, false, TerrainState.PEACEFUL)?.scheme).toBe('day_patrol');
  });
});

// ---------------------------------------------------------------------------

describe('SchemeResolver.resolve() — mixed realistic condlist', () => {

  it('realistic day/night/combat condlist selects the right scheme for each context', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'combat', scheme: 'combat_assault' },
      { when: 'alert', scheme: 'heightened_guard' },
      { when: 'night', scheme: 'night_patrol' },
      { when: 'day', scheme: 'day_patrol' },
    ];

    // Combat → first wins
    expect(resolve(conditions, false, TerrainState.COMBAT)?.scheme).toBe('combat_assault');
    // Alert (non-combat) → second wins
    expect(resolve(conditions, false, TerrainState.ALERT)?.scheme).toBe('heightened_guard');
    // Night + peaceful → night_patrol
    expect(resolve(conditions, true, TerrainState.PEACEFUL)?.scheme).toBe('night_patrol');
    // Day + peaceful → day_patrol
    expect(resolve(conditions, false, TerrainState.PEACEFUL)?.scheme).toBe('day_patrol');
  });

  it('condlist with only a night condition returns null during daytime', () => {
    const conditions: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'night_only' },
    ];

    // Daytime → no match
    expect(resolve(conditions, false, TerrainState.PEACEFUL)).toBeNull();
    // Nighttime → match
    expect(resolve(conditions, true, TerrainState.PEACEFUL)?.scheme).toBe('night_only');
  });
});
