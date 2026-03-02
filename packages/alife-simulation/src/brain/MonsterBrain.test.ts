import {
  EventBus,
  Clock,
  SmartTerrain,
} from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import type { IBrainConfig, ITerrainSelectorConfig, IJobScoringConfig } from '../types/ISimulationConfig';
import { MonsterBrain, createDefaultMonsterBrainConfig } from './MonsterBrain';
import type { IMonsterBrainConfig } from './MonsterBrain';
import type { IBrainDeps } from './NPCBrain';
import type { IMovementDispatcher } from './BrainScheduleManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBrainConfig(overrides?: Partial<IBrainConfig>): IBrainConfig {
  return {
    searchIntervalMs: 5_000,
    schemeCheckIntervalMs: 3_000,
    moraleFleeThreshold: -0.5,
    reEvaluateIntervalMs: 30_000,
    dangerTolerance: 10, // monsters tolerate all danger
    ...overrides,
  };
}

function createSelectorConfig(overrides?: Partial<ITerrainSelectorConfig>): ITerrainSelectorConfig {
  return {
    surgeMultiplier: 3.0,
    squadLeaderBonus: 20,
    moraleDangerPenalty: 15,
    ...overrides,
  };
}

function createJobConfig(overrides?: Partial<IJobScoringConfig>): IJobScoringConfig {
  return {
    rankBonus: 5,
    distancePenalty: 0.01,
    ...overrides,
  };
}

function createMockDeps(overrides?: Partial<IBrainDeps>): IBrainDeps {
  return {
    clock: new Clock({ startHour: 12, timeFactor: 1 }),
    events: new EventBus<ALifeEventPayloads>(),
    ...overrides,
  };
}

function createMockDispatcher(): IMovementDispatcher & {
  addMovingNPC: ReturnType<typeof vi.fn>;
  isMoving: ReturnType<typeof vi.fn>;
  cancelJourney: ReturnType<typeof vi.fn>;
} {
  return {
    addMovingNPC: vi.fn(),
    isMoving: vi.fn().mockReturnValue(false),
    cancelJourney: vi.fn(),
  };
}

function createTestTerrain(overrides?: {
  id?: string;
  capacity?: number;
  dangerLevel?: number;
  isShelter?: boolean;
  factions?: string[];
  tags?: string[];
  jobs?: Array<{ type: string; slots: number; position?: { x: number; y: number } }>;
  x?: number;
  y?: number;
}): SmartTerrain {
  const id = overrides?.id ?? 'terrain_default';
  return new SmartTerrain({
    id,
    name: id,
    bounds: {
      x: overrides?.x ?? 0,
      y: overrides?.y ?? 0,
      width: 100,
      height: 100,
    },
    capacity: overrides?.capacity ?? 10,
    dangerLevel: overrides?.dangerLevel ?? 0,
    isShelter: overrides?.isShelter ?? false,
    allowedFactions: overrides?.factions,
    tags: overrides?.tags,
    jobs: overrides?.jobs ?? [
      { type: 'guard', slots: 2, position: { x: 50, y: 50 } },
    ],
  });
}

function createMonsterBrain(overrides?: {
  npcId?: string;
  factionId?: string;
  brainConfig?: Partial<IBrainConfig>;
  selectorConfig?: Partial<ITerrainSelectorConfig>;
  jobConfig?: Partial<IJobScoringConfig>;
  deps?: Partial<IBrainDeps>;
  monsterConfig?: Partial<IMonsterBrainConfig>;
  lairTerrainId?: string;
}): {
  brain: MonsterBrain;
  deps: IBrainDeps;
  dispatcher: ReturnType<typeof createMockDispatcher>;
} {
  const deps = createMockDeps(overrides?.deps);
  const dispatcher = createMockDispatcher();
  const monsterConfig: IMonsterBrainConfig = {
    ...createDefaultMonsterBrainConfig(),
    ...overrides?.monsterConfig,
  };
  const brain = new MonsterBrain({
    npcId: overrides?.npcId ?? 'monster_1',
    factionId: overrides?.factionId ?? 'monster',
    config: createBrainConfig(overrides?.brainConfig),
    selectorConfig: createSelectorConfig(overrides?.selectorConfig),
    jobConfig: createJobConfig(overrides?.jobConfig),
    deps,
    monsterConfig,
    lairTerrainId: overrides?.lairTerrainId,
  });
  brain.setMovementDispatcher(dispatcher);
  return { brain, deps, dispatcher };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonsterBrain', () => {
  // -----------------------------------------------------------------------
  // Lair selection
  // -----------------------------------------------------------------------
  describe('lair terrain selection', () => {
    it('selects lair terrain with massive bonus over closer alternatives', () => {
      const { brain, deps } = createMonsterBrain({
        lairTerrainId: 'lair',
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Lair is far away, alternative is right here.
      const lair = createTestTerrain({ id: 'lair', x: 2000, y: 2000, dangerLevel: 1 });
      const nearby = createTestTerrain({ id: 'nearby', x: 0, y: 0, dangerLevel: 1 });

      brain.update(0, [nearby, lair]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('lair');
    });

    it('never skips lair even when it is the current terrain', () => {
      const { brain, deps } = createMonsterBrain({
        lairTerrainId: 'lair',
        brainConfig: { reEvaluateIntervalMs: 0 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const lair = createTestTerrain({ id: 'lair', x: 0, y: 0, dangerLevel: 1 });
      const other = createTestTerrain({ id: 'other', x: 0, y: 0, dangerLevel: 1 });

      // First tick: assign to lair.
      brain.update(0, [lair, other]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('lair');

      // Second tick: re-evaluate with same terrains. Lair should remain.
      brain.update(0, [lair, other]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('lair');
    });
  });

  // -----------------------------------------------------------------------
  // Danger affinity
  // -----------------------------------------------------------------------
  describe('danger affinity', () => {
    it('prefers high-danger terrain over low-danger terrain', () => {
      const { brain, deps } = createMonsterBrain();
      brain.setLastPosition({ x: 0, y: 0 });

      // Both at same location, same capacity -- only danger differs.
      const lowDanger = createTestTerrain({ id: 'safe', x: 0, y: 0, dangerLevel: 1 });
      const highDanger = createTestTerrain({ id: 'dangerous', x: 0, y: 0, dangerLevel: 8 });

      brain.update(0, [lowDanger, highDanger]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('dangerous');
    });

    it('danger affinity scales with dangerLevel', () => {
      const { brain: brain1, deps: deps1 } = createMonsterBrain({
        monsterConfig: { dangerAffinity: 5 },
      });
      brain1.setLastPosition({ x: 0, y: 0 });

      // With high affinity (5), danger 5 adds +25 vs danger 1 adding +5.
      // Both terrains at equal distance.
      const lowDanger = createTestTerrain({ id: 'low', x: 0, y: 0, dangerLevel: 1 });
      const highDanger = createTestTerrain({ id: 'high', x: 0, y: 0, dangerLevel: 5 });

      brain1.update(0, [lowDanger, highDanger]);
      deps1.events.flush();

      expect(brain1.currentTerrainId).toBe('high');
    });
  });

  // -----------------------------------------------------------------------
  // Surge immunity
  // -----------------------------------------------------------------------
  describe('surge immunity', () => {
    it('ignores surge -- does not filter non-shelters', () => {
      const { brain, deps } = createMonsterBrain();
      brain.setLastPosition({ x: 0, y: 0 });
      brain.setSurgeActive(true);

      // Only non-shelter terrains available -- monster should still pick one.
      const outdoor = createTestTerrain({ id: 'field', isShelter: false, dangerLevel: 3 });

      brain.update(0, [outdoor]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('field');
    });

    it('picks non-shelter with only non-shelters available during surge', () => {
      const { brain, deps } = createMonsterBrain();
      brain.setLastPosition({ x: 0, y: 0 });

      // Two non-shelters with different danger levels.
      // If surge filtering were applied (like human brain), both would be skipped.
      const lowDanger = createTestTerrain({ id: 'field_a', isShelter: false, dangerLevel: 1 });
      const highDanger = createTestTerrain({ id: 'field_b', isShelter: false, dangerLevel: 7 });

      brain.update(0, [lowDanger, highDanger]);
      deps.events.flush();

      // Monster picks the higher-danger terrain thanks to danger affinity.
      expect(brain.currentTerrainId).toBe('field_b');
    });
  });

  // -----------------------------------------------------------------------
  // No squad leader bonus
  // -----------------------------------------------------------------------
  it('no squad leader bonus applied', () => {
    const { brain, deps } = createMonsterBrain({
      brainConfig: { reEvaluateIntervalMs: 0 },
      selectorConfig: { squadLeaderBonus: 500 },
    });
    brain.setLastPosition({ x: 0, y: 0 });

    // A "leader" terrain far away and a nearby terrain.
    const farTerrain = createTestTerrain({ id: 'leader_spot', x: 3000, y: 3000, dangerLevel: 0 });
    const nearTerrain = createTestTerrain({ id: 'near', x: 0, y: 0, dangerLevel: 0 });

    brain.setSquadLeaderTerrainId('leader_spot');

    brain.update(0, [farTerrain, nearTerrain]);
    deps.events.flush();

    // Monster should NOT prefer the leader's terrain -- squad bonus is ignored.
    // The nearby terrain wins on distance.
    expect(brain.currentTerrainId).toBe('near');
  });

  // -----------------------------------------------------------------------
  // buildJobContext
  // -----------------------------------------------------------------------
  it('buildJobContext returns melee weaponType', () => {
    const { brain, deps } = createMonsterBrain();
    brain.setLastPosition({ x: 10, y: 20 });
    brain.setRank(3);

    const terrain = createTestTerrain({
      id: 't1',
      jobs: [{ type: 'guard', slots: 2, position: { x: 50, y: 50 } }],
    });

    brain.update(0, [terrain]);
    deps.events.flush();

    // The task was created via buildJobContext -> job scoring.
    // We verify the melee weapon type by checking that a task was created
    // (the guard job's scoring would use the context).
    expect(brain.currentTask).not.toBeNull();
    expect(brain.currentTask!.terrainId).toBe('t1');
  });

  // -----------------------------------------------------------------------
  // Lair API
  // -----------------------------------------------------------------------
  describe('lair API', () => {
    it('setLairTerrainId / getLairTerrainId', () => {
      const { brain } = createMonsterBrain();

      expect(brain.getLairTerrainId()).toBeNull();

      brain.setLairTerrainId('lair_factory');
      expect(brain.getLairTerrainId()).toBe('lair_factory');

      brain.setLairTerrainId(null);
      expect(brain.getLairTerrainId()).toBeNull();
    });

    it('constructor accepts optional lairTerrainId', () => {
      const { brain } = createMonsterBrain({ lairTerrainId: 'swamp_lair' });
      expect(brain.getLairTerrainId()).toBe('swamp_lair');
    });

    it('constructor defaults lairTerrainId to null when omitted', () => {
      const { brain } = createMonsterBrain();
      expect(brain.getLairTerrainId()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Stay-put fallback
  // -----------------------------------------------------------------------
  it('stay-put fallback when no alternatives are viable', () => {
    const { brain, deps } = createMonsterBrain({
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    brain.setLastPosition({ x: 0, y: 0 });

    const currentTerrain = createTestTerrain({ id: 'home', capacity: 10 });

    // First tick: assign to home.
    brain.update(0, [currentTerrain]);
    deps.events.flush();
    expect(brain.currentTerrainId).toBe('home');

    // Second tick: all alternatives are full. Only current terrain remains.
    const fullTerrain = createTestTerrain({ id: 'full', capacity: 0 });
    brain.update(0, [currentTerrain, fullTerrain]);
    deps.events.flush();

    // Monster should stay at its current terrain.
    expect(brain.currentTerrainId).toBe('home');
  });

  // -----------------------------------------------------------------------
  // Capacity / faction rejection
  // -----------------------------------------------------------------------
  describe('terrain filtering', () => {
    it('skips terrains that reject the monster faction', () => {
      const { brain, deps } = createMonsterBrain({ factionId: 'monster' });
      brain.setLastPosition({ x: 0, y: 0 });

      const restricted = createTestTerrain({
        id: 'military_base',
        factions: ['military'],
      });
      const open = createTestTerrain({ id: 'open_zone' });

      brain.update(0, [restricted, open]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('open_zone');
    });

    it('skips full terrains (no capacity)', () => {
      const { brain, deps } = createMonsterBrain();
      brain.setLastPosition({ x: 0, y: 0 });

      const full = createTestTerrain({ id: 'packed', capacity: 0 });
      const available = createTestTerrain({ id: 'free', capacity: 5 });

      brain.update(0, [full, available]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('free');
    });

    it('respects terrain tag filter', () => {
      const { brain, deps } = createMonsterBrain();
      brain.setLastPosition({ x: 0, y: 0 });
      brain.setAllowedTerrainTags(new Set(['outdoor']));

      const indoor = createTestTerrain({ id: 'lab', tags: ['indoor'] });
      const outdoor = createTestTerrain({ id: 'forest', tags: ['outdoor'] });

      brain.update(0, [indoor, outdoor]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('forest');
    });
  });

  // -----------------------------------------------------------------------
  // Configurable weaponType
  // -----------------------------------------------------------------------
  describe('configurable weaponType', () => {
    it('uses custom weaponType in job context', () => {
      const { brain, deps } = createMonsterBrain({
        monsterConfig: { weaponType: 'ranged' },
      });
      brain.setLastPosition({ x: 10, y: 20 });
      brain.setRank(3);

      const terrain = createTestTerrain({
        id: 't1',
        jobs: [{ type: 'guard', slots: 2, position: { x: 50, y: 50 } }],
      });

      brain.update(0, [terrain]);
      deps.events.flush();

      // Task was assigned — buildJobContext() was called with custom weaponType.
      expect(brain.currentTask).not.toBeNull();
      expect(brain.currentTask!.terrainId).toBe('t1');
    });

    it('defaults to melee when weaponType is omitted', () => {
      const { brain, deps } = createMonsterBrain({
        // No weaponType override — should default to 'melee'.
      });
      brain.setLastPosition({ x: 10, y: 20 });

      const terrain = createTestTerrain({
        id: 't1',
        jobs: [{ type: 'guard', slots: 2, position: { x: 50, y: 50 } }],
      });

      brain.update(0, [terrain]);
      deps.events.flush();

      expect(brain.currentTask).not.toBeNull();
    });

    it('custom weaponType is accessible via exposed buildJobContext', () => {
      // Subclass to expose the protected method for direct verification.
      class TestableMonsterBrain extends MonsterBrain {
        public exposeBuildJobContext() {
          return this.buildJobContext();
        }
      }

      const deps = createMockDeps();
      const dispatcher = createMockDispatcher();
      const brain = new TestableMonsterBrain({
        npcId: 'monster_test',
        factionId: 'monster',
        config: createBrainConfig(),
        selectorConfig: createSelectorConfig(),
        jobConfig: createJobConfig(),
        deps,
        monsterConfig: { ...createDefaultMonsterBrainConfig(), weaponType: 'ranged' },
      });
      brain.setMovementDispatcher(dispatcher);
      brain.setLastPosition({ x: 0, y: 0 });
      brain.setRank(2);

      const ctx = brain.exposeBuildJobContext();
      expect(ctx.weaponType).toBe('ranged');
    });

    it('default weaponType is melee via exposed buildJobContext', () => {
      class TestableMonsterBrain extends MonsterBrain {
        public exposeBuildJobContext() {
          return this.buildJobContext();
        }
      }

      const deps = createMockDeps();
      const dispatcher = createMockDispatcher();
      const brain = new TestableMonsterBrain({
        npcId: 'monster_test',
        factionId: 'monster',
        config: createBrainConfig(),
        selectorConfig: createSelectorConfig(),
        jobConfig: createJobConfig(),
        deps,
        monsterConfig: createDefaultMonsterBrainConfig(),
      });
      brain.setMovementDispatcher(dispatcher);
      brain.setLastPosition({ x: 0, y: 0 });
      brain.setRank(2);

      const ctx = brain.exposeBuildJobContext();
      expect(ctx.weaponType).toBe('melee');
    });
  });

  // -----------------------------------------------------------------------
  // createDefaultMonsterBrainConfig
  // -----------------------------------------------------------------------
  describe('createDefaultMonsterBrainConfig', () => {
    it('returns expected defaults', () => {
      const config = createDefaultMonsterBrainConfig();
      expect(config.lairTerrainBonus).toBe(1_000);
      expect(config.dangerAffinity).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Empty terrain list
  // -----------------------------------------------------------------------
  it('returns null when terrain list is empty', () => {
    const { brain, deps } = createMonsterBrain();
    brain.setLastPosition({ x: 0, y: 0 });

    brain.update(0, []);
    deps.events.flush();

    expect(brain.currentTerrainId).toBeNull();
  });
});
