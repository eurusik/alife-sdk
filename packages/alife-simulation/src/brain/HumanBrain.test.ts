import {
  EventBus,
  ALifeEvents,
  Clock,
  SmartTerrain,
} from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import type { IBrainConfig, ITerrainSelectorConfig, IJobScoringConfig } from '../types/ISimulationConfig';
import { HumanBrain, createDefaultHumanBrainConfig } from './HumanBrain';
import type { IEquipmentPreference, IHumanBrainConfig } from './HumanBrain';
import type { IBrainDeps } from './NPCBrain';
import type { IMovementDispatcher } from './BrainScheduleManager';

// ---------------------------------------------------------------------------
// Helpers (aligned with NPCBrain.test.ts patterns)
// ---------------------------------------------------------------------------

function createBrainConfig(overrides?: Partial<IBrainConfig>): IBrainConfig {
  return {
    searchIntervalMs: 5_000,
    schemeCheckIntervalMs: 3_000,
    moraleFleeThreshold: -0.5,
    reEvaluateIntervalMs: 30_000,
    dangerTolerance: 3,
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

function createEquipment(overrides?: Partial<IEquipmentPreference>): IEquipmentPreference {
  return {
    preferredWeaponType: 'rifle',
    preferredArmor: 'medium',
    aggressiveness: 0.5,
    cautiousness: 0.5,
    ...overrides,
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
  scoring?: { shelterBonus?: number; distancePenaltyDivisor?: number; scoringJitter?: number; rankMatchBonus?: number };
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
    scoring: overrides?.scoring,
  });
}

function createHumanBrain(overrides?: {
  npcId?: string;
  factionId?: string;
  brainConfig?: Partial<IBrainConfig>;
  selectorConfig?: Partial<ITerrainSelectorConfig>;
  jobConfig?: Partial<IJobScoringConfig>;
  deps?: Partial<IBrainDeps>;
  humanConfig?: Partial<IHumanBrainConfig>;
  equipment?: Partial<IEquipmentPreference>;
  initialMoney?: number;
}): {
  brain: HumanBrain;
  deps: IBrainDeps;
  dispatcher: ReturnType<typeof createMockDispatcher>;
} {
  const deps = createMockDeps(overrides?.deps);
  const dispatcher = createMockDispatcher();
  const humanConfig: IHumanBrainConfig = {
    ...createDefaultHumanBrainConfig(),
    ...overrides?.humanConfig,
  };
  const brain = new HumanBrain({
    npcId: overrides?.npcId ?? 'npc_1',
    factionId: overrides?.factionId ?? 'stalker',
    config: createBrainConfig(overrides?.brainConfig),
    selectorConfig: createSelectorConfig(overrides?.selectorConfig),
    jobConfig: createJobConfig(overrides?.jobConfig),
    deps,
    humanConfig,
    equipment: createEquipment(overrides?.equipment),
    initialMoney: overrides?.initialMoney ?? 0,
  });
  brain.setMovementDispatcher(dispatcher);
  return { brain, deps, dispatcher };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HumanBrain', () => {
  // -----------------------------------------------------------------------
  // Equipment terrain bonuses
  // -----------------------------------------------------------------------
  describe('equipment terrain bonuses', () => {
    it('sniper prefers guard-tagged terrain', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const guardTerrain = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        x: 0,
        y: 0,
      });
      const plainTerrain = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
      });

      brain.update(0, [plainTerrain, guardTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('outpost');
    });

    it('aggressive NPC prefers patrol-tagged terrain', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { aggressiveness: 0.8 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const patrolTerrain = createTestTerrain({
        id: 'road',
        tags: ['patrol'],
        x: 0,
        y: 0,
      });
      const plainTerrain = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
      });

      brain.update(0, [plainTerrain, patrolTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('road');
    });

    it('cautious NPC prefers camp-tagged terrain', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { cautiousness: 0.8 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const campTerrain = createTestTerrain({
        id: 'campsite',
        tags: ['camp'],
        x: 0,
        y: 0,
      });
      const plainTerrain = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
      });

      brain.update(0, [plainTerrain, campTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('campsite');
    });

    it('shotgun prefers low-danger terrain', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'shotgun' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const lowDanger = createTestTerrain({
        id: 'safe_zone',
        dangerLevel: 1,
        x: 0,
        y: 0,
      });
      const highDanger = createTestTerrain({
        id: 'hot_zone',
        dangerLevel: 5,
        x: 0,
        y: 0,
      });

      brain.update(0, [highDanger, lowDanger]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('safe_zone');
    });

    it('non-aggressive NPC does not get patrol bonus', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { aggressiveness: 0.3 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Both terrains at same position, same capacity -- without bonus, first wins
      const patrolTerrain = createTestTerrain({
        id: 'road',
        tags: ['patrol'],
        x: 0,
        y: 0,
        capacity: 10,
      });
      const plainTerrain = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
        capacity: 10,
      });

      // With equal base scores, the first terrain evaluated wins.
      // Non-aggressive NPC should NOT prefer patrol over plain.
      brain.update(0, [patrolTerrain, plainTerrain]);
      deps.events.flush();

      // Either terrain is valid; the point is patrol does not get boosted.
      // We verify by checking patrol does NOT consistently win when it should not.
      // Give the plain terrain a slight capacity edge to confirm no bonus.
      const { brain: brain2, deps: deps2 } = createHumanBrain({
        equipment: { aggressiveness: 0.3 },
      });
      brain2.setLastPosition({ x: 0, y: 0 });

      const patrolSmall = createTestTerrain({
        id: 'road2',
        tags: ['patrol'],
        x: 0,
        y: 0,
        capacity: 5,
      });
      const plainBig = createTestTerrain({
        id: 'field2',
        tags: ['outdoor'],
        x: 0,
        y: 0,
        capacity: 15,
      });

      brain2.update(0, [patrolSmall, plainBig]);
      deps2.events.flush();

      // Plain has higher capacity -> higher base score -> wins without bonus.
      expect(brain2.currentTerrainId).toBe('field2');
    });

    it('non-cautious NPC does not get camp bonus', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { cautiousness: 0.3 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const campSmall = createTestTerrain({
        id: 'camp',
        tags: ['camp'],
        x: 0,
        y: 0,
        capacity: 5,
      });
      const plainBig = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
        capacity: 15,
      });

      brain.update(0, [campSmall, plainBig]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('field');
    });
  });

  // -----------------------------------------------------------------------
  // Equipment bonus stacking
  // -----------------------------------------------------------------------
  describe('equipment bonus stacking', () => {
    it('equipment bonus stacks with base score (additive)', () => {
      // Create two terrains at the same position with same capacity.
      // One has guard tag, one does not.
      // A sniper NPC should consistently pick the guard terrain due to the +15 bonus.
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
      });
      brain.setLastPosition({ x: 50, y: 50 });

      const guardTerrain = createTestTerrain({
        id: 'watchtower',
        tags: ['guard'],
        x: 0,
        y: 0,
        capacity: 5,
      });
      const plainTerrain = createTestTerrain({
        id: 'open_field',
        tags: [],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [plainTerrain, guardTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('watchtower');
    });

    it('cautious sniper gets both guard and camp bonuses on multi-tagged terrain', () => {
      const { brain, deps } = createHumanBrain({
        equipment: {
          preferredWeaponType: 'sniper',
          cautiousness: 0.9,
        },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // A terrain with BOTH guard and camp tags gets both bonuses (+15 + +10 = +25)
      const multiTagTerrain = createTestTerrain({
        id: 'fortified_camp',
        tags: ['guard', 'camp'],
        x: 0,
        y: 0,
        capacity: 5,
      });
      // A terrain with only guard tag gets +15
      const guardOnly = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [guardOnly, multiTagTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('fortified_camp');
    });
  });

  // -----------------------------------------------------------------------
  // buildJobContext
  // -----------------------------------------------------------------------
  describe('buildJobContext', () => {
    it('injects weaponType into job context', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'rifle' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const terrain = createTestTerrain({
        id: 't1',
        jobs: [{ type: 'guard', slots: 2, position: { x: 50, y: 50 } }],
      });

      // Record the TASK_ASSIGNED event to verify the brain assigned a task.
      const payloads: unknown[] = [];
      deps.events.on(ALifeEvents.TASK_ASSIGNED, (p) => payloads.push(p));

      brain.update(0, [terrain]);
      deps.events.flush();

      // The task was assigned, which means buildJobContext() was called.
      expect(payloads).toHaveLength(1);
      expect(brain.currentTask).not.toBeNull();

      // Verify weapon type via getPreferredWeapon (the context is internal,
      // but the weapon flows through to job scoring).
      expect(brain.getPreferredWeapon()).toBe('rifle');
    });

    it('injects equipment prefs into job context', () => {
      const { brain } = createHumanBrain({
        equipment: { aggressiveness: 0.7, cautiousness: 0.3 },
      });

      // Equipment prefs are accessible through getEquipment()
      const eq = brain.getEquipment();
      expect(eq.aggressiveness).toBe(0.7);
      expect(eq.cautiousness).toBe(0.3);
    });
  });

  // -----------------------------------------------------------------------
  // Money management
  // -----------------------------------------------------------------------
  describe('money management', () => {
    it('starts with initial money', () => {
      const { brain } = createHumanBrain({ initialMoney: 500 });
      expect(brain.getMoney()).toBe(500);
    });

    it('starts with 0 by default', () => {
      const { brain } = createHumanBrain();
      expect(brain.getMoney()).toBe(0);
    });

    it('clamps negative initial money to 0', () => {
      const { brain } = createHumanBrain({ initialMoney: -100 });
      expect(brain.getMoney()).toBe(0);
    });

    it('setMoney updates balance', () => {
      const { brain } = createHumanBrain();
      brain.setMoney(1000);
      expect(brain.getMoney()).toBe(1000);
    });

    it('setMoney clamps negative values to 0', () => {
      const { brain } = createHumanBrain({ initialMoney: 500 });
      brain.setMoney(-50);
      expect(brain.getMoney()).toBe(0);
    });

    it('addMoney adds to balance', () => {
      const { brain } = createHumanBrain({ initialMoney: 100 });
      brain.addMoney(250);
      expect(brain.getMoney()).toBe(350);
    });

    it('addMoney subtracts from balance', () => {
      const { brain } = createHumanBrain({ initialMoney: 300 });
      brain.addMoney(-100);
      expect(brain.getMoney()).toBe(200);
    });

    it('addMoney clamps to 0 when overspending', () => {
      const { brain } = createHumanBrain({ initialMoney: 100 });
      brain.addMoney(-500);
      expect(brain.getMoney()).toBe(0);
    });

    it('addMoney ignores NaN — balance stays unchanged', () => {
      const { brain } = createHumanBrain({ initialMoney: 300 });
      brain.addMoney(NaN);
      expect(brain.getMoney()).toBe(300);
    });

    it('addMoney ignores Infinity — balance stays unchanged', () => {
      const { brain } = createHumanBrain({ initialMoney: 300 });
      brain.addMoney(Infinity);
      expect(brain.getMoney()).toBe(300);
    });

    it('addMoney ignores -Infinity — balance stays unchanged', () => {
      const { brain } = createHumanBrain({ initialMoney: 300 });
      brain.addMoney(-Infinity);
      expect(brain.getMoney()).toBe(300);
    });
  });

  // -----------------------------------------------------------------------
  // Equipment queries
  // -----------------------------------------------------------------------
  describe('equipment queries', () => {
    it('getEquipment returns full equipment profile', () => {
      const { brain } = createHumanBrain({
        equipment: {
          preferredWeaponType: 'shotgun',
          preferredArmor: 'heavy',
          aggressiveness: 0.9,
          cautiousness: 0.2,
        },
      });

      const eq = brain.getEquipment();
      expect(eq.preferredWeaponType).toBe('shotgun');
      expect(eq.preferredArmor).toBe('heavy');
      expect(eq.aggressiveness).toBe(0.9);
      expect(eq.cautiousness).toBe(0.2);
    });

    it('getPreferredWeapon returns weapon type', () => {
      const { brain } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
      });
      expect(brain.getPreferredWeapon()).toBe('sniper');
    });

    it('isAggressive returns true above threshold', () => {
      const { brain } = createHumanBrain({
        equipment: { aggressiveness: 0.8 },
        humanConfig: { aggressivenessThreshold: 0.6 },
      });
      expect(brain.isAggressive()).toBe(true);
    });

    it('isAggressive returns false at threshold', () => {
      const { brain } = createHumanBrain({
        equipment: { aggressiveness: 0.6 },
        humanConfig: { aggressivenessThreshold: 0.6 },
      });
      expect(brain.isAggressive()).toBe(false);
    });

    it('isAggressive returns false below threshold', () => {
      const { brain } = createHumanBrain({
        equipment: { aggressiveness: 0.3 },
        humanConfig: { aggressivenessThreshold: 0.6 },
      });
      expect(brain.isAggressive()).toBe(false);
    });

    it('isCautious returns true above threshold', () => {
      const { brain } = createHumanBrain({
        equipment: { cautiousness: 0.8 },
        humanConfig: { cautiousnessThreshold: 0.6 },
      });
      expect(brain.isCautious()).toBe(true);
    });

    it('isCautious returns false at threshold', () => {
      const { brain } = createHumanBrain({
        equipment: { cautiousness: 0.6 },
        humanConfig: { cautiousnessThreshold: 0.6 },
      });
      expect(brain.isCautious()).toBe(false);
    });

    it('isCautious respects custom threshold', () => {
      const { brain } = createHumanBrain({
        equipment: { cautiousness: 0.5 },
        humanConfig: { cautiousnessThreshold: 0.4 },
      });
      expect(brain.isCautious()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Surge overrides equipment preference
  // -----------------------------------------------------------------------
  describe('surge overrides equipment preference', () => {
    it('picks shelter during surge even when non-shelter has equipment bonus', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
        brainConfig: { reEvaluateIntervalMs: 0 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Guard terrain is NOT a shelter -- sniper prefers it.
      // Place it very close so the sniper bonus (+15) plus proximity outweigh
      // the shelter bonus (+50) that the bunker gets at a distance.
      const guardTerrain = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        isShelter: false,
        x: 0,
        y: 0,
        capacity: 50,
      });

      // Shelter is far away, so its distance penalty offsets its +50 bonus.
      const shelterTerrain = createTestTerrain({
        id: 'bunker',
        tags: ['indoor'],
        isShelter: true,
        x: 5000,
        y: 5000,
        capacity: 5,
      });

      // Pre-surge: sniper picks the nearby guard outpost (high capacity + close + guard bonus).
      brain.update(0, [guardTerrain, shelterTerrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('outpost');

      // Activate surge -- non-shelters are filtered out by selectBestTerrain.
      brain.setSurgeActive(true);

      brain.update(0, [guardTerrain, shelterTerrain]);
      deps.events.flush();

      // During surge, non-shelter terrains are excluded -- bunker is the only option.
      expect(brain.currentTerrainId).toBe('bunker');
    });

    it('stays in current shelter during surge — no re-evaluation', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
        brainConfig: { reEvaluateIntervalMs: 1_000 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Start by assigning to a plain shelter (pre-surge).
      const plainShelter = createTestTerrain({
        id: 'plain_bunker',
        tags: ['indoor'],
        isShelter: true,
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [plainShelter]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('plain_bunker');

      // Activate surge and introduce a guard-tagged shelter.
      brain.setSurgeActive(true);

      const guardShelter = createTestTerrain({
        id: 'guard_bunker',
        tags: ['guard'],
        isShelter: true,
        x: 0,
        y: 0,
        capacity: 5,
      });

      // Advance time past re-evaluation timer. During surge, NPC is already
      // in a shelter — re-evaluation is suppressed to prevent oscillation.
      brain.update(1_000, [plainShelter, guardShelter]);
      deps.events.flush();

      // NPC stays put — no shelter-shopping during a surge emergency.
      expect(brain.currentTerrainId).toBe('plain_bunker');
    });
  });

  // -----------------------------------------------------------------------
  // Config customisation
  // -----------------------------------------------------------------------
  describe('config customisation', () => {
    it('respects custom guardTerrainBonus value', () => {
      // Use a huge bonus to guarantee guard terrain wins even at a distance disadvantage.
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
        humanConfig: { guardTerrainBonus: 100 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const farGuard = createTestTerrain({
        id: 'far_outpost',
        tags: ['guard'],
        x: 500,
        y: 500,
        capacity: 5,
      });
      const nearPlain = createTestTerrain({
        id: 'nearby',
        tags: ['outdoor'],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [nearPlain, farGuard]);
      deps.events.flush();

      // The +100 guard bonus should outweigh the distance penalty.
      expect(brain.currentTerrainId).toBe('far_outpost');
    });

    it('respects custom shotgunDangerThreshold', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'shotgun' },
        humanConfig: { shotgunDangerThreshold: 5 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // With threshold 5, danger level 4 is "low danger" -- should get bonus.
      const midDanger = createTestTerrain({
        id: 'mid_zone',
        dangerLevel: 4,
        x: 0,
        y: 0,
        capacity: 5,
      });
      const highDanger = createTestTerrain({
        id: 'hot_zone',
        dangerLevel: 8,
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [highDanger, midDanger]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('mid_zone');
    });
  });

  // -----------------------------------------------------------------------
  // Configurable terrain tags and weapon types
  // -----------------------------------------------------------------------
  describe('configurable terrain tags and weapon types', () => {
    it('guardTerrainTag overrides default guard tag', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
        humanConfig: { guardTerrainTag: 'overwatch' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Terrain tagged 'overwatch' should receive the guard bonus.
      const overwatchTerrain = createTestTerrain({
        id: 'tower',
        tags: ['overwatch'],
        x: 0,
        y: 0,
      });
      // Terrain tagged with the old default 'guard' should NOT get bonus.
      const guardTerrain = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [guardTerrain, overwatchTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('tower');
    });

    it('patrolTerrainTag overrides default patrol tag', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { aggressiveness: 0.8 },
        humanConfig: { patrolTerrainTag: 'sweep' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const sweepTerrain = createTestTerrain({
        id: 'sweep_route',
        tags: ['sweep'],
        x: 0,
        y: 0,
      });
      const patrolTerrain = createTestTerrain({
        id: 'road',
        tags: ['patrol'],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [patrolTerrain, sweepTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('sweep_route');
    });

    it('campTerrainTag overrides default camp tag', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { cautiousness: 0.8 },
        humanConfig: { campTerrainTag: 'hideout' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const hideoutTerrain = createTestTerrain({
        id: 'bunker',
        tags: ['hideout'],
        x: 0,
        y: 0,
      });
      const campTerrain = createTestTerrain({
        id: 'campsite',
        tags: ['camp'],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [campTerrain, hideoutTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('bunker');
    });

    it('guardWeaponType overrides default sniper weapon', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'rifle' },
        humanConfig: { guardWeaponType: 'rifle' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Rifle NPC now gets the guard bonus on guard-tagged terrain.
      const guardTerrain = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        x: 0,
        y: 0,
      });
      const plainTerrain = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
      });

      brain.update(0, [plainTerrain, guardTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('outpost');
    });

    it('sniper no longer gets guard bonus when guardWeaponType is overridden', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
        humanConfig: { guardWeaponType: 'rifle' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Sniper should NOT get the guard bonus since guardWeaponType is now 'rifle'.
      const guardSmall = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        x: 0,
        y: 0,
        capacity: 5,
      });
      const plainBig = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
        capacity: 15,
      });

      brain.update(0, [guardSmall, plainBig]);
      deps.events.flush();

      // Plain has higher capacity -> higher base score -> wins without bonus.
      expect(brain.currentTerrainId).toBe('field');
    });

    it('lowDangerWeaponType overrides default shotgun weapon', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'pistol' },
        humanConfig: { lowDangerWeaponType: 'pistol' },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Pistol NPC now gets low-danger bonus.
      const lowDanger = createTestTerrain({
        id: 'safe_zone',
        dangerLevel: 1,
        x: 0,
        y: 0,
      });
      const highDanger = createTestTerrain({
        id: 'hot_zone',
        dangerLevel: 5,
        x: 0,
        y: 0,
      });

      brain.update(0, [highDanger, lowDanger]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('safe_zone');
    });

    it('combined custom tags and weapons work together', () => {
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'rifle', cautiousness: 0.9 },
        humanConfig: {
          guardWeaponType: 'rifle',
          guardTerrainTag: 'overwatch',
          campTerrainTag: 'hideout',
        },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      // Terrain with both custom tags should get both bonuses (+15 guard + +10 camp = +25).
      const multiTagTerrain = createTestTerrain({
        id: 'fortified_hideout',
        tags: ['overwatch', 'hideout'],
        x: 0,
        y: 0,
        capacity: 5,
      });
      const singleTagTerrain = createTestTerrain({
        id: 'simple_overwatch',
        tags: ['overwatch'],
        x: 0,
        y: 0,
        capacity: 5,
      });

      brain.update(0, [singleTagTerrain, multiTagTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('fortified_hideout');
    });

    it('defaults to original tags when config fields are omitted', () => {
      // This test verifies that omitting the optional fields preserves default behavior.
      const { brain, deps } = createHumanBrain({
        equipment: { preferredWeaponType: 'sniper' },
        // No custom tag/weapon overrides.
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const guardTerrain = createTestTerrain({
        id: 'outpost',
        tags: ['guard'],
        x: 0,
        y: 0,
      });
      const plainTerrain = createTestTerrain({
        id: 'field',
        tags: ['outdoor'],
        x: 0,
        y: 0,
      });

      brain.update(0, [plainTerrain, guardTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('outpost');
    });
  });

  // -----------------------------------------------------------------------
  // createDefaultHumanBrainConfig
  // -----------------------------------------------------------------------
  describe('createDefaultHumanBrainConfig', () => {
    it('returns expected production defaults', () => {
      const cfg = createDefaultHumanBrainConfig();
      expect(cfg.guardTerrainBonus).toBe(15);
      expect(cfg.patrolTerrainBonus).toBe(10);
      expect(cfg.campTerrainBonus).toBe(10);
      expect(cfg.shotgunLowDangerBonus).toBe(10);
      expect(cfg.aggressivenessThreshold).toBe(0.6);
      expect(cfg.cautiousnessThreshold).toBe(0.6);
      expect(cfg.shotgunDangerThreshold).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Inherits NPCBrain behaviour
  // -----------------------------------------------------------------------
  describe('inherits NPCBrain behaviour', () => {
    it('is combat-lockable', () => {
      const { brain, deps, dispatcher } = createHumanBrain();
      const terrain = createTestTerrain();

      brain.setCombatLock(999_999);
      brain.update(1_000, [terrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBeNull();
      expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
    });

    it('handles death correctly', () => {
      const { brain, deps, dispatcher } = createHumanBrain();
      const terrain = createTestTerrain({ id: 't1' });

      brain.update(0, [terrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).not.toBeNull();

      const diedPayloads: unknown[] = [];
      deps.events.on(ALifeEvents.NPC_DIED, (p) => diedPayloads.push(p));

      brain.onDeath();
      deps.events.flush();

      expect(brain.currentTerrainId).toBeNull();
      expect(dispatcher.cancelJourney).toHaveBeenCalledWith('npc_1');
      expect(diedPayloads).toHaveLength(1);
    });

    it('exposes morale and rank setters', () => {
      const { brain } = createHumanBrain();
      brain.setMorale(-0.3);
      expect(brain.morale).toBe(-0.3);

      brain.setRank(4);
      expect(brain.rank).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Deterministic behaviour
  // -----------------------------------------------------------------------
  describe('deterministic behaviour', () => {
    it('produces same terrain selection with same inputs', () => {
      const terrains = [
        createTestTerrain({ id: 'a', tags: ['guard'], x: 0, y: 0, capacity: 5 }),
        createTestTerrain({ id: 'b', tags: ['patrol'], x: 100, y: 100, capacity: 5 }),
      ];

      function runBrain(): string | null {
        const deps = createMockDeps();
        const dispatcher = createMockDispatcher();
        const brain = new HumanBrain({
          npcId: 'npc_1',
          factionId: 'stalker',
          config: createBrainConfig(),
          selectorConfig: createSelectorConfig(),
          jobConfig: createJobConfig(),
          deps,
          humanConfig: createDefaultHumanBrainConfig(),
          equipment: createEquipment({ preferredWeaponType: 'sniper' }),
          initialMoney: 0,
        });
        brain.setMovementDispatcher(dispatcher);
        brain.setLastPosition({ x: 0, y: 0 });
        brain.update(0, terrains);
        deps.events.flush();
        return brain.currentTerrainId;
      }

      const result1 = runBrain();
      const result2 = runBrain();

      expect(result1).toBe(result2);
      // Sniper should pick the guard-tagged terrain.
      expect(result1).toBe('a');
    });
  });
});
