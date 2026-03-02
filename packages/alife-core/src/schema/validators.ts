import type { IMonsterDefinition } from '../registry/MonsterRegistry';
import type { IFactionDefinition } from '../registry/FactionRegistry';

// ---------------------------------------------------------------------------
// Assertion helpers — throw descriptive errors on invalid input
// ---------------------------------------------------------------------------

export function assertDefined<T>(
  value: T | undefined | null,
  name: string,
): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(`${name} must be defined, got ${value === null ? 'null' : 'undefined'}`);
  }
}

export function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string, got ${typeof value}`);
  }
}

export function assertNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(
      `${name} must be a number, got ${Number.isNaN(value) ? 'NaN' : typeof value}`,
    );
  }
}

export function assertNumberInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is number {
  assertNumber(value, name);
  if (value < min || value > max) {
    throw new Error(`${name} must be in [${min}, ${max}], got ${value}`);
  }
}

export function assertBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean, got ${typeof value}`);
  }
}

export function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array, got ${typeof value}`);
  }
}

export function assertObject(
  value: unknown,
  name: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `${name} must be a plain object, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`,
    );
  }
}

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

// ---------------------------------------------------------------------------
// Generic validator factory
// ---------------------------------------------------------------------------

/**
 * Creates a reusable validator function from an array of rule functions.
 *
 * Each rule receives the raw input and returns `null` if valid or an error
 * string if invalid. The validator runs ALL rules and collects ALL errors
 * (not fail-fast) so the caller gets a complete diagnostic on first attempt.
 */
export function createValidator<_T>(
  name: string,
  rules: Array<(input: unknown) => string | null>,
): (input: unknown) => ValidationResult {
  return (input: unknown): ValidationResult => {
    const errors: string[] = [];

    for (const rule of rules) {
      const error = rule(input);
      if (error !== null) {
        errors.push(`[${name}] ${error}`);
      }
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkString(obj: Record<string, unknown>, field: string): string | null {
  if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
    return `"${field}" must be a non-empty string`;
  }
  return null;
}

function checkPositiveNumber(obj: Record<string, unknown>, field: string): string | null {
  const v = obj[field];
  if (typeof v !== 'number' || Number.isNaN(v) || v <= 0) {
    return `"${field}" must be a positive number`;
  }
  return null;
}

function checkNumberInRange(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): string | null {
  const v = obj[field];
  if (typeof v !== 'number' || Number.isNaN(v) || v < min || v > max) {
    return `"${field}" must be a number in [${min}, ${max}]`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Monster definition validator
// ---------------------------------------------------------------------------

const monsterRules: Array<(input: unknown) => string | null> = [
  (input) => (isObject(input) ? null : 'input must be an object'),
  (input) => {
    if (!isObject(input)) return null; // guarded by rule above
    return checkString(input, 'name');
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkPositiveNumber(input, 'hp');
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkPositiveNumber(input, 'speed');
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkPositiveNumber(input, 'damage');
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkPositiveNumber(input, 'attackRange');
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkPositiveNumber(input, 'detectionRange');
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkNumberInRange(input, 'fov', 0.01, 360);
  },
  (input) => {
    if (!isObject(input)) return null;
    const ps = input['packSize'];
    if (!Array.isArray(ps) || ps.length !== 2) return '"packSize" must be a [min, max] tuple';
    if (typeof ps[0] !== 'number' || ps[0] < 1) return '"packSize[0]" must be >= 1';
    if (typeof ps[1] !== 'number') return '"packSize[1]" must be a number';
    if (ps[0] > ps[1]) return '"packSize" min must be <= max';
    return null;
  },
  (input) => {
    if (!isObject(input)) return null;
    if (!Array.isArray(input['abilities'])) return '"abilities" must be an array';
    return null;
  },
  (input) => {
    if (!isObject(input)) return null;
    const lair = input['lair'];
    if (!isObject(lair)) return '"lair" must be an object with inner, patrol, outer';
    const inner = lair['inner'];
    const patrol = lair['patrol'];
    const outer = lair['outer'];
    if (typeof inner !== 'number' || typeof patrol !== 'number' || typeof outer !== 'number') {
      return '"lair" fields must be numbers';
    }
    if (inner >= patrol) return '"lair.inner" must be < "lair.patrol"';
    if (patrol >= outer) return '"lair.patrol" must be < "lair.outer"';
    return null;
  },
  (input) => {
    if (!isObject(input)) return null;
    return checkNumberInRange(input, 'rank', 1, 5);
  },
  (input) => {
    if (!isObject(input)) return null;
    const faction = input['faction'];
    if (faction !== undefined && typeof faction !== 'string') {
      return '"faction" must be a string if provided';
    }
    return null;
  },
];

/**
 * Validates raw JSON input against the IMonsterDefinition shape.
 * Runs all rules and returns a complete list of errors.
 */
export const validateMonsterDefinition: (input: unknown) => ValidationResult =
  createValidator<IMonsterDefinition>('MonsterDefinition', monsterRules);

// ---------------------------------------------------------------------------
// Faction definition validator
// ---------------------------------------------------------------------------

const factionRules: Array<(input: unknown) => string | null> = [
  (input) => (isObject(input) ? null : 'input must be an object'),
  (input) => {
    if (!isObject(input)) return null;
    return checkString(input, 'name');
  },
  (input) => {
    if (!isObject(input)) return null;
    const br = input['baseRelations'];
    if (!isObject(br)) return '"baseRelations" must be an object';
    for (const [id, v] of Object.entries(br)) {
      if (typeof v !== 'number' || v < -100 || v > 100) {
        return `"baseRelations.${id}" must be a number in [-100, 100]`;
      }
    }
    return null;
  },
  (input) => {
    if (!isObject(input)) return null;
    const imm = input['immunities'];
    if (!isObject(imm)) return '"immunities" must be an object';
    for (const [id, v] of Object.entries(imm)) {
      if (typeof v !== 'number' || v < 0 || v > 1) {
        return `"immunities.${id}" must be a number in [0, 1]`;
      }
    }
    return null;
  },
  (input) => {
    if (!isObject(input)) return null;
    const de = input['defaultEquipment'];
    if (de !== undefined && !isObject(de)) return '"defaultEquipment" must be an object if provided';
    return null;
  },
  (input) => {
    if (!isObject(input)) return null;
    const sr = input['spawnRules'];
    if (!isObject(sr)) return '"spawnRules" must be an object';
    if (typeof sr['targetRatio'] !== 'number') return '"spawnRules.targetRatio" must be a number';
    if (typeof sr['balanceTolerance'] !== 'number') return '"spawnRules.balanceTolerance" must be a number';
    return null;
  },
];

/**
 * Validates raw JSON input against the IFactionDefinition shape.
 * Runs all rules and returns a complete list of errors.
 */
export const validateFactionDefinition: (input: unknown) => ValidationResult =
  createValidator<IFactionDefinition>('FactionDefinition', factionRules);
