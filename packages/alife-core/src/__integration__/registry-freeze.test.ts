// Integration tests: Registry freeze behaviour + SpawnRegistry cooldown lifecycle
//
// These tests verify end-to-end cross-system behaviour using real objects only.
// No vi.fn() — stubs use plain objects with tracking arrays where needed.

import { describe, it, expect, beforeEach } from 'vitest';
import { FactionRegistry, type IFactionDefinition } from '../registry/FactionRegistry';
import { MonsterRegistry, type IMonsterDefinition } from '../registry/MonsterRegistry';
import { SpawnRegistry } from '../spawn/SpawnRegistry';
import { ALifeKernel } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import { FactionsPlugin } from '../plugins/FactionsPlugin';
import { MonstersPlugin } from '../plugins/MonstersPlugin';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

// ---------------------------------------------------------------------------
// Plain-object stubs (no vi.fn())
// ---------------------------------------------------------------------------

function stubEntityAdapter(): IEntityAdapter {
  return {
    getPosition: () => ({ x: 0, y: 0 }),
    isAlive: () => true,
    hasComponent: () => false,
    getComponentValue: () => null,
    setPosition: () => {},
    setActive: () => {},
    setVisible: () => {},
    setVelocity: () => {},
    getVelocity: () => ({ x: 0, y: 0 }),
    setRotation: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    setAlpha: () => {},
    playAnimation: () => {},
    hasAnimation: () => false,
  };
}

function stubPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 0, y: 0 }) };
}

function stubEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'npc_stub',
    createMonster: () => 'monster_stub',
    destroyEntity: () => {},
  };
}

function createKernel(): ALifeKernel {
  return new ALifeKernel()
    .provide(Ports.EntityAdapter, stubEntityAdapter())
    .provide(Ports.PlayerPosition, stubPlayerPosition())
    .provide(Ports.EntityFactory, stubEntityFactory());
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function validFactionDef(overrides?: Partial<IFactionDefinition>): IFactionDefinition {
  return {
    name: 'Сталкери',
    baseRelations: { military: -50, bandits: -80 },
    immunities: { psi: 0.1 },
    defaultEquipment: { preferredWeapon: 'rifle', aggressiveness: 0.5, cautiousness: 0.4, preferredArmor: 'light' },
    spawnRules: { targetRatio: 0.3, balanceTolerance: 0.05 },
    ...overrides,
  };
}

function validMonsterDef(overrides?: Partial<IMonsterDefinition>): IMonsterDefinition {
  return {
    name: 'Сліпий пес',
    hp: 100,
    speed: 80,
    damage: 15,
    attackRange: 40,
    detectionRange: 200,
    fov: 120,
    packSize: [3, 5],
    abilities: ['bite'],
    lair: { inner: 50, patrol: 150, outer: 300 },
    rank: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FactionRegistry — freeze behaviour
// ---------------------------------------------------------------------------

describe('FactionRegistry – freeze integration', () => {
  let reg: FactionRegistry;

  beforeEach(() => {
    reg = new FactionRegistry();
  });

  it('starts unfrozen and accepts registrations', () => {
    reg.register('loners', validFactionDef({ name: 'Одинаки' }));
    expect(reg.isFrozen).toBe(false);
    expect(reg.size).toBe(1);
  });

  it('throws on register() after freeze()', () => {
    reg.register('loners', validFactionDef());
    reg.freeze();

    expect(() => reg.register('bandits', validFactionDef({ name: 'Бандити', baseRelations: { military: -50 } }))).toThrow(
      /frozen/,
    );
  });

  it('read operations remain fully functional after freeze()', () => {
    const def = validFactionDef({ name: 'Монолит' });
    reg.register('monolith', def);
    reg.freeze();

    expect(reg.get('monolith')).toStrictEqual(def);
    expect(reg.has('monolith')).toBe(true);
    expect(reg.tryGet('monolith')).toStrictEqual(def);
    expect(reg.ids()).toEqual(['monolith']);
    expect(reg.size).toBe(1);
  });

  it('get() on non-existent id throws with informative message', () => {
    reg.freeze();
    expect(() => reg.get('unknown_faction')).toThrow(/unknown_faction/);
  });

  it('tryGet() on non-existent id returns undefined (no throw)', () => {
    reg.freeze();
    expect(reg.tryGet('ghost')).toBeUndefined();
  });

  it('isFrozen is false before and true after freeze()', () => {
    expect(reg.isFrozen).toBe(false);
    reg.freeze();
    expect(reg.isFrozen).toBe(true);
  });

  it('multiple factions registered before freeze — all readable after', () => {
    reg.register('loners', validFactionDef({ name: 'Одинаки' }));
    reg.register('military', validFactionDef({ name: 'Військові', baseRelations: { bandits: -80 } }));
    reg.register('duty', validFactionDef({ name: 'Обов\'язок', baseRelations: { bandits: -40 } }));
    reg.freeze();

    expect(reg.size).toBe(3);
    expect(reg.get('loners').name).toBe('Одинаки');
    expect(reg.get('military').name).toBe('Військові');
    expect(reg.get('duty').name).toBe('Обов\'язок');
    expect(reg.ids().sort()).toEqual(['duty', 'loners', 'military']);
  });

  it('is iterable via for..of after freeze', () => {
    reg.register('loners', validFactionDef({ name: 'Одинаки' }));
    reg.register('bandits', validFactionDef({ name: 'Бандити', baseRelations: {} }));
    reg.freeze();

    const names: string[] = [];
    for (const [id, def] of reg) {
      names.push(`${id}:${def.name}`);
    }
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.startsWith('loners:'))).toBe(true);
  });

  it('FactionsPlugin freezes registry on kernel.init()', () => {
    const plugin = new FactionsPlugin();
    const kernel = createKernel();
    kernel.use(plugin);

    plugin.factions.register('loners', validFactionDef());
    expect(plugin.factions.isFrozen).toBe(false);

    kernel.init();

    expect(plugin.factions.isFrozen).toBe(true);
    expect(() =>
      plugin.factions.register('bandits', validFactionDef({ name: 'Бандити', baseRelations: { military: -50 } })),
    ).toThrow(/frozen/);

    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// MonsterRegistry — freeze behaviour
// ---------------------------------------------------------------------------

describe('MonsterRegistry – freeze integration', () => {
  let reg: MonsterRegistry;

  beforeEach(() => {
    reg = new MonsterRegistry();
  });

  it('accepts valid monster registration before freeze', () => {
    reg.register('dog', validMonsterDef());
    expect(reg.has('dog')).toBe(true);
    expect(reg.get('dog').name).toBe('Сліпий пес');
  });

  it('throws on register() after freeze()', () => {
    reg.register('dog', validMonsterDef());
    reg.freeze();

    expect(() => reg.register('boar', validMonsterDef({ name: 'Кабан', rank: 2 }))).toThrow(
      /frozen/,
    );
  });

  it('read access is intact after freeze()', () => {
    reg.register('bloodsucker', validMonsterDef({ name: 'Кровосос', rank: 3 }));
    reg.freeze();

    expect(reg.get('bloodsucker').name).toBe('Кровосос');
    expect(reg.has('bloodsucker')).toBe(true);
    expect(reg.size).toBe(1);
  });

  it('tryGet returns undefined for missing entry after freeze', () => {
    reg.freeze();
    expect(reg.tryGet('unknown_monster')).toBeUndefined();
  });

  it('MonstersPlugin freezes registry on kernel.init()', () => {
    const plugin = new MonstersPlugin();
    const kernel = createKernel();
    kernel.use(plugin);

    plugin.monsters.register('dog', validMonsterDef());
    expect(plugin.monsters.isFrozen).toBe(false);

    kernel.init();

    expect(plugin.monsters.isFrozen).toBe(true);
    expect(() =>
      plugin.monsters.register('boar', validMonsterDef({ name: 'Кабан', rank: 2 })),
    ).toThrow(/frozen/);

    kernel.destroy();
  });

  it('custom rank bounds: MonsterRegistry(rankMin:2, rankMax:10) accepts rank 7', () => {
    const customReg = new MonsterRegistry({ rankMin: 2, rankMax: 10 });
    expect(() =>
      customReg.register('elite', validMonsterDef({ rank: 7, name: 'Еліта' })),
    ).not.toThrow();
    customReg.freeze();
    expect(customReg.get('elite').rank).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Two independent registries in same kernel — no cross-contamination
// ---------------------------------------------------------------------------

describe('Two registries in one kernel — isolation', () => {
  it('FactionRegistry and MonsterRegistry do not share state', () => {
    const kernel = createKernel();
    const fp = new FactionsPlugin();
    const mp = new MonstersPlugin();
    kernel.use(fp).use(mp);

    fp.factions.register('loners', validFactionDef({ name: 'Одинаки' }));
    mp.monsters.register('dog', validMonsterDef({ name: 'Пес' }));

    kernel.init();

    expect(fp.factions.size).toBe(1);
    expect(mp.monsters.size).toBe(1);
    expect(fp.factions.isFrozen).toBe(true);
    expect(mp.monsters.isFrozen).toBe(true);

    // Frozen separately — each throws its own registry name
    expect(() =>
      fp.factions.register('bandits', validFactionDef({ name: 'Бандити', baseRelations: { military: -50 } })),
    ).toThrow(/FactionRegistry/);
    expect(() =>
      mp.monsters.register('boar', validMonsterDef({ name: 'Кабан', rank: 2 })),
    ).toThrow(/MonsterRegistry/);

    kernel.destroy();
  });

  it('two separate FactionRegistry instances are fully independent', () => {
    const reg1 = new FactionRegistry();
    const reg2 = new FactionRegistry();

    reg1.register('loners', validFactionDef({ name: 'Одинаки' }));
    reg2.register('bandits', validFactionDef({ name: 'Бандити', baseRelations: { military: -50 } }));

    reg1.freeze();

    // reg2 is still unfrozen
    expect(reg1.isFrozen).toBe(true);
    expect(reg2.isFrozen).toBe(false);
    expect(reg1.has('loners')).toBe(true);
    expect(reg1.has('bandits')).toBe(false);
    expect(reg2.has('bandits')).toBe(true);
    expect(reg2.has('loners')).toBe(false);

    // reg2 can still register
    expect(() =>
      reg2.register('military', validFactionDef({ name: 'Військові', baseRelations: { bandits: -80 } })),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SpawnRegistry — cooldown lifecycle integration
// ---------------------------------------------------------------------------

describe('SpawnRegistry – cooldown lifecycle integration', () => {
  it('resetAllCooldowns() makes all on-cooldown points eligible again', () => {
    const reg = new SpawnRegistry(10_000);

    reg.addPoint({ id: 'sp1', terrainId: 'camp_a', position: { x: 100, y: 200 }, factionId: 'loners', maxNPCs: 5 });
    reg.addPoint({ id: 'sp2', terrainId: 'camp_b', position: { x: 300, y: 400 }, factionId: 'duty', maxNPCs: 5 });
    reg.addPoint({ id: 'sp3', terrainId: 'camp_c', position: { x: 500, y: 100 }, factionId: 'bandits', maxNPCs: 5 });

    // All three get used → on cooldown
    reg.markSpawned('sp1');
    reg.markSpawned('sp2');
    reg.markSpawned('sp3');
    expect(reg.getEligiblePoints()).toHaveLength(0);

    // Reset clears all cooldowns → all three eligible
    reg.resetAllCooldowns();
    expect(reg.getEligiblePoints()).toHaveLength(3);
  });

  it('cooldown ticks down correctly with update()', () => {
    const reg = new SpawnRegistry(5_000); // 5 second cooldown
    reg.addPoint({ id: 'sp1', terrainId: 't1', position: { x: 0, y: 0 }, factionId: 'loners', maxNPCs: 5 });

    reg.markSpawned('sp1');
    expect(reg.getEligiblePoints()).toHaveLength(0);

    reg.update(2_500); // 2.5s — half cooldown remains
    expect(reg.getEligiblePoints()).toHaveLength(0);

    reg.update(2_500); // another 2.5s — cooldown expires
    expect(reg.getEligiblePoints()).toHaveLength(1);
  });

  it('markDespawned reduces active count making room when capacity was full', () => {
    const reg = new SpawnRegistry(0); // zero cooldown
    reg.addPoint({ id: 'sp1', terrainId: 't1', position: { x: 0, y: 0 }, factionId: 'loners', maxNPCs: 1 });

    reg.markSpawned('sp1');
    // active=1, maxNPCs=1 → not eligible (at capacity)
    expect(reg.getEligiblePoints()).toHaveLength(0);

    reg.markDespawned('sp1');
    // active=0 again, cooldown=0 → eligible
    expect(reg.getEligiblePoints()).toHaveLength(1);
  });

  it('faction-filtered queries return only matching points', () => {
    const reg = new SpawnRegistry();

    reg.addPoint({ id: 'a1', terrainId: 'camp_a', position: { x: 0, y: 0 }, factionId: 'loners', maxNPCs: 3 });
    reg.addPoint({ id: 'a2', terrainId: 'camp_a', position: { x: 10, y: 0 }, factionId: 'loners', maxNPCs: 3 });
    reg.addPoint({ id: 'b1', terrainId: 'camp_b', position: { x: 0, y: 100 }, factionId: 'bandits', maxNPCs: 3 });

    const lonerPoints = reg.getPointsByFaction('loners');
    const banditPoints = reg.getPointsByFaction('bandits');
    const dutyPoints = reg.getPointsByFaction('duty');

    expect(lonerPoints).toHaveLength(2);
    expect(lonerPoints.every((p) => p.factionId === 'loners')).toBe(true);
    expect(banditPoints).toHaveLength(1);
    expect(dutyPoints).toHaveLength(0);
  });

  it('serialize → restore round-trips cooldown state correctly', () => {
    const reg = new SpawnRegistry(8_000);
    reg.addPoint({ id: 'sp1', terrainId: 't1', position: { x: 0, y: 0 }, factionId: 'loners', maxNPCs: 5 });
    reg.addPoint({ id: 'sp2', terrainId: 't2', position: { x: 0, y: 0 }, factionId: 'duty', maxNPCs: 5 });

    reg.markSpawned('sp1'); // cooldown = 8000
    reg.update(3_000);      // sp1 cooldown = 5000

    const snapshot = reg.serialize();
    expect(snapshot.cooldowns['sp1']).toBe(5_000);
    expect(snapshot.cooldowns['sp2']).toBe(0);
    expect(snapshot.activeCounts['sp1']).toBe(1);

    // Restore into a fresh registry with same points
    const reg2 = new SpawnRegistry(8_000);
    reg2.addPoint({ id: 'sp1', terrainId: 't1', position: { x: 0, y: 0 }, factionId: 'loners', maxNPCs: 5 });
    reg2.addPoint({ id: 'sp2', terrainId: 't2', position: { x: 0, y: 0 }, factionId: 'duty', maxNPCs: 5 });
    reg2.restore(snapshot);

    // sp1 still on cooldown, sp2 eligible
    expect(reg2.getEligiblePoints()).toHaveLength(1);
    expect(reg2.getEligiblePoints()[0].id).toBe('sp2');

    reg2.update(5_000); // expire sp1 cooldown
    expect(reg2.getEligiblePoints()).toHaveLength(2);
  });
});
