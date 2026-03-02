/**
 * Fluent builder for creating IFactionDefinition objects.
 *
 * Usage:
 *   const def = new FactionBuilder('stalkers')
 *     .displayName('Stalkers')
 *     .relation('bandits', -60)
 *     .immunity('radiation', 0.2)
 *     .equipmentPreference({ aggressiveness: 0.5 })
 *     .spawn({ targetRatio: 0.25, balanceTolerance: 0.1 })
 *     .build();
 */

import type {
  IFactionDefinition,
  IEquipmentPreference,
  IFactionSpawnRules,
} from '../registry/FactionRegistry';

const DEFAULT_SPAWN_RULES: IFactionSpawnRules = {
  targetRatio: 0,
  balanceTolerance: 0,
};

export class FactionBuilder {
  private readonly id: string;
  private name = '';
  private readonly relations: Record<string, number> = {};
  private readonly immunities: Record<string, number> = {};
  private equipment: Partial<IEquipmentPreference> = {};
  private spawnRules: IFactionSpawnRules = DEFAULT_SPAWN_RULES;
  private metadataEntries: Record<string, unknown> = {};

  constructor(id: string) {
    if (!id) {
      throw new Error('[FactionBuilder] id must not be empty');
    }
    this.id = id;
  }

  displayName(name: string): this {
    this.name = name;
    return this;
  }

  relation(factionId: string, score: number): this {
    if (factionId === this.id) {
      throw new Error(
        `[FactionBuilder] Faction "${this.id}" cannot define a relation to itself`,
      );
    }
    if (score < -100 || score > 100) {
      throw new Error(
        `[FactionBuilder] Relation score for "${factionId}" must be in [-100, 100], got ${score}`,
      );
    }
    this.relations[factionId] = score;
    return this;
  }

  immunity(damageTypeId: string, factor: number): this {
    if (factor < 0 || factor > 1) {
      throw new Error(
        `[FactionBuilder] Immunity factor for "${damageTypeId}" must be in [0, 1], got ${factor}`,
      );
    }
    this.immunities[damageTypeId] = factor;
    return this;
  }

  equipmentPreference(prefs: Partial<IEquipmentPreference>): this {
    this.equipment = { ...this.equipment, ...prefs };
    return this;
  }

  spawn(rules: Partial<IFactionSpawnRules>): this {
    this.spawnRules = { ...this.spawnRules, ...rules };
    return this;
  }

  withMetadata(key: string, value: unknown): this {
    this.metadataEntries[key] = value;
    return this;
  }

  /** Validate required fields and return a frozen IFactionDefinition. */
  build(): IFactionDefinition {
    if (!this.name) {
      throw new Error(
        `[FactionBuilder] Faction "${this.id}" requires a display name`,
      );
    }

    return {
      name: this.name,
      baseRelations: { ...this.relations },
      immunities: { ...this.immunities },
      defaultEquipment: { ...this.equipment },
      spawnRules: { ...this.spawnRules },
      metadata: Object.keys(this.metadataEntries).length > 0
        ? { ...this.metadataEntries }
        : undefined,
    };
  }
}
