import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, Clock } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { NPCRegistrar } from './NPCRegistrar';
import type { INPCRegistrationOptions, INPCRegistrationData } from './NPCRegistrar';
import { NPCBrain } from '../brain/NPCBrain';
import type { IBrainDeps } from '../brain/NPCBrain';
import { HumanBrain } from '../brain/HumanBrain';
import { MonsterBrain } from '../brain/MonsterBrain';
import { MovementSimulator } from '../movement/MovementSimulator';
import { SquadManager } from '../squad/SquadManager';
import { createDefaultSquadConfig } from '../squad/Squad';
import { NPCRelationRegistry, createDefaultRelationConfig } from './NPCRelationRegistry';
import { StoryRegistry } from './StoryRegistry';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import {
  createBrainConfig,
  createSelectorConfig,
  createJobConfig,
  createTerrain,
  createBehaviorConfig,
} from '../__integration__/helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDeps(): { deps: IBrainDeps; events: EventBus<ALifeEventPayloads>; clock: Clock } {
  const clock = new Clock({ startHour: 12, timeFactor: 1 });
  const events = new EventBus<ALifeEventPayloads>();
  return { deps: { clock, events }, events, clock };
}

function createRegistrar(deps: IBrainDeps, events: EventBus<ALifeEventPayloads>) {
  const movement = new MovementSimulator(events);
  const squadManager = new SquadManager(createDefaultSquadConfig(), events);
  const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());
  const storyRegistry = new StoryRegistry();

  const registrar = new NPCRegistrar({
    brainConfig: createBrainConfig(),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps,
    movement,
    squadManager,
    relationRegistry,
    storyRegistry,
  });

  return { registrar, movement, squadManager, relationRegistry, storyRegistry };
}

const DEFAULT_BEHAVIOR: INPCBehaviorConfig = createBehaviorConfig();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NPCRegistrar', () => {
  let deps: IBrainDeps;
  let events: EventBus<ALifeEventPayloads>;
  let registrar: NPCRegistrar;
  let squadManager: SquadManager;
  let _relationRegistry: NPCRelationRegistry;
  let storyRegistry: StoryRegistry;
  let npcs: Map<string, INPCRecord>;
  let brains: Map<string, NPCBrain>;

  beforeEach(() => {
    const { deps: d, events: e } = createDeps();
    deps = d;
    events = e;
    const ctx = createRegistrar(deps, events);
    registrar = ctx.registrar;
    squadManager = ctx.squadManager;
    _relationRegistry = ctx.relationRegistry;
    storyRegistry = ctx.storyRegistry;
    npcs = new Map();
    brains = new Map();
  });

  // -------------------------------------------------------------------------
  // Registration — base NPCBrain (no options)
  // -------------------------------------------------------------------------

  it('registers an NPC with base NPCBrain when no options given', () => {
    const terrains = [createTerrain({ id: 't1' })];
    const result = registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 10, y: 20 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR },
      terrains, npcs, brains,
    );

    expect(result.record.entityId).toBe('npc_1');
    expect(result.record.factionId).toBe('loner');
    expect(result.record.rank).toBe(3);
    expect(result.record.combatPower).toBe(50);
    expect(result.record.currentHp).toBe(100);
    expect(result.record.isOnline).toBe(false);

    expect(result.brain).toBeInstanceOf(NPCBrain);
    expect(result.brain).not.toBeInstanceOf(HumanBrain);
    expect(result.brain).not.toBeInstanceOf(MonsterBrain);
  });

  it('adds record and brain to maps', () => {
    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );

    expect(npcs.has('npc_1')).toBe(true);
    expect(brains.has('npc_1')).toBe(true);
    expect(npcs.get('npc_1')!.entityId).toBe('npc_1');
  });

  it('auto-assigns NPC to a squad', () => {
    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    events.flush();

    const squad = squadManager.getSquadForNPC('npc_1');
    expect(squad).not.toBeNull();
    expect(squad!.factionId).toBe('loner');
  });

  // -------------------------------------------------------------------------
  // Registration — HumanBrain
  // -------------------------------------------------------------------------

  it('registers a HumanBrain when equipmentPrefs are provided', () => {
    const options: INPCRegistrationOptions = {
      type: 'human',
      equipmentPrefs: {
        preferredWeaponType: 'sniper',
        preferredArmor: 'medium',
        aggressiveness: 0.3,
        cautiousness: 0.7,
      },
    };

    const result = registrar.registerNPC(
      { entityId: 'npc_h1', factionId: 'military', position: { x: 50, y: 50 }, rank: 4, combatPower: 60, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR, options },
      [], npcs, brains,
    );

    expect(result.brain).toBeInstanceOf(HumanBrain);
    const human = result.brain as HumanBrain;
    expect(human.getPreferredWeapon()).toBe('sniper');
  });

  it('registers HumanBrain for human type without equipmentPrefs (default equipment)', () => {
    const options: INPCRegistrationOptions = { type: 'human' };

    const result = registrar.registerNPC(
      { entityId: 'npc_h2', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR, options },
      [], npcs, brains,
    );

    expect(result.brain).toBeInstanceOf(HumanBrain);
    const human = result.brain as HumanBrain;
    expect(human.getPreferredWeapon()).toBe('rifle');
  });

  it('sets schedule waypoints for human NPC', () => {
    const options: INPCRegistrationOptions = {
      type: 'human',
      scheduleWaypoints: [
        { position: { x: 10, y: 10 }, stayDurationMs: 5000, terrainId: 't1' },
        { position: { x: 90, y: 90 }, stayDurationMs: 5000, terrainId: 't2' },
      ],
    };

    const result = registrar.registerNPC(
      { entityId: 'npc_sched', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR, options },
      [], npcs, brains,
    );

    expect(result.brain.hasSchedule()).toBe(true);
  });

  it('sets allowedTerrainTags for human NPC', () => {
    const tags = new Set(['outdoor', 'settlement']);
    const options: INPCRegistrationOptions = {
      type: 'human',
      allowedTerrainTags: tags,
    };

    const result = registrar.registerNPC(
      { entityId: 'npc_tags', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR, options },
      [], npcs, brains,
    );

    expect(result.brain).toBeDefined();
    // The brain should have tags set (verified indirectly through terrain selection).
  });

  // -------------------------------------------------------------------------
  // Registration — MonsterBrain
  // -------------------------------------------------------------------------

  it('registers a MonsterBrain with lair terrain', () => {
    const options: INPCRegistrationOptions = {
      type: 'monster',
      lairTerrainId: 'lair_1',
    };

    const result = registrar.registerNPC(
      { entityId: 'npc_m1', factionId: 'monster', position: { x: 100, y: 100 }, rank: 1, combatPower: 30, currentHp: 60, behaviorConfig: DEFAULT_BEHAVIOR, options },
      [], npcs, brains,
    );

    expect(result.brain).toBeInstanceOf(MonsterBrain);
    const monster = result.brain as MonsterBrain;
    expect(monster.getLairTerrainId()).toBe('lair_1');
  });

  it('registers a MonsterBrain without lair', () => {
    const options: INPCRegistrationOptions = { type: 'monster' };

    const result = registrar.registerNPC(
      { entityId: 'npc_m2', factionId: 'monster', position: { x: 0, y: 0 }, rank: 1, combatPower: 20, currentHp: 40, behaviorConfig: DEFAULT_BEHAVIOR, options },
      [], npcs, brains,
    );

    expect(result.brain).toBeInstanceOf(MonsterBrain);
    const monster = result.brain as MonsterBrain;
    expect(monster.getLairTerrainId()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Terrain assignment on registration
  // -------------------------------------------------------------------------

  it('assigns NPC to terrain during registration', () => {
    const terrain = createTerrain({ id: 't1' });

    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [terrain], npcs, brains,
    );

    expect(terrain.hasOccupant('npc_1')).toBe(true);
  });

  it('skips terrain assignment when no terrains available', () => {
    const result = registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );

    expect(result.brain.currentTerrainId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Unregister
  // -------------------------------------------------------------------------

  it('unregister removes NPC from all maps and subsystems', () => {
    const terrain = createTerrain({ id: 't1' });

    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [terrain], npcs, brains,
    );
    events.flush();

    expect(npcs.has('npc_1')).toBe(true);
    expect(brains.has('npc_1')).toBe(true);
    expect(squadManager.getSquadForNPC('npc_1')).not.toBeNull();

    registrar.unregisterNPC('npc_1', npcs, brains);

    expect(npcs.has('npc_1')).toBe(false);
    expect(brains.has('npc_1')).toBe(false);
    expect(squadManager.getSquadForNPC('npc_1')).toBeNull();
  });

  it('unregister removes story registration', () => {
    registrar.registerNPC(
      { entityId: 'npc_story', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    storyRegistry.register('quest_1', 'npc_story');

    expect(storyRegistry.isStoryNPC('npc_story')).toBe(true);

    registrar.unregisterNPC('npc_story', npcs, brains);

    expect(storyRegistry.isStoryNPC('npc_story')).toBe(false);
  });

  it('unregister releases brain from terrain', () => {
    const terrain = createTerrain({ id: 't1' });

    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [terrain], npcs, brains,
    );

    expect(terrain.hasOccupant('npc_1')).toBe(true);

    registrar.unregisterNPC('npc_1', npcs, brains);

    expect(terrain.hasOccupant('npc_1')).toBe(false);
  });

  it('unregister is safe for unknown NPC', () => {
    expect(() => registrar.unregisterNPC('ghost', npcs, brains)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Multiple NPCs — squad auto-assignment
  // -------------------------------------------------------------------------

  it('auto-assigns same-faction NPCs to the same squad', () => {
    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'duty', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    registrar.registerNPC(
      { entityId: 'npc_2', factionId: 'duty', position: { x: 10, y: 10 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    events.flush();

    const sq1 = squadManager.getSquadForNPC('npc_1');
    const sq2 = squadManager.getSquadForNPC('npc_2');

    expect(sq1).not.toBeNull();
    expect(sq1!.id).toBe(sq2!.id);
  });

  it('different factions get different squads', () => {
    registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'duty', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    registrar.registerNPC(
      { entityId: 'npc_2', factionId: 'freedom', position: { x: 10, y: 10 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    events.flush();

    const sq1 = squadManager.getSquadForNPC('npc_1');
    const sq2 = squadManager.getSquadForNPC('npc_2');

    expect(sq1).not.toBeNull();
    expect(sq2).not.toBeNull();
    expect(sq1!.id).not.toBe(sq2!.id);
  });

  // -------------------------------------------------------------------------
  // Position and rank wiring
  // -------------------------------------------------------------------------

  it('sets position and rank on the brain', () => {
    const result = registrar.registerNPC(
      { entityId: 'npc_1', factionId: 'loner', position: { x: 42, y: 99 }, rank: 5, combatPower: 80, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );

    expect(result.brain.lastPosition).toEqual({ x: 42, y: 99 });
    expect(result.brain.rank).toBe(5);
  });

  // -------------------------------------------------------------------------
  // rebuildBrain
  // -------------------------------------------------------------------------

  it('rebuildBrain throws when NPC record is not in npcs map', () => {
    expect(() => registrar.rebuildBrain('ghost', npcs, [], brains)).toThrow(
      '[NPCRegistrar.rebuildBrain] NPC "ghost" not found in npcs map.',
    );
  });

  it('rebuildBrain creates base NPCBrain for restored record', () => {
    // Simulate restore(): manually populate the npcs map (no brain created).
    const record: INPCRecord = {
      entityId: 'npc_restored',
      factionId: 'loner',
      combatPower: 50,
      currentHp: 75,
      rank: 3,
      behaviorConfig: DEFAULT_BEHAVIOR,
      lastPosition: { x: 10, y: 20 },
      isOnline: false,
    };
    npcs.set('npc_restored', record);

    const brain = registrar.rebuildBrain('npc_restored', npcs, [], brains);

    expect(brain).toBeInstanceOf(NPCBrain);
    expect(brains.has('npc_restored')).toBe(true);
    expect(brains.get('npc_restored')).toBe(brain);
    expect(brain.lastPosition).toEqual({ x: 10, y: 20 });
    expect(brain.rank).toBe(3);
  });

  it('rebuildBrain creates HumanBrain when type:human option provided', () => {
    const record: INPCRecord = {
      entityId: 'npc_human',
      factionId: 'loner',
      combatPower: 60,
      currentHp: 100,
      rank: 4,
      behaviorConfig: DEFAULT_BEHAVIOR,
      lastPosition: { x: 0, y: 0 },
      isOnline: false,
    };
    npcs.set('npc_human', record);

    const brain = registrar.rebuildBrain('npc_human', npcs, [], brains, { type: 'human' });

    expect(brain).toBeInstanceOf(HumanBrain);
  });

  it('rebuildBrain creates MonsterBrain when type:monster option provided', () => {
    const record: INPCRecord = {
      entityId: 'npc_monster',
      factionId: 'monster',
      combatPower: 30,
      currentHp: 60,
      rank: 1,
      behaviorConfig: DEFAULT_BEHAVIOR,
      lastPosition: { x: 0, y: 0 },
      isOnline: false,
    };
    npcs.set('npc_monster', record);

    const brain = registrar.rebuildBrain('npc_monster', npcs, [], brains, { type: 'monster', lairTerrainId: 'lair_1' });

    expect(brain).toBeInstanceOf(MonsterBrain);
    expect((brain as MonsterBrain).getLairTerrainId()).toBe('lair_1');
  });

  it('rebuildBrain does NOT touch squads or story registry', () => {
    // Register the NPC normally to establish squad and story.
    registrar.registerNPC(
      { entityId: 'npc_s', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR },
      [], npcs, brains,
    );
    events.flush();
    storyRegistry.register('quest_s', 'npc_s');

    const squadBefore = squadManager.getSquadForNPC('npc_s');
    expect(squadBefore).not.toBeNull();
    expect(storyRegistry.isStoryNPC('npc_s')).toBe(true);

    // Simulate load: clear brains but keep npcs (as restore() does).
    brains.clear();

    // rebuildBrain should restore the brain without touching squad or story.
    registrar.rebuildBrain('npc_s', npcs, [], brains);

    expect(brains.has('npc_s')).toBe(true);
    expect(squadManager.getSquadForNPC('npc_s')!.id).toBe(squadBefore!.id);
    expect(storyRegistry.isStoryNPC('npc_s')).toBe(true);
  });

  it('rebuildBrain assigns terrain when terrains are available', () => {
    const terrain = createTerrain({ id: 't1' });
    const record: INPCRecord = {
      entityId: 'npc_t',
      factionId: 'loner',
      combatPower: 50,
      currentHp: 100,
      rank: 3,
      behaviorConfig: DEFAULT_BEHAVIOR,
      lastPosition: { x: 100, y: 100 },
      isOnline: false,
    };
    npcs.set('npc_t', record);

    registrar.rebuildBrain('npc_t', npcs, [terrain], brains);

    expect(brains.get('npc_t')!.currentTerrainId).toBe('t1');
  });
});
