import { ALifeKernel } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import { FactionsPlugin } from './FactionsPlugin';
import { MonstersPlugin } from './MonstersPlugin';
import { NPCTypesPlugin } from './NPCTypesPlugin';
import { AnomaliesPlugin } from './AnomaliesPlugin';
import { CombatSchemaPlugin } from './CombatSchemaPlugin';
import { SpawnPlugin } from './SpawnPlugin';
import { SurgePlugin } from './SurgePlugin';
import { TradePlugin } from './TradePlugin';
import { SquadPlugin } from './SquadPlugin';
import { SocialPlugin } from './SocialPlugin';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

function mockEntityAdapter(): IEntityAdapter {
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

function mockPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 0, y: 0 }) };
}

function mockEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'npc_1',
    createMonster: () => 'mon_1',
    destroyEntity: () => {},
  };
}

function createKernelWithPorts(): ALifeKernel {
  return new ALifeKernel()
    .provide(Ports.EntityAdapter, mockEntityAdapter())
    .provide(Ports.PlayerPosition, mockPlayerPosition())
    .provide(Ports.EntityFactory, mockEntityFactory());
}

// ---------------------------------------------------------------------------
// FactionsPlugin
// ---------------------------------------------------------------------------

describe('FactionsPlugin', () => {
  it('installs with name "factions"', () => {
    const plugin = new FactionsPlugin();
    expect(plugin.name).toBe('factions');
  });

  it('exposes a FactionRegistry', () => {
    const plugin = new FactionsPlugin();
    expect(plugin.factions).toBeDefined();
    expect(plugin.factions.size).toBe(0);
  });

  it('freezes the registry on init()', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new FactionsPlugin());
    kernel.init();

    const fp = kernel.getPlugin<FactionsPlugin>('factions');
    expect(fp.factions.isFrozen).toBe(true);
    kernel.destroy();
  });

  it('can register factions before init', () => {
    const plugin = new FactionsPlugin();
    const kernel = createKernelWithPorts();
    kernel.use(plugin);

    plugin.factions.register('loners', {
      name: 'Одинаки',
      baseRelations: {},
      immunities: {},
      defaultEquipment: {},
      spawnRules: { targetRatio: 0.3, balanceTolerance: 0.1 },
    });

    kernel.init();
    expect(plugin.factions.size).toBe(1);
    expect(plugin.factions.get('loners').name).toBe('Одинаки');
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// MonstersPlugin
// ---------------------------------------------------------------------------

describe('MonstersPlugin', () => {
  it('installs with name "monsters"', () => {
    expect(new MonstersPlugin().name).toBe('monsters');
  });

  it('freezes the registry on init()', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new MonstersPlugin());
    kernel.init();

    const mp = kernel.getPlugin<MonstersPlugin>('monsters');
    expect(mp.monsters.isFrozen).toBe(true);
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// NPCTypesPlugin
// ---------------------------------------------------------------------------

describe('NPCTypesPlugin', () => {
  it('installs with name "npcTypes"', () => {
    expect(new NPCTypesPlugin().name).toBe('npcTypes');
  });

  it('freezes the registry on init()', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new NPCTypesPlugin());
    kernel.init();

    const np = kernel.getPlugin<NPCTypesPlugin>('npcTypes');
    expect(np.npcTypes.isFrozen).toBe(true);
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// AnomaliesPlugin
// ---------------------------------------------------------------------------

describe('AnomaliesPlugin', () => {
  it('installs with name "anomalies"', () => {
    expect(new AnomaliesPlugin().name).toBe('anomalies');
  });

  it('freezes the registry on init()', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new AnomaliesPlugin());
    kernel.init();

    const ap = kernel.getPlugin<AnomaliesPlugin>('anomalies');
    expect(ap.anomalyTypes.isFrozen).toBe(true);
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// CombatSchemaPlugin
// ---------------------------------------------------------------------------

describe('CombatSchemaPlugin', () => {
  it('installs with name "combatSchema"', () => {
    expect(new CombatSchemaPlugin().name).toBe('combatSchema');
  });

  it('exposes four registries', () => {
    const plugin = new CombatSchemaPlugin();
    expect(plugin.damageTypes).toBeDefined();
    expect(plugin.aiStates).toBeDefined();
    expect(plugin.behaviorSchemes).toBeDefined();
    expect(plugin.taskTypes).toBeDefined();
  });

  it('freezes all four registries on init()', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new CombatSchemaPlugin());
    kernel.init();

    const cs = kernel.getPlugin<CombatSchemaPlugin>('combatSchema');
    expect(cs.damageTypes.isFrozen).toBe(true);
    expect(cs.aiStates.isFrozen).toBe(true);
    expect(cs.behaviorSchemes.isFrozen).toBe(true);
    expect(cs.taskTypes.isFrozen).toBe(true);
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// SpawnPlugin
// ---------------------------------------------------------------------------

describe('SpawnPlugin', () => {
  it('installs with name "spawn"', () => {
    expect(new SpawnPlugin().name).toBe('spawn');
  });

  it('accepts custom cooldown', () => {
    const plugin = new SpawnPlugin(5000);
    expect(plugin.spawns).toBeDefined();
  });

  it('supports serialize/restore', () => {
    const plugin = new SpawnPlugin();
    const kernel = createKernelWithPorts();
    kernel.use(plugin);
    kernel.init();

    const state = plugin.serialize();
    expect(state).toBeDefined();

    plugin.restore(state);
    kernel.destroy();
  });

  it('delegates update to SpawnRegistry', () => {
    const plugin = new SpawnPlugin();
    const kernel = createKernelWithPorts();
    kernel.use(plugin);
    kernel.init();

    // update should not throw
    expect(() => plugin.update!(100)).not.toThrow();
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// SurgePlugin
// ---------------------------------------------------------------------------

describe('SurgePlugin', () => {
  it('installs with name "surge"', () => {
    expect(new SurgePlugin().name).toBe('surge');
  });

  it('exposes surge config from kernel', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new SurgePlugin());
    kernel.init();

    const sp = kernel.getPlugin<SurgePlugin>('surge');
    expect(sp.config).toBeDefined();
    expect(sp.config.warningDurationMs).toBe(30_000);
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// TradePlugin
// ---------------------------------------------------------------------------

describe('TradePlugin', () => {
  it('installs with name "trade"', () => {
    expect(new TradePlugin().name).toBe('trade');
  });

  it('exposes trade config from kernel', () => {
    const kernel = createKernelWithPorts();
    kernel.use(new TradePlugin());
    kernel.init();

    const tp = kernel.getPlugin<TradePlugin>('trade');
    expect(tp.config).toBeDefined();
    expect(tp.config.allyDiscount).toBe(0.8);
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// SquadPlugin
// ---------------------------------------------------------------------------

describe('SquadPlugin', () => {
  it('installs with name "squad"', () => {
    expect(new SquadPlugin().name).toBe('squad');
  });

  it('install does not throw', () => {
    const kernel = createKernelWithPorts();
    expect(() => kernel.use(new SquadPlugin())).not.toThrow();
    kernel.init();
    kernel.destroy();
  });
});

// ---------------------------------------------------------------------------
// SocialPlugin
// ---------------------------------------------------------------------------

describe('SocialPlugin', () => {
  it('installs with name "social"', () => {
    expect(new SocialPlugin().name).toBe('social');
  });

  it('install does not throw', () => {
    const kernel = createKernelWithPorts();
    expect(() => kernel.use(new SocialPlugin())).not.toThrow();
    kernel.init();
    kernel.destroy();
  });
});
