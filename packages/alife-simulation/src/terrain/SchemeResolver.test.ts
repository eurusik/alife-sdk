import { vi } from 'vitest';
import { resolve, type ISchemeConditionConfig } from './SchemeResolver';
import { TerrainState } from './TerrainStateManager';

describe('SchemeResolver', () => {
  // -----------------------------------------------------------------------
  // Time-of-day conditions
  // -----------------------------------------------------------------------
  it('matches "day" when isNight is false', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'guard' },
    ];
    const result = resolve(conds, false, TerrainState.PEACEFUL);
    expect(result).toEqual({ scheme: 'guard', params: null });
  });

  it('does not match "day" when isNight is true', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'day', scheme: 'guard' },
    ];
    expect(resolve(conds, true, TerrainState.PEACEFUL)).toBeNull();
  });

  it('matches "night" when isNight is true', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'sleep' },
    ];
    const result = resolve(conds, true, TerrainState.PEACEFUL);
    expect(result).toEqual({ scheme: 'sleep', params: null });
  });

  // -----------------------------------------------------------------------
  // Terrain state conditions
  // -----------------------------------------------------------------------
  it('matches "combat" only in COMBAT state', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'combat', scheme: 'camper' },
    ];

    expect(resolve(conds, false, TerrainState.COMBAT)).toEqual({
      scheme: 'camper',
      params: null,
    });
    expect(resolve(conds, false, TerrainState.ALERT)).toBeNull();
    expect(resolve(conds, false, TerrainState.PEACEFUL)).toBeNull();
  });

  it('matches "alert" in ALERT and COMBAT states', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'alert', scheme: 'patrol' },
    ];

    expect(resolve(conds, false, TerrainState.ALERT)).toEqual({
      scheme: 'patrol',
      params: null,
    });
    expect(resolve(conds, false, TerrainState.COMBAT)).toEqual({
      scheme: 'patrol',
      params: null,
    });
    expect(resolve(conds, false, TerrainState.PEACEFUL)).toBeNull();
  });

  it('matches "peaceful" only in PEACEFUL state', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'peaceful', scheme: 'wander' },
    ];

    expect(resolve(conds, false, TerrainState.PEACEFUL)).toEqual({
      scheme: 'wander',
      params: null,
    });
    expect(resolve(conds, false, TerrainState.ALERT)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // First-match semantics
  // -----------------------------------------------------------------------
  it('returns the first matching condition', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'combat', scheme: 'camper' },
      { when: 'alert', scheme: 'patrol' },
      { when: 'day', scheme: 'guard' },
    ];

    // COMBAT -> first match is 'combat'
    expect(resolve(conds, false, TerrainState.COMBAT)!.scheme).toBe('camper');

    // ALERT -> 'combat' fails, 'alert' matches
    expect(resolve(conds, false, TerrainState.ALERT)!.scheme).toBe('patrol');

    // PEACEFUL, day -> 'combat' fails, 'alert' fails, 'day' matches
    expect(resolve(conds, false, TerrainState.PEACEFUL)!.scheme).toBe('guard');
  });

  // -----------------------------------------------------------------------
  // Params
  // -----------------------------------------------------------------------
  it('returns params when provided', () => {
    const conds: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'guard',
        params: { scanArc: 120, engageRange: 300 },
      },
    ];

    const result = resolve(conds, false, TerrainState.PEACEFUL);
    expect(result).toEqual({
      scheme: 'guard',
      params: { scanArc: 120, engageRange: 300 },
    });
  });

  // -----------------------------------------------------------------------
  // Custom predicates
  // -----------------------------------------------------------------------
  it('accepts when customPredicate returns true', () => {
    const conds: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'special_guard',
        customPredicate: (ctx) => ctx.terrainState === TerrainState.PEACEFUL,
      },
    ];

    const result = resolve(conds, false, TerrainState.PEACEFUL);
    expect(result).toEqual({ scheme: 'special_guard', params: null });
  });

  it('rejects when customPredicate returns false', () => {
    const conds: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'special_guard',
        customPredicate: () => false,
      },
    ];

    expect(resolve(conds, false, TerrainState.PEACEFUL)).toBeNull();
  });

  it('skips to next condition when customPredicate rejects', () => {
    const conds: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'elite_guard',
        customPredicate: () => false,
      },
      { when: 'day', scheme: 'regular_guard' },
    ];

    const result = resolve(conds, false, TerrainState.PEACEFUL);
    expect(result).toEqual({ scheme: 'regular_guard', params: null });
  });

  it('does not call customPredicate if built-in when fails', () => {
    const predicate = vi.fn(() => true);
    const conds: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'night_patrol', customPredicate: predicate },
    ];

    resolve(conds, false, TerrainState.PEACEFUL);
    expect(predicate).not.toHaveBeenCalled();
  });

  it('passes correct context to customPredicate', () => {
    let capturedCtx: unknown = null;
    const conds: ISchemeConditionConfig[] = [
      {
        when: 'day',
        scheme: 'test',
        customPredicate: (ctx) => { capturedCtx = ctx; return true; },
      },
    ];

    resolve(conds, false, TerrainState.ALERT);
    expect(capturedCtx).toEqual({
      isNight: false,
      terrainState: TerrainState.ALERT,
    });
  });

  // -----------------------------------------------------------------------
  // Empty list
  // -----------------------------------------------------------------------
  it('returns null for empty conditions', () => {
    expect(resolve([], false, TerrainState.PEACEFUL)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Exhaustiveness guard (bug audit fix: unknown ConditionKind)
  // -----------------------------------------------------------------------
  it('returns null for unknown ConditionKind', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'siege' as ConditionKind, scheme: 'siege_guard' },
    ];
    // Unknown kinds should silently return false (not match), resulting in null.
    expect(resolve(conds, false, TerrainState.PEACEFUL)).toBeNull();
    expect(resolve(conds, true, TerrainState.COMBAT)).toBeNull();
  });

  it('skips unknown ConditionKind and matches the next valid one', () => {
    const conds: ISchemeConditionConfig[] = [
      { when: 'unknown_kind' as ConditionKind, scheme: 'broken' },
      { when: 'day', scheme: 'fallback_guard' },
    ];

    const result = resolve(conds, false, TerrainState.PEACEFUL);
    expect(result).toEqual({ scheme: 'fallback_guard', params: null });
  });
});
