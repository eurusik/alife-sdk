// types/IWeaponTypes.ts
// Weapon system value objects and type definitions.

/**
 * Weapon category identifiers.
 * Numeric values enable fast switch-case dispatch in scoring logic.
 */
export const WeaponCategory = {
  PISTOL: 0,
  SHOTGUN: 1,
  RIFLE: 2,
  SNIPER: 3,
  GRENADE: 4,
  MEDKIT: 5,
} as const;

export type WeaponCategory = (typeof WeaponCategory)[keyof typeof WeaponCategory] | (string & {});

/**
 * Effective engagement range for a weapon type.
 * Used by weapon selection scoring to evaluate distance suitability.
 */
export interface IWeaponRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Static configuration for a weapon type.
 * Defines baseline stats used for loadout creation and scoring.
 */
export interface IWeaponConfig {
  readonly category: WeaponCategory;
  readonly range: IWeaponRange;
  readonly damage: number;
  /** Shots per second. */
  readonly fireRate: number;
  readonly defaultAmmo: number;
}

/**
 * Runtime state for a single weapon carried by an NPC.
 * Ammo is mutable — decremented as shots are fired.
 */
export interface IWeaponSlot {
  readonly category: WeaponCategory;
  ammo: number;
  readonly maxAmmo: number;
  readonly range: IWeaponRange;
  readonly damage: number;
  readonly fireRate: number;
}

/**
 * Full inventory snapshot for one NPC.
 * Primary and secondary slots may be null if the NPC carries no such weapon.
 */
export interface INPCLoadout {
  primary: IWeaponSlot | null;
  secondary: IWeaponSlot | null;
  grenades: number;
  medkits: number;
}
