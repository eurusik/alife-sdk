/**
 * Offline combat resolution for SDK -- framework-free.
 *
 * Resolves probabilistic offline combat for terrains containing NPCs from
 * mutually hostile factions. Uses round-robin budget-capped resolution with
 * per-NPC cumulative victory probability and retreat thresholds.
 *
 * Key differences from the game-side version:
 *   - No god object (IALifeContext) -- explicit params in constructor and resolve().
 *   - No Entity references -- uses INPCRecord.entityId (string).
 *   - ISimulationBridge port for game-engine operations (isAlive, getEffectiveDamage, adjustMorale).
 *   - IRandom for deterministic testing.
 *   - IOfflineCombatConfig for all tunable constants.
 */

import type { IRandom } from '@alife-sdk/core';
import type { SmartTerrain, Faction } from '@alife-sdk/core';

import type { INPCRecord } from '../types/INPCRecord';
import { getRankMultiplier } from '../types/INPCRecord';
import type { IOfflineCombatConfig } from '../types/ISimulationConfig';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { NPCBrain } from '../brain/NPCBrain';
import type { StoryRegistry } from '../npc/StoryRegistry';
import type { NPCRelationRegistry } from '../npc/NPCRelationRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default damage type used for offline combat exchanges when not overridden by config. */
const DEFAULT_DAMAGE_TYPE = 'physical';

// ---------------------------------------------------------------------------
// OfflineCombatResolver
// ---------------------------------------------------------------------------

/**
 * Resolves probabilistic offline combat for each terrain that contains NPCs
 * from mutually hostile factions.
 *
 * Receives simulation state through explicit params -- no singletons,
 * no framework imports, fully testable with stubs.
 */
export class OfflineCombatResolver {
  private readonly config: IOfflineCombatConfig;
  private readonly bridge: ISimulationBridge;
  private readonly random: IRandom;
  private readonly damageTypeId: string;

  // Scratch fields — reused across resolve() calls to avoid per-tick allocations
  private readonly _terrainsList: SmartTerrain[] = [];
  private readonly _factionToNpcs = new Map<string, string[]>();
  private readonly _presentFactionIds: string[] = [];
  private readonly _stringArrayPool: string[][] = [];
  private readonly _terrainIndex = new Map<string, string[]>();
  private readonly _witnessIds: string[] = [];
  private readonly _witnessFactions = new Map<string, string>();

  constructor(
    config: IOfflineCombatConfig,
    bridge: ISimulationBridge,
    random: IRandom,
  ) {
    this.config = config;
    this.bridge = bridge;
    this.random = random;
    this.damageTypeId = config.damageTypeId ?? DEFAULT_DAMAGE_TYPE;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Run one round-robin pass of offline combat resolution.
   *
   * @param npcRecords         - All NPC records in the simulation.
   * @param terrains           - All smart terrains.
   * @param factions           - All factions.
   * @param brains             - All NPC brains (keyed by NPC entity ID).
   * @param storyRegistry      - Story NPC registry for quest protection.
   * @param relationRegistry   - NPC relation registry for witness goodwill.
   * @param cursor             - Current round-robin terrain cursor.
   * @param onNPCDeath         - Optional callback for game-specific death cleanup.
   * @returns The updated cursor value for the next tick.
   */
  resolve(
    npcRecords: ReadonlyMap<string, INPCRecord>,
    terrains: ReadonlyMap<string, SmartTerrain>,
    factions: ReadonlyMap<string, Faction>,
    brains: ReadonlyMap<string, NPCBrain>,
    storyRegistry: StoryRegistry,
    relationRegistry: NPCRelationRegistry,
    cursor: number,
    onNPCDeath?: (deadId: string, killerId: string) => void,
  ): number {
    this._terrainsList.length = 0;
    for (const t of terrains.values()) this._terrainsList.push(t);
    const terrainsList = this._terrainsList;
    const totalTerrains = terrainsList.length;

    // Clamp cursor in case terrains were removed since the last tick.
    let combatResolutionCursor = cursor;
    if (combatResolutionCursor >= totalTerrains) {
      combatResolutionCursor = 0;
    }

    // Build a terrain-to-NPC index using brain.currentTerrainId.
    // Only includes NPCs that are offline and alive.
    const terrainToNpcs = this.buildTerrainIndex(npcRecords, brains);

    // Each call processes at most maxResolutionsPerTick hostile
    // faction-pair exchanges across all terrains.
    let combatResolutions = 0;

    for (let i = 0; i < totalTerrains; i++) {
      if (combatResolutions >= this.config.maxResolutionsPerTick) break;

      const terrain = terrainsList[(combatResolutionCursor + i) % totalTerrains];
      const npcsInTerrain = terrainToNpcs.get(terrain.id);
      if (!npcsInTerrain || npcsInTerrain.length < 2) continue;

      // Group NPC IDs by faction (reuse scratch map + pooled buckets).
      this._releaseBuckets();

      for (const npcId of npcsInTerrain) {
        const record = npcRecords.get(npcId);
        if (!record) continue;

        const bucket = this._factionToNpcs.get(record.factionId);
        if (bucket) {
          bucket.push(npcId);
        } else {
          const newBucket = this._acquireBucket();
          newBucket.push(npcId);
          this._factionToNpcs.set(record.factionId, newBucket);
        }
      }

      if (this._factionToNpcs.size < 2) continue;

      // Check all hostile faction pairs present in this terrain.
      this._presentFactionIds.length = 0;
      for (const k of this._factionToNpcs.keys()) this._presentFactionIds.push(k);
      const presentFactionIds = this._presentFactionIds;

      for (let fi = 0; fi < presentFactionIds.length; fi++) {
        for (let fj = fi + 1; fj < presentFactionIds.length; fj++) {
          const factionAId = presentFactionIds[fi];
          const factionBId = presentFactionIds[fj];

          const factionA = factions.get(factionAId);
          const factionB = factions.get(factionBId);

          // Only resolve if mutually hostile.
          if (!factionA || !factionB) continue;
          if (!factionA.isHostile(factionBId) || !factionB.isHostile(factionAId)) continue;

          // --- Step A: Detection gate ---
          if (this.random.next() * 100 >= this.config.detectionProbability) continue;

          // --- Step B: Pick representatives from each bucket ---
          const npcsA = this._factionToNpcs.get(factionAId)!;
          const npcsB = this._factionToNpcs.get(factionBId)!;

          // Guard: buckets must still have members (earlier death in this loop
          // removes IDs from the registry but the bucket array is a snapshot).
          const npcAId = npcsA.find(id => { const r = npcRecords.get(id); return r != null && r.currentHp > 0; });
          const npcBId = npcsB.find(id => { const r = npcRecords.get(id); return r != null && r.currentHp > 0; });
          if (!npcAId || !npcBId) continue;

          const recordA = npcRecords.get(npcAId)!;
          const recordB = npcRecords.get(npcBId)!;

          // --- Step C: Victory probability (1v1 representative exchange) ---
          const powerA = Math.max(0.01, recordA.combatPower * getRankMultiplier(recordA.rank));
          const powerB = Math.max(0.01, recordB.combatPower * getRankMultiplier(recordB.rank));

          const { victoryProbMin, victoryProbMax, maxSizeAdvantage } = this.config;
          const rawVpA = Math.min(victoryProbMax, Math.max(victoryProbMin, powerA / powerB * this.config.victoryBase));
          const rawVpB = Math.min(victoryProbMax, Math.max(victoryProbMin, powerB / powerA * this.config.victoryBase));

          // Squad size advantage: side with more members gets a bonus.
          let sizeA = 0;
          for (const id of npcsA) if ((npcRecords.get(id)?.currentHp ?? 0) > 0) sizeA++;
          let sizeB = 0;
          for (const id of npcsB) if ((npcRecords.get(id)?.currentHp ?? 0) > 0) sizeB++;
          const sizeAdvantageA = Math.min(maxSizeAdvantage, sizeA / Math.max(1, sizeB));
          const sizeAdvantageB = Math.min(maxSizeAdvantage, sizeB / Math.max(1, sizeA));

          const cumWinProbA = Math.min(victoryProbMax, rawVpA * sizeAdvantageA);
          const cumWinProbB = Math.min(victoryProbMax, rawVpB * sizeAdvantageB);

          // --- Step D: Retreat decisions ---
          const attackerRetreats = cumWinProbA < recordA.behaviorConfig.retreatThreshold;
          const defenderRetreats = cumWinProbB < recordB.behaviorConfig.retreatThreshold;

          if (attackerRetreats) {
            for (const retreatingId of npcsA) {
              const brain = brains.get(retreatingId);
              if (brain) {
                brain.forceReevaluate();
              }
            }
          }

          if (defenderRetreats) {
            for (const retreatingId of npcsB) {
              const brain = brains.get(retreatingId);
              if (brain) {
                brain.forceReevaluate();
              }
            }
          }

          // If both sides retreat there is no exchange this tick.
          if (attackerRetreats && defenderRetreats) {
            combatResolutions++;
            if (combatResolutions >= this.config.maxResolutionsPerTick) break;
            continue;
          }

          // If one side retreats the other does not pursue (no damage exchange).
          if (attackerRetreats || defenderRetreats) {
            combatResolutions++;
            if (combatResolutions >= this.config.maxResolutionsPerTick) break;
            continue;
          }

          // Story NPCs cannot be killed by offline combat.
          if (storyRegistry.isStoryNPC(npcAId) || storyRegistry.isStoryNPC(npcBId)) {
            combatResolutions++;
            if (combatResolutions >= this.config.maxResolutionsPerTick) break;
            continue;
          }

          // --- Step E: Damage exchange (neither side retreated) ---
          const jitterA = this.config.powerJitterMin +
            this.random.next() * (this.config.powerJitterMax - this.config.powerJitterMin);
          const jitterB = this.config.powerJitterMin +
            this.random.next() * (this.config.powerJitterMax - this.config.powerJitterMin);

          const rawAttackA = Math.round(recordA.combatPower * getRankMultiplier(recordA.rank) * jitterA);
          const rawAttackB = Math.round(recordB.combatPower * getRankMultiplier(recordB.rank) * jitterB);

          // Apply defender's PHYSICAL immunity factor via the bridge.
          const attackA = Math.round(this.bridge.getEffectiveDamage(npcBId, rawAttackA, this.damageTypeId));
          const attackB = Math.round(this.bridge.getEffectiveDamage(npcAId, rawAttackB, this.damageTypeId));

          // Apply simultaneous damage (both hit each other).
          recordA.currentHp -= attackB;
          recordB.currentHp -= attackA;

          // Morale penalty for taking damage.
          this.bridge.adjustMorale(npcAId, this.config.moraleHitPenalty, 'hit');
          this.bridge.adjustMorale(npcBId, this.config.moraleHitPenalty, 'hit');

          // Combat lock: prevent morale-driven flee/reevaluate.
          const brainA = brains.get(npcAId);
          const brainB = brains.get(npcBId);
          brainA?.setCombatLock(this.config.combatLockMs);
          brainB?.setCombatLock(this.config.combatLockMs);

          // Resolve deaths.
          const diedA = recordA.currentHp <= 0;
          const diedB = recordB.currentHp <= 0;

          if (diedA) {
            // Grant kill credit to B only if B survived.
            this.handleNPCDeath(
              npcAId, npcBId,
              npcRecords, brains, terrain, npcsInTerrain,
              relationRegistry,
              !diedB, // killerSurvived
              onNPCDeath,
            );
          }

          if (diedB) {
            // Grant kill credit to A only if A survived.
            this.handleNPCDeath(
              npcBId, npcAId,
              npcRecords, brains, terrain, npcsInTerrain,
              relationRegistry,
              !diedA, // killerSurvived
              onNPCDeath,
            );
          }

          combatResolutions++;
          if (combatResolutions >= this.config.maxResolutionsPerTick) break;
        }

        // Also break out of the outer faction-pair loop when budget runs out.
        if (combatResolutions >= this.config.maxResolutionsPerTick) break;
      }
    }

    // Advance the round-robin cursor.
    if (totalTerrains > 0) {
      return (combatResolutionCursor + 1) % totalTerrains;
    }
    return combatResolutionCursor;
  }

  // -------------------------------------------------------------------------
  // Private -- helpers
  // -------------------------------------------------------------------------

  private _acquireBucket(): string[] {
    return this._stringArrayPool.pop() ?? [];
  }

  private _releaseBuckets(): void {
    for (const arr of this._factionToNpcs.values()) {
      arr.length = 0;
      this._stringArrayPool.push(arr);
    }
    this._factionToNpcs.clear();
  }

  /**
   * Build a map from terrainId -> npcIds for all offline, alive NPCs.
   * Uses brain.currentTerrainId to determine terrain assignment.
   * Reuses the class-level _terrainIndex map.
   *
   * NOTE: terrain buckets are plain allocations, not pooled. The terrain index
   * lives for the full duration of the tick, so returning its arrays to the
   * shared _stringArrayPool before the tick ends would allow _acquireBucket()
   * to hand the same array to a faction bucket, aliasing the two and silently
   * corrupting the terrain NPC list mid-iteration.
   */
  private buildTerrainIndex(
    npcRecords: ReadonlyMap<string, INPCRecord>,
    brains: ReadonlyMap<string, NPCBrain>,
  ): Map<string, string[]> {
    this._terrainIndex.clear();

    for (const [npcId, record] of npcRecords) {
      // Skip online NPCs -- their combat is handled by the live physics system.
      if (record.isOnline) continue;
      // Skip dead NPCs.
      if (record.currentHp <= 0) continue;

      const brain = brains.get(npcId);
      if (!brain) continue;

      const terrainId = brain.currentTerrainId;
      if (terrainId === null) continue;

      const bucket = this._terrainIndex.get(terrainId);
      if (bucket) {
        bucket.push(npcId);
      } else {
        // Allocate a plain array -- terrain buckets must NOT come from
        // _stringArrayPool because they stay live until the end of the tick.
        const newBucket = [npcId];
        this._terrainIndex.set(terrainId, newBucket);
      }
    }

    return this._terrainIndex;
  }

  /**
   * Apply ally death morale penalty to all faction allies in the same terrain.
   */
  private applyAllyDeathMoralePenalty(
    deadNpcId: string,
    deadFactionId: string,
    npcsInTerrain: readonly string[],
    npcRecords: ReadonlyMap<string, INPCRecord>,
  ): void {
    for (const allyId of npcsInTerrain) {
      if (allyId === deadNpcId) continue;

      const allyRecord = npcRecords.get(allyId);
      if (!allyRecord || allyRecord.factionId !== deadFactionId) continue;

      this.bridge.adjustMorale(allyId, this.config.moraleAllyDeathPenalty, 'ally_died');
    }
  }

  /**
   * Handle the death of a single NPC in offline combat.
   *
   * SDK-owned cleanup: terrain.removeOccupant, relation registry (onNPCKilled).
   * Full NPC cleanup (brain.onDeath, relationRegistry.removeNPC, squad ops):
   * delegated to the onNPCDeath callback (SimulationPlugin.onNPCDeath) to
   * avoid duplicate calls.
   */
  private handleNPCDeath(
    deadId: string,
    killerId: string,
    npcRecords: ReadonlyMap<string, INPCRecord>,
    brains: ReadonlyMap<string, NPCBrain>,
    terrain: SmartTerrain,
    npcsInTerrain: readonly string[],
    relationRegistry: NPCRelationRegistry,
    killerSurvived: boolean,
    onNPCDeath?: (deadId: string, killerId: string) => void,
  ): void {
    const deadRecord = npcRecords.get(deadId);
    if (!deadRecord) return;

    const deadFactionId = deadRecord.factionId;

    // Kill bonus for the surviving killer.
    if (killerSurvived) {
      this.bridge.adjustMorale(killerId, this.config.moraleKillBonus, 'kill');
    }

    // Morale cascade to allies.
    this.applyAllyDeathMoralePenalty(deadId, deadFactionId, npcsInTerrain, npcRecords);

    // Unregister from terrain.
    terrain.removeOccupant(deadId);

    // Notify relation registry -- all NPCs on same terrain are witnesses.
    this._witnessIds.length = 0;
    this._witnessFactions.clear();
    for (const wId of npcsInTerrain) {
      if (wId === deadId) continue;
      const wRec = npcRecords.get(wId);
      if (wRec) {
        this._witnessIds.push(wId);
        this._witnessFactions.set(wId, wRec.factionId);
      }
    }
    relationRegistry.onNPCKilled(killerId, deadId, deadFactionId, this._witnessIds, this._witnessFactions);

    // Trigger brain death lifecycle (emits NPC_DIED event, marks brain as dead).
    // NPCBrain.onDeath() is idempotent (_dead guard), so safe to call even if
    // SimulationPlugin's onNPCDeath callback also calls it.
    brains.get(deadId)?.onDeath(killerId);

    // Game-specific cleanup (npcs.delete, squad ops, relation removeNPC, etc.)
    // delegated to the onNPCDeath callback (e.g. SimulationPlugin.onNPCDeath).
    onNPCDeath?.(deadId, killerId);
  }
}
