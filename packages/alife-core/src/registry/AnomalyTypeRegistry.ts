import { Registry } from './Registry';

/** Definition of an anomaly zone type (e.g. 'fire_anomaly', 'psi_field'). */
export interface IAnomalyTypeDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** ID of the damage type inflicted. Must be registered in DamageTypeRegistry. */
  readonly damageTypeId: string;
  /** Damage dealt per second to entities inside the zone (> 0). */
  readonly damagePerSecond: number;
  /** Anomaly zone radius (px, > 0). */
  readonly radius: number;
  /** Probability of spawning an artefact per cycle [0, 1]. */
  readonly artefactChance: number;
  /** Maximum artefacts the zone can hold simultaneously (≥ 0). */
  readonly maxArtefacts: number;
}

function validate(c: IAnomalyTypeDefinition): string[] {
  const errors: string[] = [];
  if (c.damagePerSecond <= 0) errors.push('damagePerSecond must be > 0');
  if (c.radius <= 0) errors.push('radius must be > 0');
  if (c.artefactChance < 0 || c.artefactChance > 1) errors.push('artefactChance must be in [0, 1]');
  if (c.maxArtefacts < 0) errors.push('maxArtefacts must be >= 0');
  return errors;
}

/** Registry of anomaly zone types. Validates damagePerSecond > 0, radius > 0, artefactChance [0, 1]. */
export class AnomalyTypeRegistry extends Registry<string, IAnomalyTypeDefinition> {
  constructor() {
    super({ name: 'AnomalyTypeRegistry', validate });
  }
}
