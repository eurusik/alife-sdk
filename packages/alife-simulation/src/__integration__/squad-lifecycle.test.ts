/**
 * Integration test: "Squad lifecycle".
 *
 * Verifies the full squad lifecycle in the simulation:
 *   - SquadManager + OfflineCombatResolver: NPC death → squad morale penalty → auto-disband
 *   - SquadManager + auto-assign: NPCs grouped by faction, respects capacity
 *   - Squad morale cascade with real MoraleLookup wired through ISimulationBridge
 *   - Serialize/restore round-trip preserves squad structure + reverse index
 *   - Leader death triggers re-election + higher cascade factor for survivors
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SmartTerrain,
  Faction,
  FactionBuilder,
  Clock,
  EventBus,
  ALifeEvents,
} from '@alife-sdk/core';
import type { IRandom, ALifeEventPayloads, ISmartTerrainConfig } from '@alife-sdk/core';

import { SquadManager } from '../squad/SquadManager';
import { createDefaultSquadConfig } from '../squad/Squad';
import type { MoraleLookup } from '../squad/Squad';
import { NPCBrain } from '../brain/NPCBrain';
import type { IBrainDeps } from '../brain/NPCBrain';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import { createDefaultSimulationConfig } from '../types/ISimulationConfig';
import type { IOfflineCombatConfig } from '../types/ISimulationConfig';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { MovementSimulator } from '../movement/MovementSimulator';

// ---------------------------------------------------------------------------
// Deterministic random
// ---------------------------------------------------------------------------

const seeded: IRandom = {
  next: () => 0.25,
  nextInt: (min, max) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.25 * (max - min) + min,
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createStubBridge(overrides?: Partial<ISimulationBridge>): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
    ...overrides,
  };
}

function getCombatConfig(overrides?: Partial<IOfflineCombatConfig>): IOfflineCombatConfig {
  const base = createDefaultSimulationConfig();
  return { ...base.offlineCombat, ...overrides };
}

function createBehaviorConfig(overrides?: Partial<INPCBehaviorConfig>): INPCBehaviorConfig {
  return {
    retreatThreshold: 0.1,
    panicThreshold: -0.7,
    searchIntervalMs: 5_000,
    dangerTolerance: 3,
    aggression: 0.5,
    ...overrides,
  };
}

function createNPCRecord(overrides?: Partial<INPCRecord>): INPCRecord {
  return {
    entityId: 'npc_default',
    factionId: 'stalker',
    combatPower: 50,
    currentHp: 100,
    rank: 3,
    behaviorConfig: createBehaviorConfig(),
    lastPosition: { x: 100, y: 100 },
    isOnline: false,
    ...overrides,
  };
}

function createTerrain(overrides?: Partial<ISmartTerrainConfig>): SmartTerrain {
  return new SmartTerrain({
    id: 'terrain_default',
    name: 'Default',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 10,
    ...overrides,
  });
}

function createFaction(id: string, relations: Record<string, number> = {}): Faction {
  const def = new FactionBuilder(id).displayName(id);
  for (const [otherId, score] of Object.entries(relations)) {
    def.relation(otherId, score);
  }
  return new Faction(id, def.build());
}

function createSharedDeps() {
  const clock = new Clock({ startHour: 12, timeFactor: 1 });
  const events = new EventBus<ALifeEventPayloads>();
  const movement = new MovementSimulator(events);
  return { clock, events, movement };
}

function createBrain(
  npcId: string,
  factionId: string,
  deps: IBrainDeps,
  movement: MovementSimulator,
): NPCBrain {
  const brain = new NPCBrain({
    npcId,
    factionId,
    config: {
      searchIntervalMs: 5_000,
      schemeCheckIntervalMs: 3_000,
      moraleFleeThreshold: -0.5,
      reEvaluateIntervalMs: 30_000,
      dangerTolerance: 3,
    },
    selectorConfig: { surgeMultiplier: 3.0, squadLeaderBonus: 20, moraleDangerPenalty: 15 },
    jobConfig: { rankBonus: 5, distancePenalty: 0.01 },
    deps,
  });
  brain.setMovementDispatcher(movement);
  brain.setLastPosition({ x: 100, y: 100 });
  brain.setRank(3);
  return brain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Squad lifecycle', () => {
  let events: EventBus<ALifeEventPayloads>;

  beforeEach(() => {
    events = new EventBus<ALifeEventPayloads>();
  });

  // -----------------------------------------------------------------------
  // 1. Combat death removes NPC from squad + morale penalty to survivors
  // -----------------------------------------------------------------------
  it('combat death triggers squad morale penalty and removes dead NPC', () => {
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });

    const config = getCombatConfig();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({
      id: 'outpost',
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const sharedDeps = createSharedDeps();
    const deps: IBrainDeps = { clock: sharedDeps.clock, events: sharedDeps.events };

    // Create brains
    const brainA = createBrain('stalker_a', 'stalker', deps, sharedDeps.movement);
    const brainB = createBrain('stalker_b', 'stalker', deps, sharedDeps.movement);
    const brainC = createBrain('bandit_k', 'bandit', deps, sharedDeps.movement);

    // Place all in same terrain
    for (const b of [brainA, brainB, brainC]) {
      b.update(0, [terrain]);
      sharedDeps.events.flush();
    }

    // Wire up squad — stalker_a and stalker_b in same squad
    const moraleCalls: Array<{ npcId: string; delta: number }> = [];
    const moraleLookup: MoraleLookup = (npcId) => ({
      adjustMorale(delta: number) {
        moraleCalls.push({ npcId, delta });
      },
    });

    const squadMgr = new SquadManager(createDefaultSquadConfig(), sharedDeps.events, moraleLookup);
    squadMgr.createSquad('stalker', ['stalker_a', 'stalker_b']);
    sharedDeps.events.flush();

    // stalker_a: 1 HP (will die), bandit_k: 1000 HP (killer)
    const recordA = createNPCRecord({ entityId: 'stalker_a', factionId: 'stalker', currentHp: 1 });
    const recordB = createNPCRecord({ entityId: 'stalker_b', factionId: 'stalker', currentHp: 500 });
    const recordK = createNPCRecord({ entityId: 'bandit_k', factionId: 'bandit', currentHp: 1000 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['stalker_a', recordA], ['stalker_b', recordB], ['bandit_k', recordK],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['stalker_a', brainA], ['stalker_b', brainB], ['bandit_k', brainC],
    ]);

    // Resolve combat — stalker_a dies
    const deaths: string[] = [];
    resolver.resolve(
      npcRecords,
      new Map([['outpost', terrain]]),
      factions,
      brains,
      new StoryRegistry(),
      new NPCRelationRegistry(createDefaultRelationConfig()),
      0,
      (deadId) => {
        deaths.push(deadId);
        squadMgr.onNPCDeath(deadId);
      },
    );
    sharedDeps.events.flush();

    // stalker_a is dead
    expect(recordA.currentHp).toBeLessThanOrEqual(0);
    expect(deaths).toContain('stalker_a');

    // Squad updated: stalker_a removed, stalker_b is sole member + new leader
    expect(squadMgr.getSquadForNPC('stalker_a')).toBeNull();
    const squad = squadMgr.getSquadForNPC('stalker_b');
    expect(squad).not.toBeNull();
    expect(squad!.hasMember('stalker_a')).toBe(false);
    expect(squad!.getLeader()).toBe('stalker_b');

    // Squad morale penalty applied to stalker_b (survivor)
    const penaltyForB = moraleCalls.filter(
      (c) => c.npcId === 'stalker_b' && c.delta < 0,
    );
    expect(penaltyForB).toHaveLength(1);
    expect(penaltyForB[0].delta).toBe(createDefaultSquadConfig().moraleAllyDeathPenalty);
  });

  // -----------------------------------------------------------------------
  // 2. Last squad member death auto-disbands squad
  // -----------------------------------------------------------------------
  it('last member death auto-disbands squad with SQUAD_DISBANDED event', () => {
    const moraleLookup: MoraleLookup = () => ({
      adjustMorale() {},
    });

    const squadMgr = new SquadManager(createDefaultSquadConfig(), events, moraleLookup);
    const squad = squadMgr.createSquad('stalker', ['npc_solo']);
    events.flush();

    const disbanded: string[] = [];
    events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

    squadMgr.onNPCDeath('npc_solo');
    events.flush();

    expect(disbanded).toContain(squad.id);
    expect(squadMgr.getAllSquads()).toHaveLength(0);
    expect(squadMgr.getSquadForNPC('npc_solo')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 3. Auto-assign groups NPCs by faction into squads
  // -----------------------------------------------------------------------
  it('auto-assign fills existing squad before creating new one', () => {
    const squadMgr = new SquadManager(createDefaultSquadConfig(), events);

    // Auto-assign 5 stalkers (maxSize=4 per squad)
    const assigned: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const squad = squadMgr.autoAssign(`npc_${i}`, 'stalker');
      assigned.push(squad.id);
    }

    // First 4 should be in same squad
    const firstSquadId = assigned[0];
    expect(assigned.slice(0, 4).every((id) => id === firstSquadId)).toBe(true);

    // 5th should be in a new squad
    expect(assigned[4]).not.toBe(firstSquadId);
    expect(squadMgr.getAllSquads()).toHaveLength(2);
  });

  it('auto-assign does not mix factions', () => {
    const squadMgr = new SquadManager(createDefaultSquadConfig(), events);

    squadMgr.autoAssign('stalker_1', 'stalker');
    squadMgr.autoAssign('bandit_1', 'bandit');
    squadMgr.autoAssign('stalker_2', 'stalker');

    // stalker_1 and stalker_2 share a squad
    expect(squadMgr.getSquadId('stalker_1')).toBe(squadMgr.getSquadId('stalker_2'));

    // bandit_1 is in a different squad
    expect(squadMgr.getSquadId('bandit_1')).not.toBe(squadMgr.getSquadId('stalker_1'));

    expect(squadMgr.getAllSquads()).toHaveLength(2);
  });

  it('auto-assign removes NPC from previous squad before reassignment', () => {
    const squadMgr = new SquadManager(createDefaultSquadConfig(), events);

    const squadA = squadMgr.createSquad('stalker', ['npc_x', 'npc_y']);
    const squadB = squadMgr.createSquad('bandit');

    // npc_x switches faction — auto-assign to bandit
    squadMgr.autoAssign('npc_x', 'bandit');

    // Removed from old squad
    expect(squadA.hasMember('npc_x')).toBe(false);
    expect(squadA.getMemberCount()).toBe(1);

    // Added to bandit squad
    expect(squadB.hasMember('npc_x')).toBe(true);

    // Reverse index updated
    expect(squadMgr.getSquadId('npc_x')).toBe(squadB.id);
  });

  // -----------------------------------------------------------------------
  // 4. Cascade morale — leader vs regular factor
  // -----------------------------------------------------------------------
  it('cascadeMorale uses higher factor for leader source', () => {
    const moraleCalls: Array<{ npcId: string; delta: number }> = [];
    const moraleLookup: MoraleLookup = (npcId) => ({
      adjustMorale(delta: number) {
        moraleCalls.push({ npcId, delta });
      },
    });

    const config = createDefaultSquadConfig();
    const squadMgr = new SquadManager(config, events, moraleLookup);
    const squad = squadMgr.createSquad('stalker', ['leader', 'grunt_a', 'grunt_b']);
    events.flush();

    // Leader cascade (factor 0.8)
    squadMgr.cascadeMorale(squad.id, 'leader', -1.0);
    const leaderCascade = [...moraleCalls];

    expect(leaderCascade).toHaveLength(2);
    expect(leaderCascade.every((c) => c.delta === -1.0 * config.moraleCascadeLeaderFactor)).toBe(true);
    expect(leaderCascade.every((c) => c.npcId !== 'leader')).toBe(true);

    moraleCalls.length = 0;

    // Regular cascade (factor 0.5)
    squadMgr.cascadeMorale(squad.id, 'grunt_a', -1.0);
    const regularCascade = [...moraleCalls];

    expect(regularCascade).toHaveLength(2);
    expect(regularCascade.every((c) => c.delta === -1.0 * config.moraleCascadeFactor)).toBe(true);
    expect(regularCascade.every((c) => c.npcId !== 'grunt_a')).toBe(true);

    // Leader factor is higher than regular
    expect(Math.abs(leaderCascade[0].delta)).toBeGreaterThan(Math.abs(regularCascade[0].delta));
  });

  // -----------------------------------------------------------------------
  // 5. Leader death re-election + events
  // -----------------------------------------------------------------------
  it('leader death triggers re-election and correct event sequence', () => {
    const moraleLookup: MoraleLookup = () => ({
      adjustMorale() {},
    });

    const squadMgr = new SquadManager(createDefaultSquadConfig(), events, moraleLookup);
    const squad = squadMgr.createSquad('duty', ['cmd', 'sgt', 'pvt']);
    events.flush();

    expect(squad.getLeader()).toBe('cmd');

    const memberRemoved: string[] = [];
    events.on(ALifeEvents.SQUAD_MEMBER_REMOVED, ({ npcId }) => memberRemoved.push(npcId));

    // cmd dies
    squadMgr.onNPCDeath('cmd');
    events.flush();

    // Leader re-elected to sgt (next in Set insertion order)
    expect(squad.getLeader()).toBe('sgt');
    expect(squad.hasMember('cmd')).toBe(false);
    expect(squad.getMemberCount()).toBe(2);

    // SQUAD_MEMBER_REMOVED emitted for cmd
    expect(memberRemoved).toContain('cmd');
  });

  // -----------------------------------------------------------------------
  // 6. Serialize/restore round-trip with active squads
  // -----------------------------------------------------------------------
  it('serialize/restore preserves squads, leadership, and reverse index', () => {
    const squadMgr = new SquadManager(createDefaultSquadConfig(), events);

    // Create a multi-squad scenario
    const s1 = squadMgr.createSquad('stalker', ['npc_a', 'npc_b', 'npc_c']);
    s1.setLeader('npc_b');
    const s2 = squadMgr.createSquad('bandit', ['npc_d', 'npc_e']);
    const s3 = squadMgr.createSquad('duty', ['npc_f']);
    events.flush();

    const state = squadMgr.serialize();

    // Restore into fresh manager
    const mgr2 = new SquadManager(createDefaultSquadConfig(), events);
    mgr2.restore(state);

    // Structure preserved
    expect(mgr2.getAllSquads()).toHaveLength(3);

    // Leadership preserved
    const restoredS1 = mgr2.getSquadForNPC('npc_a');
    expect(restoredS1).not.toBeNull();
    expect(restoredS1!.getLeader()).toBe('npc_b');
    expect(restoredS1!.getMembers()).toEqual(['npc_a', 'npc_b', 'npc_c']);

    // Reverse index rebuilt
    expect(mgr2.getSquadId('npc_d')).toBe(s2.id);
    expect(mgr2.getSquadId('npc_f')).toBe(s3.id);
    expect(mgr2.getSquadForNPC('npc_e')!.factionId).toBe('bandit');

    // New squad after restore gets unique ID (counter recovered)
    const s4 = mgr2.createSquad('freedom', ['npc_g']);
    expect([s1.id, s2.id, s3.id]).not.toContain(s4.id);
  });

  it('restore does not emit phantom SQUAD_MEMBER_ADDED events', () => {
    const squadMgr = new SquadManager(createDefaultSquadConfig(), events);
    squadMgr.createSquad('stalker', ['npc_a', 'npc_b']);
    events.flush(); // drain events from createSquad
    const state = squadMgr.serialize();

    // Fresh EventBus to isolate restore from prior emissions
    const events2 = new EventBus<ALifeEventPayloads>();
    const mgr2 = new SquadManager(createDefaultSquadConfig(), events2);

    const added: string[] = [];
    events2.on(ALifeEvents.SQUAD_MEMBER_ADDED, ({ npcId }) => added.push(npcId));

    mgr2.restore(state);
    events2.flush();

    // restoreMember() does not emit events
    expect(added).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 7. Kill bonus propagates to entire squad
  // -----------------------------------------------------------------------
  it('kill by squad member grants morale bonus to all members', () => {
    const moraleCalls: Array<{ npcId: string; delta: number }> = [];
    const moraleLookup: MoraleLookup = (npcId) => ({
      adjustMorale(delta: number) {
        moraleCalls.push({ npcId, delta });
      },
    });

    const squadMgr = new SquadManager(createDefaultSquadConfig(), events, moraleLookup);
    squadMgr.createSquad('stalker', ['npc_a', 'npc_b', 'npc_c']);
    events.flush();

    squadMgr.onNPCKill('npc_b');

    const config = createDefaultSquadConfig();
    // All 3 members get the bonus (including the killer)
    expect(moraleCalls).toHaveLength(3);
    expect(moraleCalls.every((c) => c.delta === config.moraleKillBonus)).toBe(true);
    expect(moraleCalls.map((c) => c.npcId).sort()).toEqual(['npc_a', 'npc_b', 'npc_c']);
  });

  // -----------------------------------------------------------------------
  // 8. Squad event sequence: FORMED → MEMBER_ADDED → MEMBER_REMOVED → DISBANDED
  // -----------------------------------------------------------------------
  it('full lifecycle emits correct event sequence', () => {
    const log: string[] = [];

    events.on(ALifeEvents.SQUAD_FORMED, () => log.push('FORMED'));
    events.on(ALifeEvents.SQUAD_MEMBER_ADDED, ({ npcId }) => log.push(`ADDED:${npcId}`));
    events.on(ALifeEvents.SQUAD_MEMBER_REMOVED, ({ npcId }) => log.push(`REMOVED:${npcId}`));
    events.on(ALifeEvents.SQUAD_DISBANDED, () => log.push('DISBANDED'));

    const squadMgr = new SquadManager(createDefaultSquadConfig(), events);

    // Create with 2 members
    const _squad = squadMgr.createSquad('loner', ['npc_1', 'npc_2']);
    events.flush();

    expect(log).toEqual(['ADDED:npc_1', 'ADDED:npc_2', 'FORMED']);

    log.length = 0;

    // Remove npc_1 (squad still has npc_2)
    squadMgr.removeFromSquad('npc_1');
    events.flush();

    expect(log).toEqual(['REMOVED:npc_1']);

    log.length = 0;

    // Remove npc_2 (squad empty → auto-disband)
    squadMgr.removeFromSquad('npc_2');
    events.flush();

    expect(log).toEqual(['REMOVED:npc_2', 'DISBANDED']);
  });

  // -----------------------------------------------------------------------
  // 9. Multiple deaths in same combat tick
  // -----------------------------------------------------------------------
  it('multiple squad deaths in same tick cascade correctly', () => {
    const moraleCalls: Array<{ npcId: string; delta: number }> = [];
    const moraleLookup: MoraleLookup = (npcId) => ({
      adjustMorale(delta: number) {
        moraleCalls.push({ npcId, delta });
      },
    });

    const squadMgr = new SquadManager(createDefaultSquadConfig(), events, moraleLookup);
    squadMgr.createSquad('stalker', ['npc_a', 'npc_b', 'npc_c', 'npc_d']);
    events.flush();

    const config = createDefaultSquadConfig();

    // npc_a dies first — penalty to b, c, d (3 survivors)
    squadMgr.onNPCDeath('npc_a');

    const afterFirstDeath = [...moraleCalls];
    expect(afterFirstDeath).toHaveLength(3);
    expect(afterFirstDeath.every((c) => c.delta === config.moraleAllyDeathPenalty)).toBe(true);

    moraleCalls.length = 0;

    // npc_c dies next — penalty to b, d (2 survivors)
    squadMgr.onNPCDeath('npc_c');

    const afterSecondDeath = [...moraleCalls];
    expect(afterSecondDeath).toHaveLength(2);
    expect(afterSecondDeath.every((c) => c.delta === config.moraleAllyDeathPenalty)).toBe(true);
    expect(afterSecondDeath.map((c) => c.npcId).sort()).toEqual(['npc_b', 'npc_d']);
  });

  // -----------------------------------------------------------------------
  // 10. Cross-faction squad isolation
  // -----------------------------------------------------------------------
  it('death in one faction squad does not affect other faction squads', () => {
    const moraleCalls: Array<{ npcId: string; delta: number }> = [];
    const moraleLookup: MoraleLookup = (npcId) => ({
      adjustMorale(delta: number) {
        moraleCalls.push({ npcId, delta });
      },
    });

    const squadMgr = new SquadManager(createDefaultSquadConfig(), events, moraleLookup);
    squadMgr.createSquad('stalker', ['s_1', 's_2']);
    squadMgr.createSquad('bandit', ['b_1', 'b_2']);
    events.flush();

    // Stalker s_1 dies
    squadMgr.onNPCDeath('s_1');

    // Only s_2 receives penalty (stalker squad), bandit squad unaffected
    expect(moraleCalls).toHaveLength(1);
    expect(moraleCalls[0].npcId).toBe('s_2');

    // Bandit squad intact
    const banditSquad = squadMgr.getSquadForNPC('b_1');
    expect(banditSquad).not.toBeNull();
    expect(banditSquad!.getMemberCount()).toBe(2);
  });
});
