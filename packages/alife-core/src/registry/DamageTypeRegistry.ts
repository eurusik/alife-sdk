import { Registry } from './Registry';

/** Definition of a damage type (e.g. 'physical', 'fire', 'psi'). */
export interface IDamageTypeDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** Base resistance applied when a faction has no explicit override [0, 1]. */
  readonly defaultImmunity: number;
  /** Morale delta applied when an NPC takes damage of this type. Negative = demoralising. */
  readonly moraleImpact: number;
}

function validate(c: IDamageTypeDefinition): string[] {
  const errors: string[] = [];
  if (c.defaultImmunity < 0 || c.defaultImmunity > 1) {
    errors.push('defaultImmunity must be in [0, 1]');
  }
  return errors;
}

/** Registry of damage types. Validates defaultImmunity [0, 1]. Call registerDefaults() for the standard 5 types. */
export class DamageTypeRegistry extends Registry<string, IDamageTypeDefinition> {
  constructor() {
    super({ name: 'DamageTypeRegistry', validate });
  }

  /** Register the 5 built-in damage types (physical, fire, radiation, chemical, psi). Returns `this` for chaining. */
  registerDefaults(): this {
    return this
      .register('physical', { name: 'Physical', defaultImmunity: 0, moraleImpact: -0.15 })
      .register('fire', { name: 'Fire', defaultImmunity: 0, moraleImpact: -0.2 })
      .register('radiation', { name: 'Radiation', defaultImmunity: 0, moraleImpact: -0.1 })
      .register('chemical', { name: 'Chemical', defaultImmunity: 0, moraleImpact: -0.1 })
      .register('psi', { name: 'PSI', defaultImmunity: 0, moraleImpact: -0.25 });
  }
}
