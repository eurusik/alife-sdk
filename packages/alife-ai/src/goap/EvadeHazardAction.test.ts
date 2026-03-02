import { describe, it, expect } from 'vitest';
import { ActionStatus, type IEntity } from '@alife-sdk/core';
import { EvadeHazardAction } from './EvadeHazardAction';
import type { IHazardZoneAccess } from './IHazardZoneAccess';
import { WorldProperty } from '../types/IPerceptionTypes';

const PROP_KEY = WorldProperty.ANOMALY_NEAR;
const ACTION_ID = 'evade_anomaly';

function makeEntity(x = 100, y = 100): IEntity {
  return {
    id: 'npc_1',
    entityType: 'npc',
    isAlive: true,
    x,
    y,
    active: true,
    setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; },
    setActive() { return this; },
    setVisible() { return this; },
    hasComponent() { return false; },
    getComponent<T>(): T { throw new Error('no components'); },
  };
}

function makeHazard(overrides: Partial<IHazardZoneAccess> = {}): IHazardZoneAccess {
  return {
    isNearHazard: () => true,
    getEscapeDirection: () => ({ x: 1, y: 0 }),
    ...overrides,
  };
}

function makeAction(hazard = makeHazard(), speed?: number, cost?: number): EvadeHazardAction {
  return new EvadeHazardAction(hazard, ACTION_ID, PROP_KEY, speed, cost);
}

describe('EvadeHazardAction', () => {
  it('getPreconditions() → { [propertyKey]: true }', () => {
    const action = makeAction();
    const pre = action.getPreconditions();
    expect(pre.get(PROP_KEY)).toBe(true);
  });

  it('getEffects() → { [propertyKey]: false }', () => {
    const action = makeAction();
    const eff = action.getEffects();
    expect(eff.get(PROP_KEY)).toBe(false);
  });

  it('id is assigned from constructor param', () => {
    const action = makeAction();
    expect(action.id).toBe(ACTION_ID);
  });

  it('isValid() delegates to hazard.isNearHazard(entity.x, entity.y)', () => {
    let capturedX = -1;
    let capturedY = -1;
    const hazard = makeHazard({
      isNearHazard(x, y) { capturedX = x; capturedY = y; return true; },
    });
    const action = makeAction(hazard);
    const entity = makeEntity(42, 99);

    action.isValid(entity);

    expect(capturedX).toBe(42);
    expect(capturedY).toBe(99);
  });

  it('isValid() returns false when entity is not near hazard', () => {
    const action = makeAction(makeHazard({ isNearHazard: () => false }));
    expect(action.isValid(makeEntity())).toBe(false);
  });

  it('execute() when escape=null (already clear) → SUCCESS, no movement', () => {
    const action = makeAction(makeHazard({ getEscapeDirection: () => null }));
    const entity = makeEntity(100, 100);

    const status = action.execute(entity, 100);

    expect(status).toBe(ActionStatus.SUCCESS);
    expect(entity.x).toBe(100);
    expect(entity.y).toBe(100);
  });

  it('execute() when near → moves entity, returns RUNNING', () => {
    const hazard = makeHazard({
      getEscapeDirection: () => ({ x: 1, y: 0 }),
      isNearHazard: () => true,
    });
    const action = makeAction(hazard, 120);
    const entity = makeEntity(100, 100);

    const status = action.execute(entity, 1000); // 1 second

    expect(status).toBe(ActionStatus.RUNNING);
    expect(entity.x).toBeCloseTo(220); // 100 + 120 * 1.0
    expect(entity.y).toBeCloseTo(100);
  });

  it('execute() once entity is clear → returns SUCCESS', () => {
    let callCount = 0;
    const hazard = makeHazard({
      getEscapeDirection: () => ({ x: 0, y: 1 }),
      isNearHazard: () => { callCount++; return callCount < 2; }, // clear after move
    });
    const action = makeAction(hazard);
    const entity = makeEntity(100, 100);

    // isValid() call counts as 1 → next isNearHazard inside execute() will be 2 → false
    action.isValid(entity);
    const status = action.execute(entity, 100);

    expect(status).toBe(ActionStatus.SUCCESS);
  });

  it('abort() is a no-op (does not throw)', () => {
    const action = makeAction();
    expect(() => action.abort(makeEntity())).not.toThrow();
  });

  it('custom speed is respected', () => {
    const hazard = makeHazard({
      getEscapeDirection: () => ({ x: 0, y: 1 }),
      isNearHazard: () => true,
    });
    const action = makeAction(hazard, 60); // half speed
    const entity = makeEntity(0, 0);

    action.execute(entity, 1000); // 1 second

    expect(entity.y).toBeCloseTo(60);
  });

  it('custom cost is stored correctly', () => {
    const action = makeAction(makeHazard(), 120, 5);
    expect(action.cost).toBe(5);
  });

  it('two instances with different propertyKeys have independent preconditions', () => {
    const a1 = new EvadeHazardAction(makeHazard(), 'evade_fire', 'fireZoneNear');
    const a2 = new EvadeHazardAction(makeHazard(), 'evade_rad', 'radZoneNear');

    expect(a1.getPreconditions().get('fireZoneNear')).toBe(true);
    expect(a1.getPreconditions().get('radZoneNear')).toBeUndefined();
    expect(a2.getPreconditions().get('radZoneNear')).toBe(true);
    expect(a2.getPreconditions().get('fireZoneNear')).toBeUndefined();
  });
});
