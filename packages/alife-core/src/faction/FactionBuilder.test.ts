import { FactionBuilder } from './FactionBuilder';

describe('FactionBuilder', () => {
  // ---------------------------------------------------------------------------
  // Fluent chaining → build()
  // ---------------------------------------------------------------------------
  describe('fluent chaining', () => {
    it('builds a complete IFactionDefinition with all options', () => {
      const def = new FactionBuilder('stalkers')
        .displayName('Stalkers')
        .relation('bandits', -60)
        .relation('military', 20)
        .immunity('radiation', 0.2)
        .immunity('psi', 0.5)
        .equipmentPreference({ aggressiveness: 0.5, cautiousness: 0.3 })
        .spawn({ targetRatio: 0.25, balanceTolerance: 0.1 })
        .build();

      expect(def.name).toBe('Stalkers');
      expect(def.baseRelations).toEqual({ bandits: -60, military: 20 });
      expect(def.immunities).toEqual({ radiation: 0.2, psi: 0.5 });
      expect(def.defaultEquipment).toEqual({ aggressiveness: 0.5, cautiousness: 0.3 });
      expect(def.spawnRules).toEqual({ targetRatio: 0.25, balanceTolerance: 0.1 });
    });

    it('each method returns this for chaining', () => {
      const builder = new FactionBuilder('test');
      expect(builder.displayName('Test')).toBe(builder);
      expect(builder.relation('a', 0)).toBe(builder);
      expect(builder.immunity('b', 0.5)).toBe(builder);
      expect(builder.equipmentPreference({})).toBe(builder);
      expect(builder.spawn({})).toBe(builder);
    });

    it('builds with minimal required fields', () => {
      const def = new FactionBuilder('min')
        .displayName('Minimal')
        .build();

      expect(def.name).toBe('Minimal');
      expect(def.baseRelations).toEqual({});
      expect(def.immunities).toEqual({});
      expect(def.spawnRules).toEqual({ targetRatio: 0, balanceTolerance: 0 });
    });

    it('overwrites relation for the same factionId', () => {
      const def = new FactionBuilder('test')
        .displayName('Test')
        .relation('bandits', 10)
        .relation('bandits', -40)
        .build();

      expect(def.baseRelations.bandits).toBe(-40);
    });

    it('merges equipmentPreference across multiple calls', () => {
      const def = new FactionBuilder('test')
        .displayName('Test')
        .equipmentPreference({ aggressiveness: 0.8 })
        .equipmentPreference({ cautiousness: 0.2 })
        .build();

      expect(def.defaultEquipment).toEqual({ aggressiveness: 0.8, cautiousness: 0.2 });
    });

    it('overwrites spawn rules on subsequent calls', () => {
      const def = new FactionBuilder('test')
        .displayName('Test')
        .spawn({ targetRatio: 0.5 })
        .spawn({ targetRatio: 0.3, balanceTolerance: 0.1 })
        .build();

      expect(def.spawnRules.targetRatio).toBe(0.3);
      expect(def.spawnRules.balanceTolerance).toBe(0.1);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------
  describe('validation errors', () => {
    it('throws on empty id', () => {
      expect(() => new FactionBuilder('')).toThrow('[FactionBuilder] id must not be empty');
    });

    it('throws on build() without displayName', () => {
      expect(() => new FactionBuilder('test').build()).toThrow(
        '[FactionBuilder] Faction "test" requires a display name',
      );
    });

    it('throws on relation score < -100', () => {
      const builder = new FactionBuilder('test');
      expect(() => builder.relation('other', -101)).toThrow(
        'Relation score for "other" must be in [-100, 100]',
      );
    });

    it('throws on relation score > 100', () => {
      const builder = new FactionBuilder('test');
      expect(() => builder.relation('other', 101)).toThrow(
        'Relation score for "other" must be in [-100, 100]',
      );
    });

    it('accepts boundary relation scores (-100 and 100)', () => {
      const builder = new FactionBuilder('test');
      expect(() => builder.relation('a', -100)).not.toThrow();
      expect(() => builder.relation('b', 100)).not.toThrow();
    });

    it('throws on immunity factor < 0', () => {
      const builder = new FactionBuilder('test');
      expect(() => builder.immunity('fire', -0.1)).toThrow(
        'Immunity factor for "fire" must be in [0, 1]',
      );
    });

    it('throws on immunity factor > 1', () => {
      const builder = new FactionBuilder('test');
      expect(() => builder.immunity('fire', 1.1)).toThrow(
        'Immunity factor for "fire" must be in [0, 1]',
      );
    });

    it('accepts boundary immunity factors (0 and 1)', () => {
      const builder = new FactionBuilder('test');
      expect(() => builder.immunity('a', 0)).not.toThrow();
      expect(() => builder.immunity('b', 1)).not.toThrow();
    });

    it('throws when setting a self-relation (faction pointing to itself)', () => {
      const builder = new FactionBuilder('stalker');
      expect(() => builder.relation('stalker', 50)).toThrow('cannot define a relation to itself');
    });
  });

  // ---------------------------------------------------------------------------
  // withMetadata
  // ---------------------------------------------------------------------------
  describe('withMetadata', () => {
    it('adds metadata to build result', () => {
      const def = new FactionBuilder('test')
        .displayName('Test')
        .withMetadata('color', '#ff0000')
        .withMetadata('description', 'A test faction')
        .build();

      expect(def.metadata).toEqual({ color: '#ff0000', description: 'A test faction' });
    });

    it('metadata is undefined when not set', () => {
      const def = new FactionBuilder('test')
        .displayName('Test')
        .build();

      expect(def.metadata).toBeUndefined();
    });
  });
});
