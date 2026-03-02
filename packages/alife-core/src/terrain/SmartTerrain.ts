/**
 * SmartTerrain -- a Zone with job slots, capacity, and NPC fitness scoring.
 *
 * NPCs evaluate available terrains and select the one with the highest
 * fitness score. The terrain tracks its occupants and enforces capacity.
 */

import type { Vec2 } from '../core/Vec2';
import { distance, distanceSq } from '../core/Vec2';
import type { IRandom } from '../ports/IRandom';
import { DefaultRandom } from '../ports/IRandom';
import { Zone, type IZoneBounds } from './Zone';

// ---------------------------------------------------------------------------
// Job & Patrol interfaces
// ---------------------------------------------------------------------------

export interface IJobPreconditions {
  readonly minRank?: number;
  readonly dayOnly?: boolean;
  readonly nightOnly?: boolean;
  readonly factions?: readonly string[];
}

export interface IJobSlot {
  readonly type: string;
  readonly slots: number;
  readonly position?: Vec2;
  readonly routeId?: string;
  readonly preconditions?: IJobPreconditions;
}

export interface ISpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly factionId: string;
}

export interface IPatrolRouteConfig {
  readonly id: string;
  readonly routeType: 'loop' | 'ping_pong' | 'one_way';
  readonly waypoints: readonly Vec2[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Tunable scoring weights for SmartTerrain fitness evaluation. */
export interface IScoringConfig {
  /** Distance penalty = dist / divisor. Default: 100. */
  readonly distancePenaltyDivisor?: number;
  /** Bonus applied when terrain is a shelter. Default: 50. */
  readonly shelterBonus?: number;
  /** Bonus when NPC rank >= terrain danger level. Default: 10. */
  readonly rankMatchBonus?: number;
  /** Random ± noise applied to fitness score. Default: 0 (deterministic). */
  readonly scoringJitter?: number;
  /**
   * Use squared distance instead of sqrt for the distance penalty.
   * Eliminates Math.sqrt per terrain per NPC but changes the penalty curve
   * from linear to quadratic (nearby terrains are even more preferred).
   * When true, uses distancePenaltySqDivisor (default: distancePenaltyDivisor²).
   */
  readonly useSquaredDistance?: boolean;
  /** Squared-distance penalty divisor. Default: distancePenaltyDivisor². */
  readonly distancePenaltySqDivisor?: number;
}

export interface ISmartTerrainConfig {
  readonly id: string;
  readonly name: string;
  readonly bounds: IZoneBounds;
  readonly dangerLevel?: number;
  readonly capacity: number;
  readonly allowedFactions?: readonly string[];
  readonly isShelter?: boolean;
  readonly tags?: readonly string[];
  readonly jobs?: readonly IJobSlot[];
  readonly spawnPoints?: readonly ISpawnPoint[];
  readonly patrolRoutes?: readonly IPatrolRouteConfig[];
  readonly scoring?: IScoringConfig;
  /** Injectable RNG for deterministic scoring jitter. Falls back to Math.random(). */
  readonly random?: IRandom;
}

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const DEFAULT_DISTANCE_PENALTY_DIVISOR = 100;
const DEFAULT_SHELTER_BONUS = 50;
const DEFAULT_RANK_MATCH_BONUS = 10;
const DEFAULT_SCORING_JITTER = 0;

// ---------------------------------------------------------------------------
// SmartTerrain
// ---------------------------------------------------------------------------

export class SmartTerrain extends Zone {
  readonly capacity: number;
  readonly allowedFactions: ReadonlySet<string>;
  readonly isShelter: boolean;
  readonly tags: ReadonlySet<string>;
  readonly jobs: readonly IJobSlot[];
  readonly spawnPoints: readonly ISpawnPoint[];
  readonly patrolRoutes: ReadonlyMap<string, IPatrolRouteConfig>;

  private readonly distancePenaltyDivisor: number;
  private readonly useSquaredDistance: boolean;
  private readonly distancePenaltySqDivisor: number;
  private readonly shelterBonus: number;
  private readonly rankMatchBonus: number;
  private readonly scoringJitter: number;
  private readonly random: IRandom;
  private readonly occupants = new Set<string>();

  constructor(config: ISmartTerrainConfig) {
    super(config.id, config.bounds, config.dangerLevel);

    this.capacity = config.capacity;
    this.allowedFactions = new Set(config.allowedFactions ?? []);
    this.isShelter = config.isShelter ?? false;
    this.tags = new Set(config.tags ?? []);
    this.jobs = config.jobs ?? [];
    this.spawnPoints = config.spawnPoints ?? [];
    this.patrolRoutes = buildRouteMap(config.patrolRoutes);
    this.distancePenaltyDivisor = config.scoring?.distancePenaltyDivisor ?? DEFAULT_DISTANCE_PENALTY_DIVISOR;
    this.useSquaredDistance = config.scoring?.useSquaredDistance ?? false;
    this.distancePenaltySqDivisor = config.scoring?.distancePenaltySqDivisor
      ?? (this.distancePenaltyDivisor * this.distancePenaltyDivisor);
    this.shelterBonus = config.scoring?.shelterBonus ?? DEFAULT_SHELTER_BONUS;
    this.rankMatchBonus = config.scoring?.rankMatchBonus ?? DEFAULT_RANK_MATCH_BONUS;
    this.scoringJitter = config.scoring?.scoringJitter ?? DEFAULT_SCORING_JITTER;
    this.random = config.random ?? new DefaultRandom();
  }

  /** Number of NPCs currently assigned to this terrain. */
  get occupantCount(): number {
    return this.occupants.size;
  }

  /** Whether the terrain can accept another NPC. */
  get hasCapacity(): boolean {
    return this.occupants.size < this.capacity;
  }

  /**
   * Register an NPC as an occupant.
   * Returns false if the terrain is already at capacity.
   */
  addOccupant(npcId: string): boolean {
    if (this.occupants.size >= this.capacity) return false;
    this.occupants.add(npcId);
    return true;
  }

  /** Remove an NPC from the occupant set. */
  removeOccupant(npcId: string): void {
    this.occupants.delete(npcId);
  }

  /** Check whether a given NPC is an occupant. */
  hasOccupant(npcId: string): boolean {
    return this.occupants.has(npcId);
  }

  /** Read-only view of the current occupant set. */
  getOccupants(): ReadonlySet<string> {
    return this.occupants;
  }

  /**
   * Compute a fitness score for an NPC considering faction, distance,
   * capacity, shelter status, and danger-to-rank matching.
   *
   * Scoring breakdown:
   *   - Base = remaining capacity (capacity - occupantCount)
   *   - Faction not allowed: -Infinity
   *   - Distance penalty: -distance / 100
   *   - Shelter bonus: +50 if isShelter
   *   - Rank >= dangerLevel: +10
   */
  scoreFitness(
    npcFaction: string,
    npcPosition: Vec2,
    npcRank: number,
  ): number {
    if (!this.acceptsFaction(npcFaction)) return -Infinity;

    let score = this.capacity - this.occupants.size;

    if (this.useSquaredDistance) {
      score -= distanceSq(npcPosition, this.center) / this.distancePenaltySqDivisor;
    } else {
      score -= distance(npcPosition, this.center) / this.distancePenaltyDivisor;
    }

    if (this.isShelter) {
      score += this.shelterBonus;
    }

    if (npcRank >= this.dangerLevel) {
      score += this.rankMatchBonus;
    }

    if (this.scoringJitter > 0) {
      score += (this.random.next() - 0.5) * 2 * this.scoringJitter;
    }

    return score;
  }

  /**
   * Check whether a faction is allowed in this terrain.
   * An empty allowedFactions set means all factions are accepted.
   */
  acceptsFaction(factionId: string): boolean {
    if (this.allowedFactions.size === 0) return true;
    return this.allowedFactions.has(factionId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRouteMap(
  routes?: readonly IPatrolRouteConfig[],
): ReadonlyMap<string, IPatrolRouteConfig> {
  const map = new Map<string, IPatrolRouteConfig>();

  if (routes) {
    for (const route of routes) {
      map.set(route.id, route);
    }
  }

  return map;
}
