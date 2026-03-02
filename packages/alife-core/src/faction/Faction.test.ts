import { Faction } from './Faction';
import type { IFactionDefinition } from '../registry/FactionRegistry';

function makeDef(overrides?: Partial<IFactionDefinition>): IFactionDefinition {
  return {
    name: 'Test Faction',
    baseRelations: {},
    immunities: {},
    defaultEquipment: {},
    spawnRules: { targetRatio: 0.2, balanceTolerance: 0.05 },
    ...overrides,
  };
}

describe('Faction', () => {
  // ---------------------------------------------------------------------------
  // getRelation (base + dynamic)
  // ---------------------------------------------------------------------------
  describe('getRelation', () => {
    it('returns base relation when no dynamic goodwill exists', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { bandits: -60, military: 20 },
      }));

      expect(faction.getRelation('bandits')).toBe(-60);
      expect(faction.getRelation('military')).toBe(20);
    });

    it('returns 0 for unknown factions', () => {
      const faction = new Faction('stalkers', makeDef());
      expect(faction.getRelation('unknown')).toBe(0);
    });

    it('sums base + dynamic goodwill', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { bandits: -30 },
      }));

      faction.adjustGoodwill('bandits', -20);
      expect(faction.getRelation('bandits')).toBe(-50);
    });

    it('clamps combined relation to [-100, 100]', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { ally: 80 },
      }));

      faction.adjustGoodwill('ally', 50);
      expect(faction.getRelation('ally')).toBe(100); // 80 + 50 = 130 → clamped to 100

      const faction2 = new Faction('stalkers', makeDef({
        baseRelations: { enemy: -80 },
      }));

      faction2.adjustGoodwill('enemy', -50);
      expect(faction2.getRelation('enemy')).toBe(-100); // -80 + (-50) = -130 → clamped to -100
    });
  });

  // ---------------------------------------------------------------------------
  // adjustGoodwill + isHostile / isAlly / isNeutral
  // ---------------------------------------------------------------------------
  describe('adjustGoodwill + diplomacy queries', () => {
    it('isHostile returns true when relation < hostile threshold (-50)', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { bandits: -51 },
      }));
      expect(faction.isHostile('bandits')).toBe(true);
    });

    it('isHostile returns false when relation == hostile threshold', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { bandits: -50 },
      }));
      expect(faction.isHostile('bandits')).toBe(false);
    });

    it('isAlly returns true when relation > ally threshold (50)', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { freedom: 51 },
      }));
      expect(faction.isAlly('freedom')).toBe(true);
    });

    it('isAlly returns false when relation == ally threshold', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { freedom: 50 },
      }));
      expect(faction.isAlly('freedom')).toBe(false);
    });

    it('isNeutral returns true when relation is between thresholds (inclusive)', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { mercs: 0 },
      }));
      expect(faction.isNeutral('mercs')).toBe(true);

      // At boundaries
      const faction2 = new Faction('stalkers', makeDef({
        baseRelations: { a: -50, b: 50 },
      }));
      expect(faction2.isNeutral('a')).toBe(true);
      expect(faction2.isNeutral('b')).toBe(true);
    });

    it('adjustGoodwill can shift diplomacy status', () => {
      const faction = new Faction('stalkers', makeDef({
        baseRelations: { mercs: 0 },
      }));

      expect(faction.isNeutral('mercs')).toBe(true);

      faction.adjustGoodwill('mercs', -60);
      expect(faction.isHostile('mercs')).toBe(true);
    });

    it('adjustGoodwill clamps stored value', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('other', 200);
      expect(faction.getRelation('other')).toBe(100);

      faction.adjustGoodwill('other', -500);
      // dynamic was clamped to 100, then -500 → clamped to -100
      expect(faction.getRelation('other')).toBe(-100);
    });
  });

  // ---------------------------------------------------------------------------
  // decayGoodwill
  // ---------------------------------------------------------------------------
  describe('decayGoodwill', () => {
    it('decays positive goodwill toward 0', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('freedom', 30);

      faction.decayGoodwill(10);
      expect(faction.getRelation('freedom')).toBe(20);
    });

    it('decays negative goodwill toward 0', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('bandits', -30);

      faction.decayGoodwill(10);
      expect(faction.getRelation('bandits')).toBe(-20);
    });

    it('removes entry when goodwill reaches 0', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('mercs', 5);

      faction.decayGoodwill(10); // 5 - 10 → clamped to 0
      expect(faction.getRelation('mercs')).toBe(0);
    });

    it('does nothing when rate <= 0', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('bandits', 30);

      faction.decayGoodwill(0);
      expect(faction.getRelation('bandits')).toBe(30);

      faction.decayGoodwill(-5);
      expect(faction.getRelation('bandits')).toBe(30);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom thresholds
  // ---------------------------------------------------------------------------
  describe('custom thresholds', () => {
    it('uses custom hostile and ally thresholds', () => {
      const faction = new Faction(
        'custom',
        makeDef({ baseRelations: { a: -20, b: 30 } }),
        { hostile: -10, ally: 20 },
      );

      expect(faction.isHostile('a')).toBe(true);  // -20 < -10
      expect(faction.isAlly('b')).toBe(true);      // 30 > 20
    });

    it('partial thresholds use defaults for missing values', () => {
      const faction = new Faction(
        'custom',
        makeDef({ baseRelations: { a: -51 } }),
        { hostile: -50 }, // ally remains default 50
      );

      expect(faction.isHostile('a')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // serialize / restore
  // ---------------------------------------------------------------------------
  describe('serialize / restore', () => {
    it('roundtrips dynamic goodwill', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('bandits', -30);
      faction.adjustGoodwill('freedom', 20);

      const state = faction.serialize();
      expect(state.dynamicGoodwill).toEqual({ bandits: -30, freedom: 20 });

      // Restore to a fresh instance
      const faction2 = new Faction('stalkers', makeDef());
      faction2.restore(state);

      expect(faction2.getRelation('bandits')).toBe(-30);
      expect(faction2.getRelation('freedom')).toBe(20);
    });

    it('restore clears previous dynamic goodwill', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('old', 50);

      faction.restore({ dynamicGoodwill: { new: 10 } });
      expect(faction.getRelation('old')).toBe(0);
      expect(faction.getRelation('new')).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------
  describe('metadata', () => {
    it('exposes metadata from definition', () => {
      const faction = new Faction('stalkers', makeDef({
        metadata: { color: '#ff0000', description: 'test' },
      }));

      expect(faction.metadata.get('color')).toBe('#ff0000');
      expect(faction.metadata.get('description')).toBe('test');
    });

    it('defaults to empty map when metadata is undefined', () => {
      const faction = new Faction('stalkers', makeDef());
      expect(faction.metadata.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // resetGoodwill
  // ---------------------------------------------------------------------------
  describe('resetGoodwill', () => {
    it('clears all dynamic goodwill', () => {
      const faction = new Faction('stalkers', makeDef());
      faction.adjustGoodwill('bandits', -50);
      faction.adjustGoodwill('freedom', 40);

      faction.resetGoodwill();
      expect(faction.getRelation('bandits')).toBe(0);
      expect(faction.getRelation('freedom')).toBe(0);
    });
  });
});
