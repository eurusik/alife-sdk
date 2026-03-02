import { SpawnRegistry, type ISpawnPointConfig } from './SpawnRegistry';

function makePoint(overrides?: Partial<ISpawnPointConfig>): ISpawnPointConfig {
  return {
    id: 'sp1',
    terrainId: 't1',
    position: { x: 100, y: 200 },
    factionId: 'stalkers',
    maxNPCs: 3,
    ...overrides,
  };
}

describe('SpawnRegistry', () => {
  // -----------------------------------------------------------------------
  // addPoint + getEligiblePoints
  // -----------------------------------------------------------------------
  describe('addPoint / getEligiblePoints', () => {
    it('newly added point is eligible (no cooldown, no active NPCs)', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint());

      const eligible = reg.getEligiblePoints();
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('sp1');
    });

    it('point with active cooldown is not eligible', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint());
      reg.markSpawned('sp1'); // starts cooldown

      expect(reg.getEligiblePoints()).toHaveLength(0);
    });

    it('point at max capacity is not eligible even with no cooldown', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint({ maxNPCs: 1 }));
      reg.markSpawned('sp1');

      // Wait for cooldown to expire
      reg.update(30_000);

      // cooldown expired but active count = 1 = maxNPCs
      expect(reg.getEligiblePoints()).toHaveLength(0);
    });

    it('becomes eligible after cooldown expires and capacity is available', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint({ maxNPCs: 2 }));
      reg.markSpawned('sp1');

      // Tick past default cooldown (30s)
      reg.update(30_000);

      // active = 1, max = 2, cooldown = 0 => eligible
      expect(reg.getEligiblePoints()).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // markSpawned
  // -----------------------------------------------------------------------
  describe('markSpawned', () => {
    it('sets cooldown and increments active count', () => {
      const reg = new SpawnRegistry(5000);
      reg.addPoint(makePoint({ maxNPCs: 5 }));

      reg.markSpawned('sp1');
      // Should be on cooldown
      expect(reg.getEligiblePoints()).toHaveLength(0);

      // After cooldown expires
      reg.update(5000);
      expect(reg.getEligiblePoints()).toHaveLength(1);
    });

    it('increments active count each time', () => {
      const reg = new SpawnRegistry(0); // zero cooldown for simplicity
      reg.addPoint(makePoint({ maxNPCs: 3 }));

      reg.markSpawned('sp1');
      reg.update(0); // reset cooldown effect
      reg.markSpawned('sp1');
      reg.update(0);
      reg.markSpawned('sp1');
      reg.update(0);

      // active = 3 = maxNPCs, not eligible
      expect(reg.getEligiblePoints()).toHaveLength(0);
    });

    it('is a no-op for unknown spawn point IDs', () => {
      const reg = new SpawnRegistry();
      // Should not throw
      reg.markSpawned('nonexistent');
      expect(reg.totalPoints).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // markDespawned
  // -----------------------------------------------------------------------
  describe('markDespawned', () => {
    it('decrements active count', () => {
      const reg = new SpawnRegistry(100);
      reg.addPoint(makePoint({ maxNPCs: 1 }));

      reg.markSpawned('sp1');
      reg.update(100); // expire cooldown

      // active = 1 = maxNPCs => not eligible
      expect(reg.getEligiblePoints()).toHaveLength(0);

      reg.markDespawned('sp1');
      // active = 0, cooldown = 0 => eligible
      expect(reg.getEligiblePoints()).toHaveLength(1);
    });

    it('does not go below zero', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint());

      reg.markDespawned('sp1');
      reg.markDespawned('sp1');

      // Should still be eligible (active count stayed at 0)
      expect(reg.getEligiblePoints()).toHaveLength(1);
    });

    it('is a no-op for unknown spawn point IDs', () => {
      const reg = new SpawnRegistry();
      // Should not throw
      reg.markDespawned('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // update (cooldown tick-down)
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('ticks cooldowns down by deltaMs', () => {
      const reg = new SpawnRegistry(1000);
      reg.addPoint(makePoint({ maxNPCs: 5 }));
      reg.markSpawned('sp1');

      reg.update(500); // 500 remaining
      expect(reg.getEligiblePoints()).toHaveLength(0);

      reg.update(500); // 0 remaining
      expect(reg.getEligiblePoints()).toHaveLength(1);
    });

    it('does not tick below zero', () => {
      const reg = new SpawnRegistry(100);
      reg.addPoint(makePoint({ maxNPCs: 5 }));
      reg.markSpawned('sp1');

      reg.update(500); // way past cooldown
      expect(reg.getEligiblePoints()).toHaveLength(1);
    });

    it('handles multiple spawn points independently', () => {
      const reg = new SpawnRegistry(1000);
      reg.addPoint(makePoint({ id: 'sp1', maxNPCs: 5 }));
      reg.addPoint(makePoint({ id: 'sp2', maxNPCs: 5 }));

      reg.markSpawned('sp1');
      // sp1 on cooldown, sp2 is eligible
      expect(reg.getEligiblePoints()).toHaveLength(1);
      expect(reg.getEligiblePoints()[0].id).toBe('sp2');

      reg.update(1000);
      expect(reg.getEligiblePoints()).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // resetAllCooldowns
  // -----------------------------------------------------------------------
  describe('resetAllCooldowns', () => {
    it('resets all cooldowns to zero', () => {
      const reg = new SpawnRegistry(10_000);
      reg.addPoint(makePoint({ id: 'sp1', maxNPCs: 5 }));
      reg.addPoint(makePoint({ id: 'sp2', maxNPCs: 5 }));

      reg.markSpawned('sp1');
      reg.markSpawned('sp2');

      // Both on cooldown
      expect(reg.getEligiblePoints()).toHaveLength(0);

      reg.resetAllCooldowns();

      // Cooldowns reset, both eligible (active < max)
      expect(reg.getEligiblePoints()).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // getPointsByFaction
  // -----------------------------------------------------------------------
  describe('getPointsByFaction', () => {
    it('returns points matching the given faction', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint({ id: 'sp1', factionId: 'stalkers' }));
      reg.addPoint(makePoint({ id: 'sp2', factionId: 'duty' }));
      reg.addPoint(makePoint({ id: 'sp3', factionId: 'stalkers' }));

      const stalkerPoints = reg.getPointsByFaction('stalkers');
      expect(stalkerPoints).toHaveLength(2);
      expect(stalkerPoints.map((p) => p.id).sort()).toEqual(['sp1', 'sp3']);
    });

    it('returns empty array for unknown faction', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint({ factionId: 'stalkers' }));

      expect(reg.getPointsByFaction('bandits')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // serialize / restore
  // -----------------------------------------------------------------------
  describe('serialize / restore', () => {
    it('serializes cooldowns and active counts', () => {
      const reg = new SpawnRegistry(5000);
      reg.addPoint(makePoint({ id: 'sp1' }));
      reg.addPoint(makePoint({ id: 'sp2' }));

      reg.markSpawned('sp1');
      reg.update(2000); // sp1 cooldown: 3000

      const state = reg.serialize();
      expect(state.cooldowns['sp1']).toBe(3000);
      expect(state.cooldowns['sp2']).toBe(0);
      expect(state.activeCounts['sp1']).toBe(1);
      expect(state.activeCounts['sp2']).toBe(0);
    });

    it('restores state from a serialized snapshot', () => {
      const reg = new SpawnRegistry(5000);
      reg.addPoint(makePoint({ id: 'sp1', maxNPCs: 5 }));
      reg.addPoint(makePoint({ id: 'sp2', maxNPCs: 5 }));

      reg.restore({
        cooldowns: { sp1: 1000, sp2: 0 },
        activeCounts: { sp1: 2, sp2: 1 },
      });

      // sp1 still on cooldown
      expect(reg.getEligiblePoints()).toHaveLength(1);
      expect(reg.getEligiblePoints()[0].id).toBe('sp2');

      reg.update(1000);
      expect(reg.getEligiblePoints()).toHaveLength(2);
    });

    it('ignores restore data for unknown point IDs', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint({ id: 'sp1' }));

      // sp_unknown should be silently ignored
      reg.restore({
        cooldowns: { sp1: 500, sp_unknown: 9999 },
        activeCounts: { sp1: 1, sp_unknown: 5 },
      });

      expect(reg.totalPoints).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Other
  // -----------------------------------------------------------------------
  describe('point management', () => {
    it('removePoint removes the point entirely', () => {
      const reg = new SpawnRegistry();
      reg.addPoint(makePoint({ id: 'sp1' }));
      expect(reg.totalPoints).toBe(1);

      reg.removePoint('sp1');
      expect(reg.totalPoints).toBe(0);
      expect(reg.getPoint('sp1')).toBeUndefined();
    });

    it('getPoint returns the config or undefined', () => {
      const reg = new SpawnRegistry();
      const point = makePoint();
      reg.addPoint(point);

      expect(reg.getPoint('sp1')).toBe(point);
      expect(reg.getPoint('missing')).toBeUndefined();
    });

    it('totalPoints reflects current count', () => {
      const reg = new SpawnRegistry();
      expect(reg.totalPoints).toBe(0);
      reg.addPoint(makePoint({ id: 'a' }));
      reg.addPoint(makePoint({ id: 'b' }));
      expect(reg.totalPoints).toBe(2);
    });
  });
});
