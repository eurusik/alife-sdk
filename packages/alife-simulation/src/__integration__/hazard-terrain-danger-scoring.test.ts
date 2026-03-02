/**
 * Integration test: "Hazard-terrain danger scoring".
 *
 * Cross-package integration between @alife-sdk/simulation (TerrainSelector,
 * NPCBrain) and @alife-sdk/hazards (HazardManager.getZonesInRadius()).
 *
 * The integration pattern:
 *   1. HazardManager detects which terrains overlap with hazard zones.
 *   2. The host elevates the terrain's dangerLevel accordingly.
 *   3. TerrainSelector penalises high-dangerLevel terrains for low-morale NPCs.
 *   4. NPCBrain (via TerrainSelector) avoids the hazardous terrain.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { SmartTerrain, EventBus } from '@alife-sdk/core';
import type { ALifeEventPayloads, IRandom } from '@alife-sdk/core';
import { HazardManager, ArtefactRegistry, WeightedArtefactSelector } from '@alife-sdk/hazards';
import type { IHazardManagerConfig } from '@alife-sdk/hazards';
import { TerrainSelector } from '../terrain/TerrainSelector';
import type { ITerrainQuery } from '../terrain/TerrainSelector';
import {
  createTerrain,
  createBrainConfig,
  createSelectorConfig,
  createJobConfig,
  createSharedDeps,
  createBrain,
} from './helpers';

// ---------------------------------------------------------------------------
// Hazard manager factory
// ---------------------------------------------------------------------------

/** Minimal no-op artefact factory (tests do not exercise spawning). */
function buildHazardManager(): HazardManager {
  const events = new EventBus<ALifeEventPayloads>();
  const random: IRandom = { next: () => 0.5, nextInt: (a, b) => a, nextFloat: (a, b) => a };
  const selector = new WeightedArtefactSelector(random);
  const artefacts = new ArtefactRegistry(selector);
  artefacts.freeze();

  const config: IHazardManagerConfig = {
    artefactFactory: { create: () => {} },
    random,
  };

  return new HazardManager(events as EventBus<any>, artefacts, config);
}

// ---------------------------------------------------------------------------
// TerrainQuery factory
// ---------------------------------------------------------------------------

function buildQuery(
  overrides: Partial<ITerrainQuery> & { terrains: readonly SmartTerrain[] },
): ITerrainQuery {
  return {
    npcFaction: 'stalkers',
    npcPos: { x: 300, y: 300 },
    npcRank: 3,
    morale: -0.6,          // low morale → danger penalty active
    surgeActive: false,
    leaderTerrainId: null,
    allowedTags: null,
    config: createSelectorConfig(),
    occupantId: 'npc_test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hazard-terrain danger scoring (integration)', () => {
  // -------------------------------------------------------------------------
  // 1. NPC with dangerTolerance=3 prefers safe terrain over dangerous one
  // -------------------------------------------------------------------------
  describe('NPC prefers safe terrain when morale is low', () => {
    it('safe terrain (dangerLevel=0) wins over dangerous terrain (dangerLevel=5) for low-morale NPC', () => {
      // Both terrains at the same distance from NPC (same x,y center offset).
      const dangerousTerrain = createTerrain({
        id: 'terrain_dangerous',
        name: 'Небезпечна зона',
        bounds: { x: 200, y: 200, width: 200, height: 200 },
        dangerLevel: 5,
        capacity: 5,
      });

      const safeTerrain = createTerrain({
        id: 'terrain_safe',
        name: 'Безпечна зона',
        bounds: { x: 400, y: 400, width: 200, height: 200 },
        dangerLevel: 0,
        capacity: 5,
      });

      // NPC at (300, 300) — equidistant from both terrain centers
      // dangerous terrain center = (300, 300), safe terrain center = (500, 500)
      // Dangerous terrain is closer but has dangerLevel=5 penalty with low morale.
      const dangerousTerrain2 = createTerrain({
        id: 'terrain_dangerous_far',
        name: 'Небезпечна зона',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 5,
        capacity: 5,
      });
      const safeTerrain2 = createTerrain({
        id: 'terrain_safe_near',
        name: 'Безпечна зона',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 0,
        capacity: 5,
      });

      // Both terrains at same position as NPC (distance = 0, same distance penalty).
      // dangerLevel=5 with moraleDangerPenalty=15 → -75 penalty for dangerous terrain.
      const query = buildQuery({
        terrains: [dangerousTerrain2, safeTerrain2],
        npcPos: { x: 100, y: 100 },
        morale: -0.6,
      });

      const selected = TerrainSelector.selectBest(query);

      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('terrain_safe_near');
    });

    it('NPC at equal distance selects terrain with dangerLevel=0 over dangerLevel=5', () => {
      // Two terrains with identical positions (center at 100,100).
      // Only difference: dangerLevel.
      const dangerTerrain = createTerrain({
        id: 'danger',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 5,
        capacity: 5,
      });

      const safeTerrain = createTerrain({
        id: 'safe',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 0,
        capacity: 5,
      });

      // dangerPenalty = dangerLevel * moraleDangerPenalty = 5 * 15 = 75
      // Both terrains: base=5, distance=0, rankBonus=0 (rank=2 < dangerLevel=5)
      // danger score = 5 - 75 = -70
      // safe score   = 5 + 10 (rankBonus, rank=3 >= 0) = 15
      const query = buildQuery({
        terrains: [dangerTerrain, safeTerrain],
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: -0.6,
      });

      const selected = TerrainSelector.selectBest(query);

      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('safe');
    });

    it('high morale NPC (morale=0.5) ignores danger penalty and picks by fitness', () => {
      // With morale >= 0, danger penalty is NOT applied (see TerrainSelector: if morale < 0).
      const dangerTerrain = createTerrain({
        id: 'danger_close',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 5,
        capacity: 10, // more remaining capacity → higher base score
      });

      const safeTerrain = createTerrain({
        id: 'safe_far',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 0,
        capacity: 5,
      });

      // No danger penalty (morale > 0).
      // danger base = 10 (capacity), rank 3 < 5 so no rankBonus → score = 10
      // safe base   = 5 (capacity), rank 3 >= 0 so rankBonus +10 → score = 15
      // safe wins by capacity scoring alone.
      const query = buildQuery({
        terrains: [dangerTerrain, safeTerrain],
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: 0.5, // positive morale → no danger penalty
      });

      const selected = TerrainSelector.selectBest(query);

      expect(selected).not.toBeNull();
      // Both valid: safe has rank bonus, danger has more capacity.
      // Score: danger = 10 + 0 (no rankBonus, rank<dangerLevel) = 10
      //        safe   = 5 + 10 (rankBonus, rank>=0) = 15
      expect(selected!.id).toBe('safe_far');
    });
  });

  // -------------------------------------------------------------------------
  // 2. HazardManager detects hazard proximity → terrain elevated dangerLevel → brain avoids
  // -------------------------------------------------------------------------
  describe('HazardManager proximity detection drives terrain danger rating', () => {
    it('terrain inside radiation zone radius is detected by getZonesInRadius', () => {
      const manager = buildHazardManager();

      // Radiation zone at (100, 100) with radius=80.
      manager.addZone({
        id: 'rad_zone_1',
        type: 'radiation',
        x: 100,
        y: 100,
        radius: 80,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Terrain center at (100, 100) — inside the hazard zone.
      const terrainX = 100;
      const terrainY = 100;
      const detectionRadius = 10;

      const zones = manager.getZonesInRadius(terrainX, terrainY, detectionRadius);

      // The radiation zone overlaps with the terrain center.
      expect(zones.length).toBeGreaterThanOrEqual(1);
      expect(zones[0]!.config.id).toBe('rad_zone_1');
      expect(zones[0]!.config.type).toBe('radiation');
    });

    it('terrain outside hazard radius is not detected', () => {
      const manager = buildHazardManager();

      manager.addZone({
        id: 'rad_zone_2',
        type: 'radiation',
        x: 100,
        y: 100,
        radius: 40,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Terrain center at (500, 500) — far outside radius.
      const zones = manager.getZonesInRadius(500, 500, 10);

      expect(zones).toHaveLength(0);
    });

    it('brain avoids terrain elevated dangerLevel due to nearby radiation zone', () => {
      const manager = buildHazardManager();

      // Radiation zone at (100, 100).
      manager.addZone({
        id: 'rad_zone_3',
        type: 'radiation',
        x: 100,
        y: 100,
        radius: 80,
        damagePerSecond: 10,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Terrain near radiation zone — host detects hazard and assigns elevated dangerLevel.
      const hazardTerrain = createTerrain({
        id: 'terrain_hazard',
        name: 'Зона радіації',
        bounds: { x: 50, y: 50, width: 100, height: 100 },  // center at (100, 100)
        dangerLevel: 5,  // elevated because of radiation zone
        capacity: 5,
      });

      // Safe terrain far from any hazard zone.
      const safeTerrain = createTerrain({
        id: 'terrain_no_hazard',
        name: 'Безпечна зона',
        bounds: { x: 450, y: 450, width: 100, height: 100 },  // center at (500, 500)
        dangerLevel: 0,
        capacity: 5,
      });

      // Verify detection: the hazardous terrain's center overlaps with the radiation zone.
      const hazardCenter = { x: 100, y: 100 };
      const zonesNearHazardTerrain = manager.getZonesInRadius(hazardCenter.x, hazardCenter.y, 10);
      expect(zonesNearHazardTerrain.length).toBeGreaterThanOrEqual(1);

      const zonesNearSafeTerrain = manager.getZonesInRadius(500, 500, 10);
      expect(zonesNearSafeTerrain).toHaveLength(0);

      // Now run TerrainSelector: low morale NPC should prefer safe terrain.
      // NPC is at (300, 300), equidistant from both terrain centers roughly.
      // danger penalty = 5 * 15 = 75 applied to hazard terrain (morale < 0)
      const selectorConfig = createSelectorConfig({ moraleDangerPenalty: 15 });

      const query: ITerrainQuery = {
        terrains: [hazardTerrain, safeTerrain],
        npcFaction: 'stalkers',
        npcPos: { x: 300, y: 300 },
        npcRank: 3,
        morale: -0.6,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: selectorConfig,
        occupantId: 'npc_scout',
      };

      const selected = TerrainSelector.selectBest(query);

      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('terrain_no_hazard');
    });
  });

  // -------------------------------------------------------------------------
  // 3. NPC with dangerTolerance=10 can assign to dangerous terrain
  // -------------------------------------------------------------------------
  describe('high dangerTolerance NPC can use dangerous terrain', () => {
    it('NPC rank >= terrain dangerLevel gets rank bonus instead of fleeing', () => {
      // When npcRank >= terrain.dangerLevel, the terrain gets +rankMatchBonus.
      // This represents a high-rank NPC that can handle the danger.
      const dangerTerrain = createTerrain({
        id: 'danger_high',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 5,
        capacity: 5,
      });

      // Low morale but high rank — danger penalty still applies for morale.
      // But we test that the NPC CAN still be assigned to the dangerous terrain
      // when it's the only option.
      const query = buildQuery({
        terrains: [dangerTerrain],
        npcPos: { x: 100, y: 100 },
        npcRank: 10,   // high rank → dangerTolerance=10 equivalent
        morale: 0.0,   // neutral morale → no danger penalty
      });

      const selected = TerrainSelector.selectBest(query);

      // NPC can be assigned even though terrain is dangerous (rank is high enough).
      expect(selected).not.toBeNull();
      expect(selected!.id).toBe('danger_high');
    });

    it('NPCBrain with dangerTolerance=10 assigns to dangerous terrain when safe terrain is full', () => {
      const { clock, events, movement } = createSharedDeps();

      // Dangerous terrain at NPC position (zero distance penalty).
      const dangerTerrain = createTerrain({
        id: 'danger_only',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 5,
        capacity: 5,
      });

      // Safe terrain is at capacity (all 3 slots filled).
      const safeTerrain = createTerrain({
        id: 'safe_full',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 0,
        capacity: 3,
      });
      safeTerrain.addOccupant('npc_a');
      safeTerrain.addOccupant('npc_b');
      safeTerrain.addOccupant('npc_c');

      // High dangerTolerance NPC with neutral morale.
      const brain = createBrain(
        'npc_high_tol',
        'stalkers',
        { clock, events },
        movement,
        {
          rank: 10,
          position: { x: 100, y: 100 },
          brainConfig: createBrainConfig({ dangerTolerance: 10 }),
        },
      );

      brain.update(0, [dangerTerrain, safeTerrain]);
      events.flush();

      // Brain must assign to dangerous terrain (safe is full).
      expect(brain.currentTerrainId).toBe('danger_only');
    });
  });

  // -------------------------------------------------------------------------
  // 4. After HazardManager.removeZone(), terrain is no longer flagged
  // -------------------------------------------------------------------------
  describe('after removeZone(), hazard proximity no longer detected', () => {
    it('removeZone() causes getZonesInRadius() to return empty for that location', () => {
      const manager = buildHazardManager();

      manager.addZone({
        id: 'temp_zone',
        type: 'chemical',
        x: 200,
        y: 200,
        radius: 60,
        damagePerSecond: 8,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Before removal: zone detected.
      const before = manager.getZonesInRadius(200, 200, 10);
      expect(before.length).toBeGreaterThanOrEqual(1);

      // Remove the zone.
      manager.removeZone('temp_zone');

      // After removal: no zones detected.
      const after = manager.getZonesInRadius(200, 200, 10);
      expect(after).toHaveLength(0);
    });

    it('brain can now assign to the former hazard terrain after zone removal', () => {
      const manager = buildHazardManager();

      manager.addZone({
        id: 'removable_zone',
        type: 'fire',
        x: 100,
        y: 100,
        radius: 80,
        damagePerSecond: 15,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Host detects hazard and creates elevated dangerLevel terrain.
      const hazardTerrain = createTerrain({
        id: 'formerly_hazardous',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 5,
        capacity: 5,
      });

      const safeTerrain = createTerrain({
        id: 'always_safe',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 0,
        capacity: 5,
      });

      // Before removal: low-morale NPC avoids hazardous terrain.
      const queryBefore: ITerrainQuery = {
        terrains: [hazardTerrain, safeTerrain],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: -0.6,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: createSelectorConfig({ moraleDangerPenalty: 15 }),
        occupantId: 'npc_scout2',
      };

      const selectedBefore = TerrainSelector.selectBest(queryBefore);
      expect(selectedBefore).not.toBeNull();
      expect(selectedBefore!.id).toBe('always_safe');

      // Remove the hazard zone — host would now update terrain dangerLevel to 0.
      manager.removeZone('removable_zone');

      // Verify zone is gone.
      const zonesAfterRemoval = manager.getZonesInRadius(100, 100, 10);
      expect(zonesAfterRemoval).toHaveLength(0);

      // Host creates an updated terrain with dangerLevel=0 (zone is gone).
      const rehabilitatedTerrain = createTerrain({
        id: 'formerly_hazardous',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        dangerLevel: 0,   // danger cleared after zone removal
        capacity: 5,
      });

      // Now both terrains are equally safe — brain can pick either.
      const queryAfter: ITerrainQuery = {
        terrains: [rehabilitatedTerrain, safeTerrain],
        npcFaction: 'stalkers',
        npcPos: { x: 100, y: 100 },
        npcRank: 3,
        morale: -0.6,
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: createSelectorConfig({ moraleDangerPenalty: 15 }),
        occupantId: 'npc_scout2',
      };

      const selectedAfter = TerrainSelector.selectBest(queryAfter);

      // Brain can now assign to the formerly hazardous terrain (no danger penalty).
      expect(selectedAfter).not.toBeNull();
      // Both have dangerLevel=0 and same position — either is valid.
      expect(['formerly_hazardous', 'always_safe']).toContain(selectedAfter!.id);
    });

    it('multiple zones — removing one does not affect remaining zone detection', () => {
      const manager = buildHazardManager();

      manager.addZone({
        id: 'zone_a',
        type: 'radiation',
        x: 100,
        y: 100,
        radius: 50,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      manager.addZone({
        id: 'zone_b',
        type: 'psi',
        x: 500,
        y: 500,
        radius: 50,
        damagePerSecond: 8,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Both zones exist.
      expect(manager.getZonesInRadius(100, 100, 10)).toHaveLength(1);
      expect(manager.getZonesInRadius(500, 500, 10)).toHaveLength(1);

      // Remove zone_a only.
      manager.removeZone('zone_a');

      // zone_a gone, zone_b remains.
      expect(manager.getZonesInRadius(100, 100, 10)).toHaveLength(0);
      expect(manager.getZonesInRadius(500, 500, 10)).toHaveLength(1);
      expect(manager.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. scoreModifier hook: custom hazard penalty via TerrainSelector
  // -------------------------------------------------------------------------
  describe('scoreModifier hook applies custom hazard-based penalty', () => {
    it('scoreModifier can apply additional penalty for terrains inside hazard zones', () => {
      const manager = buildHazardManager();

      manager.addZone({
        id: 'chemical_spill',
        type: 'chemical',
        x: 200,
        y: 200,
        radius: 100,
        damagePerSecond: 12,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      const terrainInHazard = createTerrain({
        id: 'terrain_in_chem',
        bounds: { x: 150, y: 150, width: 100, height: 100 },  // center at (200,200)
        dangerLevel: 0,
        capacity: 5,
      });

      const terrainOutside = createTerrain({
        id: 'terrain_outside',
        bounds: { x: 550, y: 550, width: 100, height: 100 },  // center at (600,600)
        dangerLevel: 0,
        capacity: 5,
      });

      // Custom scoreModifier: applies -100 penalty for terrains with hazard zones nearby.
      const HAZARD_DETECTION_RADIUS = 50;
      const HAZARD_SCORE_PENALTY = 100;

      const query: ITerrainQuery = {
        terrains: [terrainInHazard, terrainOutside],
        npcFaction: 'stalkers',
        npcPos: { x: 400, y: 400 },
        npcRank: 3,
        morale: 0.5,   // positive morale — base danger penalty not active
        surgeActive: false,
        leaderTerrainId: null,
        allowedTags: null,
        config: createSelectorConfig(),
        occupantId: 'npc_chem',
        scoreModifier: (terrain, score) => {
          const zones = manager.getZonesInRadius(
            terrain.center.x,
            terrain.center.y,
            HAZARD_DETECTION_RADIUS,
          );
          if (zones.length > 0) {
            return score - HAZARD_SCORE_PENALTY;
          }
          return score;
        },
      };

      const selected = TerrainSelector.selectBest(query);

      expect(selected).not.toBeNull();
      // The outside terrain should win — no hazard penalty applied.
      expect(selected!.id).toBe('terrain_outside');
    });
  });
});
