import { EventBus, ALifeEvents } from '@alife-sdk/core';
import { TerrainStateManager, TerrainState } from './TerrainStateManager';
import type { ITerrainStateConfig } from '../types/ISimulationConfig';

function makeConfig(
  overrides?: Partial<ITerrainStateConfig>,
): ITerrainStateConfig {
  return {
    combatDecayMs: 30_000,
    alertDecayMs: 15_000,
    ...overrides,
  };
}

function makeManager(
  terrainId = 'bar_100',
  config?: Partial<ITerrainStateConfig>,
): { manager: TerrainStateManager; events: EventBus } {
  const events = new EventBus();
  const manager = new TerrainStateManager(terrainId, makeConfig(config), events);
  return { manager, events };
}

describe('TerrainStateManager', () => {
  // -----------------------------------------------------------------------
  // Escalation
  // -----------------------------------------------------------------------
  describe('escalation', () => {
    it('starts in PEACEFUL', () => {
      const { manager } = makeManager();
      expect(manager.terrainState).toBe(TerrainState.PEACEFUL);
    });

    it('escalates from PEACEFUL to ALERT', () => {
      const { manager } = makeManager();
      manager.escalate(TerrainState.ALERT, 1000);
      expect(manager.terrainState).toBe(TerrainState.ALERT);
    });

    it('escalates from PEACEFUL directly to COMBAT', () => {
      const { manager } = makeManager();
      manager.escalate(TerrainState.COMBAT, 1000);
      expect(manager.terrainState).toBe(TerrainState.COMBAT);
    });

    it('ignores escalation to the same level', () => {
      const { manager, events } = makeManager();
      manager.escalate(TerrainState.ALERT, 1000);
      events.flush();

      const calls: unknown[] = [];
      events.on(ALifeEvents.TERRAIN_STATE_CHANGED, (p) => calls.push(p));

      manager.escalate(TerrainState.ALERT, 2000);
      events.flush();

      expect(manager.terrainState).toBe(TerrainState.ALERT);
      expect(calls).toHaveLength(0);
    });

    it('ignores escalation to a lower level', () => {
      const { manager } = makeManager();
      manager.escalate(TerrainState.COMBAT, 1000);
      manager.escalate(TerrainState.ALERT, 2000);
      expect(manager.terrainState).toBe(TerrainState.COMBAT);
    });
  });

  // -----------------------------------------------------------------------
  // Decay
  // -----------------------------------------------------------------------
  describe('decay', () => {
    it('decays COMBAT to ALERT after combatDecayMs', () => {
      const { manager } = makeManager('t1', { combatDecayMs: 10_000 });
      manager.escalate(TerrainState.COMBAT, 0);
      manager.tickDecay(10_000);
      expect(manager.terrainState).toBe(TerrainState.ALERT);
    });

    it('decays ALERT to PEACEFUL after alertDecayMs', () => {
      const { manager } = makeManager('t1', { alertDecayMs: 5_000 });
      manager.escalate(TerrainState.ALERT, 0);
      manager.tickDecay(5_000);
      expect(manager.terrainState).toBe(TerrainState.PEACEFUL);
    });

    it('decays stepwise: COMBAT -> ALERT -> PEACEFUL', () => {
      const { manager } = makeManager('t1', {
        combatDecayMs: 10_000,
        alertDecayMs: 5_000,
      });
      manager.escalate(TerrainState.COMBAT, 0);

      manager.tickDecay(10_000);
      expect(manager.terrainState).toBe(TerrainState.ALERT);

      manager.tickDecay(15_000);
      expect(manager.terrainState).toBe(TerrainState.PEACEFUL);
    });

    it('does not decay before threshold', () => {
      const { manager } = makeManager('t1', { combatDecayMs: 10_000 });
      manager.escalate(TerrainState.COMBAT, 0);
      manager.tickDecay(9_999);
      expect(manager.terrainState).toBe(TerrainState.COMBAT);
    });

    it('does nothing when already PEACEFUL', () => {
      const { manager } = makeManager();
      manager.tickDecay(100_000);
      expect(manager.terrainState).toBe(TerrainState.PEACEFUL);
    });
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------
  describe('events', () => {
    it('emits TERRAIN_STATE_CHANGED on escalation', () => {
      const { manager, events } = makeManager('bar_100');
      const payloads: unknown[] = [];
      events.on(ALifeEvents.TERRAIN_STATE_CHANGED, (p) => payloads.push(p));

      manager.escalate(TerrainState.COMBAT, 500);
      events.flush();

      expect(payloads).toEqual([
        {
          terrainId: 'bar_100',
          oldState: TerrainState.PEACEFUL,
          newState: TerrainState.COMBAT,
        },
      ]);
    });

    it('emits TERRAIN_STATE_CHANGED on decay', () => {
      const { manager, events } = makeManager('agr', { combatDecayMs: 1000 });
      manager.escalate(TerrainState.COMBAT, 0);
      events.flush();

      const payloads: unknown[] = [];
      events.on(ALifeEvents.TERRAIN_STATE_CHANGED, (p) => payloads.push(p));

      manager.tickDecay(1000);
      events.flush();

      expect(payloads).toEqual([
        {
          terrainId: 'agr',
          oldState: TerrainState.COMBAT,
          newState: TerrainState.ALERT,
        },
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Serialize / Restore
  // -----------------------------------------------------------------------
  describe('serialize / restore', () => {
    it('round-trips state faithfully', () => {
      const { manager: m1 } = makeManager('t1');
      m1.escalate(TerrainState.COMBAT, 5000);
      const snap = m1.serialize();

      const { manager: m2 } = makeManager('t1');
      m2.restore(snap.state, snap.lastThreatTimeMs);

      expect(m2.terrainState).toBe(TerrainState.COMBAT);
      expect(m2.serialize()).toEqual(snap);
    });
  });
});
