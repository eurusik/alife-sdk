/**
 * Fluent builder for SmartTerrain configurations.
 *
 * Usage:
 *   const config = new TerrainBuilder('bar_rostok')
 *     .name('Bar "Rostok"')
 *     .bounds({ x: 100, y: 200, width: 300, height: 300 })
 *     .capacity(8)
 *     .allowFactions(['stalkers', 'duty'])
 *     .shelter(true)
 *     .tags(['indoor', 'settlement'])
 *     .addJob({ type: 'guard', slots: 2, position: { x: 120, y: 210 } })
 *     .build();
 */

import type { IZoneBounds } from './Zone';
import type {
  ISmartTerrainConfig,
  IJobSlot,
  ISpawnPoint,
  IPatrolRouteConfig,
} from './SmartTerrain';

export class TerrainBuilder {
  private readonly id: string;
  private terrainName = '';
  private terrainBounds: IZoneBounds | undefined;
  private terrainDangerLevel = 0;
  private terrainCapacity = 0;
  private terrainFactions: string[] = [];
  private terrainShelter = false;
  private terrainTags: string[] = [];
  private terrainJobs: IJobSlot[] = [];
  private terrainSpawnPoints: ISpawnPoint[] = [];
  private terrainPatrolRoutes: IPatrolRouteConfig[] = [];

  constructor(id: string) {
    if (!id) {
      throw new Error('[TerrainBuilder] id must not be empty');
    }
    this.id = id;
  }

  name(name: string): this {
    this.terrainName = name;
    return this;
  }

  bounds(b: IZoneBounds): this {
    this.terrainBounds = b;
    return this;
  }

  dangerLevel(level: number): this {
    this.terrainDangerLevel = level;
    return this;
  }

  capacity(n: number): this {
    if (n < 0) {
      throw new Error(
        `[TerrainBuilder] capacity must be non-negative, got ${n}`,
      );
    }
    this.terrainCapacity = n;
    return this;
  }

  allowFactions(factions: string[]): this {
    this.terrainFactions = [...factions];
    return this;
  }

  shelter(isShelter: boolean): this {
    this.terrainShelter = isShelter;
    return this;
  }

  tags(tags: string[]): this {
    this.terrainTags = [...tags];
    return this;
  }

  addJob(job: IJobSlot): this {
    this.terrainJobs.push(job);
    return this;
  }

  addSpawnPoint(sp: ISpawnPoint): this {
    this.terrainSpawnPoints.push(sp);
    return this;
  }

  addPatrolRoute(route: IPatrolRouteConfig): this {
    this.terrainPatrolRoutes.push(route);
    return this;
  }

  /** Validate required fields and return the SmartTerrain configuration. */
  build(): ISmartTerrainConfig {
    const errors = this.validate();

    if (errors.length > 0) {
      throw new Error(
        `[TerrainBuilder] Invalid terrain "${this.id}": ${errors.join('; ')}`,
      );
    }

    return {
      id: this.id,
      name: this.terrainName,
      bounds: this.terrainBounds!,
      dangerLevel: this.terrainDangerLevel,
      capacity: this.terrainCapacity,
      allowedFactions:
        this.terrainFactions.length > 0 ? [...this.terrainFactions] : undefined,
      isShelter: this.terrainShelter || undefined,
      tags: this.terrainTags.length > 0 ? [...this.terrainTags] : undefined,
      jobs: this.terrainJobs.length > 0 ? [...this.terrainJobs] : undefined,
      spawnPoints:
        this.terrainSpawnPoints.length > 0
          ? [...this.terrainSpawnPoints]
          : undefined,
      patrolRoutes:
        this.terrainPatrolRoutes.length > 0
          ? [...this.terrainPatrolRoutes]
          : undefined,
    };
  }

  private validate(): string[] {
    const errors: string[] = [];

    if (!this.terrainName) {
      errors.push('name is required');
    }
    if (!this.terrainBounds) {
      errors.push('bounds is required');
    }
    if (this.terrainCapacity <= 0) {
      errors.push('capacity must be a positive number');
    }

    return errors;
  }
}
