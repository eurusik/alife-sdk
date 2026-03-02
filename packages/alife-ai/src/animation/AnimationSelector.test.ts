import { describe, it, expect } from 'vitest';
import {
  getDirection,
  getAnimationKey,
  getAnimationRequest,
  CompassIndex,
  AnimLayer,
  DEFAULT_STATE_ANIM_MAP,
  DEFAULT_WEAPON_SUFFIXES,
} from './AnimationSelector';
import type { IAnimDescriptor } from './AnimationSelector';
import { WeaponCategory } from '../types/IWeaponTypes';

describe('getDirection', () => {
  it('returns S for zero velocity', () => {
    expect(getDirection(0, 0)).toBe(CompassIndex.S);
  });

  it('returns E for rightward movement', () => {
    expect(getDirection(100, 0)).toBe(CompassIndex.E);
  });

  it('returns W for leftward movement', () => {
    expect(getDirection(-100, 0)).toBe(CompassIndex.W);
  });

  it('returns N for upward movement (negative Y)', () => {
    expect(getDirection(0, -100)).toBe(CompassIndex.N);
  });

  it('returns S for downward movement (positive Y)', () => {
    expect(getDirection(0, 100)).toBe(CompassIndex.S);
  });

  it('returns NE for diagonal up-right', () => {
    expect(getDirection(100, -100)).toBe(CompassIndex.NE);
  });

  it('returns SW for diagonal down-left', () => {
    expect(getDirection(-100, 100)).toBe(CompassIndex.SW);
  });

  it('handles very small velocities as zero', () => {
    expect(getDirection(0.001, 0.001)).toBe(CompassIndex.S);
  });
});

describe('getAnimationKey', () => {
  it('builds key with direction', () => {
    const key = getAnimationKey('PATROL', WeaponCategory.RIFLE, CompassIndex.E);
    expect(key).toBe('walk_rifle_E');
  });

  it('builds key without direction for DEAD', () => {
    const key = getAnimationKey('DEAD', WeaponCategory.RIFLE, CompassIndex.E);
    expect(key).toBe('death_rifle');
  });

  it('uses unarmed suffix for GRENADE weapon type', () => {
    const key = getAnimationKey('IDLE', WeaponCategory.GRENADE, CompassIndex.S);
    expect(key).toBe('idle_unarmed_S');
  });

  it('uses unarmed suffix for MEDKIT weapon type', () => {
    const key = getAnimationKey('IDLE', WeaponCategory.MEDKIT, CompassIndex.N);
    expect(key).toBe('idle_unarmed_N');
  });

  it('falls back to rifle for unknown weapon', () => {
    const key = getAnimationKey('IDLE', 99 as any, CompassIndex.S);
    expect(key).toBe('idle_rifle_S');
  });

  it('falls back to idle for unknown state', () => {
    const key = getAnimationKey('UNKNOWN_STATE', WeaponCategory.RIFLE, CompassIndex.S);
    expect(key).toBe('idle_rifle_S');
  });

  it('handles combat state', () => {
    const key = getAnimationKey('COMBAT', WeaponCategory.SHOTGUN, CompassIndex.NW);
    expect(key).toBe('combat_shotgun_NW');
  });

  it('handles wound state', () => {
    const key = getAnimationKey('WOUNDED', WeaponCategory.PISTOL, CompassIndex.SE);
    expect(key).toBe('crawl_pistol_SE');
  });

  it('handles grenade throw (omit direction)', () => {
    const key = getAnimationKey('GRENADE', WeaponCategory.RIFLE, CompassIndex.E);
    expect(key).toBe('throw_rifle');
  });

  it('handles monster charge', () => {
    const key = getAnimationKey('CHARGE', WeaponCategory.PISTOL, CompassIndex.E);
    expect(key).toBe('charge_pistol_E');
  });
});

describe('getAnimationRequest', () => {
  it('returns complete request for PATROL', () => {
    const req = getAnimationRequest({ state: 'PATROL', weaponCategory: WeaponCategory.RIFLE, velocity: { x: 100, y: 0 } });
    expect(req.key).toBe('walk_rifle_E');
    expect(req.loop).toBe(true);
    expect(req.frameRate).toBe(10);
    expect(req.layer).toBe(AnimLayer.LEGS);
  });

  it('returns complete request for COMBAT', () => {
    const req = getAnimationRequest({ state: 'COMBAT', weaponCategory: WeaponCategory.SHOTGUN, velocity: { x: 0, y: 100 } });
    expect(req.key).toBe('combat_shotgun_S');
    expect(req.loop).toBe(false);
    expect(req.frameRate).toBe(12);
    expect(req.layer).toBe(AnimLayer.TORSO);
  });

  it('returns complete request for FLEE', () => {
    const req = getAnimationRequest({ state: 'FLEE', weaponCategory: WeaponCategory.PISTOL, velocity: { x: -100, y: 0 } });
    expect(req.key).toBe('run_pistol_W');
    expect(req.loop).toBe(true);
    expect(req.frameRate).toBe(14);
  });

  it('returns complete request for DEAD (no direction)', () => {
    const req = getAnimationRequest({ state: 'DEAD', weaponCategory: WeaponCategory.RIFLE, velocity: { x: 0, y: 0 } });
    expect(req.key).toBe('death_rifle');
    expect(req.loop).toBe(false);
    expect(req.frameRate).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Configurable maps tests
// ---------------------------------------------------------------------------
describe('custom animMap', () => {
  const customMap: Readonly<Record<string, IAnimDescriptor>> = {
    FORAGE: { base: 'forage', loop: true, frameRate: 6, layer: AnimLayer.LEGS, omitDirection: false },
    BURROW: { base: 'burrow', loop: false, frameRate: 8, layer: AnimLayer.LEGS, omitDirection: true },
  };

  it('getAnimationKey uses custom animMap for known state', () => {
    const key = getAnimationKey('FORAGE', WeaponCategory.RIFLE, CompassIndex.E, customMap);
    expect(key).toBe('forage_rifle_E');
  });

  it('getAnimationKey uses custom animMap with omitDirection', () => {
    const key = getAnimationKey('BURROW', WeaponCategory.PISTOL, CompassIndex.N, customMap);
    expect(key).toBe('burrow_pistol');
  });

  it('getAnimationKey falls back to idle for unknown state in custom map', () => {
    const key = getAnimationKey('PATROL', WeaponCategory.RIFLE, CompassIndex.S, customMap);
    expect(key).toBe('idle_rifle_S');
  });

  it('getAnimationRequest uses custom animMap', () => {
    const req = getAnimationRequest({ state: 'FORAGE', weaponCategory: WeaponCategory.SHOTGUN, velocity: { x: 100, y: 0 }, animMap: customMap });
    expect(req.key).toBe('forage_shotgun_E');
    expect(req.loop).toBe(true);
    expect(req.frameRate).toBe(6);
    expect(req.layer).toBe(AnimLayer.LEGS);
  });
});

describe('custom weaponSuffixes', () => {
  const customSuffixes: Readonly<Record<string, string>> = {
    '0': 'handgun',
    'laser': 'laser_gun',
  };

  it('getAnimationKey uses custom suffix for numeric category', () => {
    const key = getAnimationKey('IDLE', 0, CompassIndex.S, undefined, customSuffixes);
    expect(key).toBe('idle_handgun_S');
  });

  it('getAnimationKey uses custom suffix for string category', () => {
    const key = getAnimationKey('IDLE', 'laser', CompassIndex.E, undefined, customSuffixes);
    expect(key).toBe('idle_laser_gun_E');
  });

  it('getAnimationKey falls back to rifle for unknown category in custom suffixes', () => {
    const key = getAnimationKey('IDLE', 99, CompassIndex.S, undefined, customSuffixes);
    expect(key).toBe('idle_rifle_S');
  });

  it('getAnimationRequest uses custom weaponSuffixes', () => {
    const req = getAnimationRequest({ state: 'PATROL', weaponCategory: 'laser', velocity: { x: 0, y: 100 }, weaponSuffixes: customSuffixes });
    expect(req.key).toBe('walk_laser_gun_S');
  });
});

describe('DEFAULT_STATE_ANIM_MAP and DEFAULT_WEAPON_SUFFIXES exports', () => {
  it('DEFAULT_STATE_ANIM_MAP has expected entries', () => {
    expect(DEFAULT_STATE_ANIM_MAP.IDLE).toBeDefined();
    expect(DEFAULT_STATE_ANIM_MAP.COMBAT).toBeDefined();
    expect(DEFAULT_STATE_ANIM_MAP.CHARGE).toBeDefined();
    expect(DEFAULT_STATE_ANIM_MAP.IDLE.base).toBe('idle');
  });

  it('DEFAULT_WEAPON_SUFFIXES has expected string keys', () => {
    expect(DEFAULT_WEAPON_SUFFIXES['0']).toBe('pistol');
    expect(DEFAULT_WEAPON_SUFFIXES['2']).toBe('rifle');
    expect(DEFAULT_WEAPON_SUFFIXES['5']).toBe('unarmed');
  });
});
