import { Registry } from './Registry';

/** Definition of an NPC behavior scheme used by the terrain behavior engine. */
export interface IBehaviorSchemeDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** True if the NPC stays at a fixed position (e.g. camp, sleep). */
  readonly isStationary: boolean;
  /** True if the scheme needs a patrol route to operate. */
  readonly requiresRoute: boolean;
  /** Restrict to nighttime hours only. Cannot combine with dayOnly. */
  readonly nightOnly: boolean;
  /** Restrict to daytime hours only. Cannot combine with nightOnly. */
  readonly dayOnly: boolean;
}

function validate(c: IBehaviorSchemeDefinition): string[] {
  const errors: string[] = [];
  if (c.nightOnly && c.dayOnly) errors.push('cannot be both nightOnly and dayOnly');
  return errors;
}

/** Registry of behavior schemes. Validates mutual exclusion of nightOnly/dayOnly. Call registerDefaults() for the 6 built-in schemes. */
export class BehaviorSchemeRegistry extends Registry<string, IBehaviorSchemeDefinition> {
  constructor() {
    super({ name: 'BehaviorSchemeRegistry', validate });
  }

  /** Register the 6 built-in behavior schemes (guard, patrol, camp, sleep, camper, wander). Returns `this` for chaining. */
  registerDefaults(): this {
    return this
      .register('guard', { name: 'Guard', isStationary: false, requiresRoute: false, nightOnly: false, dayOnly: false })
      .register('patrol', { name: 'Patrol', isStationary: false, requiresRoute: true, nightOnly: false, dayOnly: false })
      .register('camp', { name: 'Camp', isStationary: true, requiresRoute: false, nightOnly: false, dayOnly: false })
      .register('sleep', { name: 'Sleep', isStationary: true, requiresRoute: false, nightOnly: true, dayOnly: false })
      .register('camper', { name: 'Camper', isStationary: true, requiresRoute: false, nightOnly: false, dayOnly: false })
      .register('wander', { name: 'Wander', isStationary: false, requiresRoute: false, nightOnly: false, dayOnly: false });
  }
}
