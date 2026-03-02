/**
 * Extensible immunity profile based on Map<string, number>.
 *
 * Each entry maps a damage type ID to a resistance factor in [0, 1],
 * where 0 = no resistance and 1 = full immunity.
 * Missing entries default to 0 (no resistance).
 */

export type ImmunityProfile = ReadonlyMap<string, number>;

/**
 * Create an ImmunityProfile from an optional record of damage-type-to-resistance pairs.
 * Values are clamped to [0, 1].
 */
export function createImmunityProfile(
  entries?: Record<string, number>,
): ImmunityProfile {
  const map = new Map<string, number>();

  if (entries) {
    for (const [damageTypeId, rawFactor] of Object.entries(entries)) {
      const factor = clampResistance(rawFactor);
      map.set(damageTypeId, factor);
    }
  }

  return map;
}

/**
 * Return the resistance factor for a given damage type.
 * Returns 0 when the profile has no entry for that type.
 */
export function getResistance(
  profile: ImmunityProfile,
  damageTypeId: string,
): number {
  return profile.get(damageTypeId) ?? 0;
}

/**
 * Reduce base damage by the profile's resistance to the given type.
 * Formula: baseDamage * (1 - resistance).
 */
export function applyDamageReduction(
  baseDamage: number,
  profile: ImmunityProfile,
  damageTypeId: string,
): number {
  const resistance = getResistance(profile, damageTypeId);
  return baseDamage * (1 - resistance);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampResistance(value: number): number {
  return Math.max(0, Math.min(1, value));
}
