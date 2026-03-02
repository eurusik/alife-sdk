/**
 * Lifecycle phase of the surge event.
 *
 * Value-object enum (string union) -- no framework dependency.
 */
export const SurgePhase = {
  /** Normal gameplay -- no surge imminent. */
  INACTIVE: 'inactive',
  /** Warning window -- NPCs flee to shelter; impact imminent. */
  WARNING: 'warning',
  /** Surge wave active -- outdoor NPCs take PSI damage every tick. */
  ACTIVE: 'active',
  /** Post-surge cooldown -- mass respawn, morale recovery. */
  AFTERMATH: 'aftermath',
} as const;

export type SurgePhase = (typeof SurgePhase)[keyof typeof SurgePhase];
