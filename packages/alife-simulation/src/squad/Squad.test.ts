import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { Squad, createDefaultSquadConfig, SquadGoalTypes, type MoraleLookup } from './Squad';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Squad', () => {
  let events: EventBus<ALifeEventPayloads>;
  let squad: Squad;

  beforeEach(() => {
    events = new EventBus<ALifeEventPayloads>();
    squad = new Squad('sq_1', 'loner', createDefaultSquadConfig(), events);
  });

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  it('addMember adds an NPC and returns true', () => {
    expect(squad.addMember('npc_1')).toBe(true);
    expect(squad.hasMember('npc_1')).toBe(true);
    expect(squad.getMemberCount()).toBe(1);
  });

  it('addMember returns false for duplicate', () => {
    squad.addMember('npc_1');
    expect(squad.addMember('npc_1')).toBe(false);
    expect(squad.getMemberCount()).toBe(1);
  });

  it('addMember returns false when squad is full', () => {
    const small = new Squad(
      'sq_2',
      'loner',
      createDefaultSquadConfig({ maxSize: 2 }),
      events,
    );
    small.addMember('npc_1');
    small.addMember('npc_2');

    expect(small.addMember('npc_3')).toBe(false);
    expect(small.getMemberCount()).toBe(2);
  });

  it('addMember emits SQUAD_MEMBER_ADDED', () => {
    const received: Array<{ squadId: string; npcId: string }> = [];
    events.on(ALifeEvents.SQUAD_MEMBER_ADDED, (p) => received.push(p));

    squad.addMember('npc_1');
    events.flush();

    expect(received).toEqual([{ squadId: 'sq_1', npcId: 'npc_1' }]);
  });

  it('first member is auto-elected as leader', () => {
    squad.addMember('npc_1');
    expect(squad.getLeader()).toBe('npc_1');
  });

  it('removeMember removes NPC and emits SQUAD_MEMBER_REMOVED', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    const received: Array<{ squadId: string; npcId: string }> = [];
    events.on(ALifeEvents.SQUAD_MEMBER_REMOVED, (p) => received.push(p));

    squad.removeMember('npc_2');
    events.flush();

    expect(squad.hasMember('npc_2')).toBe(false);
    expect(squad.getMemberCount()).toBe(1);
    expect(received).toEqual([{ squadId: 'sq_1', npcId: 'npc_2' }]);
  });

  it('removeMember is no-op for non-member', () => {
    const received: Array<{ squadId: string; npcId: string }> = [];
    events.on(ALifeEvents.SQUAD_MEMBER_REMOVED, (p) => received.push(p));

    squad.removeMember('ghost');
    events.flush();

    expect(received).toHaveLength(0);
  });

  it('getMembers returns snapshot array', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    const snapshot = squad.getMembers();
    expect(snapshot).toEqual(['npc_1', 'npc_2']);

    // Mutating the snapshot must not affect the squad.
    snapshot.push('npc_intruder');
    expect(squad.getMemberCount()).toBe(2);
    expect(squad.hasMember('npc_intruder')).toBe(false);
  });

  it('getMemberCount tracks correctly', () => {
    expect(squad.getMemberCount()).toBe(0);
    squad.addMember('npc_1');
    expect(squad.getMemberCount()).toBe(1);
    squad.addMember('npc_2');
    expect(squad.getMemberCount()).toBe(2);
    squad.removeMember('npc_1');
    expect(squad.getMemberCount()).toBe(1);
  });

  it('isFull returns true at capacity', () => {
    const small = new Squad(
      'sq_3',
      'duty',
      createDefaultSquadConfig({ maxSize: 2 }),
      events,
    );
    expect(small.isFull()).toBe(false);
    small.addMember('npc_1');
    expect(small.isFull()).toBe(false);
    small.addMember('npc_2');
    expect(small.isFull()).toBe(true);
  });

  it('hasMember returns correct boolean', () => {
    expect(squad.hasMember('npc_1')).toBe(false);
    squad.addMember('npc_1');
    expect(squad.hasMember('npc_1')).toBe(true);
    squad.removeMember('npc_1');
    expect(squad.hasMember('npc_1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Leadership
  // -------------------------------------------------------------------------

  it('getLeader returns current leader', () => {
    expect(squad.getLeader()).toBeNull();
    squad.addMember('npc_1');
    expect(squad.getLeader()).toBe('npc_1');
  });

  it('setLeader changes leader if NPC is member', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');
    squad.setLeader('npc_2');
    expect(squad.getLeader()).toBe('npc_2');
  });

  it('setLeader is no-op for non-member', () => {
    squad.addMember('npc_1');
    squad.setLeader('ghost');
    expect(squad.getLeader()).toBe('npc_1');
  });

  it('electNewLeader picks first member after leader removal', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');
    squad.addMember('npc_3');

    // npc_1 is leader; remove them.
    squad.removeMember('npc_1');

    // Set iteration order: npc_2 was added second, now first in the Set.
    expect(squad.getLeader()).toBe('npc_2');
  });

  it('leader is re-elected when current leader is removed', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    expect(squad.getLeader()).toBe('npc_1');
    squad.removeMember('npc_1');
    expect(squad.getLeader()).toBe('npc_2');
  });

  it('leader is null when squad is empty', () => {
    squad.addMember('npc_1');
    squad.removeMember('npc_1');
    expect(squad.getLeader()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Morale cascade
  // -------------------------------------------------------------------------

  it('onMemberDeath removes the NPC', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    squad.onMemberDeath('npc_2');

    expect(squad.hasMember('npc_2')).toBe(false);
    expect(squad.getMemberCount()).toBe(1);
  });

  it('onMemberDeath applies flat penalty to survivors', () => {
    const { lookup, calls } = createMoraleSpy();
    const sq = new Squad(
      'sq_m',
      'loner',
      createDefaultSquadConfig(),
      events,
      lookup,
    );
    sq.addMember('npc_1'); // leader
    sq.addMember('npc_2');
    sq.addMember('npc_3');

    sq.onMemberDeath('npc_3'); // regular member dies

    // Flat penalty = moraleAllyDeathPenalty(-0.15), no cascade factor applied
    expect(calls).toEqual([
      { npcId: 'npc_1', delta: -0.15 },
      { npcId: 'npc_2', delta: -0.15 },
    ]);
  });

  it('onMemberDeath applies same flat penalty for leader death', () => {
    const { lookup, calls } = createMoraleSpy();
    const sq = new Squad(
      'sq_m2',
      'loner',
      createDefaultSquadConfig(),
      events,
      lookup,
    );
    sq.addMember('npc_1'); // leader
    sq.addMember('npc_2');
    sq.addMember('npc_3');

    sq.onMemberDeath('npc_1'); // leader dies

    // Same flat penalty — cascade factors are for SquadManager.cascadeMorale()
    expect(calls).toEqual([
      { npcId: 'npc_2', delta: -0.15 },
      { npcId: 'npc_3', delta: -0.15 },
    ]);
  });

  it('onMemberDeath with no moraleLookup is safe', () => {
    // squad from beforeEach has no moraleLookup
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    // Should not throw.
    expect(() => squad.onMemberDeath('npc_2')).not.toThrow();
    expect(squad.hasMember('npc_2')).toBe(false);
  });

  it('onMemberKill applies kill bonus to all members except the killer', () => {
    const { lookup, calls } = createMoraleSpy();
    const sq = new Squad(
      'sq_k',
      'duty',
      createDefaultSquadConfig(),
      events,
      lookup,
    );
    sq.addMember('npc_1');
    sq.addMember('npc_2');
    sq.addMember('npc_3');

    sq.onMemberKill('npc_2');

    // moraleKillBonus = 0.1; killer (npc_2) is skipped
    expect(calls).toEqual([
      { npcId: 'npc_1', delta: 0.1 },
      { npcId: 'npc_3', delta: 0.1 },
    ]);
  });

  it('onMemberKill does NOT give killer the moraleKillBonus', () => {
    const { lookup, calls } = createMoraleSpy();
    const sq = new Squad(
      'sq_k2',
      'duty',
      createDefaultSquadConfig(),
      events,
      lookup,
    );
    sq.addMember('npc_1');
    sq.addMember('npc_2');
    sq.addMember('npc_3');

    sq.onMemberKill('npc_1'); // npc_1 is the killer

    const killerBonus = calls.filter((c) => c.npcId === 'npc_1');
    expect(killerBonus).toHaveLength(0);
  });

  it('onMemberKill gives moraleKillBonus to every non-killer squad member', () => {
    const { lookup, calls } = createMoraleSpy();
    const sq = new Squad(
      'sq_k3',
      'loner',
      createDefaultSquadConfig({ moraleKillBonus: 0.2 }),
      events,
      lookup,
    );
    sq.addMember('npc_a');
    sq.addMember('npc_b');
    sq.addMember('npc_c');
    sq.addMember('npc_d');

    sq.onMemberKill('npc_c'); // killer is npc_c

    expect(calls).toEqual([
      { npcId: 'npc_a', delta: 0.2 },
      { npcId: 'npc_b', delta: 0.2 },
      { npcId: 'npc_d', delta: 0.2 },
    ]);
    expect(calls.find((c) => c.npcId === 'npc_c')).toBeUndefined();
  });

  it('onMemberKill in a solo squad applies no bonus (killer is only member)', () => {
    const { lookup, calls } = createMoraleSpy();
    const sq = new Squad(
      'sq_solo',
      'loner',
      createDefaultSquadConfig(),
      events,
      lookup,
    );
    sq.addMember('npc_1');

    sq.onMemberKill('npc_1');

    expect(calls).toHaveLength(0);
  });

  it('onMemberKill with no moraleLookup is safe', () => {
    squad.addMember('npc_1');
    expect(() => squad.onMemberKill('npc_1')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('destroy clears members (SQUAD_DISBANDED is emitted by SquadManager)', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    const received: Array<{ squadId: string }> = [];
    events.on(ALifeEvents.SQUAD_DISBANDED, (p) => received.push(p));

    squad.destroy();
    events.flush();

    // Squad.destroy() does NOT emit SQUAD_DISBANDED — that's SquadManager's job
    expect(received).toHaveLength(0);
  });

  it('after destroy, squad is empty', () => {
    squad.addMember('npc_1');
    squad.addMember('npc_2');

    squad.destroy();

    expect(squad.getMemberCount()).toBe(0);
    expect(squad.getLeader()).toBeNull();
    expect(squad.hasMember('npc_1')).toBe(false);
    expect(squad.hasMember('npc_2')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Goal management
  // -------------------------------------------------------------------------

  describe('goals', () => {
    it('currentGoal is null initially', () => {
      expect(squad.currentGoal).toBeNull();
    });

    it('setGoal stores the goal and emits SQUAD_GOAL_SET', () => {
      const emitted: unknown[] = [];
      events.on(ALifeEvents.SQUAD_GOAL_SET, (p) => emitted.push(p));

      squad.setGoal({ type: SquadGoalTypes.PATROL, terrainId: 'zone_b' });
      events.flush();

      expect(squad.currentGoal).toMatchObject({ type: 'patrol', terrainId: 'zone_b' });
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        squadId: 'sq_1',
        goalType: 'patrol',
        terrainId: 'zone_b',
        priority: 0,
      });
    });

    it('setGoal stores priority and meta', () => {
      squad.setGoal({ type: 'assault', terrainId: 'zone_c', priority: 10, meta: { urgent: true } });

      const goal = squad.currentGoal!;
      expect(goal.type).toBe('assault');
      expect(goal.priority).toBe(10);
      expect(goal.meta).toEqual({ urgent: true });
    });

    it('setGoal replaces previous goal without clearing first', () => {
      const cleared: unknown[] = [];
      events.on(ALifeEvents.SQUAD_GOAL_CLEARED, (p) => cleared.push(p));

      squad.setGoal({ type: 'patrol', terrainId: 'zone_a' });
      squad.setGoal({ type: 'defend', terrainId: 'zone_b' });
      events.flush();

      expect(squad.currentGoal!.type).toBe('defend');
      expect(cleared).toHaveLength(0); // no cleared event on replace
    });

    it('clearGoal nullifies goal and emits SQUAD_GOAL_CLEARED', () => {
      const emitted: unknown[] = [];
      events.on(ALifeEvents.SQUAD_GOAL_CLEARED, (p) => emitted.push(p));

      squad.setGoal({ type: 'patrol', terrainId: 'zone_a' });
      squad.clearGoal();
      events.flush();

      expect(squad.currentGoal).toBeNull();
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({ squadId: 'sq_1', previousGoalType: 'patrol' });
    });

    it('clearGoal is a no-op when no goal is set', () => {
      const emitted: unknown[] = [];
      events.on(ALifeEvents.SQUAD_GOAL_CLEARED, (p) => emitted.push(p));

      squad.clearGoal();
      events.flush();

      expect(emitted).toHaveLength(0);
    });

    it('goal object is frozen (immutable)', () => {
      squad.setGoal({ type: 'patrol', terrainId: 'zone_a' });

      expect(Object.isFrozen(squad.currentGoal)).toBe(true);
    });

    it('destroy clears the goal', () => {
      squad.setGoal({ type: 'patrol', terrainId: 'zone_a' });
      squad.destroy();

      expect(squad.currentGoal).toBeNull();
    });

    it('restoreGoal sets goal without emitting events', () => {
      const emitted: unknown[] = [];
      events.on(ALifeEvents.SQUAD_GOAL_SET, (p) => emitted.push(p));

      squad.restoreGoal({ type: 'defend', terrainId: 'zone_x', priority: 5, meta: null });
      events.flush();

      expect(squad.currentGoal!.type).toBe('defend');
      expect(squad.currentGoal!.terrainId).toBe('zone_x');
      expect(emitted).toHaveLength(0);
    });

    it('restoreGoal with null meta and null terrainId', () => {
      squad.restoreGoal({ type: 'flee', terrainId: null, priority: 0, meta: null });

      const goal = squad.currentGoal!;
      expect(goal.type).toBe('flee');
      expect(goal.terrainId).toBeUndefined();
      expect(goal.meta).toBeUndefined();
    });

    it('custom goal type works with open union', () => {
      squad.setGoal({ type: 'escort_convoy', terrainId: 'road_1' });

      expect(squad.currentGoal!.type).toBe('escort_convoy');
    });

    it('goal without terrainId does not appear in terrain bias', () => {
      squad.setGoal({ type: 'flee' });

      expect(squad.currentGoal!.terrainId).toBeUndefined();
    });
  });
});
