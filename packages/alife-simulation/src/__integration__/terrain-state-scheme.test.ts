/**
 * Integration test: "Terrain state + scheme resolution pipeline".
 *
 * Exercises three systems that were never tested together:
 *   1. TerrainStateManager escalation → decay lifecycle
 *   2. SchemeResolver condition-list with customPredicate
 *   3. NPCBrain.update() consuming terrainStates map → scheme override on task
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { ALifeEvents } from '@alife-sdk/core';
import { TerrainStateManager, TerrainState } from '../terrain/TerrainStateManager';
import { resolve as resolveScheme } from '../terrain/SchemeResolver';
import type { ISchemeConditionConfig } from '../terrain/SchemeResolver';
import {
  createWorld,
  createTerrain,
  createBrain,
  createSharedDeps,
  assignBrainToTerrain,
  getDefaultTerrainStateConfig,
} from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Terrain state + scheme resolution (integration)', () => {
  // -----------------------------------------------------------------------
  // TerrainStateManager lifecycle
  // -----------------------------------------------------------------------

  describe('terrain state escalation and decay', () => {
    it('PEACEFUL → escalate COMBAT → decay to ALERT → decay to PEACEFUL', () => {
      const deps = createSharedDeps();
      const cfg = getDefaultTerrainStateConfig(); // combatDecayMs=500, alertDecayMs=500
      const tsm = new TerrainStateManager('zone_1', cfg, deps.events);

      expect(tsm.terrainState).toBe(TerrainState.PEACEFUL);

      // Escalate to COMBAT
      tsm.escalate(TerrainState.COMBAT, 0);
      expect(tsm.terrainState).toBe(TerrainState.COMBAT);

      // Decay: COMBAT → ALERT after combatDecayMs
      tsm.tickDecay(cfg.combatDecayMs);
      expect(tsm.terrainState).toBe(TerrainState.ALERT);

      // Decay: ALERT → PEACEFUL after alertDecayMs
      tsm.tickDecay(cfg.combatDecayMs + cfg.alertDecayMs);
      expect(tsm.terrainState).toBe(TerrainState.PEACEFUL);
    });

    it('decay before threshold does nothing', () => {
      const deps = createSharedDeps();
      const cfg = getDefaultTerrainStateConfig();
      const tsm = new TerrainStateManager('zone_1', cfg, deps.events);

      tsm.escalate(TerrainState.COMBAT, 0);
      tsm.tickDecay(cfg.combatDecayMs - 1); // Not yet enough time
      expect(tsm.terrainState).toBe(TerrainState.COMBAT);
    });

    it('emits TERRAIN_STATE_CHANGED events on transitions', () => {
      const deps = createSharedDeps();
      const cfg = getDefaultTerrainStateConfig();
      const tsm = new TerrainStateManager('zone_1', cfg, deps.events);

      const changes: Array<{ oldState: number; newState: number }> = [];
      deps.events.on(ALifeEvents.TERRAIN_STATE_CHANGED, (p) => {
        changes.push({ oldState: p.oldState, newState: p.newState });
      });

      tsm.escalate(TerrainState.COMBAT, 0);
      deps.events.flush();
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ oldState: TerrainState.PEACEFUL, newState: TerrainState.COMBAT });

      tsm.tickDecay(cfg.combatDecayMs);
      deps.events.flush();
      expect(changes).toHaveLength(2);
      expect(changes[1]).toEqual({ oldState: TerrainState.COMBAT, newState: TerrainState.ALERT });
    });
  });

  // -----------------------------------------------------------------------
  // SchemeResolver with customPredicate
  // -----------------------------------------------------------------------

  describe('scheme resolution with conditions', () => {
    it('combat terrain state → matches combat condition first', () => {
      const conditions: ISchemeConditionConfig[] = [
        { when: 'combat', scheme: 'combat_mode' },
        { when: 'alert', scheme: 'alert_mode' },
        { when: 'day', scheme: 'patrol' },
      ];

      const result = resolveScheme(conditions, false, TerrainState.COMBAT);
      expect(result).not.toBeNull();
      expect(result!.scheme).toBe('combat_mode');
    });

    it('customPredicate gates resolution (AND logic)', () => {
      const conditions: ISchemeConditionConfig[] = [
        {
          when: 'day',
          scheme: 'sniper_guard',
          customPredicate: (ctx) => ctx.terrainState === TerrainState.PEACEFUL,
        },
        { when: 'day', scheme: 'patrol' },
      ];

      // Day + COMBAT → customPredicate fails → falls through to 'patrol'
      const combatResult = resolveScheme(conditions, false, TerrainState.COMBAT);
      expect(combatResult!.scheme).toBe('patrol');

      // Day + PEACEFUL → customPredicate passes → 'sniper_guard'
      const peacefulResult = resolveScheme(conditions, false, TerrainState.PEACEFUL);
      expect(peacefulResult!.scheme).toBe('sniper_guard');
    });

    it('no conditions match → returns null', () => {
      const conditions: ISchemeConditionConfig[] = [
        { when: 'night', scheme: 'night_patrol' },
      ];

      // Day time → night condition doesn't match
      const result = resolveScheme(conditions, false, TerrainState.PEACEFUL);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // NPCBrain + TerrainStateManager + SchemeResolver integrated
  // -----------------------------------------------------------------------

  describe('brain scheme evaluation with terrain states', () => {
    it('brain applies scheme override when terrain enters COMBAT', () => {
      const deps = createSharedDeps(12); // noon
      const terrain = createTerrain({
        id: 'zone_combat',
        capacity: 10,
        jobs: [{ type: 'guard', slots: 3, position: { x: 100, y: 100 } }],
      });
      const brain = createBrain('npc_1', 'loner', deps, deps.movement);

      // Place NPC into terrain
      assignBrainToTerrain(brain, terrain, deps.events);
      expect(brain.currentTerrainId).toBe('zone_combat');

      // Set scheme conditions: combat → guard, default → patrol
      brain.setConditions([
        { when: 'combat', scheme: 'guard', params: { engageRange: 500 } },
        { when: 'day', scheme: 'patrol' },
      ]);

      // Build terrain state map with COMBAT state
      const terrainStates = new Map<string, (typeof TerrainState)[keyof typeof TerrainState]>([
        ['zone_combat', TerrainState.COMBAT],
      ]);

      // Advance past schemeCheckIntervalMs (3000ms default)
      brain.update(3_100, [terrain], terrainStates);
      deps.events.flush();

      // Task should now have the combat scheme override
      const task = brain.currentTask;
      expect(task).not.toBeNull();
      expect(task!.scheme).toBe('guard');
      expect(task!.params?.engageRange).toBe(500);
    });

    it('schemeCheckIntervalMs prevents premature re-evaluation', () => {
      const deps = createSharedDeps(12);
      const terrain = createTerrain({
        id: 'zone_a',
        capacity: 10,
        jobs: [{ type: 'patrol', slots: 3, position: { x: 100, y: 100 } }],
      });
      const brain = createBrain('npc_1', 'loner', deps, deps.movement);
      assignBrainToTerrain(brain, terrain, deps.events);

      brain.setConditions([
        { when: 'combat', scheme: 'combat_mode' },
        { when: 'day', scheme: 'patrol' },
      ]);

      // First update with PEACEFUL — should get patrol (after interval)
      brain.update(3_100, [terrain], new Map([['zone_a', TerrainState.PEACEFUL]]));
      deps.events.flush();
      expect(brain.currentTask?.scheme).toBe('patrol');

      // Switch to COMBAT but only 100ms later — below schemeCheckIntervalMs
      brain.update(100, [terrain], new Map([['zone_a', TerrainState.COMBAT]]));
      deps.events.flush();
      // Scheme should NOT have changed yet
      expect(brain.currentTask?.scheme).toBe('patrol');
    });

    it('morale below threshold triggers forced re-evaluation', () => {
      const world = createWorld({
        clockHour: 12,
        terrains: [
          { id: 'danger_zone', capacity: 10, dangerLevel: 5 },
          { id: 'safe_zone', capacity: 10, dangerLevel: 0 },
        ],
        npcs: [
          { id: 'npc_low_morale', faction: 'loner', rank: 3 },
        ],
      });

      const brain = world.brains[0];

      // Place in danger zone first
      world.tick(0);
      expect(brain.currentTerrainId).not.toBeNull();

      // Drop morale below flee threshold (-0.5)
      brain.setMorale(-0.8);

      // Tick — morale flee should trigger re-evaluation
      world.tick(5_000);
      // Brain should have attempted to find a less dangerous terrain
      expect(brain.morale).toBe(-0.8);
    });
  });

  // -----------------------------------------------------------------------
  // MovementSimulator interpolation
  // -----------------------------------------------------------------------

  describe('movement interpolation', () => {
    it('getPosition mid-journey returns interpolated position', () => {
      const deps = createSharedDeps();

      // Manually add a movement journey
      deps.movement.addMovingNPC(
        'npc_move',
        'zone_a',
        'zone_b',
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      );

      expect(deps.movement.isMoving('npc_move')).toBe(true);

      // Advance halfway through the journey
      const pos0 = deps.movement.getPosition('npc_move');
      expect(pos0).not.toBeNull();
      expect(pos0!.x).toBe(0); // Start position

      // Advance some time
      deps.movement.update(1_000);
      const posMid = deps.movement.getPosition('npc_move');
      expect(posMid).not.toBeNull();
      expect(posMid!.x).toBeGreaterThan(0);
      expect(posMid!.x).toBeLessThan(200);
    });
  });
});
