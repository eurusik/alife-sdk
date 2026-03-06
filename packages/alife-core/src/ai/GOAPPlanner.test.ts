import { GOAPPlanner } from './GOAPPlanner';
import { GOAPAction, ActionStatus } from './GOAPAction';
import type { GOAPActionDef } from './GOAPAction';
import { WorldState } from './WorldState';
import type { IEntity } from '../entity/IEntity';

// ---------------------------------------------------------------------------
// Mock action builder
// ---------------------------------------------------------------------------

class TestAction extends GOAPAction {
  readonly id: string;
  readonly cost: number;
  private readonly preconditions: WorldState;
  private readonly effects: WorldState;

  constructor(
    id: string,
    cost: number,
    preconditions: Record<string, boolean | number | string>,
    effects: Record<string, boolean | number | string>,
  ) {
    super();
    this.id = id;
    this.cost = cost;

    this.preconditions = new WorldState();
    for (const [k, v] of Object.entries(preconditions)) {
      this.preconditions.set(k, v);
    }

    this.effects = new WorldState();
    for (const [k, v] of Object.entries(effects)) {
      this.effects.set(k, v);
    }
  }

  getPreconditions(): WorldState {
    return this.preconditions;
  }

  getEffects(): WorldState {
    return this.effects;
  }

  isValid(_entity: IEntity): boolean {
    return true;
  }

  execute(_entity: IEntity, _delta: number): ActionStatus {
    return ActionStatus.SUCCESS;
  }
}

function makeState(props: Record<string, boolean | number | string>): WorldState {
  const ws = new WorldState();
  for (const [k, v] of Object.entries(props)) {
    ws.set(k, v);
  }
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GOAPPlanner', () => {
  // -------------------------------------------------------------------------
  // plan() finds optimal plan
  // -------------------------------------------------------------------------

  describe('plan — basic', () => {
    it('finds a single-action plan', () => {
      const planner = new GOAPPlanner();

      planner.registerAction(
        new TestAction('getWeapon', 1, {}, { armed: true }),
      );

      const current = makeState({ armed: false });
      const goal = makeState({ armed: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(1);
      expect(plan![0].id).toBe('getWeapon');
    });

    it('finds a multi-step plan', () => {
      const planner = new GOAPPlanner();

      // To kill enemy: need weapon → need ammo → then kill
      planner.registerAction(
        new TestAction('getWeapon', 1, {}, { hasWeapon: true }),
      );
      planner.registerAction(
        new TestAction('loadAmmo', 1, { hasWeapon: true }, { hasAmmo: true }),
      );
      planner.registerAction(
        new TestAction('killEnemy', 1, { hasWeapon: true, hasAmmo: true }, { enemyDead: true }),
      );

      const current = makeState({});
      const goal = makeState({ enemyDead: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(3);
      expect(plan!.map((a) => a.id)).toEqual(['getWeapon', 'loadAmmo', 'killEnemy']);
    });

    it('returns empty array when current state already satisfies goal', () => {
      const planner = new GOAPPlanner();
      planner.registerAction(
        new TestAction('noop', 1, {}, { alive: true }),
      );

      const current = makeState({ alive: true });
      const goal = makeState({ alive: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Depth limit → null
  // -------------------------------------------------------------------------

  describe('depth limit', () => {
    it('returns null when plan would exceed maxDepth', () => {
      const planner = new GOAPPlanner();

      // Chain of 5 actions: step1 → step2 → step3 → step4 → step5
      planner.registerAction(new TestAction('step1', 1, {}, { s1: true }));
      planner.registerAction(new TestAction('step2', 1, { s1: true }, { s2: true }));
      planner.registerAction(new TestAction('step3', 1, { s2: true }, { s3: true }));
      planner.registerAction(new TestAction('step4', 1, { s3: true }, { s4: true }));
      planner.registerAction(new TestAction('step5', 1, { s4: true }, { s5: true }));

      const current = makeState({});
      const goal = makeState({ s5: true });

      // maxDepth 3 — can only go 3 levels, but solution needs 5
      const plan = planner.plan(current, goal, 3);
      expect(plan).toBeNull();
    });

    it('finds plan within depth limit', () => {
      const planner = new GOAPPlanner();

      planner.registerAction(new TestAction('step1', 1, {}, { s1: true }));
      planner.registerAction(new TestAction('step2', 1, { s1: true }, { s2: true }));

      const current = makeState({});
      const goal = makeState({ s2: true });

      // maxDepth 5 — solution needs 2 steps, within limit
      const plan = planner.plan(current, goal, 5);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Unsolvable goal → null
  // -------------------------------------------------------------------------

  describe('unsolvable goal', () => {
    it('returns null when no actions can satisfy the goal', () => {
      const planner = new GOAPPlanner();

      // Only action gives "armed", but goal wants "flying"
      planner.registerAction(
        new TestAction('getWeapon', 1, {}, { armed: true }),
      );

      const current = makeState({});
      const goal = makeState({ flying: true });

      const plan = planner.plan(current, goal);
      expect(plan).toBeNull();
    });

    it('returns null when precondition chain is broken', () => {
      const planner = new GOAPPlanner();

      // killEnemy needs weapon, but there's no getWeapon action
      planner.registerAction(
        new TestAction('killEnemy', 1, { hasWeapon: true }, { enemyDead: true }),
      );

      const current = makeState({});
      const goal = makeState({ enemyDead: true });

      const plan = planner.plan(current, goal);
      expect(plan).toBeNull();
    });

    it('returns null with no actions registered', () => {
      const planner = new GOAPPlanner();

      const current = makeState({});
      const goal = makeState({ alive: true });

      const plan = planner.plan(current, goal);
      expect(plan).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cost-based ordering
  // -------------------------------------------------------------------------

  describe('cost-based ordering', () => {
    it('prefers the lower-cost path', () => {
      const planner = new GOAPPlanner();

      // Two ways to get armed: cheap vs expensive
      planner.registerAction(
        new TestAction('buyExpensiveWeapon', 10, {}, { armed: true }),
      );
      planner.registerAction(
        new TestAction('findCheapWeapon', 1, {}, { armed: true }),
      );

      const current = makeState({});
      const goal = makeState({ armed: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(1);
      expect(plan![0].id).toBe('findCheapWeapon');
    });

    it('prefers a cheaper multi-step path over an expensive single step', () => {
      const planner = new GOAPPlanner();

      // Expensive single action (cost 20)
      planner.registerAction(
        new TestAction('directKill', 20, {}, { enemyDead: true }),
      );

      // Cheap two-step path (cost 2 + 3 = 5)
      planner.registerAction(
        new TestAction('getWeapon', 2, {}, { hasWeapon: true }),
      );
      planner.registerAction(
        new TestAction('shootEnemy', 3, { hasWeapon: true }, { enemyDead: true }),
      );

      const current = makeState({});
      const goal = makeState({ enemyDead: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(2);
      expect(plan![0].id).toBe('getWeapon');
      expect(plan![1].id).toBe('shootEnemy');
    });
  });

  // -------------------------------------------------------------------------
  // Fingerprint paths
  // -------------------------------------------------------------------------

  describe('fingerprint — non-boolean values (djb2 fallback)', () => {
    it('finds correct plan when world state contains numeric values', () => {
      const planner = new GOAPPlanner();

      planner.registerAction(
        new TestAction('restock', 1, { ammo: 0 }, { ammo: 5 }),
      );
      planner.registerAction(
        new TestAction('shoot', 1, { ammo: 5 }, { enemyDead: true }),
      );

      const current = makeState({ ammo: 0 });
      const goal = makeState({ enemyDead: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(2);
      expect(plan!.map((a) => a.id)).toEqual(['restock', 'shoot']);
    });

    it('finds correct plan when world state contains string values', () => {
      const planner = new GOAPPlanner();

      planner.registerAction(
        new TestAction('equip', 1, { weapon: 'none' }, { weapon: 'rifle' }),
      );
      planner.registerAction(
        new TestAction('fire', 1, { weapon: 'rifle' }, { targetDown: true }),
      );

      const current = makeState({ weapon: 'none' });
      const goal = makeState({ targetDown: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(2);
      expect(plan!.map((a) => a.id)).toEqual(['equip', 'fire']);
    });
  });

  describe('fingerprint — key universe from actions', () => {
    it('distinguishes states that differ only in action-introduced keys', () => {
      const planner = new GOAPPlanner();

      // Two parallel paths to 'done': via keyA or via keyB
      planner.registerAction(
        new TestAction('pathA_step1', 1, {}, { keyA: true }),
      );
      planner.registerAction(
        new TestAction('pathA_step2', 1, { keyA: true }, { done: true }),
      );
      planner.registerAction(
        new TestAction('pathB_step1', 10, {}, { keyB: true }),
      );
      planner.registerAction(
        new TestAction('pathB_step2', 10, { keyB: true }, { done: true }),
      );

      const current = makeState({});
      const goal = makeState({ done: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      // Should prefer cheaper pathA (cost 2) over pathB (cost 20)
      expect(plan!.map((a) => a.id)).toEqual(['pathA_step1', 'pathA_step2']);
    });
  });

  // -------------------------------------------------------------------------
  // Default max depth
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // registerAction with GOAPActionDef (plain-object actions)
  // -------------------------------------------------------------------------

  describe('registerAction with GOAPActionDef', () => {
    it('registers a plain-object action and plans a trivial 1-step plan', () => {
      const planner = new GOAPPlanner();

      const def: GOAPActionDef = {
        id: 'finish',
        cost: 1,
        preconditions: {},
        effects: { done: true },
      };
      planner.registerAction(def);

      const current = makeState({});
      const goal = makeState({ done: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(1);
      expect(plan![0].id).toBe('finish');
    });

    it('registers multiple plain-object actions and plans a multi-step plan', () => {
      const planner = new GOAPPlanner();

      planner.registerAction({
        id: 'step1',
        cost: 1,
        preconditions: {},
        effects: { ready: true },
      });
      planner.registerAction({
        id: 'step2',
        cost: 1,
        preconditions: { ready: true },
        effects: { done: true },
      });

      const current = makeState({});
      const goal = makeState({ done: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(2);
      expect(plan!.map((a) => a.id)).toEqual(['step1', 'step2']);
    });

    it('isValid callback is invoked on the planned action and its return value is honoured', () => {
      const planner = new GOAPPlanner();

      const calls: string[] = [];
      const def: GOAPActionDef = {
        id: 'act',
        cost: 1,
        preconditions: {},
        effects: { done: true },
        isValid: (_entity: IEntity) => {
          calls.push('isValid');
          return false;
        },
      };
      planner.registerAction(def);

      const current = makeState({});
      const goal = makeState({ done: true });

      // The planner builds the plan (isValid is not checked at plan time).
      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();

      // Callers check isValid before execution — verify callback is invoked.
      const mockEntity = {} as IEntity;
      const valid = plan![0].isValid(mockEntity);
      expect(calls).toEqual(['isValid']);
      expect(valid).toBe(false);
    });

    it('execute callback is invoked on the planned action and returns its value', () => {
      const planner = new GOAPPlanner();

      const calls: string[] = [];
      const def: GOAPActionDef = {
        id: 'act',
        cost: 1,
        preconditions: {},
        effects: { done: true },
        execute: (_entity: IEntity, _delta: number) => {
          calls.push('execute');
          return ActionStatus.SUCCESS;
        },
      };
      planner.registerAction(def);

      const current = makeState({});
      const goal = makeState({ done: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();

      const mockEntity = {} as IEntity;
      const status = plan![0].execute(mockEntity, 16);
      expect(calls).toEqual(['execute']);
      expect(status).toBe(ActionStatus.SUCCESS);
    });

    it('mix of class-based GOAPAction and plain GOAPActionDef in the same planner', () => {
      const planner = new GOAPPlanner();

      // Class-based action
      planner.registerAction(
        new TestAction('classStep', 1, {}, { classReady: true }),
      );

      // Plain-object action
      planner.registerAction({
        id: 'defStep',
        cost: 1,
        preconditions: { classReady: true },
        effects: { done: true },
      });

      const current = makeState({});
      const goal = makeState({ done: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(2);
      expect(plan!.map((a) => a.id)).toEqual(['classStep', 'defStep']);
    });
  });

  // -------------------------------------------------------------------------
  // Default max depth
  // -------------------------------------------------------------------------

  describe('constructor defaultMaxDepth', () => {
    it('uses the defaultMaxDepth when no maxDepth argument is given', () => {
      const planner = new GOAPPlanner(2);

      planner.registerAction(new TestAction('s1', 1, {}, { a: true }));
      planner.registerAction(new TestAction('s2', 1, { a: true }, { b: true }));
      planner.registerAction(new TestAction('s3', 1, { b: true }, { c: true }));

      const current = makeState({});
      const goal = makeState({ c: true });

      // Needs 3 steps but defaultMaxDepth is 2
      const plan = planner.plan(current, goal);
      expect(plan).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Fingerprint regression: C1 — false vs undefined (absent key)
  // -------------------------------------------------------------------------

  describe('fingerprint — C1: explicit false vs absent key', () => {
    it('treats explicit false and absent key as distinct states', () => {
      // Regression for C1: both `false` and `undefined` (absent) produced
      // bitmask bit=0, causing closed-set collision and skipping valid expansions.
      //
      // Scenario: we need to flip `locked` from false → true.
      // If the planner conflates {locked:false} with {locked:undefined (absent)},
      // it would mark the initial state as visited and prune the unlock action.
      const planner = new GOAPPlanner();

      planner.registerAction(
        new TestAction('unlock', 1, { locked: false }, { locked: true }),
      );

      // Current state has locked=false (explicit), goal wants locked=true.
      const current = makeState({ locked: false });
      const goal = makeState({ locked: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan).toHaveLength(1);
      expect(plan![0].id).toBe('unlock');
    });

    it('solves a plan where intermediate state sets a key to false', () => {
      // An action sets a boolean to false as an effect; the next action requires
      // that false value as a precondition. Planners that conflate false with
      // absent would skip the second action's precondition match.
      const planner = new GOAPPlanner();

      planner.registerAction(
        new TestAction('disarm', 1, { armed: true }, { armed: false }),
      );
      planner.registerAction(
        new TestAction('detain', 1, { armed: false }, { detained: true }),
      );

      const current = makeState({ armed: true });
      const goal = makeState({ detained: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      expect(plan!.map((a) => a.id)).toEqual(['disarm', 'detain']);
    });
  });

  // -------------------------------------------------------------------------
  // Fingerprint regression: C2 — key universe > 31 keys
  // -------------------------------------------------------------------------

  describe('fingerprint — C2: key universe larger than 31', () => {
    it('still finds a valid plan when the key universe exceeds 31 keys', () => {
      // Regression for C2: bitmask used `i < 32` but `1 << 31` produces a
      // negative int32 in JS, potentially producing collisions with hash domain.
      // Now falls through to djb2 when keys.length > 31.
      const planner = new GOAPPlanner();

      // Register 30 "padding" actions that introduce 30 unique boolean keys.
      // This ensures the key universe exceeds 31 entries (30 padding + goal).
      for (let i = 0; i < 30; i++) {
        planner.registerAction(
          new TestAction(`pad${i}`, 100, {}, { [`pad${i}`]: true }),
        );
      }

      // The actual plan we want: a cheap 2-step path.
      planner.registerAction(
        new TestAction('getKey', 1, {}, { hasKey: true }),
      );
      planner.registerAction(
        new TestAction('openDoor', 1, { hasKey: true }, { doorOpen: true }),
      );

      const current = makeState({});
      const goal = makeState({ doorOpen: true });

      const plan = planner.plan(current, goal);
      expect(plan).not.toBeNull();
      // Should find the 2-step cheap path despite the large key universe
      expect(plan!.map((a) => a.id)).toEqual(['getKey', 'openDoor']);
    });
  });
});
