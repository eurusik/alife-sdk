import { SmartTerrain } from '@alife-sdk/core';
import { JobSlotSystem, type IJobSlotRuntime } from './JobSlotSystem';
import { TerrainState } from './TerrainStateManager';
import type { INPCJobContext } from '../types/INPCRecord';
import type { IJobScoringConfig } from '../types/ISimulationConfig';

const defaultScoringConfig: IJobScoringConfig = {
  rankBonus: 5,
  distancePenalty: 0.01,
};

function makeTerrain(
  jobs: SmartTerrain['jobs'] = [],
): SmartTerrain {
  return new SmartTerrain({
    id: 'test_terrain',
    name: 'Test',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 10,
    jobs,
  });
}

function makeCtx(overrides?: Partial<INPCJobContext>): INPCJobContext {
  return {
    npcId: 'npc_1',
    factionId: 'stalkers',
    rank: 3,
    position: { x: 100, y: 100 },
    ...overrides,
  };
}

function makeSlot(overrides?: Partial<IJobSlotRuntime>): IJobSlotRuntime {
  return {
    type: 'guard',
    slots: 2,
    assignedNPCs: new Set(),
    ...overrides,
  };
}

describe('JobSlotSystem', () => {
  // -----------------------------------------------------------------------
  // buildSlots
  // -----------------------------------------------------------------------
  describe('buildSlots', () => {
    it('creates runtime slots from terrain jobs', () => {
      const terrain = makeTerrain([
        { type: 'guard', slots: 2, position: { x: 10, y: 10 } },
        { type: 'patrol', slots: 1 },
      ]);
      const slots = JobSlotSystem.buildSlots(terrain);

      expect(slots).toHaveLength(2);
      expect(slots[0]!.type).toBe('guard');
      expect(slots[0]!.assignedNPCs).toBeInstanceOf(Set);
      expect(slots[0]!.assignedNPCs.size).toBe(0);
      expect(slots[1]!.type).toBe('patrol');
    });

    it('returns empty array for terrain with no jobs', () => {
      const terrain = makeTerrain([]);
      expect(JobSlotSystem.buildSlots(terrain)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // clearSlots
  // -----------------------------------------------------------------------
  describe('clearSlots', () => {
    it('clears all assignedNPCs sets while preserving slot objects', () => {
      const terrain = makeTerrain([
        { type: 'guard', slots: 2 },
        { type: 'patrol', slots: 1 },
      ]);
      const slots = JobSlotSystem.buildSlots(terrain);

      // Assign NPCs
      JobSlotSystem.assignNPC(slots[0]!, 'npc_1');
      JobSlotSystem.assignNPC(slots[0]!, 'npc_2');
      JobSlotSystem.assignNPC(slots[1]!, 'npc_3');
      expect(slots[0]!.assignedNPCs.size).toBe(2);
      expect(slots[1]!.assignedNPCs.size).toBe(1);

      // Keep references to verify identity
      const ref0 = slots[0];
      const ref1 = slots[1];

      JobSlotSystem.clearSlots(slots);

      // Sets are empty but slot objects are the same references
      expect(slots[0]!.assignedNPCs.size).toBe(0);
      expect(slots[1]!.assignedNPCs.size).toBe(0);
      expect(slots[0]).toBe(ref0);
      expect(slots[1]).toBe(ref1);
    });

    it('handles empty slot array', () => {
      expect(() => JobSlotSystem.clearSlots([])).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Preconditions (tested via pickBestSlot filtering)
  // -----------------------------------------------------------------------
  describe('preconditions', () => {
    it('skips slots where rank is below minRank', () => {
      const slot = makeSlot({
        preconditions: { minRank: 5 },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx({ rank: 3 }),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBeNull();
    });

    it('accepts slot when rank meets minRank', () => {
      const slot = makeSlot({
        preconditions: { minRank: 3 },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx({ rank: 3 }),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBe(slot);
    });

    it('skips dayOnly slot at night', () => {
      const slot = makeSlot({
        preconditions: { dayOnly: true },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx(),
        true,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBeNull();
    });

    it('accepts dayOnly slot during day', () => {
      const slot = makeSlot({
        preconditions: { dayOnly: true },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx(),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBe(slot);
    });

    it('skips nightOnly slot during day', () => {
      const slot = makeSlot({
        preconditions: { nightOnly: true },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx(),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBeNull();
    });

    it('skips slot when NPC faction is not in allowed list', () => {
      const slot = makeSlot({
        preconditions: { factions: ['duty', 'freedom'] },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx({ factionId: 'bandits' }),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBeNull();
    });

    it('accepts slot when NPC faction is in allowed list', () => {
      const slot = makeSlot({
        preconditions: { factions: ['duty', 'stalkers'] },
      });
      const result = JobSlotSystem.pickBestSlot(
        [slot],
        makeCtx({ factionId: 'stalkers' }),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBe(slot);
    });
  });

  // -----------------------------------------------------------------------
  // Scoring (via pickBestSlot winner)
  // -----------------------------------------------------------------------
  describe('scoring', () => {
    it('prefers closer slots due to distance penalty', () => {
      const far = makeSlot({
        type: 'guard',
        slots: 2,
        position: { x: 500, y: 500 },
        preconditions: { minRank: 1 },
      });
      const close = makeSlot({
        type: 'patrol',
        slots: 2,
        position: { x: 110, y: 100 },
        preconditions: { minRank: 1 },
      });

      const best = JobSlotSystem.pickBestSlot(
        [far, close],
        makeCtx(),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );

      expect(best).toBe(close);
    });

    it('gives rank bonus when NPC rank >= minRank', () => {
      const withMin = makeSlot({
        type: 'guard',
        slots: 2,
        preconditions: { minRank: 2 },
      });
      const withoutMin = makeSlot({
        type: 'patrol',
        slots: 2,
      });

      // withMin gets +5 rankBonus, withoutMin gets 0
      const best = JobSlotSystem.pickBestSlot(
        [withoutMin, withMin],
        makeCtx({ rank: 3 }),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );

      expect(best).toBe(withMin);
    });
  });

  // -----------------------------------------------------------------------
  // Assignment
  // -----------------------------------------------------------------------
  describe('assignNPC / releaseNPC', () => {
    it('assigns up to slot capacity', () => {
      const slot = makeSlot({ slots: 2 });
      expect(JobSlotSystem.assignNPC(slot, 'npc_1')).toBe(true);
      expect(JobSlotSystem.assignNPC(slot, 'npc_2')).toBe(true);
      expect(slot.assignedNPCs.size).toBe(2);
    });

    it('rejects assignment beyond capacity', () => {
      const slot = makeSlot({ slots: 1 });
      JobSlotSystem.assignNPC(slot, 'npc_1');
      expect(JobSlotSystem.assignNPC(slot, 'npc_2')).toBe(false);
      expect(slot.assignedNPCs.size).toBe(1);
    });

    it('releases assigned NPC', () => {
      const slot = makeSlot({ slots: 2 });
      JobSlotSystem.assignNPC(slot, 'npc_1');
      JobSlotSystem.releaseNPC(slot, 'npc_1');
      expect(slot.assignedNPCs.size).toBe(0);
    });

    it('release of unassigned NPC is a no-op', () => {
      const slot = makeSlot({ slots: 2 });
      JobSlotSystem.releaseNPC(slot, 'ghost');
      expect(slot.assignedNPCs.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // pickBestSlot edge cases
  // -----------------------------------------------------------------------
  describe('pickBestSlot edge cases', () => {
    it('returns null when all slots are full', () => {
      const full = makeSlot({ slots: 1 });
      JobSlotSystem.assignNPC(full, 'npc_x');

      const result = JobSlotSystem.pickBestSlot(
        [full],
        makeCtx(),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );

      expect(result).toBeNull();
    });

    it('returns null for empty slot list', () => {
      const result = JobSlotSystem.pickBestSlot(
        [],
        makeCtx(),
        false,
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );
      expect(result).toBeNull();
    });

    it('skips precondition-failing slots and picks valid one', () => {
      const dayOnly = makeSlot({
        type: 'guard',
        slots: 2,
        preconditions: { dayOnly: true },
      });
      const nightSlot = makeSlot({
        type: 'camp',
        slots: 2,
        preconditions: { nightOnly: true },
      });

      const result = JobSlotSystem.pickBestSlot(
        [dayOnly, nightSlot],
        makeCtx(),
        true, // night
        TerrainState.PEACEFUL,
        defaultScoringConfig,
      );

      expect(result).toBe(nightSlot);
    });
  });
});
