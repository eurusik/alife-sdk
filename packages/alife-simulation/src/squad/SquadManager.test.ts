/**
 * Tests for SquadManager -- pure data/logic unit tests.
 *
 * Zero mocks, zero vi.fn(). Uses real EventBus from @alife-sdk/core
 * and plain stub objects for MoraleLookup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';

import { SquadManager } from './SquadManager';
import { createDefaultSquadConfig } from './Squad';
import type { MoraleLookup } from './Squad';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMoraleSpy() {
  const calls: Array<{ npcId: string; delta: number }> = [];
  const lookup: MoraleLookup = (npcId) => ({
    adjustMorale(delta: number) {
      calls.push({ npcId, delta });
    },
  });
  return { lookup, calls };
}

function createManager(
  events: EventBus<ALifeEventPayloads>,
  moraleLookup?: MoraleLookup | null,
) {
  return new SquadManager(createDefaultSquadConfig(), events, moraleLookup);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SquadManager', () => {
  let events: EventBus<ALifeEventPayloads>;

  beforeEach(() => {
    events = new EventBus<ALifeEventPayloads>();
  });

  // =========================================================================
  // Squad lifecycle
  // =========================================================================

  describe('Squad lifecycle', () => {
    it('createSquad creates a squad and emits SQUAD_FORMED', () => {
      const mgr = createManager(events);
      const emitted: Array<{ squadId: string; factionId: string; memberIds: string[] }> = [];
      events.on(ALifeEvents.SQUAD_FORMED, (payload) => emitted.push(payload));

      const squad = mgr.createSquad('stalker');
      events.flush();

      expect(squad).toBeDefined();
      expect(squad.factionId).toBe('stalker');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].factionId).toBe('stalker');
      expect(emitted[0].squadId).toBe(squad.id);
    });

    it('createSquad with initial members adds them all', () => {
      const mgr = createManager(events);
      const addedMembers: string[] = [];
      events.on(ALifeEvents.SQUAD_MEMBER_ADDED, ({ npcId }) => addedMembers.push(npcId));

      const squad = mgr.createSquad('stalker', ['npc_a', 'npc_b', 'npc_c']);
      events.flush();

      expect(squad.getMemberCount()).toBe(3);
      expect(squad.getMembers()).toEqual(['npc_a', 'npc_b', 'npc_c']);
      expect(addedMembers).toEqual(['npc_a', 'npc_b', 'npc_c']);
    });

    it('createSquad generates unique IDs', () => {
      const mgr = createManager(events);

      const s1 = mgr.createSquad('stalker');
      const s2 = mgr.createSquad('stalker');
      const s3 = mgr.createSquad('bandit');

      expect(s1.id).not.toBe(s2.id);
      expect(s2.id).not.toBe(s3.id);
      expect(s1.id).not.toBe(s3.id);
    });

    it('disbandSquad removes squad and emits SQUAD_DISBANDED', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.disbandSquad(squad.id);
      events.flush();

      // SquadManager emits SQUAD_DISBANDED after squad.destroy()
      expect(disbanded).toContain(squad.id);
      expect(mgr.getAllSquads()).toHaveLength(0);
    });

    it('disbandSquad is no-op for unknown squadId', () => {
      const mgr = createManager(events);
      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.disbandSquad('nonexistent_squad');
      events.flush();

      expect(disbanded).toHaveLength(0);
    });
  });

  // =========================================================================
  // NPC assignment
  // =========================================================================

  describe('NPC assignment', () => {
    it('assignToSquad adds NPC and returns true', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker');

      const result = mgr.assignToSquad('npc_a', squad.id);

      expect(result).toBe(true);
      expect(squad.hasMember('npc_a')).toBe(true);
    });

    it('assignToSquad returns false for unknown squadId', () => {
      const mgr = createManager(events);

      const result = mgr.assignToSquad('npc_a', 'nonexistent');

      expect(result).toBe(false);
    });

    it('assignToSquad moves NPC from previous squad', () => {
      const mgr = createManager(events);
      const squadA = mgr.createSquad('stalker', ['npc_x']);
      const squadB = mgr.createSquad('stalker', ['npc_y']);

      // npc_x is in squadA, move to squadB
      mgr.assignToSquad('npc_x', squadB.id);

      expect(squadA.hasMember('npc_x')).toBe(false);
      expect(squadB.hasMember('npc_x')).toBe(true);
    });

    it('removeFromSquad removes NPC from squad', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      mgr.removeFromSquad('npc_a');

      expect(squad.hasMember('npc_a')).toBe(false);
      expect(squad.hasMember('npc_b')).toBe(true);
      expect(mgr.getSquadForNPC('npc_a')).toBeNull();
    });

    it('removeFromSquad auto-disbands empty squad with SQUAD_DISBANDED event', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.removeFromSquad('npc_a');
      events.flush();

      expect(disbanded).toContain(squad.id);
      expect(mgr.getAllSquads()).toHaveLength(0);
    });

    it('removeFromSquad is no-op for unassigned NPC', () => {
      const mgr = createManager(events);
      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.removeFromSquad('nonexistent_npc');
      events.flush();

      expect(disbanded).toHaveLength(0);
    });
  });

  // =========================================================================
  // Auto-grouping
  // =========================================================================

  describe('Auto-grouping', () => {
    it('autoAssign finds first non-full same-faction squad', () => {
      const mgr = createManager(events);
      const existing = mgr.createSquad('stalker', ['npc_a']);

      const result = mgr.autoAssign('npc_b', 'stalker');

      expect(result.id).toBe(existing.id);
      expect(existing.hasMember('npc_b')).toBe(true);
    });

    it('autoAssign creates new squad when all existing are full', () => {
      const mgr = createManager(events);
      // Default maxSize = 4, fill it up
      const full = mgr.createSquad('stalker', ['a', 'b', 'c', 'd']);
      expect(full.isFull()).toBe(true);

      const result = mgr.autoAssign('npc_e', 'stalker');

      expect(result.id).not.toBe(full.id);
      expect(result.hasMember('npc_e')).toBe(true);
      expect(mgr.getAllSquads()).toHaveLength(2);
    });

    it('autoAssign creates new squad for new faction', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a']);

      const result = mgr.autoAssign('npc_b', 'bandit');

      expect(result.factionId).toBe('bandit');
      expect(result.hasMember('npc_b')).toBe(true);
      expect(mgr.getAllSquads()).toHaveLength(2);
    });
  });

  // =========================================================================
  // Queries
  // =========================================================================

  describe('Queries', () => {
    it('getSquadForNPC returns correct squad', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);

      expect(mgr.getSquadForNPC('npc_a')).toBe(squad);
    });

    it('getSquadForNPC returns null for unassigned NPC', () => {
      const mgr = createManager(events);

      expect(mgr.getSquadForNPC('nonexistent')).toBeNull();
    });

    it('getSquadId returns squadId string', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);

      expect(mgr.getSquadId('npc_a')).toBe(squad.id);
    });

    it('getSquadsByFaction returns only matching faction squads', () => {
      const mgr = createManager(events);
      const s1 = mgr.createSquad('stalker', ['npc_a']);
      const s2 = mgr.createSquad('stalker', ['npc_b']);
      mgr.createSquad('bandit', ['npc_c']);

      const stalkerSquads = mgr.getSquadsByFaction('stalker');

      expect(stalkerSquads).toHaveLength(2);
      expect(stalkerSquads.map(s => s.id)).toContain(s1.id);
      expect(stalkerSquads.map(s => s.id)).toContain(s2.id);
    });

    it('getAllSquads returns all squads', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a']);
      mgr.createSquad('bandit', ['npc_b']);
      mgr.createSquad('duty', ['npc_c']);

      expect(mgr.getAllSquads()).toHaveLength(3);
    });
  });

  // =========================================================================
  // Morale events
  // =========================================================================

  describe('Morale events', () => {
    it('onNPCDeath delegates to Squad.onMemberDeath', () => {
      const { lookup, calls } = createMoraleSpy();
      const mgr = createManager(events, lookup);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      mgr.onNPCDeath('npc_a');

      // Squad.onMemberDeath applies flat moraleAllyDeathPenalty (-0.15)
      // to survivors. No cascade factor applied (those are for cascadeMorale).
      const forB = calls.filter(c => c.npcId === 'npc_b');
      expect(forB).toHaveLength(1);
      expect(forB[0].delta).toBe(-0.15);
    });

    it('onNPCDeath auto-disbands empty squad', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.onNPCDeath('npc_a');
      events.flush();

      expect(disbanded).toContain(squad.id);
      expect(mgr.getAllSquads()).toHaveLength(0);
    });

    it('onNPCDeath cleans up reverse index', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      mgr.onNPCDeath('npc_a');

      expect(mgr.getSquadForNPC('npc_a')).toBeNull();
      expect(mgr.getSquadId('npc_a')).toBeNull();
    });

    it('onNPCKill delegates to Squad.onMemberKill, skipping the killer', () => {
      const { lookup, calls } = createMoraleSpy();
      const mgr = createManager(events, lookup);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      mgr.onNPCKill('npc_a');

      // Squad.onMemberKill applies moraleKillBonus (0.1) to all members
      // except the killer (npc_a). Only npc_b should receive the bonus.
      const config = createDefaultSquadConfig();
      expect(calls).toHaveLength(1);
      expect(calls[0].npcId).toBe('npc_b');
      expect(calls[0].delta).toBe(config.moraleKillBonus);
    });

    it('cascadeMorale applies leader factor when source is leader', () => {
      const { lookup, calls } = createMoraleSpy();
      const mgr = createManager(events, lookup);
      const squad = mgr.createSquad('stalker', ['leader', 'npc_b', 'npc_c']);
      // First member becomes leader automatically

      expect(squad.getLeader()).toBe('leader');

      mgr.cascadeMorale(squad.id, 'leader', -0.5);

      const config = createDefaultSquadConfig();
      const expectedDelta = -0.5 * config.moraleCascadeLeaderFactor;
      // Should cascade to npc_b and npc_c, but NOT to leader
      expect(calls).toHaveLength(2);
      expect(calls.every(c => c.npcId !== 'leader')).toBe(true);
      expect(calls.every(c => c.delta === expectedDelta)).toBe(true);
    });

    it('cascadeMorale applies regular factor when source is not leader', () => {
      const { lookup, calls } = createMoraleSpy();
      const mgr = createManager(events, lookup);
      const squad = mgr.createSquad('stalker', ['leader', 'npc_b', 'npc_c']);

      mgr.cascadeMorale(squad.id, 'npc_b', -0.5);

      const config = createDefaultSquadConfig();
      const expectedDelta = -0.5 * config.moraleCascadeFactor;
      // Should cascade to leader and npc_c, but NOT to npc_b
      expect(calls).toHaveLength(2);
      expect(calls.every(c => c.npcId !== 'npc_b')).toBe(true);
      expect(calls.every(c => c.delta === expectedDelta)).toBe(true);
    });

    it('cascadeMorale skips source NPC (no self-cascade)', () => {
      const { lookup, calls } = createMoraleSpy();
      const mgr = createManager(events, lookup);
      const squad = mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      mgr.cascadeMorale(squad.id, 'npc_a', -0.3);

      expect(calls.every(c => c.npcId !== 'npc_a')).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].npcId).toBe('npc_b');
    });

    it('cascadeMorale is no-op for unknown squadId', () => {
      const { lookup, calls } = createMoraleSpy();
      const mgr = createManager(events, lookup);

      mgr.cascadeMorale('nonexistent', 'npc_a', -0.5);

      expect(calls).toHaveLength(0);
    });
  });

  // =========================================================================
  // Serialization
  // =========================================================================

  describe('Serialization', () => {
    it('serialize captures all squad state', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);
      mgr.createSquad('bandit', ['npc_c']);

      const state = mgr.serialize();

      expect(state.squads).toHaveLength(2);
      const stalkerSquad = state.squads.find(s => s.factionId === 'stalker')!;
      expect(stalkerSquad.memberIds).toEqual(['npc_a', 'npc_b']);
      expect(stalkerSquad.leaderId).toBe('npc_a');
      const banditSquad = state.squads.find(s => s.factionId === 'bandit')!;
      expect(banditSquad.memberIds).toEqual(['npc_c']);
      expect(banditSquad.leaderId).toBe('npc_c');
    });

    it('restore rebuilds squads from state', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);
      const state = mgr.serialize();

      const mgr2 = createManager(events);
      mgr2.restore(state);

      expect(mgr2.getAllSquads()).toHaveLength(1);
      const squad = mgr2.getAllSquads()[0];
      expect(squad.factionId).toBe('stalker');
      expect(squad.getMembers()).toEqual(['npc_a', 'npc_b']);
    });

    it('restore preserves leadership', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a', 'npc_b', 'npc_c']);
      squad.setLeader('npc_b');

      const state = mgr.serialize();

      const mgr2 = createManager(events);
      mgr2.restore(state);

      const restored = mgr2.getAllSquads()[0];
      expect(restored.getLeader()).toBe('npc_b');
    });

    it('restore recovers squadCounter for unique IDs', () => {
      const mgr = createManager(events);
      // Create 3 squads -> counter at 3
      mgr.createSquad('stalker', ['npc_a']);
      mgr.createSquad('stalker', ['npc_b']);
      mgr.createSquad('stalker', ['npc_c']);
      const state = mgr.serialize();

      const mgr2 = createManager(events);
      mgr2.restore(state);

      // Next squad should have counter > 3, ensuring no collisions
      const newSquad = mgr2.createSquad('stalker', ['npc_d']);
      const existingIds = state.squads.map(s => s.id);
      expect(existingIds).not.toContain(newSquad.id);
    });

    it('serialize/restore round-trip preserves all data', () => {
      const mgr = createManager(events);
      const s1 = mgr.createSquad('stalker', ['a', 'b']);
      const s2 = mgr.createSquad('bandit', ['c', 'd', 'e']);
      s2.setLeader('d');

      const state = mgr.serialize();
      const mgr2 = createManager(events);
      mgr2.restore(state);

      // Verify structure matches
      const state2 = mgr2.serialize();
      expect(state2.squads).toHaveLength(state.squads.length);

      for (const original of state.squads) {
        const restored = state2.squads.find(s => s.id === original.id)!;
        expect(restored).toBeDefined();
        expect(restored.factionId).toBe(original.factionId);
        expect(restored.memberIds).toEqual(original.memberIds);
        expect(restored.leaderId).toBe(original.leaderId);
      }

      // Verify reverse index is rebuilt
      expect(mgr2.getSquadId('a')).toBe(s1.id);
      expect(mgr2.getSquadId('d')).toBe(s2.id);
    });
  });

  // =========================================================================
  // destroy() leak fix -- squad.destroy() called on empty-squad paths
  // =========================================================================

  describe('destroy() leak fix', () => {
    // -----------------------------------------------------------------------
    // removeFromSquad paths
    // -----------------------------------------------------------------------

    it('removeFromSquad on last member calls squad.destroy() (members cleared)', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      // Hold a reference before removal so we can inspect post-destroy state.
      const capturedSquad = mgr.getSquadForNPC('npc_a')!;
      expect(capturedSquad).toBeDefined();

      mgr.removeFromSquad('npc_a');

      // destroy() clears members and leaderId -- the only code path that does so
      // while the squad object is still reachable via a captured reference.
      expect(capturedSquad.getMemberCount()).toBe(0);
      expect(capturedSquad.getLeader()).toBeNull();
      // Manager evicts the squad from its index.
      expect(mgr.getAllSquads()).toHaveLength(0);
    });

    it('removeFromSquad on last member emits SQUAD_DISBANDED', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.removeFromSquad('npc_a');
      events.flush();

      expect(disbanded).toEqual([squad.id]);
    });

    it('removeFromSquad on non-last member does NOT call squad.destroy()', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      const capturedSquad = mgr.getSquadForNPC('npc_a')!;

      // Remove one of two members -- squad should survive intact.
      mgr.removeFromSquad('npc_a');

      // destroy() was NOT called: remaining member is still tracked.
      expect(capturedSquad.getMemberCount()).toBe(1);
      expect(capturedSquad.hasMember('npc_b')).toBe(true);
      expect(capturedSquad.getLeader()).toBe('npc_b');
      // Squad is still registered in the manager.
      expect(mgr.getAllSquads()).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // onNPCDeath paths
    // -----------------------------------------------------------------------

    it('onNPCDeath on last member calls squad.destroy() (members cleared)', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      const capturedSquad = mgr.getSquadForNPC('npc_a')!;
      expect(capturedSquad).toBeDefined();

      mgr.onNPCDeath('npc_a');

      expect(capturedSquad.getMemberCount()).toBe(0);
      expect(capturedSquad.getLeader()).toBeNull();
      expect(mgr.getAllSquads()).toHaveLength(0);
    });

    it('onNPCDeath on last member emits SQUAD_DISBANDED', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      events.flush();

      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.onNPCDeath('npc_a');
      events.flush();

      expect(disbanded).toEqual([squad.id]);
    });

    it('onNPCDeath on non-last member does NOT call squad.destroy()', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);

      const capturedSquad = mgr.getSquadForNPC('npc_a')!;

      mgr.onNPCDeath('npc_a');

      // Survivor must still be tracked -- destroy() would have wiped them.
      expect(capturedSquad.getMemberCount()).toBe(1);
      expect(capturedSquad.hasMember('npc_b')).toBe(true);
      expect(mgr.getAllSquads()).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // disbandSquad regression -- pre-existing explicit disband must still work
    // -----------------------------------------------------------------------

    it('disbandSquad still calls squad.destroy() (regression)', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a', 'npc_b']);
      events.flush();

      // Capture before disbanding so we can assert post-destroy state.
      const capturedSquad = mgr.getSquadForNPC('npc_a')!;

      mgr.disbandSquad(squad.id);

      expect(capturedSquad.getMemberCount()).toBe(0);
      expect(capturedSquad.getLeader()).toBeNull();
      expect(mgr.getAllSquads()).toHaveLength(0);
    });

    it('disbandSquad still emits SQUAD_DISBANDED (regression)', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a', 'npc_b']);
      events.flush();

      const disbanded: string[] = [];
      events.on(ALifeEvents.SQUAD_DISBANDED, ({ squadId }) => disbanded.push(squadId));

      mgr.disbandSquad(squad.id);
      events.flush();

      expect(disbanded).toEqual([squad.id]);
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe('Lifecycle', () => {
    it('destroy clears all state', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a', 'npc_b']);
      mgr.createSquad('bandit', ['npc_c']);

      mgr.destroy();

      expect(mgr.getAllSquads()).toHaveLength(0);
      expect(mgr.getSquadForNPC('npc_a')).toBeNull();
      expect(mgr.getSquadId('npc_b')).toBeNull();
    });
  });

  // =========================================================================
  // Squad goal serialization
  // =========================================================================

  describe('goal serialize/restore', () => {
    it('preserves goal through serialize/restore round-trip', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      squad.setGoal({ type: 'patrol', terrainId: 'zone_b', priority: 5 });

      const state = mgr.serialize();
      const mgr2 = createManager(events);
      mgr2.restore(state);

      const restored = mgr2.getAllSquads()[0]!;
      expect(restored.currentGoal).toMatchObject({
        type: 'patrol',
        terrainId: 'zone_b',
        priority: 5,
      });
    });

    it('preserves null goal through serialize/restore', () => {
      const mgr = createManager(events);
      mgr.createSquad('stalker', ['npc_a']);

      const state = mgr.serialize();
      const mgr2 = createManager(events);
      mgr2.restore(state);

      expect(mgr2.getAllSquads()[0]!.currentGoal).toBeNull();
    });

    it('preserves goal with meta through round-trip', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      squad.setGoal({ type: 'assault', terrainId: 'zone_c', priority: 10, meta: { urgent: true } });

      const state = mgr.serialize();
      const mgr2 = createManager(events);
      mgr2.restore(state);

      const goal = mgr2.getAllSquads()[0]!.currentGoal!;
      expect(goal.meta).toEqual({ urgent: true });
    });

    it('restore does not emit SQUAD_GOAL_SET', () => {
      const mgr = createManager(events);
      const squad = mgr.createSquad('stalker', ['npc_a']);
      squad.setGoal({ type: 'defend', terrainId: 'zone_d' });
      events.flush(); // flush setGoal event before attaching spy

      const state = mgr.serialize();

      const emitted: unknown[] = [];
      events.on(ALifeEvents.SQUAD_GOAL_SET, (p) => emitted.push(p));

      const mgr2 = createManager(events);
      mgr2.restore(state);
      events.flush();

      expect(emitted).toHaveLength(0);
    });
  });
});
