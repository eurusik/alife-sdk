import { Registry } from './Registry';
import type { IEquipmentPreference } from './FactionRegistry';

/** Blueprint for a humanoid NPC archetype (e.g. 'stalker_rookie', 'monolith_sniper'). */
export interface INPCTypeDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** Default faction ID. Must be registered in FactionRegistry. */
  readonly faction: string;
  /** Base hit points (> 0). */
  readonly hp: number;
  /** Movement speed (px/s, > 0). */
  readonly speed: number;
  /** Base damage per hit. */
  readonly damage: number;
  /** Maximum engagement distance (px). */
  readonly attackRange: number;
  /** Visual detection radius (px). */
  readonly detectionRange: number;
  /** Field of view (degrees, (0, 360]). */
  readonly fov: number;
  /** Power tier (1–5). Affects equipment, GOAP eligibility (≥ 5), and terrain job suitability. */
  readonly rank: number;
  /** Hit probability factor [0, 1]. */
  readonly accuracy: number;
  /** HP fraction [0, 1] at which the NPC prefers retreat behavior. */
  readonly retreatThreshold: number;
  /** Per-type loadout overrides (merged with faction defaults). */
  readonly equipmentPreference?: Partial<IEquipmentPreference>;
}

function validate(c: INPCTypeDefinition): string[] {
  const errors: string[] = [];
  if (c.hp <= 0) errors.push('hp must be > 0');
  if (c.speed <= 0) errors.push('speed must be > 0');
  if (c.rank < 1 || c.rank > 5) errors.push('rank must be 1-5');
  if (c.accuracy < 0 || c.accuracy > 1) errors.push('accuracy must be in [0, 1]');
  return errors;
}

/** Type-safe registry of NPC type definitions. Validates hp > 0, rank 1–5, accuracy [0, 1]. */
export class NPCTypeRegistry extends Registry<string, INPCTypeDefinition> {
  constructor() {
    super({ name: 'NPCTypeRegistry', validate });
  }
}
