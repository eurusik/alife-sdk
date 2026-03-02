import { Registry } from './Registry';

/** Blueprint for a monster archetype (e.g. 'dog', 'bloodsucker', 'controller'). */
export interface IMonsterDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** Base hit points (> 0). */
  readonly hp: number;
  /** Movement speed (px/s, > 0). */
  readonly speed: number;
  /** Melee damage per hit (> 0). */
  readonly damage: number;
  /** Melee attack range (px, > 0). */
  readonly attackRange: number;
  /** Sensory detection radius (px, > 0). */
  readonly detectionRange: number;
  /** Field of view (degrees, (0, 360]). */
  readonly fov: number;
  /** Pack spawn size as [min, max] tuple. min ≥ 1, min ≤ max. */
  readonly packSize: readonly [number, number];
  /** Ability IDs this monster can use (e.g. 'charge', 'stalk', 'leap', 'psi_attack'). */
  readonly abilities: readonly string[];
  /** Three-radius lair system (px). Must satisfy: inner < patrol < outer. */
  readonly lair: { readonly inner: number; readonly patrol: number; readonly outer: number };
  /** Threat tier (1–5). Affects brain decisions and terrain scoring. */
  readonly rank: number;
  /** Optional faction override. Defaults to 'monster' if omitted. */
  readonly faction?: string;
}

/** Configuration for MonsterRegistry rank validation bounds. */
export interface IMonsterRegistryConfig {
  /** Minimum allowed rank value. Default: 1. */
  readonly rankMin?: number;
  /** Maximum allowed rank value. Default: 5. */
  readonly rankMax?: number;
}

const DEFAULT_RANK_MIN = 1;
const DEFAULT_RANK_MAX = 5;

function createValidator(rankMin: number, rankMax: number): (c: IMonsterDefinition) => string[] {
  return (c: IMonsterDefinition): string[] => {
    const errors: string[] = [];
    if (c.hp <= 0) errors.push('hp must be > 0');
    if (c.speed <= 0) errors.push('speed must be > 0');
    if (c.damage <= 0) errors.push('damage must be > 0');
    if (c.attackRange <= 0) errors.push('attackRange must be > 0');
    if (c.detectionRange <= 0) errors.push('detectionRange must be > 0');
    if (c.fov <= 0 || c.fov > 360) errors.push('fov must be in (0, 360]');
    if (c.packSize[0] < 1) errors.push('packSize min must be >= 1');
    if (c.packSize[0] > c.packSize[1]) errors.push('packSize min must be <= max');
    if (c.lair.inner >= c.lair.patrol) errors.push('lair.inner must be < lair.patrol');
    if (c.lair.patrol >= c.lair.outer) errors.push('lair.patrol must be < lair.outer');
    if (c.rank < rankMin || c.rank > rankMax) errors.push(`rank must be ${rankMin}-${rankMax}`);
    return errors;
  };
}

/** Type-safe registry of monster definitions. Validates lair radius ordering, pack size, and rank bounds. */
export class MonsterRegistry extends Registry<string, IMonsterDefinition> {
  constructor(config?: IMonsterRegistryConfig) {
    const rankMin = config?.rankMin ?? DEFAULT_RANK_MIN;
    const rankMax = config?.rankMax ?? DEFAULT_RANK_MAX;
    if (rankMin > rankMax) {
      throw new Error(`[MonsterRegistry] rankMin (${rankMin}) must be <= rankMax (${rankMax})`);
    }
    super({ name: 'MonsterRegistry', validate: createValidator(rankMin, rankMax) });
  }
}
