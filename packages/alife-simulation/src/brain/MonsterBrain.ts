/**
 * Lair-centric offline decision-maker for mutant creatures.
 *
 * Monster brain is simpler than the human variant:
 *   - No money, no equipment preferences.
 *   - Lair-centric territory: monsters always prefer to stay near their anchor.
 *   - No Schedule / night-mode -- mutants are 24/7 predators.
 *   - No squad cohesion bonus -- monsters act as individuals or simple packs.
 *   - No surge sheltering -- monsters are native to the Zone.
 *   - High-danger affinity: opposite of a cautious human, monsters PREFER
 *     the most dangerous terrains where prey is abundant.
 *
 * Architecture:
 *   - MonsterBrain extends NPCBrain directly (NOT HumanBrain).
 *   - update() delegates entirely to super.update(). Because no Schedule is
 *     ever attached, NPCBrain.update() always falls through to the daytime
 *     terrain path -- exactly what monsters need.
 *   - selectBestTerrain() delegates to TerrainSelector.selectBest() with a
 *     scoreModifier for lair affinity + danger preference, and neutralises
 *     surge / squad / morale parameters.
 *   - buildJobContext() overrides weaponType to 'melee'.
 *
 * Pure simulation logic, zero rendering dependency.
 */

import type { SmartTerrain } from '@alife-sdk/core';
import type { INPCJobContext } from '../types/INPCRecord';
import type { TerrainState } from '../terrain/TerrainStateManager';
import { TerrainSelector } from '../terrain/TerrainSelector';
import { NPCBrain } from './NPCBrain';
import type { INPCBrainParams } from './NPCBrain';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Tunable scoring parameters specific to monster terrain selection. */
export interface IMonsterBrainConfig {
  /**
   * Bonus added to the lair terrain's score.
   * Guarantees the lair always wins unless it is completely inaccessible
   * (full or not accepting the faction).
   */
  readonly lairTerrainBonus: number;

  /**
   * Danger affinity weight.
   * Monsters gain this many score points per danger level unit,
   * making them actively prefer high-threat zones (dangerLevel -> +score).
   */
  readonly dangerAffinity: number;

  /**
   * Weapon type string injected into job context by buildJobContext().
   * Override to change monster weapon classification for suitability scoring.
   * @default 'melee'
   */
  readonly weaponType?: string;
}

/** Create a monster brain config with production-tuned defaults. */
export function createDefaultMonsterBrainConfig(
  overrides?: Partial<IMonsterBrainConfig>,
): IMonsterBrainConfig {
  return {
    lairTerrainBonus: 1_000,
    dangerAffinity: 2,
    ...overrides,
  };
}

/** Params-object for MonsterBrain construction. */
export interface IMonsterBrainParams extends INPCBrainParams {
  readonly monsterConfig: IMonsterBrainConfig;
  readonly lairTerrainId?: string;
}

// ---------------------------------------------------------------------------
// MonsterBrain
// ---------------------------------------------------------------------------

/**
 * Lair-centric offline decision-maker for mutant creatures.
 *
 * Inherits all NPCBrain infrastructure (movement dispatch, task timers, morale
 * injection, setLastPosition) and overrides two hooks:
 *
 *   selectBestTerrain() -- lair affinity + danger preference + no surge shelter.
 *   buildJobContext()   -- injects configurable weaponType (default 'melee').
 *
 * The caller stores the monster type externally (game-specific enum).
 */
export class MonsterBrain extends NPCBrain {
  // -----------------------------------------------------------------------
  // Monster-specific state
  // -----------------------------------------------------------------------

  private readonly _monsterConfig: IMonsterBrainConfig;

  /**
   * ID of the SmartTerrain that serves as this monster's home lair.
   * When non-null, selectBestTerrain() adds lairTerrainBonus to that
   * terrain's score so the monster nearly always stays near its anchor.
   */
  private _lairTerrainId: string | null;

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  constructor(params: IMonsterBrainParams) {
    super(params);

    this._monsterConfig = params.monsterConfig;
    this._lairTerrainId = params.lairTerrainId ?? null;
  }

  // -----------------------------------------------------------------------
  // Public API -- lair management
  // -----------------------------------------------------------------------

  /**
   * Assign or clear the monster's lair terrain.
   *
   * Called if a monster's lair terrain changes at runtime (e.g. a lair
   * terrain is destroyed or a new one is discovered).
   *
   * @param id - SmartTerrain ID, or null to clear the lair assignment.
   */
  setLairTerrainId(id: string | null): void {
    this._lairTerrainId = id;
  }

  /** Returns the current lair terrain ID, or null if none is assigned. */
  getLairTerrainId(): string | null {
    return this._lairTerrainId;
  }

  // -----------------------------------------------------------------------
  // Override -- job context: melee weapon type
  // -----------------------------------------------------------------------

  /**
   * Report the configured weapon type (default 'melee') so SmartTerrain
   * suitability scoring does not penalise the monster for lacking a firearm.
   */
  protected override buildJobContext(): INPCJobContext {
    const base = super.buildJobContext();
    return { ...base, weaponType: this._monsterConfig.weaponType ?? 'melee' };
  }

  // -----------------------------------------------------------------------
  // Override -- terrain selection: lair affinity + danger preference
  // -----------------------------------------------------------------------

  /**
   * Select the best SmartTerrain for this monster by delegating to
   * TerrainSelector.selectBest() with a scoreModifier callback.
   *
   * Differs from NPCBrain.selectBestTerrain() in four ways:
   *
   *   1. **Lair affinity** -- if lairTerrainId is set, that terrain receives
   *      lairTerrainBonus via scoreModifier, making it overwhelmingly
   *      preferred unless full or faction-rejected.
   *
   *   2. **Danger affinity** -- instead of the human morale-danger penalty,
   *      monsters ADD danger as a bonus via scoreModifier. High-danger
   *      terrains contain more prey and suit monster temperament.
   *
   *   3. **No surge shelter** -- surgeActive is always passed as false,
   *      so TerrainSelector never filters non-shelter terrains.
   *
   *   4. **No squad leader bonus** -- leaderTerrainId is always null,
   *      so TerrainSelector never applies the squad co-location bonus.
   *
   * @param terrains       - Full list of SmartTerrains to evaluate.
   * @param _terrainStates - Unused (monsters don't consult terrain state).
   * @returns The best terrain, or null if none are accessible.
   *
   * Time complexity: O(n) where n = terrains.length
   */
  protected override selectBestTerrain(
    terrains: readonly SmartTerrain[],
    _terrainStates?: Map<string, TerrainState>,
  ): SmartTerrain | null {
    return TerrainSelector.selectBest({
      ...this.buildTerrainQuery(terrains),
      morale: 0,
      surgeActive: false,
      leaderTerrainId: null,
      scoreModifier: (terrain, score) => this.monsterScoreModifier(terrain, score),
    });
  }

  // -----------------------------------------------------------------------
  // Monster score modifier (private)
  // -----------------------------------------------------------------------

  /**
   * Compute monster-specific score adjustments: lair affinity and danger
   * preference. Called by TerrainSelector.selectBest() as a scoreModifier.
   *
   * @param terrain - The terrain being evaluated.
   * @param score   - The base score from TerrainSelector (fitness + config).
   * @returns Adjusted score with lair bonus and danger affinity applied.
   */
  private monsterScoreModifier(terrain: SmartTerrain, score: number): number {
    let adjusted = score;

    // Lair affinity -- massive bonus keeps monsters near their home terrain.
    if (this._lairTerrainId !== null && terrain.id === this._lairTerrainId) {
      adjusted += this._monsterConfig.lairTerrainBonus;
    }

    // Danger affinity -- monsters prefer high-threat zones (more prey).
    adjusted += terrain.dangerLevel * this._monsterConfig.dangerAffinity;

    return adjusted;
  }
}
