import { describe, it, expect } from 'vitest';
import { GOAPAction, ActionStatus } from './GOAPAction';
import type { WorldState } from './WorldState';
import type { IEntity } from '../entity/IEntity';

class StubAction extends GOAPAction {
  readonly id = 'stub';
  readonly cost = 1;
  getPreconditions(): WorldState { return new Map(); }
  getEffects(): WorldState { return new Map([['done', true]]); }
  isValid(_entity: IEntity): boolean { return true; }
  execute(_entity: IEntity, _delta: number): ActionStatus { return ActionStatus.SUCCESS; }
}

describe('ActionStatus', () => {
  it('has three values', () => {
    expect(ActionStatus.RUNNING).toBe('running');
    expect(ActionStatus.SUCCESS).toBe('success');
    expect(ActionStatus.FAILURE).toBe('failure');
  });

  it('contains exactly 3 entries', () => {
    expect(Object.keys(ActionStatus)).toHaveLength(3);
  });
});

describe('GOAPAction', () => {
  it('abort() is a no-op by default (does not throw)', () => {
    const action = new StubAction();
    expect(() => action.abort({} as IEntity)).not.toThrow();
  });

  it('concrete subclass satisfies abstract contract', () => {
    const action = new StubAction();
    expect(action.id).toBe('stub');
    expect(action.cost).toBe(1);
    expect(action.getPreconditions().size).toBe(0);
    expect(action.getEffects().get('done')).toBe(true);
    expect(action.isValid({} as IEntity)).toBe(true);
    expect(action.execute({} as IEntity, 0.016)).toBe(ActionStatus.SUCCESS);
  });
});
