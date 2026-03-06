import { WorldState } from './WorldState';

describe('WorldState', () => {
  // -------------------------------------------------------------------------
  // set / get / has
  // -------------------------------------------------------------------------

  describe('set / get / has', () => {
    it('stores and retrieves a boolean value', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      expect(ws.get('alive')).toBe(true);
      expect(ws.has('alive')).toBe(true);
    });

    it('stores and retrieves a number value', () => {
      const ws = new WorldState();
      ws.set('ammo', 30);
      expect(ws.get('ammo')).toBe(30);
    });

    it('stores and retrieves a string value', () => {
      const ws = new WorldState();
      ws.set('weapon', 'rifle');
      expect(ws.get('weapon')).toBe('rifle');
    });

    it('returns undefined for unset properties', () => {
      const ws = new WorldState();
      expect(ws.get('missing')).toBeUndefined();
      expect(ws.has('missing')).toBe(false);
    });

    it('overwrites previous value on re-set', () => {
      const ws = new WorldState();
      ws.set('ammo', 30);
      ws.set('ammo', 15);
      expect(ws.get('ammo')).toBe(15);
    });
  });

  // -------------------------------------------------------------------------
  // satisfies
  // -------------------------------------------------------------------------

  describe('satisfies', () => {
    it('returns true when all goal properties match', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      ws.set('armed', true);
      ws.set('ammo', 10);

      const goal = new WorldState();
      goal.set('alive', true);
      goal.set('armed', true);

      expect(ws.satisfies(goal)).toBe(true);
    });

    it('returns false when a goal property differs', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      ws.set('armed', false);

      const goal = new WorldState();
      goal.set('armed', true);

      expect(ws.satisfies(goal)).toBe(false);
    });

    it('returns false when a goal property is absent in state', () => {
      const ws = new WorldState();
      ws.set('alive', true);

      const goal = new WorldState();
      goal.set('armed', true);

      expect(ws.satisfies(goal)).toBe(false);
    });

    it('returns true for an empty goal (vacuous truth)', () => {
      const ws = new WorldState();
      ws.set('alive', true);

      const emptyGoal = new WorldState();
      expect(ws.satisfies(emptyGoal)).toBe(true);
    });

    it('empty state satisfies empty goal', () => {
      const ws = new WorldState();
      const goal = new WorldState();
      expect(ws.satisfies(goal)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // distanceTo
  // -------------------------------------------------------------------------

  describe('distanceTo', () => {
    it('returns 0 when all goal properties match', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      ws.set('armed', true);

      const goal = new WorldState();
      goal.set('alive', true);
      goal.set('armed', true);

      expect(ws.distanceTo(goal)).toBe(0);
    });

    it('counts differing properties', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      ws.set('armed', false);
      ws.set('inCover', false);

      const goal = new WorldState();
      goal.set('alive', true);
      goal.set('armed', true);
      goal.set('inCover', true);

      // alive matches, armed and inCover differ → distance = 2
      expect(ws.distanceTo(goal)).toBe(2);
    });

    it('counts missing properties as differing', () => {
      const ws = new WorldState();

      const goal = new WorldState();
      goal.set('alive', true);
      goal.set('armed', true);

      expect(ws.distanceTo(goal)).toBe(2);
    });

    it('returns 0 for an empty goal', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      const goal = new WorldState();
      expect(ws.distanceTo(goal)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // applyEffects
  // -------------------------------------------------------------------------

  describe('applyEffects', () => {
    it('returns a new WorldState with effects applied', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      ws.set('armed', false);

      const effects = new WorldState();
      effects.set('armed', true);

      const result = ws.applyEffects(effects);

      expect(result.get('alive')).toBe(true);
      expect(result.get('armed')).toBe(true);
    });

    it('does not mutate the original state', () => {
      const ws = new WorldState();
      ws.set('armed', false);

      const effects = new WorldState();
      effects.set('armed', true);

      ws.applyEffects(effects);

      expect(ws.get('armed')).toBe(false);
    });

    it('adds new properties from effects', () => {
      const ws = new WorldState();
      ws.set('alive', true);

      const effects = new WorldState();
      effects.set('hasMedkit', true);

      const result = ws.applyEffects(effects);
      expect(result.get('hasMedkit')).toBe(true);
      expect(result.get('alive')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // clone
  // -------------------------------------------------------------------------

  describe('clone', () => {
    it('creates an independent copy with the same values', () => {
      const ws = new WorldState();
      ws.set('alive', true);
      ws.set('ammo', 30);

      const cloned = ws.clone();
      expect(cloned.get('alive')).toBe(true);
      expect(cloned.get('ammo')).toBe(30);
    });

    it('mutations on clone do not affect original', () => {
      const ws = new WorldState();
      ws.set('ammo', 30);

      const cloned = ws.clone();
      cloned.set('ammo', 0);

      expect(ws.get('ammo')).toBe(30);
      expect(cloned.get('ammo')).toBe(0);
    });

    it('mutations on original do not affect clone', () => {
      const ws = new WorldState();
      ws.set('alive', true);

      const cloned = ws.clone();
      ws.set('alive', false);

      expect(cloned.get('alive')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // keys
  // -------------------------------------------------------------------------

  describe('keys', () => {
    it('returns all set property keys', () => {
      const ws = new WorldState();
      ws.set('a', 1);
      ws.set('b', true);
      ws.set('c', 'x');

      const keys = [...ws.keys()];
      expect(keys).toHaveLength(3);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
    });
  });

  // -------------------------------------------------------------------------
  // from()
  // -------------------------------------------------------------------------

  describe('from()', () => {
    it('WorldState.from({}) creates an empty state (no keys)', () => {
      const ws = WorldState.from({});
      expect([...ws.keys()]).toHaveLength(0);
    });

    it('sets a boolean value from a plain object', () => {
      const ws = WorldState.from({ alive: true });
      expect(ws.get('alive')).toBe(true);
      expect(ws.has('alive')).toBe(true);
    });

    it('sets a number value from a plain object', () => {
      const ws = WorldState.from({ ammo: 30 });
      expect(ws.get('ammo')).toBe(30);
    });

    it('sets a string value from a plain object', () => {
      const ws = WorldState.from({ weapon: 'rifle' });
      expect(ws.get('weapon')).toBe('rifle');
    });

    it('sets multiple keys from a plain object', () => {
      const ws = WorldState.from({ alive: true, ammo: 10, weapon: 'pistol' });
      expect(ws.get('alive')).toBe(true);
      expect(ws.get('ammo')).toBe(10);
      expect(ws.get('weapon')).toBe('pistol');
      expect([...ws.keys()]).toHaveLength(3);
    });

    it('returned instance satisfies a matching goal', () => {
      const ws = WorldState.from({ armed: true, inCover: true });
      const goal = new WorldState();
      goal.set('armed', true);
      expect(ws.satisfies(goal)).toBe(true);
    });

    it('from({}) is equivalent to new WorldState() — no keys set', () => {
      const fromEmpty = WorldState.from({});
      const manual = new WorldState();
      expect([...fromEmpty.keys()]).toHaveLength(0);
      expect([...manual.keys()]).toHaveLength(0);
      expect(fromEmpty.satisfies(manual)).toBe(true);
      expect(manual.satisfies(fromEmpty)).toBe(true);
    });
  });
});
