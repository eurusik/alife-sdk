/**
 * Data-driven spawn management with cooldowns and faction balance.
 *
 * SpawnRegistry is a pure simulation object -- it never creates game objects.
 * It tracks per-point cooldowns, live-count caps, and faction filters.
 * External systems query eligible points and handle actual entity creation.
 *
 * Eligibility: cooldown expired AND activeCounts < maxNPCs.
 */

import type { Vec2 } from '../core/Vec2';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ISpawnPointConfig {
  readonly id: string;
  readonly terrainId: string;
  readonly position: Vec2;
  readonly factionId: string;
  readonly maxNPCs: number;
}

// ---------------------------------------------------------------------------
// Serialisation state
// ---------------------------------------------------------------------------

export interface ISpawnRegistryState {
  readonly cooldowns: Readonly<Record<string, number>>;
  readonly activeCounts: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// SpawnRegistry
// ---------------------------------------------------------------------------

export class SpawnRegistry {
  private readonly points = new Map<string, ISpawnPointConfig>();
  private readonly cooldowns = new Map<string, number>();
  private readonly activeCounts = new Map<string, number>();

  private readonly defaultCooldownMs: number;

  constructor(defaultCooldownMs: number = DEFAULT_COOLDOWN_MS) {
    this.defaultCooldownMs = defaultCooldownMs;
  }

  // -----------------------------------------------------------------------
  // Point management
  // -----------------------------------------------------------------------

  addPoint(config: ISpawnPointConfig): void {
    this.points.set(config.id, config);
    this.cooldowns.set(config.id, 0);
    this.activeCounts.set(config.id, 0);
  }

  removePoint(id: string): void {
    this.points.delete(id);
    this.cooldowns.delete(id);
    this.activeCounts.delete(id);
  }

  getPoint(id: string): ISpawnPointConfig | undefined {
    return this.points.get(id);
  }

  // -----------------------------------------------------------------------
  // Eligibility
  // -----------------------------------------------------------------------

  /** Get all spawn points eligible for spawning now. */
  getEligiblePoints(): ISpawnPointConfig[] {
    const eligible: ISpawnPointConfig[] = [];

    for (const [id, config] of this.points) {
      if (this.isEligible(id, config)) {
        eligible.push(config);
      }
    }

    return eligible;
  }

  // -----------------------------------------------------------------------
  // Spawn lifecycle
  // -----------------------------------------------------------------------

  /** Mark a spawn point as used (starts cooldown, increments active count). */
  markSpawned(spawnPointId: string): void {
    if (!this.points.has(spawnPointId)) return;

    this.cooldowns.set(spawnPointId, this.defaultCooldownMs);
    const current = this.activeCounts.get(spawnPointId) ?? 0;
    this.activeCounts.set(spawnPointId, current + 1);
  }

  /** Record NPC death -- decrement active count for the spawn point. */
  markDespawned(spawnPointId: string): void {
    const current = this.activeCounts.get(spawnPointId);
    if (current === undefined) return;

    this.activeCounts.set(spawnPointId, Math.max(0, current - 1));
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /** Tick cooldowns by the given delta. */
  update(deltaMs: number): void {
    for (const [id, remaining] of this.cooldowns) {
      if (remaining > 0) {
        this.cooldowns.set(id, Math.max(0, remaining - deltaMs));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Batch operations
  // -----------------------------------------------------------------------

  /** Reset all cooldowns to zero (e.g., after a surge for mass respawn). */
  resetAllCooldowns(): void {
    for (const id of this.cooldowns.keys()) {
      this.cooldowns.set(id, 0);
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Get all spawn points that belong to the given faction. */
  getPointsByFaction(factionId: string): ISpawnPointConfig[] {
    const result: ISpawnPointConfig[] = [];
    for (const config of this.points.values()) {
      if (config.factionId === factionId) {
        result.push(config);
      }
    }
    return result;
  }

  get totalPoints(): number {
    return this.points.size;
  }

  // -----------------------------------------------------------------------
  // Serialisation
  // -----------------------------------------------------------------------

  serialize(): ISpawnRegistryState {
    return {
      cooldowns: Object.fromEntries(this.cooldowns),
      activeCounts: Object.fromEntries(this.activeCounts),
    };
  }

  restore(state: ISpawnRegistryState): void {
    for (const [id, value] of Object.entries(state.cooldowns)) {
      if (this.cooldowns.has(id)) {
        this.cooldowns.set(id, value);
      }
    }
    for (const [id, value] of Object.entries(state.activeCounts)) {
      if (this.activeCounts.has(id)) {
        this.activeCounts.set(id, value);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private isEligible(id: string, config: ISpawnPointConfig): boolean {
    const cooldown = this.cooldowns.get(id) ?? 0;
    if (cooldown > 0) return false;

    const active = this.activeCounts.get(id) ?? 0;
    if (active >= config.maxNPCs) return false;

    return true;
  }
}
