import {
  assertDefined,
  assertString,
  assertNumber,
  assertNumberInRange,
  assertBoolean,
  assertArray,
  assertObject,
  createValidator,
  validateMonsterDefinition,
  validateFactionDefinition,
} from './validators';

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

describe('assertDefined', () => {
  it('passes for truthy values', () => {
    expect(() => assertDefined('hello', 'val')).not.toThrow();
    expect(() => assertDefined(0, 'val')).not.toThrow();
    expect(() => assertDefined(false, 'val')).not.toThrow();
  });

  it('throws for undefined', () => {
    expect(() => assertDefined(undefined, 'val')).toThrow('val must be defined, got undefined');
  });

  it('throws for null', () => {
    expect(() => assertDefined(null, 'val')).toThrow('val must be defined, got null');
  });
});

describe('assertString', () => {
  it('passes for strings', () => {
    expect(() => assertString('hello', 'val')).not.toThrow();
    expect(() => assertString('', 'val')).not.toThrow();
  });

  it('throws for non-strings', () => {
    expect(() => assertString(42, 'val')).toThrow('val must be a string, got number');
  });
});

describe('assertNumber', () => {
  it('passes for numbers', () => {
    expect(() => assertNumber(42, 'val')).not.toThrow();
    expect(() => assertNumber(0, 'val')).not.toThrow();
    expect(() => assertNumber(-1, 'val')).not.toThrow();
  });

  it('throws for NaN', () => {
    expect(() => assertNumber(NaN, 'val')).toThrow('val must be a number, got NaN');
  });

  it('throws for non-numbers', () => {
    expect(() => assertNumber('42', 'val')).toThrow('val must be a number, got string');
  });
});

describe('assertNumberInRange', () => {
  it('passes for values in range', () => {
    expect(() => assertNumberInRange(5, 'val', 0, 10)).not.toThrow();
    expect(() => assertNumberInRange(0, 'val', 0, 10)).not.toThrow();
    expect(() => assertNumberInRange(10, 'val', 0, 10)).not.toThrow();
  });

  it('throws for out-of-range values', () => {
    expect(() => assertNumberInRange(-1, 'val', 0, 10)).toThrow('val must be in [0, 10], got -1');
    expect(() => assertNumberInRange(11, 'val', 0, 10)).toThrow('val must be in [0, 10], got 11');
  });
});

describe('assertBoolean', () => {
  it('passes for booleans', () => {
    expect(() => assertBoolean(true, 'val')).not.toThrow();
    expect(() => assertBoolean(false, 'val')).not.toThrow();
  });

  it('throws for non-booleans', () => {
    expect(() => assertBoolean(1, 'val')).toThrow('val must be a boolean, got number');
  });
});

describe('assertArray', () => {
  it('passes for arrays', () => {
    expect(() => assertArray([], 'val')).not.toThrow();
    expect(() => assertArray([1, 2], 'val')).not.toThrow();
  });

  it('throws for non-arrays', () => {
    expect(() => assertArray({}, 'val')).toThrow('val must be an array, got object');
  });
});

describe('assertObject', () => {
  it('passes for plain objects', () => {
    expect(() => assertObject({}, 'val')).not.toThrow();
    expect(() => assertObject({ a: 1 }, 'val')).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => assertObject(null, 'val')).toThrow('val must be a plain object, got null');
  });

  it('throws for arrays', () => {
    expect(() => assertObject([], 'val')).toThrow('val must be a plain object, got array');
  });

  it('throws for primitives', () => {
    expect(() => assertObject('str', 'val')).toThrow('val must be a plain object, got string');
  });
});

// ---------------------------------------------------------------------------
// createValidator
// ---------------------------------------------------------------------------

describe('createValidator', () => {
  it('returns valid for no errors', () => {
    const validate = createValidator('Test', [() => null]);
    expect(validate({})).toEqual({ valid: true });
  });

  it('collects all errors', () => {
    const validate = createValidator('Test', [
      () => 'error 1',
      () => null,
      () => 'error 2',
    ]);
    const result = validate({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('[Test] error 1');
      expect(result.errors[1]).toContain('[Test] error 2');
    }
  });
});

// ---------------------------------------------------------------------------
// validateMonsterDefinition
// ---------------------------------------------------------------------------

describe('validateMonsterDefinition', () => {
  const validMonster = {
    name: 'Dog',
    hp: 100,
    speed: 120,
    damage: 15,
    attackRange: 40,
    detectionRange: 200,
    fov: 180,
    packSize: [2, 4],
    abilities: ['charge'],
    lair: { inner: 50, patrol: 150, outer: 300 },
    rank: 2,
  };

  it('accepts valid monster definition', () => {
    const result = validateMonsterDefinition(validMonster);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateMonsterDefinition('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects hp <= 0', () => {
    const result = validateMonsterDefinition({ ...validMonster, hp: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid lair ordering', () => {
    const result = validateMonsterDefinition({
      ...validMonster,
      lair: { inner: 200, patrol: 100, outer: 300 },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects packSize min > max', () => {
    const result = validateMonsterDefinition({
      ...validMonster,
      packSize: [5, 2],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects rank out of range', () => {
    const result = validateMonsterDefinition({ ...validMonster, rank: 0 });
    expect(result.valid).toBe(false);
  });

  it('accepts optional faction field', () => {
    const result = validateMonsterDefinition({ ...validMonster, faction: 'mutant' });
    expect(result.valid).toBe(true);
  });

  it('rejects non-string faction', () => {
    const result = validateMonsterDefinition({ ...validMonster, faction: 42 });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateFactionDefinition
// ---------------------------------------------------------------------------

describe('validateFactionDefinition', () => {
  const validFaction = {
    name: 'Loners',
    baseRelations: { military: -50 },
    immunities: { psi: 0.3 },
    defaultEquipment: {},
    spawnRules: { targetRatio: 0.3, balanceTolerance: 0.1 },
  };

  it('accepts valid faction definition', () => {
    const result = validateFactionDefinition(validFaction);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateFactionDefinition(null);
    expect(result.valid).toBe(false);
  });

  it('rejects empty name', () => {
    const result = validateFactionDefinition({ ...validFaction, name: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects relation out of range', () => {
    const result = validateFactionDefinition({
      ...validFaction,
      baseRelations: { mil: 200 },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects immunity out of range', () => {
    const result = validateFactionDefinition({
      ...validFaction,
      immunities: { fire: -0.1 },
    });
    expect(result.valid).toBe(false);
  });
});
