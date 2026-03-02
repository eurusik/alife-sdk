import { describe, it, expect, vi } from 'vitest';
import { QuestEngine } from './QuestEngine';
import type { ITerrainLockAdapter } from './QuestEngine';
import { QuestStatus, ObjectiveType } from '../types/IEconomyTypes';
import type { IQuestDefinition } from '../types/IEconomyTypes';

function makeQuest(overrides?: Partial<IQuestDefinition>): IQuestDefinition {
  return {
    id: 'q_test',
    name: 'Test Quest',
    description: 'A test quest',
    objectives: [
      {
        id: 'obj_1',
        type: ObjectiveType.REACH_ZONE,
        target: 'zone_a',
        description: 'Go to zone A',
        count: 1,
        current: 0,
        completed: false,
      },
    ],
    ...overrides,
  };
}

function makeKillQuest(): IQuestDefinition {
  return {
    id: 'q_kill',
    name: 'Kill Quest',
    description: 'Kill enemies',
    objectives: [
      {
        id: 'obj_kill',
        type: ObjectiveType.KILL,
        target: 'bandits',
        description: 'Kill 3 bandits',
        count: 3,
        current: 0,
        completed: false,
      },
    ],
  };
}

describe('QuestEngine', () => {
  describe('lifecycle', () => {
    it('registers quest as AVAILABLE', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      const state = engine.getQuestState('q_test');
      expect(state?.status).toBe(QuestStatus.AVAILABLE);
    });

    it('starts quest (AVAILABLE → ACTIVE)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      expect(engine.startQuest('q_test')).toBe(true);
      expect(engine.getQuestState('q_test')?.status).toBe(QuestStatus.ACTIVE);
    });

    it('fails to start already active quest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      expect(engine.startQuest('q_test')).toBe(false);
    });

    it('fails to start nonexistent quest', () => {
      const engine = new QuestEngine();
      expect(engine.startQuest('unknown')).toBe(false);
    });

    it('fails quest (ACTIVE → FAILED)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      expect(engine.failQuest('q_test')).toBe(true);
      expect(engine.getQuestState('q_test')?.status).toBe(QuestStatus.FAILED);
    });

    it('cannot fail non-active quest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      expect(engine.failQuest('q_test')).toBe(false);
    });
  });

  describe('objectives', () => {
    it('completes single objective → auto-completes quest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      expect(engine.completeObjective('q_test', 'obj_1')).toBe(true);
      expect(engine.getQuestState('q_test')?.status).toBe(QuestStatus.COMPLETED);
    });

    it('does not auto-complete with remaining objectives', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({
        objectives: [
          { id: 'o1', type: ObjectiveType.REACH_ZONE, target: 'a', description: 'A', count: 1, current: 0, completed: false },
          { id: 'o2', type: ObjectiveType.REACH_ZONE, target: 'b', description: 'B', count: 1, current: 0, completed: false },
        ],
      }));
      engine.startQuest('q_test');
      engine.completeObjective('q_test', 'o1');
      expect(engine.getQuestState('q_test')?.status).toBe(QuestStatus.ACTIVE);
    });

    it('completes when all objectives done', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({
        objectives: [
          { id: 'o1', type: ObjectiveType.REACH_ZONE, target: 'a', description: 'A', count: 1, current: 0, completed: false },
          { id: 'o2', type: ObjectiveType.REACH_ZONE, target: 'b', description: 'B', count: 1, current: 0, completed: false },
        ],
      }));
      engine.startQuest('q_test');
      engine.completeObjective('q_test', 'o1');
      engine.completeObjective('q_test', 'o2');
      expect(engine.getQuestState('q_test')?.status).toBe(QuestStatus.COMPLETED);
    });

    it('cannot complete objective of non-active quest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      expect(engine.completeObjective('q_test', 'obj_1')).toBe(false);
    });

    it('cannot complete already completed objective', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({
        objectives: [
          { id: 'o1', type: ObjectiveType.REACH_ZONE, target: 'a', description: 'A', count: 1, current: 0, completed: false },
          { id: 'o2', type: ObjectiveType.REACH_ZONE, target: 'b', description: 'B', count: 1, current: 0, completed: false },
        ],
      }));
      engine.startQuest('q_test');
      engine.completeObjective('q_test', 'o1');
      expect(engine.completeObjective('q_test', 'o1')).toBe(false);
    });
  });

  describe('updateObjectiveProgress', () => {
    it('increments kill count', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 1);
      const state = engine.getQuestState('q_kill');
      expect(state?.objectives[0].current).toBe(1);
    });

    it('auto-completes at target count', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 3);
      expect(engine.getQuestState('q_kill')?.status).toBe(QuestStatus.COMPLETED);
    });

    it('clamps at max count', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 10);
      expect(engine.getQuestState('q_kill')?.objectives[0].current).toBe(3);
    });
  });

  describe('setTerrainAdapter', () => {
    it('setTerrainAdapter updates the adapter after construction', () => {
      const engine = new QuestEngine(); // no adapter
      const locked: Record<string, boolean> = {};
      const adapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { locked[id] = l; },
      };
      engine.setTerrainAdapter(adapter);

      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'zone_c', action: 'lock', trigger: 'on_start' },
        ],
      }));
      engine.startQuest('q_test');

      expect(locked['zone_c']).toBe(true);
    });

    it('setTerrainAdapter replaces previously set adapter', () => {
      const firstLocked: Record<string, boolean> = {};
      const firstAdapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { firstLocked[id] = l; },
      };
      const engine = new QuestEngine(firstAdapter);

      const secondLocked: Record<string, boolean> = {};
      const secondAdapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { secondLocked[id] = l; },
      };
      engine.setTerrainAdapter(secondAdapter);

      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'zone_d', action: 'lock', trigger: 'on_start' },
        ],
      }));
      engine.startQuest('q_test');

      // First adapter should not have been called after replacement.
      expect(firstLocked['zone_d']).toBeUndefined();
      // Second adapter should have been called.
      expect(secondLocked['zone_d']).toBe(true);
    });
  });

  describe('terrain effects', () => {
    it('applies on_start effects', () => {
      const locked: Record<string, boolean> = {};
      const adapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { locked[id] = l; },
      };
      const engine = new QuestEngine(adapter);
      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'zone_a', action: 'lock', trigger: 'on_start' },
        ],
      }));
      engine.startQuest('q_test');
      expect(locked['zone_a']).toBe(true);
    });

    it('applies on_complete effects', () => {
      const locked: Record<string, boolean> = {};
      const adapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { locked[id] = l; },
      };
      const engine = new QuestEngine(adapter);
      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'zone_b', action: 'unlock', trigger: 'on_complete' },
        ],
      }));
      engine.startQuest('q_test');
      engine.completeObjective('q_test', 'obj_1');
      expect(locked['zone_b']).toBe(false);
    });

    it('works without adapter (no crash)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'zone_a', action: 'lock', trigger: 'on_start' },
        ],
      }));
      expect(() => engine.startQuest('q_test')).not.toThrow();
    });
  });

  describe('query helpers', () => {
    it('getActiveQuests returns only active', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2' }));
      engine.startQuest('q1');
      expect(engine.getActiveQuests()).toHaveLength(1);
    });

    it('getAvailableQuests returns only available', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2' }));
      engine.startQuest('q1');
      expect(engine.getAvailableQuests()).toHaveLength(1);
    });

    it('getCompletedQuests returns only completed', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.startQuest('q1');
      engine.completeObjective('q1', 'obj_1');
      expect(engine.getCompletedQuests()).toHaveLength(1);
    });
  });

  describe('serialize/restore', () => {
    it('round-trips quest state', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 2);

      const data = engine.serialize();

      const engine2 = new QuestEngine();
      engine2.registerQuest(makeKillQuest());
      engine2.restore(data);

      const state = engine2.getQuestState('q_kill');
      expect(state?.status).toBe(QuestStatus.ACTIVE);
      expect(state?.objectives[0].current).toBe(2);
    });

    it('ignores invalid quest status from corrupted save (bug audit fix)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());

      // Simulate corrupted save data with an invalid status string.
      engine.restore([
        {
          id: 'q_test',
          status: 'UNKNOWN_GARBAGE',
          objectives: [{ id: 'obj_1', current: 0, completed: false }],
        },
      ]);

      // Status should remain AVAILABLE (unchanged) because 'UNKNOWN_GARBAGE' is not valid.
      const state = engine.getQuestState('q_test');
      expect(state?.status).toBe(QuestStatus.AVAILABLE);
    });

    it('skips unknown quest IDs in restore data', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());

      // Restore data references a quest that doesn't exist.
      engine.restore([
        { id: 'q_nonexistent', status: QuestStatus.ACTIVE, objectives: [] },
        { id: 'q_test', status: QuestStatus.ACTIVE, objectives: [{ id: 'obj_1', current: 0, completed: false }] },
      ]);

      // q_test should be restored, q_nonexistent silently skipped.
      expect(engine.getQuestState('q_test')?.status).toBe(QuestStatus.ACTIVE);
      expect(engine.getQuestState('q_nonexistent')).toBeUndefined();
    });

    it('skips unknown objective IDs in restore data', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 1);

      engine.restore([
        {
          id: 'q_kill',
          status: QuestStatus.ACTIVE,
          objectives: [
            { id: 'obj_kill', current: 2, completed: false },
            { id: 'obj_ghost', current: 99, completed: true }, // doesn't exist
          ],
        },
      ]);

      const state = engine.getQuestState('q_kill');
      expect(state?.objectives[0].current).toBe(2);
      // No crash, unknown objective simply ignored.
    });
  });

  describe('events', () => {
    it('quest:started fires on startQuest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      const cb = vi.fn();
      engine.on('quest:started', cb);
      engine.startQuest('q_test');
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith({ questId: 'q_test' });
    });

    it('quest:completed fires when all objectives done', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      const cb = vi.fn();
      engine.on('quest:completed', cb);
      engine.completeObjective('q_test', 'obj_1');
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith({ questId: 'q_test' });
    });

    it('quest:failed fires on failQuest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      const cb = vi.fn();
      engine.on('quest:failed', cb);
      engine.failQuest('q_test');
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith({ questId: 'q_test' });
    });

    it('objective:completed fires when objective is completed', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({
        objectives: [
          { id: 'o1', type: ObjectiveType.REACH_ZONE, target: 'a', description: 'A', count: 1, current: 0, completed: false },
          { id: 'o2', type: ObjectiveType.REACH_ZONE, target: 'b', description: 'B', count: 1, current: 0, completed: false },
        ],
      }));
      engine.startQuest('q_test');
      const cb = vi.fn();
      engine.on('objective:completed', cb);
      engine.completeObjective('q_test', 'o1');
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith({ questId: 'q_test', objectiveId: 'o1' });
    });

    it('objective:progress fires on updateObjectiveProgress with correct values', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      const events: Array<{ current: number; total: number }> = [];
      engine.on('objective:progress', ({ current, total }) => events.push({ current, total }));

      engine.updateObjectiveProgress('q_kill', 'obj_kill', 1);
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 1);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ current: 1, total: 3 });
      expect(events[1]).toEqual({ current: 2, total: 3 });
    });

    it('objective:progress fires before objective:completed on final hit', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeKillQuest());
      engine.startQuest('q_kill');
      const order: string[] = [];
      engine.on('objective:progress', () => order.push('progress'));
      engine.on('objective:completed', () => order.push('completed'));
      engine.updateObjectiveProgress('q_kill', 'obj_kill', 3);
      expect(order).toEqual(['progress', 'completed']);
    });

    it('off() removes the listener', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      const cb = vi.fn();
      engine.on('quest:started', cb);
      engine.off('quest:started', cb);
      engine.startQuest('q_test');
      expect(cb).not.toHaveBeenCalled();
    });

    it('multiple listeners on same event all fire', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      engine.on('quest:started', cb1);
      engine.on('quest:started', cb2);
      engine.startQuest('q_test');
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('no events fire when startQuest is blocked', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      const cb = vi.fn();
      engine.on('quest:started', cb);
      // Quest is already registered as AVAILABLE but we try to start unknown quest
      engine.startQuest('unknown');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('requires (prerequisites)', () => {
    it('startQuest returns false when required quest is not completed', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q1'] }));
      // q1 not even started — q2 should be blocked
      expect(engine.startQuest('q2')).toBe(false);
      expect(engine.getQuestState('q2')?.status).toBe(QuestStatus.AVAILABLE);
    });

    it('startQuest returns false when required quest is only active (not completed)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q1'] }));
      engine.startQuest('q1');
      expect(engine.startQuest('q2')).toBe(false);
    });

    it('startQuest returns false when required quest does not exist', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q_nonexistent'] }));
      expect(engine.startQuest('q2')).toBe(false);
    });

    it('startQuest succeeds after required quest is completed', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q1'] }));
      engine.startQuest('q1');
      engine.completeObjective('q1', 'obj_1');
      expect(engine.getQuestState('q1')?.status).toBe(QuestStatus.COMPLETED);
      expect(engine.startQuest('q2')).toBe(true);
      expect(engine.getQuestState('q2')?.status).toBe(QuestStatus.ACTIVE);
    });

    it('all requires must be completed (multiple prerequisites)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2' }));
      engine.registerQuest(makeQuest({ id: 'q3', requires: ['q1', 'q2'] }));

      // Complete only q1 — q3 still blocked
      engine.startQuest('q1');
      engine.completeObjective('q1', 'obj_1');
      expect(engine.startQuest('q3')).toBe(false);

      // Complete q2 — q3 now unblocked
      engine.startQuest('q2');
      engine.completeObjective('q2', 'obj_1');
      expect(engine.startQuest('q3')).toBe(true);
    });

    it('quest without requires starts normally', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      expect(engine.startQuest('q_test')).toBe(true);
    });
  });

  describe('isQuestStartable', () => {
    it('returns true for AVAILABLE quest with no requires', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      expect(engine.isQuestStartable('q_test')).toBe(true);
    });

    it('returns false when requires not completed', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q1'] }));
      expect(engine.isQuestStartable('q2')).toBe(false);
    });

    it('returns true when requires are all completed', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q1'] }));
      engine.startQuest('q1');
      engine.completeObjective('q1', 'obj_1');
      expect(engine.isQuestStartable('q2')).toBe(true);
    });

    it('returns false for ACTIVE quest (already started)', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      expect(engine.isQuestStartable('q_test')).toBe(false);
    });

    it('returns false for COMPLETED quest', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest());
      engine.startQuest('q_test');
      engine.completeObjective('q_test', 'obj_1');
      expect(engine.isQuestStartable('q_test')).toBe(false);
    });

    it('returns false for unknown quest', () => {
      const engine = new QuestEngine();
      expect(engine.isQuestStartable('nonexistent')).toBe(false);
    });

    it('usable to filter getAvailableQuests to only truly startable', () => {
      const engine = new QuestEngine();
      engine.registerQuest(makeQuest({ id: 'q1' }));
      engine.registerQuest(makeQuest({ id: 'q2', requires: ['q1'] }));
      // Both are AVAILABLE, but only q1 is startable
      expect(engine.getAvailableQuests()).toHaveLength(2);
      const startable = engine.getAvailableQuests().filter(q => engine.isQuestStartable(q.id));
      expect(startable).toHaveLength(1);
      expect(startable[0].id).toBe('q1');
    });
  });

  describe('on_fail terrain effects', () => {
    it('failQuest applies on_fail terrain effects', () => {
      const locked: Record<string, boolean> = {};
      const adapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { locked[id] = l; },
      };
      const engine = new QuestEngine(adapter);
      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'fallback_zone', action: 'unlock', trigger: 'on_fail' },
        ],
      }));
      engine.startQuest('q_test');
      engine.failQuest('q_test');
      expect(locked['fallback_zone']).toBe(false);
    });

    it('on_complete effects do NOT fire on failQuest', () => {
      const locked: Record<string, boolean> = {};
      const adapter: ITerrainLockAdapter = {
        setLocked: (id, l) => { locked[id] = l; },
      };
      const engine = new QuestEngine(adapter);
      engine.registerQuest(makeQuest({
        terrainEffects: [
          { terrainId: 'reward_zone', action: 'unlock', trigger: 'on_complete' },
          { terrainId: 'fallback_zone', action: 'unlock', trigger: 'on_fail' },
        ],
      }));
      engine.startQuest('q_test');
      engine.failQuest('q_test');
      expect(locked['reward_zone']).toBeUndefined();
      expect(locked['fallback_zone']).toBe(false);
    });
  });
});
