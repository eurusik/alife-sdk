import { MonsterRegistry, type IMonsterDefinition } from './MonsterRegistry';

function makeValidDef(overrides?: Partial<IMonsterDefinition>): IMonsterDefinition {
  return {
    name: 'Test Dog',
    hp: 100,
    speed: 80,
    damage: 15,
    attackRange: 30,
    detectionRange: 200,
    fov: 120,
    packSize: [2, 4],
    abilities: ['charge'],
    lair: { inner: 50, patrol: 150, outer: 300 },
    rank: 3,
    ...overrides,
  };
}

describe('MonsterRegistry', () => {
  // -----------------------------------------------------------------------
  // Default behavior (no config)
  // -----------------------------------------------------------------------
  describe('default rank bounds (1-5)', () => {
    it('accepts rank within default bounds', () => {
      const reg = new MonsterRegistry();
      expect(() => reg.register('dog', makeValidDef({ rank: 1 }))).not.toThrow();
      expect(() => reg.register('controller', makeValidDef({ rank: 5 }))).not.toThrow();
    });

    it('rejects rank below default minimum', () => {
      const reg = new MonsterRegistry();
      expect(() => reg.register('bad', makeValidDef({ rank: 0 }))).toThrow('rank must be 1-5');
    });

    it('rejects rank above default maximum', () => {
      const reg = new MonsterRegistry();
      expect(() => reg.register('bad', makeValidDef({ rank: 6 }))).toThrow('rank must be 1-5');
    });
  });

  // -----------------------------------------------------------------------
  // Custom rank bounds
  // -----------------------------------------------------------------------
  describe('custom rank bounds', () => {
    it('accepts rank within custom bounds (1-10)', () => {
      const reg = new MonsterRegistry({ rankMin: 1, rankMax: 10 });
      expect(() => reg.register('elite', makeValidDef({ rank: 8 }))).not.toThrow();
      expect(() => reg.register('boss', makeValidDef({ rank: 10 }))).not.toThrow();
    });

    it('rejects rank above custom maximum', () => {
      const reg = new MonsterRegistry({ rankMin: 1, rankMax: 10 });
      expect(() => reg.register('bad', makeValidDef({ rank: 11 }))).toThrow('rank must be 1-10');
    });

    it('rejects rank below custom minimum', () => {
      const reg = new MonsterRegistry({ rankMin: 3, rankMax: 8 });
      expect(() => reg.register('bad', makeValidDef({ rank: 2 }))).toThrow('rank must be 3-8');
    });

    it('supports custom minimum only (max defaults to 5)', () => {
      const reg = new MonsterRegistry({ rankMin: 2 });
      expect(() => reg.register('ok', makeValidDef({ rank: 2 }))).not.toThrow();
      expect(() => reg.register('bad', makeValidDef({ rank: 1 }))).toThrow('rank must be 2-5');
    });

    it('supports custom maximum only (min defaults to 1)', () => {
      const reg = new MonsterRegistry({ rankMax: 20 });
      expect(() => reg.register('ok', makeValidDef({ rank: 15 }))).not.toThrow();
      expect(() => reg.register('bad', makeValidDef({ rank: 0 }))).toThrow('rank must be 1-20');
    });
  });

  // -----------------------------------------------------------------------
  // Other validations still work
  // -----------------------------------------------------------------------
  describe('non-rank validations unaffected', () => {
    it('still validates hp > 0', () => {
      const reg = new MonsterRegistry();
      expect(() => reg.register('bad', makeValidDef({ hp: 0 }))).toThrow('hp must be > 0');
    });

    it('still validates lair ordering', () => {
      const reg = new MonsterRegistry({ rankMin: 1, rankMax: 10 });
      expect(() =>
        reg.register('bad', makeValidDef({ lair: { inner: 200, patrol: 150, outer: 300 } })),
      ).toThrow('lair.inner must be < lair.patrol');
    });
  });
});
