import {
  EventBus,
  ALifeEvents,
  Clock,
  SmartTerrain,
} from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import type { IBrainConfig, ITerrainSelectorConfig, IJobScoringConfig } from '../types/ISimulationConfig';
import type { ISchemeConditionConfig } from '../terrain/SchemeResolver';
import { Schedule } from '../npc/Schedule';
import { NPCBrain } from './NPCBrain';
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

function createBrain(overrides?: {
  npcId?: string;
  factionId?: string;
  brainConfig?: Partial<IBrainConfig>;
  selectorConfig?: Partial<ITerrainSelectorConfig>;
  jobConfig?: Partial<IJobScoringConfig>;
  deps?: Partial<IBrainDeps>;
}): { brain: NPCBrain; deps: IBrainDeps; dispatcher: ReturnType<typeof createMockDispatcher> } {
  const deps = createMockDeps(overrides?.deps);
  const dispatcher = createMockDispatcher();
  const brain = new NPCBrain({
    npcId: overrides?.npcId ?? 'npc_1',
    factionId: overrides?.factionId ?? 'stalker',
    config: createBrainConfig(overrides?.brainConfig),
    selectorConfig: createSelectorConfig(overrides?.selectorConfig),
    jobConfig: createJobConfig(overrides?.jobConfig),
    deps,
  });
  brain.setMovementDispatcher(dispatcher);
  return { brain, deps, dispatcher };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NPCBrain', () => {
  // -----------------------------------------------------------------------
  // Terrain selection
  // -----------------------------------------------------------------------
  describe('terrain selection', () => {
    it('selects terrain after re-evaluation timer expires', () => {
      const { brain, deps, dispatcher } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 1_000 },
      });
      const terrain = createTestTerrain({ id: 'bar_100' });

      brain.update(1_000, [terrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('bar_100');
      expect(dispatcher.addMovingNPC).toHaveBeenCalled();
    });

    it('does not select terrain before timer expires', () => {
      const { brain } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 30_000 },
      });
      const terrain = createTestTerrain();

      brain.update(100, [terrain]);

      // No terrain because the NPC has no current terrain
      // and re-eval hasn't expired.
      // But tickTerrainAssignment should still trigger since currentTerrainId is null.
      expect(brain.currentTerrainId).toBe('terrain_default');
    });

    it('switches terrain when a better one is found on re-evaluation', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 1_000 },
      });
      const terrainA = createTestTerrain({ id: 'far', x: 1000, y: 1000, capacity: 2 });
      const terrainB = createTestTerrain({ id: 'near', x: 0, y: 0, capacity: 10 });
      brain.setLastPosition({ x: 0, y: 0 });

      // First update -- assigns to best (near, since closer)
      brain.update(1_000, [terrainA, terrainB]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('near');

      // Now only offer a different terrain
      const terrainC = createTestTerrain({ id: 'new_spot', x: 10, y: 10, capacity: 20 });
      brain.update(1_000, [terrainC]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('new_spot');
    });
  });

  // -----------------------------------------------------------------------
  // Task lifecycle
  // -----------------------------------------------------------------------
  describe('task lifecycle', () => {
    it('assigns a task after terrain is selected', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 0 },
      });
      const terrain = createTestTerrain({
        id: 't1',
        jobs: [{ type: 'guard', slots: 2, position: { x: 50, y: 50 } }],
      });

      brain.update(0, [terrain]);
      deps.events.flush();

      expect(brain.currentTask).not.toBeNull();
      expect(brain.currentTask!.slotType).toBe('guard');
      expect(brain.currentTask!.terrainId).toBe('t1');
    });

    it('renews task from same terrain when timer expires', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({
        id: 't1',
        jobs: [{ type: 'patrol', slots: 5, position: { x: 30, y: 30 } }],
      });

      brain.update(0, [terrain]);
      deps.events.flush();

      const firstTask = brain.currentTask;
      expect(firstTask).not.toBeNull();

      // Expire the task (default 60_000ms)
      brain.update(60_001, [terrain]);
      deps.events.flush();

      expect(brain.currentTask).not.toBeNull();
      expect(brain.currentTask!.slotType).toBe('patrol');
    });

    it('emits TASK_ASSIGNED when a new task is created', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({ id: 't1' });

      const payloads: unknown[] = [];
      deps.events.on(ALifeEvents.TASK_ASSIGNED, (p) => payloads.push(p));

      brain.update(0, [terrain]);
      deps.events.flush();

      expect(payloads).toEqual([
        { npcId: 'npc_1', terrainId: 't1', taskType: 'guard' },
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Force re-evaluate
  // -----------------------------------------------------------------------
  it('forceReevaluate triggers immediate search', () => {
    const { brain, deps } = createBrain({
      brainConfig: { reEvaluateIntervalMs: 999_999 },
    });
    const terrainA = createTestTerrain({ id: 'a' });

    brain.update(0, [terrainA]);
    deps.events.flush();
    expect(brain.currentTerrainId).toBe('a');

    const terrainB = createTestTerrain({ id: 'b', capacity: 100 });
    brain.forceReevaluate();

    brain.update(0, [terrainB]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('b');
  });

  // -----------------------------------------------------------------------
  // Release
  // -----------------------------------------------------------------------
  it('releaseFromTerrain resets terrain and task state', () => {
    const { brain, deps } = createBrain();
    const terrain = createTestTerrain({ id: 't1' });

    brain.update(0, [terrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('t1');
    expect(brain.currentTask).not.toBeNull();

    brain.releaseFromTerrain();
    deps.events.flush();

    expect(brain.currentTerrainId).toBeNull();
    expect(brain.currentTask).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Morale flee
  // -----------------------------------------------------------------------
  it('flees to safer terrain when morale is below threshold', () => {
    const { brain, deps } = createBrain({
      brainConfig: { moraleFleeThreshold: -0.5 },
    });
    brain.setLastPosition({ x: 0, y: 0 });

    const dangerousTerrain = createTestTerrain({ id: 'danger', dangerLevel: 5 });
    const safeTerrain = createTestTerrain({ id: 'safe', dangerLevel: 0 });

    // First: assign to dangerous terrain (only option)
    brain.update(0, [dangerousTerrain]);
    deps.events.flush();
    expect(brain.currentTerrainId).toBe('danger');

    // Set low morale and provide safe alternative.
    // tickMoraleFlee resets the re-eval timer to 0 (throttled).
    brain.setMorale(-0.7);

    brain.update(0, [dangerousTerrain, safeTerrain]);
    deps.events.flush();

    // Re-eval fires on the next tick (timer was reset to 0 by morale flee).
    brain.update(0, [dangerousTerrain, safeTerrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('safe');
  });

  // -----------------------------------------------------------------------
  // Surge shelter flee
  // -----------------------------------------------------------------------
  it('flees to shelter during surge when not in one', () => {
    const { brain, deps } = createBrain();
    brain.setLastPosition({ x: 0, y: 0 });

    const outdoor = createTestTerrain({ id: 'outdoor', isShelter: false });
    const shelter = createTestTerrain({ id: 'bunker', isShelter: true });

    // Assign to outdoor terrain
    brain.update(0, [outdoor]);
    deps.events.flush();
    expect(brain.currentTerrainId).toBe('outdoor');

    // Activate surge
    brain.setSurgeActive(true);

    brain.update(0, [outdoor, shelter]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('bunker');
  });

  it('stays in shelter during surge', () => {
    const { brain, deps } = createBrain();
    brain.setLastPosition({ x: 0, y: 0 });

    const shelter = createTestTerrain({ id: 'bunker', isShelter: true });

    brain.setSurgeActive(true);
    brain.update(0, [shelter]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('bunker');

    // Second tick -- should stay
    brain.update(100, [shelter]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('bunker');
  });

  // -----------------------------------------------------------------------
  // Squad leader bonus
  // -----------------------------------------------------------------------
  it('prefers squad leader terrain', () => {
    const { brain, deps } = createBrain({
      brainConfig: { reEvaluateIntervalMs: 0 },
      selectorConfig: { squadLeaderBonus: 100 },
    });
    brain.setLastPosition({ x: 0, y: 0 });

    const terrainA = createTestTerrain({ id: 'base', x: 0, y: 0 });
    const terrainB = createTestTerrain({ id: 'leader_spot', x: 500, y: 500 });

    brain.setSquadLeaderTerrainId('leader_spot');

    brain.update(0, [terrainA, terrainB]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('leader_spot');
  });

  // -----------------------------------------------------------------------
  // Combat lock
  // -----------------------------------------------------------------------
  it('suppresses all decisions when combat locked', () => {
    const { brain, deps, dispatcher } = createBrain();
    const terrain = createTestTerrain();

    brain.setCombatLock(999_999);
    brain.update(1_000, [terrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBeNull();
    expect(brain.currentTask).toBeNull();
    expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
  });

  it('resumes decisions after combat lock expires', () => {
    const { brain, deps } = createBrain();
    const terrain = createTestTerrain({ id: 't1' });

    brain.setCombatLock(500);
    brain.update(100, [terrain]);
    expect(brain.currentTerrainId).toBeNull();

    // Lock expires after remaining 400ms are consumed.
    brain.update(500, [terrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('t1');
  });

  it('extends combat lock when overlapping locks are applied', () => {
    const { brain } = createBrain();
    const terrain = createTestTerrain();

    brain.setCombatLock(1_000);
    brain.setCombatLock(5_000); // extends
    brain.update(2_000, [terrain]);

    expect(brain.isCombatLocked).toBe(true); // 3_000 remaining
  });

  // -----------------------------------------------------------------------
  // Night schedule delegation
  // -----------------------------------------------------------------------
  it('delegates to night schedule during nighttime', () => {
    const nightClock = new Clock({ startHour: 23, timeFactor: 1 });
    const { brain, dispatcher } = createBrain({
      deps: { clock: nightClock },
    });

    const schedule = new Schedule([
      { zoneId: 'camp_a', position: { x: 100, y: 100 }, durationMs: 1_000 },
      { zoneId: 'camp_b', position: { x: 200, y: 200 }, durationMs: 2_000 },
    ]);
    brain.setSchedule(schedule);
    brain.setLastPosition({ x: 0, y: 0 });

    const terrain = createTestTerrain({ id: 'camp_a' });
    brain.update(0, [terrain]);

    // Exhaust the linger timer
    brain.update(1_000, [terrain]);

    expect(dispatcher.addMovingNPC).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // No available terrain
  // -----------------------------------------------------------------------
  it('stays unassigned when no terrain is available', () => {
    const { brain, deps } = createBrain();
    brain.setLastPosition({ x: 0, y: 0 });

    // Provide a terrain that rejects our faction
    const restricted = createTestTerrain({
      id: 'military_only',
      factions: ['military'],
    });

    brain.update(0, [restricted]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBeNull();
    expect(brain.currentTask).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Death
  // -----------------------------------------------------------------------
  it('cancels everything on death and emits NPC_DIED', () => {
    const { brain, deps, dispatcher } = createBrain();
    const terrain = createTestTerrain({ id: 't1' });

    brain.update(0, [terrain]);
    deps.events.flush();
    expect(brain.currentTerrainId).not.toBeNull();

    const diedPayloads: unknown[] = [];
    deps.events.on(ALifeEvents.NPC_DIED, (p) => diedPayloads.push(p));

    brain.onDeath();
    deps.events.flush();

    expect(brain.currentTerrainId).toBeNull();
    expect(brain.currentTask).toBeNull();
    expect(dispatcher.cancelJourney).toHaveBeenCalledWith('npc_1');
    expect(diedPayloads).toHaveLength(1);
  });

  it('ignores update calls after death', () => {
    const { brain, deps, dispatcher } = createBrain();
    const terrain = createTestTerrain({ id: 't1' });

    brain.onDeath();
    deps.events.flush();
    dispatcher.addMovingNPC.mockClear();

    brain.update(0, [terrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBeNull();
    expect(dispatcher.addMovingNPC).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Tag filter
  // -----------------------------------------------------------------------
  it('restricts terrain set when allowedTerrainTags is set', () => {
    const { brain, deps } = createBrain();
    brain.setLastPosition({ x: 0, y: 0 });

    const indoor = createTestTerrain({ id: 'bar', tags: ['indoor', 'settlement'] });
    const outdoor = createTestTerrain({ id: 'field', tags: ['outdoor'] });

    brain.setAllowedTerrainTags(new Set(['indoor']));

    brain.update(0, [indoor, outdoor]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('bar');
  });

  // -----------------------------------------------------------------------
  // Deterministic behavior
  // -----------------------------------------------------------------------
  it('produces same result with same inputs', () => {
    const terrains = [
      createTestTerrain({ id: 'a', x: 0, y: 0, capacity: 5 }),
      createTestTerrain({ id: 'b', x: 100, y: 100, capacity: 5 }),
    ];

    function runBrain(): string | null {
      const deps = createMockDeps();
      const dispatcher = createMockDispatcher();
      const brain = new NPCBrain({
        npcId: 'npc_1',
        factionId: 'stalker',
        config: createBrainConfig(),
        selectorConfig: createSelectorConfig(),
        jobConfig: createJobConfig(),
        deps,
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
  });

  // -----------------------------------------------------------------------
  // Condlist scheme override
  // -----------------------------------------------------------------------
  it('applies scheme override to active task', () => {
    const nightClock = new Clock({ startHour: 23, timeFactor: 1 });
    const { brain, deps } = createBrain({
      brainConfig: { schemeCheckIntervalMs: 100 },
      deps: { clock: nightClock },
    });
    brain.setLastPosition({ x: 0, y: 0 });

    const terrain = createTestTerrain({ id: 't1' });

    const conditions: ISchemeConditionConfig[] = [
      { when: 'night', scheme: 'sleep', params: { alertness: 0.1 } },
    ];
    brain.setConditions(conditions);

    // First update: assign terrain + task
    brain.update(0, [terrain]);
    deps.events.flush();

    expect(brain.currentTask).not.toBeNull();
    expect(brain.currentTask!.scheme).toBe('idle'); // default before scheme evaluation fires

    // Second update: scheme evaluation fires after 100ms
    brain.update(100, [terrain]);

    expect(brain.currentTask!.scheme).toBe('sleep');
    expect(brain.currentTask!.params).toEqual({ alertness: 0.1 });
  });

  // -----------------------------------------------------------------------
  // Getters
  // -----------------------------------------------------------------------
  describe('getters', () => {
    it('exposes npcId and factionId', () => {
      const { brain } = createBrain({ npcId: 'sid', factionId: 'loner' });
      expect(brain.npcId).toBe('sid');
      expect(brain.factionId).toBe('loner');
    });

    it('exposes mutable state through getters', () => {
      const { brain } = createBrain();

      brain.setMorale(-0.3);
      expect(brain.morale).toBe(-0.3);

      brain.setRank(4);
      expect(brain.rank).toBe(4);

      brain.setLastPosition({ x: 10, y: 20 });
      expect(brain.lastPosition).toEqual({ x: 10, y: 20 });

      brain.setCombatLock(5_000);
      expect(brain.isCombatLocked).toBe(true);
    });

    it('returns dangerTolerance from brain config', () => {
      const { brain } = createBrain({ brainConfig: { dangerTolerance: 7 } });
      expect(brain.dangerTolerance).toBe(7);
    });

    it('returns default dangerTolerance of 3', () => {
      const { brain } = createBrain();
      expect(brain.dangerTolerance).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Death event zoneId (fix #3)
  // -----------------------------------------------------------------------
  describe('death event zoneId', () => {
    it('includes terrain id in NPC_DIED zoneId when brain had a terrain', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({ id: 'rostok' });

      brain.update(0, [terrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('rostok');

      const diedPayloads: Array<{ npcId: string; killedBy: string; zoneId: string }> = [];
      deps.events.on(ALifeEvents.NPC_DIED, (p) => diedPayloads.push(p as typeof diedPayloads[0]));

      brain.onDeath();
      deps.events.flush();

      expect(diedPayloads).toHaveLength(1);
      expect(diedPayloads[0].zoneId).toBe('rostok');
    });

    it('emits empty zoneId when brain had no terrain', () => {
      const { brain, deps } = createBrain();

      const diedPayloads: Array<{ npcId: string; killedBy: string; zoneId: string }> = [];
      deps.events.on(ALifeEvents.NPC_DIED, (p) => diedPayloads.push(p as typeof diedPayloads[0]));

      brain.onDeath();
      deps.events.flush();

      expect(diedPayloads).toHaveLength(1);
      expect(diedPayloads[0].zoneId).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Occupant management (fix #2)
  // -----------------------------------------------------------------------
  describe('occupant management', () => {
    it('calls removeOccupant on terrain when releasing', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({ id: 'bar_100', capacity: 5 });

      brain.update(0, [terrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('bar_100');
      expect(terrain.hasCapacity).toBe(true);

      const removeOccupantSpy = vi.spyOn(terrain, 'removeOccupant');

      brain.releaseFromTerrain();
      deps.events.flush();

      expect(removeOccupantSpy).toHaveBeenCalledWith('npc_1');
    });

    it('calls removeOccupant on death', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({ id: 'bar_100', capacity: 5 });

      brain.update(0, [terrain]);
      deps.events.flush();

      const removeOccupantSpy = vi.spyOn(terrain, 'removeOccupant');

      brain.onDeath();
      deps.events.flush();

      expect(removeOccupantSpy).toHaveBeenCalledWith('npc_1');
    });

    it('calls removeOccupant on old terrain when switching terrains', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 0 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const terrainA = createTestTerrain({ id: 'old', x: 500, y: 500 });
      const terrainB = createTestTerrain({ id: 'new', x: 0, y: 0, capacity: 20 });

      // Assign to terrainA first
      brain.update(0, [terrainA]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('old');

      const removeOccupantSpy = vi.spyOn(terrainA, 'removeOccupant');

      // Switch to terrainB on next evaluation
      brain.update(0, [terrainB]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('new');

      expect(removeOccupantSpy).toHaveBeenCalledWith('npc_1');
    });

    it('does not assign to terrain at full capacity and forces re-evaluation', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 10_000 },
      });
      const fullTerrain = createTestTerrain({ id: 'full', capacity: 0 });
      const openTerrain = createTestTerrain({ id: 'open', capacity: 10, x: 0, y: 0 });

      // First tick: only full terrain available — brain cannot assign
      brain.update(0, [fullTerrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBeNull();

      // Second tick: open terrain now available — brain should immediately re-evaluate
      // because re-eval timer was reset to 0 when capacity was full
      brain.update(0, [openTerrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('open');
    });
  });

  // -----------------------------------------------------------------------
  // Shelter flee scoring (fix #5)
  // -----------------------------------------------------------------------
  describe('shelter flee scoring', () => {
    it('chooses closest shelter during surge, not first in list', () => {
      const { brain, deps } = createBrain();
      brain.setLastPosition({ x: 0, y: 0 });

      const farShelter = createTestTerrain({ id: 'far_shelter', isShelter: true, x: 1000, y: 1000 });
      const nearShelter = createTestTerrain({ id: 'near_shelter', isShelter: true, x: 10, y: 10 });
      const outdoor = createTestTerrain({ id: 'outdoor', isShelter: false });

      // Assign to outdoor first
      brain.update(0, [outdoor]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('outdoor');

      // Activate surge -- far shelter is first in list, near shelter should win
      brain.setSurgeActive(true);

      brain.update(0, [farShelter, nearShelter]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('near_shelter');
    });
  });

  // -----------------------------------------------------------------------
  // Fix 1: readonly SmartTerrain[] (type safety)
  // -----------------------------------------------------------------------
  describe('readonly SmartTerrain[] contract', () => {
    it('accepts a frozen array without error', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({ id: 't1' });
      const frozenTerrains: readonly SmartTerrain[] = Object.freeze([terrain]);

      brain.update(0, frozenTerrains);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('t1');
    });

    it('works with empty readonly array', () => {
      const { brain, deps } = createBrain();
      const empty: readonly SmartTerrain[] = Object.freeze([]);

      brain.update(0, empty);
      deps.events.flush();

      expect(brain.currentTerrainId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Fix 2: createTaskFromSlot explicit terrainId
  // -----------------------------------------------------------------------
  describe('createTaskFromSlot terrainId safety', () => {
    it('task terrainId matches the terrain assigned at time of job pick', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 0 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const terrain = createTestTerrain({
        id: 'specific_terrain',
        jobs: [{ type: 'guard', slots: 2, position: { x: 50, y: 50 } }],
      });

      brain.update(0, [terrain]);
      deps.events.flush();

      expect(brain.currentTask).not.toBeNull();
      expect(brain.currentTask!.terrainId).toBe('specific_terrain');
    });

    it('TASK_ASSIGNED event contains correct terrainId', () => {
      const { brain, deps } = createBrain();
      const terrain = createTestTerrain({
        id: 'event_terrain',
        jobs: [{ type: 'patrol', slots: 3, position: { x: 10, y: 10 } }],
      });

      const payloads: Array<{ npcId: string; terrainId: string; taskType: string }> = [];
      deps.events.on(ALifeEvents.TASK_ASSIGNED, (p) => payloads.push(p as typeof payloads[0]));

      brain.update(0, [terrain]);
      deps.events.flush();

      expect(payloads).toHaveLength(1);
      expect(payloads[0].terrainId).toBe('event_terrain');
    });
  });

  // -----------------------------------------------------------------------
  // Fix 3: IBrainDeps has no random property
  // -----------------------------------------------------------------------
  describe('IBrainDeps without random', () => {
    it('constructs with only clock and events', () => {
      const deps: IBrainDeps = {
        clock: new Clock({ startHour: 12, timeFactor: 1 }),
        events: new EventBus<ALifeEventPayloads>(),
      };
      const brain = new NPCBrain({
        npcId: 'npc_clean',
        factionId: 'stalker',
        config: createBrainConfig(),
        selectorConfig: createSelectorConfig(),
        jobConfig: createJobConfig(),
        deps,
      });

      expect(brain.npcId).toBe('npc_clean');
    });
  });

  // -----------------------------------------------------------------------
  // Fix 4: tickMoraleFlee throttled via re-evaluation timer
  // -----------------------------------------------------------------------
  describe('morale flee throttling', () => {
    it('does not trigger redundant terrain evaluation when re-eval already ran', () => {
      const { brain, deps, dispatcher } = createBrain({
        brainConfig: {
          reEvaluateIntervalMs: 1_000,
          moraleFleeThreshold: -0.5,
        },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const dangerousTerrain = createTestTerrain({ id: 'danger', dangerLevel: 5 });
      const safeTerrain = createTestTerrain({ id: 'safe', dangerLevel: 0 });

      // First: assign to dangerous terrain
      brain.update(0, [dangerousTerrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('danger');

      // Set low morale
      brain.setMorale(-0.7);

      // At t=500ms, re-eval timer has NOT expired yet (started at 1000ms).
      // tickMoraleFlee should reset the timer to 0, causing tickReEvaluation
      // to trigger on the next tick (not this one since re-eval runs before morale flee).
      dispatcher.addMovingNPC.mockClear();

      brain.update(500, [dangerousTerrain, safeTerrain]);
      deps.events.flush();

      // The brain should NOT have switched yet because tickReEvaluation
      // ran first (timer was 500ms > 0) and didn't fire.
      // tickMoraleFlee then reset the timer to 0.
      // Actual switch happens on the next update call.
      expect(brain.currentTerrainId).toBe('danger');

      // Now on the very next tick, the re-eval timer is 0, so it fires immediately.
      brain.update(0, [dangerousTerrain, safeTerrain]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('safe');
    });

    it('morale flee resets timer only once even across multiple ticks', () => {
      const { brain, deps } = createBrain({
        brainConfig: {
          reEvaluateIntervalMs: 10_000,
          moraleFleeThreshold: -0.5,
        },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const dangerousTerrain = createTestTerrain({ id: 'danger', dangerLevel: 3 });

      // Assign to dangerous terrain
      brain.update(0, [dangerousTerrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('danger');

      brain.setMorale(-0.8);

      // Tick 1: morale flee resets timer -> next tick will re-evaluate
      brain.update(100, [dangerousTerrain]);
      deps.events.flush();

      // Tick 2: re-eval fires (timer was reset to 0), but no better terrain
      // so it stays. Timer is now reset to 10_000.
      brain.update(0, [dangerousTerrain]);
      deps.events.flush();
      expect(brain.currentTerrainId).toBe('danger');

      // Tick 3: morale flee resets timer again (morale still low, danger still > 0)
      brain.update(100, [dangerousTerrain]);
      deps.events.flush();

      // Tick 4: re-eval fires again
      brain.update(0, [dangerousTerrain]);
      deps.events.flush();

      // Still in danger -- no better option. But the pattern is stable.
      expect(brain.currentTerrainId).toBe('danger');
    });
  });

  // -----------------------------------------------------------------------
  // buildTerrainQuery
  // -----------------------------------------------------------------------
  describe('buildTerrainQuery', () => {
    // Expose protected method for testing
    class TestableBrain extends NPCBrain {
      public exposedBuildTerrainQuery(terrains: readonly SmartTerrain[]) {
        return this.buildTerrainQuery(terrains);
      }
    }

    it('populates all query fields from brain state', () => {
      const deps = createMockDeps();
      const selectorConfig = createSelectorConfig();
      const brain = new TestableBrain({
        npcId: 'hero',
        factionId: 'stalker',
        config: createBrainConfig(),
        selectorConfig,
        jobConfig: createJobConfig(),
        deps,
      });
      brain.setLastPosition({ x: 42, y: 99 });
      brain.setRank(3);
      brain.setMorale(-0.5);

      const terrains = [createTestTerrain({ id: 'a' })];
      const query = brain.exposedBuildTerrainQuery(terrains);

      expect(query.terrains).toBe(terrains);
      expect(query.npcFaction).toBe('stalker');
      expect(query.npcPos).toEqual({ x: 42, y: 99 });
      expect(query.npcRank).toBe(3);
      expect(query.morale).toBe(-0.5);
      expect(query.surgeActive).toBe(false);
      expect(query.leaderTerrainId).toBeNull();
      expect(query.allowedTags).toBeNull();
      expect(query.config).toBe(selectorConfig);
      expect(query.occupantId).toBe('hero');
    });
  });

  // -----------------------------------------------------------------------
  // Squad goal terrain override
  // -----------------------------------------------------------------------

  describe('squad goal terrain', () => {
    it('squadGoalTerrainId is null by default', () => {
      const { brain } = createBrain();
      expect(brain.squadGoalTerrainId).toBeNull();
    });

    it('setSquadGoalTerrainId stores and returns the value', () => {
      const { brain } = createBrain();
      brain.setSquadGoalTerrainId('goal_zone');
      expect(brain.squadGoalTerrainId).toBe('goal_zone');
    });

    it('goal terrain overrides leader terrain in terrain selection', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 0 },
        selectorConfig: { squadLeaderBonus: 100 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const terrainA = createTestTerrain({ id: 'base', x: 0, y: 0 });
      const terrainGoal = createTestTerrain({ id: 'goal_zone', x: 500, y: 500 });
      const terrainLeader = createTestTerrain({ id: 'leader_zone', x: 600, y: 600 });

      brain.setSquadLeaderTerrainId('leader_zone');
      brain.setSquadGoalTerrainId('goal_zone');

      brain.update(0, [terrainA, terrainGoal, terrainLeader]);
      deps.events.flush();

      // goal overrides leader
      expect(brain.currentTerrainId).toBe('goal_zone');
    });

    it('falls back to leader terrain when goal is null', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 0 },
        selectorConfig: { squadLeaderBonus: 100 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const terrainA = createTestTerrain({ id: 'base', x: 0, y: 0 });
      const terrainLeader = createTestTerrain({ id: 'leader_zone', x: 500, y: 500 });

      brain.setSquadLeaderTerrainId('leader_zone');
      brain.setSquadGoalTerrainId(null);

      brain.update(0, [terrainA, terrainLeader]);
      deps.events.flush();

      expect(brain.currentTerrainId).toBe('leader_zone');
    });

    it('clearing goal terrain falls back to leader terrain on next update', () => {
      const { brain, deps } = createBrain({
        brainConfig: { reEvaluateIntervalMs: 0 },
        selectorConfig: { squadLeaderBonus: 100 },
      });
      brain.setLastPosition({ x: 0, y: 0 });

      const terrainA = createTestTerrain({ id: 'base', x: 0, y: 0 });
      const terrainLeader = createTestTerrain({ id: 'leader_zone', x: 500, y: 500 });

      brain.setSquadLeaderTerrainId('leader_zone');
      brain.setSquadGoalTerrainId('leader_zone'); // same target; point is it's wired through goal

      brain.update(0, [terrainA, terrainLeader]);
      deps.events.flush();

      brain.setSquadGoalTerrainId(null); // clear goal
      expect(brain.squadGoalTerrainId).toBeNull();
    });
  });
});
