/**
 * Equipment-aware human brain -- extends NPCBrain with weapon specialisation,
 * equipment personality traits, and money management.
 *
 * Responsibilities:
 *   - Override terrain selection to layer equipment bonuses on top of base scoring.
 *   - Inject weapon type into job context for suitability scoring.
 *   - Track abstract currency balance for future trade/loot systems.
 *
 * Design:
 *   - Pure simulation logic, zero rendering or framework dependency.
 *   - All scoring weights injected via IHumanBrainConfig, no hardcoded constants.
 *   - Equipment bonuses are additive on top of the full TerrainSelector pipeline,
 *     so they never override critical survival logic (surge shelter, morale flee).
 *   - Uses configurable terrain tags (default 'guard', 'patrol', 'camp') to
 *     identify terrain roles, matching the SDK SmartTerrain.tags convention.
 *   - Deterministic given identical inputs and configs.
 */

import type { SmartTerrain } from '@alife-sdk/core';
import type { INPCJobContext } from '../types/INPCRecord';
import type { TerrainState } from '../terrain/TerrainStateManager';
import { TerrainSelector } from '../terrain/TerrainSelector';
import { NPCBrain } from './NPCBrain';
import type { INPCBrainParams } from './NPCBrain';

// ---------------------------------------------------------------------------
// Equipment preference
// ---------------------------------------------------------------------------

/** Weapon class carried by a human NPC. Built-in values have IDE autocomplete; any string is also valid. */
export type WeaponType = 'pistol' | 'rifle' | 'shotgun' | 'sniper' | (string & {});

/** Armour tier worn by a human NPC. Built-in values have IDE autocomplete; any string is also valid. */
export type ArmorType = 'light' | 'medium' | 'heavy' | (string & {});

/**
 * Abstract loadout and tactical disposition of a human NPC.
 *
 * These values are NOT simulated inventory -- they are preference descriptors
 * used to bias terrain selection and offline combat rolls. Actual item tracking
 * lives in the game layer.
 */
export interface IEquipmentPreference {
  /** Weapon class carried -- determines optimal engagement range. */
  readonly preferredWeaponType: WeaponType;
  /** Armour tier worn -- tracked for future protection calculations. */
  readonly preferredArmor: ArmorType;
  /** Willingness to close distance and engage [0-1]. */
  readonly aggressiveness: number;
  /** Likelihood of seeking cover and avoiding direct engagements [0-1]. */
  readonly cautiousness: number;
}

// ---------------------------------------------------------------------------
// Human brain config
// ---------------------------------------------------------------------------

/**
 * Tunable scoring weights for HumanBrain equipment-based terrain bonuses.
 *
 * All values are injectable -- zero hardcoded constants in the brain itself.
 */
export interface IHumanBrainConfig {
  /** Additive bonus for terrains tagged 'guard' when NPC carries sniper weapon. */
  readonly guardTerrainBonus: number;
  /** Additive bonus for terrains tagged 'patrol' when NPC is aggressive. */
  readonly patrolTerrainBonus: number;
  /** Additive bonus for terrains tagged 'camp' when NPC is cautious. */
  readonly campTerrainBonus: number;
  /** Additive bonus for shotgun NPCs on terrains with danger below threshold. */
  readonly shotgunLowDangerBonus: number;
  /** Aggressiveness value above which NPC is considered "aggressive". */
  readonly aggressivenessThreshold: number;
  /** Cautiousness value above which NPC is considered "cautious". */
  readonly cautiousnessThreshold: number;
  /** Maximum terrain danger level for shotgun low-danger bonus. */
  readonly shotgunDangerThreshold: number;
  /** Terrain tag that triggers the guard bonus. @default 'guard' */
  readonly guardTerrainTag?: string;
  /** Terrain tag that triggers the patrol bonus. @default 'patrol' */
  readonly patrolTerrainTag?: string;
  /** Terrain tag that triggers the camp bonus. @default 'camp' */
  readonly campTerrainTag?: string;
  /** Weapon type that triggers the guard terrain bonus. @default 'sniper' */
  readonly guardWeaponType?: string;
  /** Weapon type that triggers the low-danger terrain bonus. @default 'shotgun' */
  readonly lowDangerWeaponType?: string;
}

/** Create a default human brain config with production-tuned values. */
export function createDefaultHumanBrainConfig(
  overrides?: Partial<IHumanBrainConfig>,
): IHumanBrainConfig {
  return {
    guardTerrainBonus: 15,
    patrolTerrainBonus: 10,
    campTerrainBonus: 10,
    shotgunLowDangerBonus: 10,
    aggressivenessThreshold: 0.6,
    cautiousnessThreshold: 0.6,
    shotgunDangerThreshold: 3,
    ...overrides,
  };
}

/** Params-object for HumanBrain construction. */
export interface IHumanBrainParams extends INPCBrainParams {
  readonly humanConfig: IHumanBrainConfig;
  readonly equipment: IEquipmentPreference;
  readonly initialMoney?: number;
}

// ---------------------------------------------------------------------------
// HumanBrain
// ---------------------------------------------------------------------------

/**
 * Equipment-aware offline decision-maker for human NPCs.
 *
 * Extends NPCBrain by overriding selectBestTerrain() to add weapon-class and
 * personality bonuses on top of the standard fitness scoring:
 *
 *   Snipers      -- bonus on 'guard'-tagged terrains (stationary, long sight lines)
 *   Aggressive   -- bonus on 'patrol'-tagged terrains (active, offensive posture)
 *   Cautious     -- bonus on 'camp'-tagged terrains (defensive, sheltered)
 *   Shotgun      -- bonus on low-danger terrains (close-range disadvantage in open)
 *
 * All other NPCBrain behaviour (movement, schedule, surge-flee, squad, scheme resolution)
 * is inherited unchanged.
 */
export class HumanBrain extends NPCBrain {
  private readonly _equipment: IEquipmentPreference;
  private readonly _humanConfig: IHumanBrainConfig;
  private _money: number;

  constructor(params: IHumanBrainParams) {
    super(params);
    this._humanConfig = params.humanConfig;
    this._equipment = params.equipment;
    this._money = Math.max(0, params.initialMoney ?? 0);
  }

  // -----------------------------------------------------------------------
  // Equipment queries
  // -----------------------------------------------------------------------

  /** Read-only view of the resolved equipment profile. */
  getEquipment(): Readonly<IEquipmentPreference> {
    return this._equipment;
  }

  /** Convenience accessor -- returns the weapon type string directly. */
  getPreferredWeapon(): WeaponType {
    return this._equipment.preferredWeaponType;
  }

  /** True when aggressiveness exceeds the configured threshold. */
  isAggressive(): boolean {
    return this._equipment.aggressiveness > this._humanConfig.aggressivenessThreshold;
  }

  /** True when cautiousness exceeds the configured threshold. */
  isCautious(): boolean {
    return this._equipment.cautiousness > this._humanConfig.cautiousnessThreshold;
  }

  // -----------------------------------------------------------------------
  // Money management
  // -----------------------------------------------------------------------

  /** Returns the current currency balance. */
  getMoney(): number {
    return this._money;
  }

  /**
   * Set the currency balance to an exact value.
   * Clamped to [0, +Infinity] -- balance can never go negative.
   */
  setMoney(amount: number): void {
    this._money = Math.max(0, amount);
  }

  /**
   * Add or subtract from the current balance.
   * Passing a negative delta deducts money; clamped to 0 (no debt).
   * Non-finite values (NaN, Infinity) are silently ignored.
   */
  addMoney(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this._money = Math.max(0, this._money + delta);
  }

  // -----------------------------------------------------------------------
  // Protected overrides
  // -----------------------------------------------------------------------

  /**
   * Override base buildJobContext() to inject the NPC's actual preferred weapon
   * type and equipment personality traits, instead of the default undefined.
   *
   * This ensures JobSlotSystem suitability scoring accounts for the NPC's
   * loadout when matching jobs.
   */
  protected override buildJobContext(): INPCJobContext {
    const base = super.buildJobContext();
    return {
      ...base,
      weaponType: this._equipment.preferredWeaponType,
      equipmentPrefs: {
        aggressiveness: this._equipment.aggressiveness,
        cautiousness: this._equipment.cautiousness,
      },
    };
  }

  /**
   * Select the best SmartTerrain by delegating to TerrainSelector.selectBest()
   * with a scoreModifier callback that layers equipment bonuses on top of the
   * standard fitness scores.
   *
   * Time complexity: O(n) where n = number of terrains.
   */
  protected override selectBestTerrain(
    terrains: readonly SmartTerrain[],
    _terrainStates?: Map<string, TerrainState>,
  ): SmartTerrain | null {
    return TerrainSelector.selectBest({
      ...this.buildTerrainQuery(terrains),
      scoreModifier: (terrain, score) => score + this.equipmentTerrainBonus(terrain),
    });
  }

  // -----------------------------------------------------------------------
  // Equipment bonus scoring (private)
  // -----------------------------------------------------------------------

  /**
   * Compute an additive score bonus for a terrain based on this NPC's
   * equipment profile.
   *
   * Uses terrain tags ('guard', 'patrol', 'camp') to identify terrain roles.
   * Bonuses can stack if multiple conditions match.
   *
   * @param terrain - The terrain being evaluated.
   * @returns Non-negative bonus score (0 if no preference applies).
   */
  private equipmentTerrainBonus(terrain: SmartTerrain): number {
    let bonus = 0;

    const guardWeapon = this._humanConfig.guardWeaponType ?? 'sniper';
    const guardTag = this._humanConfig.guardTerrainTag ?? 'guard';
    const patrolTag = this._humanConfig.patrolTerrainTag ?? 'patrol';
    const campTag = this._humanConfig.campTerrainTag ?? 'camp';
    const lowDangerWeapon = this._humanConfig.lowDangerWeaponType ?? 'shotgun';

    // Snipers (or configured guard weapon) prefer guard-tagged terrains -- stationary, long sight lines.
    if (this._equipment.preferredWeaponType === guardWeapon && terrain.tags.has(guardTag)) {
      bonus += this._humanConfig.guardTerrainBonus;
    }

    // Aggressive NPCs prefer patrol-tagged terrains -- active, offensive posture.
    if (this.isAggressive() && terrain.tags.has(patrolTag)) {
      bonus += this._humanConfig.patrolTerrainBonus;
    }

    // Cautious NPCs prefer camp-tagged terrains -- defensive, sheltered.
    if (this.isCautious() && terrain.tags.has(campTag)) {
      bonus += this._humanConfig.campTerrainBonus;
    }

    // Shotgun (or configured low-danger weapon) users prefer low-danger terrains -- close range is risky in open areas.
    if (
      this._equipment.preferredWeaponType === lowDangerWeapon &&
      terrain.dangerLevel <= this._humanConfig.shotgunDangerThreshold
    ) {
      bonus += this._humanConfig.shotgunLowDangerBonus;
    }

    return bonus;
  }
}
