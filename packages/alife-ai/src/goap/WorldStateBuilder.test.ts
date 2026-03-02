import { describe, it, expect } from 'vitest';
import { buildWorldState, DEFAULT_WORLD_PROPERTY_BUILDERS } from './WorldStateBuilder';
import type { IWorldPropertyBuilder } from './WorldStateBuilder';
import { WorldProperty, type INPCWorldSnapshot } from '../types/IPerceptionTypes';

function makeSnapshot(overrides?: Partial<INPCWorldSnapshot>): INPCWorldSnapshot {
  return {
    isAlive: true,
    hpRatio: 1.0,
    hasWeapon: true,
    hasAmmo: true,
    inCover: false,
    seeEnemy: false,
    enemyPresent: false,
    enemyInRange: false,
    hasDanger: false,
    hasDangerGrenade: false,
    enemyWounded: false,
    nearAnomalyZone: false,
    ...overrides,
  };
}

describe('buildWorldState', () => {
  it('sets all 17 properties', () => {
    const state = buildWorldState(makeSnapshot());
    for (const key of Object.values(WorldProperty)) {
      expect(state.has(key)).toBe(true);
    }
  });

  it('sets ALIVE from snapshot', () => {
    const alive = buildWorldState(makeSnapshot({ isAlive: true }));
    expect(alive.get(WorldProperty.ALIVE)).toBe(true);

    const dead = buildWorldState(makeSnapshot({ isAlive: false }));
    expect(dead.get(WorldProperty.ALIVE)).toBe(false);
  });

  it('sets CRITICALLY_WOUNDED at 30% HP', () => {
    const healthy = buildWorldState(makeSnapshot({ hpRatio: 0.5 }));
    expect(healthy.get(WorldProperty.CRITICALLY_WOUNDED)).toBe(false);

    const wounded = buildWorldState(makeSnapshot({ hpRatio: 0.3 }));
    expect(wounded.get(WorldProperty.CRITICALLY_WOUNDED)).toBe(true);

    const critical = buildWorldState(makeSnapshot({ hpRatio: 0.1 }));
    expect(critical.get(WorldProperty.CRITICALLY_WOUNDED)).toBe(true);
  });

  it('computes READY_TO_KILL correctly', () => {
    const ready = buildWorldState(makeSnapshot({
      hasWeapon: true,
      hasAmmo: true,
      seeEnemy: true,
      enemyInRange: true,
    }));
    expect(ready.get(WorldProperty.READY_TO_KILL)).toBe(true);

    const notReady = buildWorldState(makeSnapshot({
      hasWeapon: true,
      hasAmmo: false,
      seeEnemy: true,
      enemyInRange: true,
    }));
    expect(notReady.get(WorldProperty.READY_TO_KILL)).toBe(false);
  });

  it('computes POSITION_HELD correctly', () => {
    const held = buildWorldState(makeSnapshot({ inCover: true, seeEnemy: false }));
    expect(held.get(WorldProperty.POSITION_HELD)).toBe(true);

    const notHeld = buildWorldState(makeSnapshot({ inCover: true, seeEnemy: true }));
    expect(notHeld.get(WorldProperty.POSITION_HELD)).toBe(false);
  });

  it('computes AT_TARGET correctly', () => {
    const atTarget = buildWorldState(makeSnapshot({ enemyPresent: false, hasDanger: false }));
    expect(atTarget.get(WorldProperty.AT_TARGET)).toBe(true);

    const notAtTarget = buildWorldState(makeSnapshot({ enemyPresent: true }));
    expect(notAtTarget.get(WorldProperty.AT_TARGET)).toBe(false);
  });

  it('LOOKED_OUT is always false', () => {
    const state = buildWorldState(makeSnapshot());
    expect(state.get(WorldProperty.LOOKED_OUT)).toBe(false);
  });

  it('nearAnomalyZone=true → ANOMALY_NEAR = true', () => {
    const state = buildWorldState(makeSnapshot({ nearAnomalyZone: true }));
    expect(state.get(WorldProperty.ANOMALY_NEAR)).toBe(true);
  });

  it('nearAnomalyZone=false → ANOMALY_NEAR = false', () => {
    const state = buildWorldState(makeSnapshot({ nearAnomalyZone: false }));
    expect(state.get(WorldProperty.ANOMALY_NEAR)).toBe(false);
  });

  it('ENEMY_SEE_ME mirrors SEE_ENEMY', () => {
    const seeing = buildWorldState(makeSnapshot({ seeEnemy: true }));
    expect(seeing.get(WorldProperty.ENEMY_SEE_ME)).toBe(true);

    const notSeeing = buildWorldState(makeSnapshot({ seeEnemy: false }));
    expect(notSeeing.get(WorldProperty.ENEMY_SEE_ME)).toBe(false);
  });

  it('passes through direct properties', () => {
    const state = buildWorldState(makeSnapshot({
      hasDanger: true,
      hasDangerGrenade: true,
      enemyWounded: true,
    }));
    expect(state.get(WorldProperty.DANGER)).toBe(true);
    expect(state.get(WorldProperty.DANGER_GRENADE)).toBe(true);
    expect(state.get(WorldProperty.ENEMY_WOUNDED)).toBe(true);
  });
});

describe('buildWorldState with custom builders', () => {
  it('uses only custom builders when provided', () => {
    const customBuilders: IWorldPropertyBuilder[] = [
      { key: 'custom_a', build: () => true },
      { key: 'custom_b', build: (s) => s.hpRatio > 0.5 },
      { key: 'custom_c', build: (s) => s.isAlive && s.hasWeapon },
    ];
    const state = buildWorldState(makeSnapshot({ hpRatio: 0.8 }), customBuilders);

    expect(state.has('custom_a')).toBe(true);
    expect(state.get('custom_a')).toBe(true);
    expect(state.get('custom_b')).toBe(true);
    expect(state.get('custom_c')).toBe(true);
    // Default properties should NOT be present
    expect(state.has(WorldProperty.ALIVE)).toBe(false);
  });

  it('custom builders can extend defaults with additional properties', () => {
    const extendedBuilders: readonly IWorldPropertyBuilder[] = [
      ...DEFAULT_WORLD_PROPERTY_BUILDERS,
      { key: 'has_flashlight', build: () => true },
      { key: 'is_sneaking', build: (s) => !s.seeEnemy && s.inCover },
    ];
    const state = buildWorldState(
      makeSnapshot({ inCover: true, seeEnemy: false }),
      extendedBuilders,
    );

    // All 16 default properties still present
    for (const key of Object.values(WorldProperty)) {
      expect(state.has(key)).toBe(true);
    }
    // Plus custom ones
    expect(state.get('has_flashlight')).toBe(true);
    expect(state.get('is_sneaking')).toBe(true);
  });

  it('DEFAULT_WORLD_PROPERTY_BUILDERS has exactly 17 entries', () => {
    expect(DEFAULT_WORLD_PROPERTY_BUILDERS).toHaveLength(17);
  });

  it('explicit DEFAULT_WORLD_PROPERTY_BUILDERS produces same result as no builders param', () => {
    const snapshot = makeSnapshot({
      isAlive: true,
      hpRatio: 0.5,
      hasWeapon: true,
      hasAmmo: true,
      inCover: true,
      seeEnemy: true,
      enemyPresent: true,
      enemyInRange: false,
      hasDanger: true,
      hasDangerGrenade: false,
      enemyWounded: true,
    });
    const stateDefault = buildWorldState(snapshot);
    const stateExplicit = buildWorldState(snapshot, DEFAULT_WORLD_PROPERTY_BUILDERS);

    for (const key of Object.values(WorldProperty)) {
      expect(stateExplicit.get(key)).toBe(stateDefault.get(key));
    }
  });
});
