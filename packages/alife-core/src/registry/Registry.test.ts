import { Registry } from './Registry';

interface TestConfig {
  name: string;
  value: number;
}

function makeRegistry(
  validate?: (config: TestConfig) => string[],
): Registry<string, TestConfig> {
  return new Registry<string, TestConfig>({
    name: 'TestRegistry',
    validate,
  });
}

describe('Registry', () => {
  // -----------------------------------------------------------------------
  // register + get + has
  // -----------------------------------------------------------------------
  describe('register / get / has', () => {
    it('registers an entry and retrieves it by ID', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'Alpha', value: 1 });

      expect(reg.has('a')).toBe(true);
      expect(reg.get('a')).toEqual({ name: 'Alpha', value: 1 });
    });

    it('supports chained register calls', () => {
      const reg = makeRegistry();
      const result = reg.register('a', { name: 'A', value: 1 });
      expect(result).toBe(reg);

      reg.register('b', { name: 'B', value: 2 }).register('c', { name: 'C', value: 3 });
      expect(reg.size).toBe(3);
    });

    it('throws when getting a non-existent ID', () => {
      const reg = makeRegistry();
      expect(() => reg.get('missing')).toThrow('[TestRegistry] ID "missing" not found');
    });

    it('has returns false for non-existent ID', () => {
      const reg = makeRegistry();
      expect(reg.has('missing')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Duplicate ID
  // -----------------------------------------------------------------------
  describe('duplicate ID', () => {
    it('throws when registering a duplicate ID', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'A', value: 1 });
      expect(() => reg.register('a', { name: 'B', value: 2 })).toThrow(
        '[TestRegistry] ID "a" already registered',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Frozen registry
  // -----------------------------------------------------------------------
  describe('freeze', () => {
    it('prevents registration after freeze()', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'A', value: 1 });
      reg.freeze();

      expect(reg.isFrozen).toBe(true);
      expect(() => reg.register('b', { name: 'B', value: 2 })).toThrow(
        'Cannot register: registry is frozen',
      );
    });

    it('still allows read operations after freeze', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'A', value: 1 });
      reg.freeze();

      expect(reg.get('a')).toEqual({ name: 'A', value: 1 });
      expect(reg.has('a')).toBe(true);
      expect(reg.tryGet('a')).toEqual({ name: 'A', value: 1 });
      expect(reg.ids()).toEqual(['a']);
      expect(reg.size).toBe(1);
    });

    it('isFrozen is false before freeze()', () => {
      const reg = makeRegistry();
      expect(reg.isFrozen).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------
  describe('validation', () => {
    it('throws when validation fails', () => {
      const reg = makeRegistry((config) => {
        const errors: string[] = [];
        if (config.value < 0) errors.push('value must be non-negative');
        if (!config.name) errors.push('name is required');
        return errors;
      });

      expect(() => reg.register('bad', { name: '', value: -1 })).toThrow(
        /Invalid config for "bad".*value must be non-negative.*name is required/,
      );
    });

    it('does not throw when validation passes', () => {
      const reg = makeRegistry((config) => {
        return config.value >= 0 ? [] : ['value must be non-negative'];
      });

      expect(() => reg.register('good', { name: 'Good', value: 5 })).not.toThrow();
    });

    it('works without a validator', () => {
      const reg = makeRegistry();
      expect(() => reg.register('a', { name: 'A', value: -999 })).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // tryGet
  // -----------------------------------------------------------------------
  describe('tryGet', () => {
    it('returns undefined for a missing ID', () => {
      const reg = makeRegistry();
      expect(reg.tryGet('missing')).toBeUndefined();
    });

    it('returns the config for an existing ID', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'A', value: 1 });
      expect(reg.tryGet('a')).toEqual({ name: 'A', value: 1 });
    });
  });

  // -----------------------------------------------------------------------
  // ids(), size, iterator
  // -----------------------------------------------------------------------
  describe('ids / size / iterator', () => {
    it('ids() returns all registered IDs', () => {
      const reg = makeRegistry();
      reg.register('x', { name: 'X', value: 1 });
      reg.register('y', { name: 'Y', value: 2 });
      reg.register('z', { name: 'Z', value: 3 });

      expect(reg.ids()).toEqual(['x', 'y', 'z']);
    });

    it('size reflects number of entries', () => {
      const reg = makeRegistry();
      expect(reg.size).toBe(0);
      reg.register('a', { name: 'A', value: 1 });
      expect(reg.size).toBe(1);
      reg.register('b', { name: 'B', value: 2 });
      expect(reg.size).toBe(2);
    });

    it('is iterable via Symbol.iterator', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'A', value: 1 });
      reg.register('b', { name: 'B', value: 2 });

      const entries: Array<[string, TestConfig]> = [];
      for (const entry of reg) {
        entries.push(entry);
      }

      expect(entries).toEqual([
        ['a', { name: 'A', value: 1 }],
        ['b', { name: 'B', value: 2 }],
      ]);
    });

    it('spread into array works', () => {
      const reg = makeRegistry();
      reg.register('a', { name: 'A', value: 1 });
      const arr = [...reg];
      expect(arr).toEqual([['a', { name: 'A', value: 1 }]]);
    });
  });
});
