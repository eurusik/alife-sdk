import { Registry } from './Registry';

/** Loadout preferences that influence offline weapon/armor selection for faction NPCs. */
export interface IEquipmentPreference {
  /** Preferred weapon type string (e.g. 'rifle', 'shotgun'). */
  readonly preferredWeapon: string;
  /** Preferred armor tier string. */
  readonly preferredArmor: string;
  /** Tendency toward offensive behavior [0, 1]. Higher = more likely to PATROL/ATTACK. */
  readonly aggressiveness: number;
  /** Tendency toward defensive behavior [0, 1]. Higher = more likely to CAMP/GUARD. */
  readonly cautiousness: number;
}

/** Controls how the spawn system maintains faction population balance. */
export interface IFactionSpawnRules {
  /** Target fraction of total NPC population for this faction [0, 1]. */
  readonly targetRatio: number;
  /** Allowed deviation from targetRatio before the balancer intervenes [0, 1]. */
  readonly balanceTolerance: number;
}

/** Complete definition of a faction for registration in FactionRegistry. */
export interface IFactionDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** Immutable starting relations to other factions. Key = factionId, value = [-100, 100]. */
  readonly baseRelations: Readonly<Record<string, number>>;
  /** Base resistance per damage type. Key = damageTypeId, value = [0, 1] (0 = none, 1 = immune). */
  readonly immunities: Readonly<Record<string, number>>;
  /** Default loadout preferences for NPCs of this faction. */
  readonly defaultEquipment: Partial<IEquipmentPreference>;
  /** Population balance parameters. */
  readonly spawnRules: IFactionSpawnRules;
  /** Arbitrary extension data (e.g. UI color, description). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function validate(c: IFactionDefinition): string[] {
  const errors: string[] = [];
  if (!c.name) errors.push('name must not be empty');
  for (const [id, v] of Object.entries(c.baseRelations)) {
    if (v < -100 || v > 100) errors.push(`relation "${id}" must be in [-100, 100]`);
  }
  for (const [id, v] of Object.entries(c.immunities)) {
    if (v < 0 || v > 1) errors.push(`immunity "${id}" must be in [0, 1]`);
  }
  return errors;
}

/** Type-safe registry of faction definitions. Validates relations [-100, 100] and immunities [0, 1] on register(). */
export class FactionRegistry extends Registry<string, IFactionDefinition> {
  constructor() {
    super({ name: 'FactionRegistry', validate });
  }

  /** @override Adds self-relation guard on top of base validation. */
  override register(id: string, config: IFactionDefinition): this {
    if (id in config.baseRelations) {
      throw new Error(`[FactionRegistry] Faction "${id}" cannot define a relation to itself`);
    }
    return super.register(id, config);
  }
}
