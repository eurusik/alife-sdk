import { FactionRegistry } from './FactionRegistry';
import { AnomalyTypeRegistry } from './AnomalyTypeRegistry';
import { NPCTypeRegistry } from './NPCTypeRegistry';
import { DamageTypeRegistry } from './DamageTypeRegistry';
import { BehaviorSchemeRegistry } from './BehaviorSchemeRegistry';
import { TaskTypeRegistry } from './TaskTypeRegistry';

// ---------------------------------------------------------------------------
// FactionRegistry
// ---------------------------------------------------------------------------

describe('FactionRegistry', () => {
  it('validates relations in [-100, 100]', () => {
    const reg = new FactionRegistry();
    expect(() =>
      reg.register('bad', {
        name: 'Bad',
        baseRelations: { other: 200 },
        immunities: {},
        defaultEquipment: {},
        spawnRules: { targetRatio: 0.3, balanceTolerance: 0.1 },
      }),
    ).toThrow('relation "other" must be in [-100, 100]');
  });

  it('validates immunities in [0, 1]', () => {
    const reg = new FactionRegistry();
    expect(() =>
      reg.register('bad', {
        name: 'Bad',
        baseRelations: {},
        immunities: { fire: 1.5 },
        defaultEquipment: {},
        spawnRules: { targetRatio: 0.3, balanceTolerance: 0.1 },
      }),
    ).toThrow('immunity "fire" must be in [0, 1]');
  });

  it('validates name is not empty', () => {
    const reg = new FactionRegistry();
    expect(() =>
      reg.register('empty', {
        name: '',
        baseRelations: {},
        immunities: {},
        defaultEquipment: {},
        spawnRules: { targetRatio: 0.3, balanceTolerance: 0.1 },
      }),
    ).toThrow('name must not be empty');
  });

  it('registers valid faction', () => {
    const reg = new FactionRegistry();
    reg.register('loners', {
      name: 'Одинаки',
      baseRelations: { military: -50 },
      immunities: { psi: 0.2 },
      defaultEquipment: {},
      spawnRules: { targetRatio: 0.3, balanceTolerance: 0.1 },
    });
    expect(reg.get('loners').name).toBe('Одинаки');
  });
});

// ---------------------------------------------------------------------------
// AnomalyTypeRegistry
// ---------------------------------------------------------------------------

describe('AnomalyTypeRegistry', () => {
  it('validates damagePerSecond > 0', () => {
    const reg = new AnomalyTypeRegistry();
    expect(() =>
      reg.register('bad', {
        name: 'Bad',
        damageTypeId: 'fire',
        damagePerSecond: -1,
        radius: 100,
        artefactChance: 0.1,
        maxArtefacts: 3,
      }),
    ).toThrow('damagePerSecond must be > 0');
  });

  it('validates artefactChance in [0, 1]', () => {
    const reg = new AnomalyTypeRegistry();
    expect(() =>
      reg.register('bad', {
        name: 'Bad',
        damageTypeId: 'fire',
        damagePerSecond: 10,
        radius: 100,
        artefactChance: 2.0,
        maxArtefacts: 3,
      }),
    ).toThrow('artefactChance must be in [0, 1]');
  });

  it('registers valid anomaly type', () => {
    const reg = new AnomalyTypeRegistry();
    reg.register('fire_vortex', {
      name: 'Вогняний вихор',
      damageTypeId: 'fire',
      damagePerSecond: 20,
      radius: 150,
      artefactChance: 0.3,
      maxArtefacts: 2,
    });
    expect(reg.get('fire_vortex').radius).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// NPCTypeRegistry
// ---------------------------------------------------------------------------

describe('NPCTypeRegistry', () => {
  const validNPC = {
    name: 'Сталкер',
    faction: 'loners',
    hp: 100,
    speed: 80,
    damage: 15,
    attackRange: 300,
    detectionRange: 250,
    fov: 120,
    rank: 2,
    accuracy: 0.6,
    retreatThreshold: 0.3,
  };

  it('validates hp > 0', () => {
    const reg = new NPCTypeRegistry();
    expect(() => reg.register('bad', { ...validNPC, hp: 0 })).toThrow('hp must be > 0');
  });

  it('validates rank 1-5', () => {
    const reg = new NPCTypeRegistry();
    expect(() => reg.register('bad', { ...validNPC, rank: 0 })).toThrow('rank must be 1-5');
    expect(() => reg.register('bad2', { ...validNPC, rank: 6 })).toThrow('rank must be 1-5');
  });

  it('validates accuracy in [0, 1]', () => {
    const reg = new NPCTypeRegistry();
    expect(() => reg.register('bad', { ...validNPC, accuracy: 1.5 })).toThrow(
      'accuracy must be in [0, 1]',
    );
  });

  it('registers valid NPC type', () => {
    const reg = new NPCTypeRegistry();
    reg.register('stalker', validNPC);
    expect(reg.get('stalker').name).toBe('Сталкер');
  });
});

// ---------------------------------------------------------------------------
// DamageTypeRegistry
// ---------------------------------------------------------------------------

describe('DamageTypeRegistry', () => {
  it('validates defaultImmunity in [0, 1]', () => {
    const reg = new DamageTypeRegistry();
    expect(() =>
      reg.register('bad', { name: 'Bad', defaultImmunity: 2, moraleImpact: -0.1 }),
    ).toThrow('defaultImmunity must be in [0, 1]');
  });

  it('registerDefaults() adds 5 types', () => {
    const reg = new DamageTypeRegistry();
    reg.registerDefaults();
    expect(reg.size).toBe(5);
    expect(reg.has('physical')).toBe(true);
    expect(reg.has('fire')).toBe(true);
    expect(reg.has('radiation')).toBe(true);
    expect(reg.has('chemical')).toBe(true);
    expect(reg.has('psi')).toBe(true);
  });

  it('registerDefaults() returns this for chaining', () => {
    const reg = new DamageTypeRegistry();
    expect(reg.registerDefaults()).toBe(reg);
  });
});

// ---------------------------------------------------------------------------
// BehaviorSchemeRegistry
// ---------------------------------------------------------------------------

describe('BehaviorSchemeRegistry', () => {
  it('rejects nightOnly + dayOnly', () => {
    const reg = new BehaviorSchemeRegistry();
    expect(() =>
      reg.register('bad', {
        name: 'Bad',
        isStationary: false,
        requiresRoute: false,
        nightOnly: true,
        dayOnly: true,
      }),
    ).toThrow('cannot be both nightOnly and dayOnly');
  });

  it('registerDefaults() adds 6 schemes', () => {
    const reg = new BehaviorSchemeRegistry();
    reg.registerDefaults();
    expect(reg.size).toBe(6);
    expect(reg.has('guard')).toBe(true);
    expect(reg.has('patrol')).toBe(true);
    expect(reg.has('camp')).toBe(true);
    expect(reg.has('sleep')).toBe(true);
    expect(reg.has('camper')).toBe(true);
    expect(reg.has('wander')).toBe(true);
  });

  it('sleep is nightOnly', () => {
    const reg = new BehaviorSchemeRegistry();
    reg.registerDefaults();
    expect(reg.get('sleep').nightOnly).toBe(true);
    expect(reg.get('sleep').dayOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TaskTypeRegistry
// ---------------------------------------------------------------------------

describe('TaskTypeRegistry', () => {
  it('registerDefaults() adds 4 types', () => {
    const reg = new TaskTypeRegistry();
    reg.registerDefaults();
    expect(reg.size).toBe(4);
    expect(reg.has('patrol')).toBe(true);
    expect(reg.has('guard')).toBe(true);
    expect(reg.has('camp')).toBe(true);
    expect(reg.has('wander')).toBe(true);
  });

  it('guard has higher priority than patrol', () => {
    const reg = new TaskTypeRegistry();
    reg.registerDefaults();
    expect(reg.get('guard').priority).toBeGreaterThan(reg.get('patrol').priority);
  });

  it('registers custom task type', () => {
    const reg = new TaskTypeRegistry();
    reg.register('snipe', { name: 'Snipe', defaultBehavior: 'guard', priority: 30 });
    expect(reg.get('snipe').priority).toBe(30);
  });
});
