import { SpatialGrid } from '@alife-sdk/core';
import type { EventBus } from '@alife-sdk/core';
import { HazardZone } from '../zone/HazardZone';
import type { IHazardZoneConfig, IHazardZoneState } from '../zone/HazardZone';
import type { ArtefactRegistry } from '../artefact/ArtefactRegistry';
import type { IArtefactFactory } from '../ports/IArtefactFactory';
import type { IHazardEntity } from '../ports/IHazardEntity';
import { ArtefactSpawner } from '../artefact/ArtefactSpawner';
import { HazardEvents } from '../events/HazardEvents';
import type { HazardEventPayloads } from '../events/HazardEvents';

export type { IHazardEntity };
export type { IHazardZoneState };

export interface IHazardManagerState {
  readonly elapsedMs: number;
  readonly zones: readonly IHazardZoneState[];
}

export interface IHazardManagerConfig {
  readonly artefactFactory: IArtefactFactory;
  readonly random: { next(): number };
  readonly spatialGridCellSize?: number;   // default 200
}

/**
 * Core hazard zone simulation manager.
 *
 * Usage:
 * ```ts
 * const manager = new HazardManager(eventBus, artefactRegistry, {
 *   artefactFactory: { create(ev) { scene.spawnPickup(ev); } },
 *   random,
 * });
 * manager.addZone({ id: 'rad_1', type: 'radiation', x: 400, y: 300,
 *   radius: 60, damagePerSecond: 8, artefactChance: 0.15, maxArtefacts: 2 });
 *
 * // Each frame:
 * manager.tick(deltaMs, entities);
 *
 * // NPC terrain scoring:
 * const near = manager.getZonesInRadius(npc.x, npc.y, 150);
 * ```
 */
export class HazardManager {
  private readonly _zones = new Map<string, HazardZone>();
  private readonly _zoneList: HazardZone[] = [];
  private readonly _grid: SpatialGrid<HazardZone>;
  private readonly _spawner: ArtefactSpawner;
  private _elapsedMs = 0;
  private _cachedMaxRadius = 0;
  private _maxRadiusDirty = true;

  constructor(
    private readonly _events: EventBus<HazardEventPayloads>,
    artefacts: ArtefactRegistry,
    config: IHazardManagerConfig,
  ) {
    const cellSize = config.spatialGridCellSize ?? 200;
    this._grid = new SpatialGrid<HazardZone>(cellSize, (z) => ({ x: z.config.x, y: z.config.y }));
    this._spawner = new ArtefactSpawner(artefacts, config.artefactFactory, config.random);
  }

  addZone(config: IHazardZoneConfig): HazardZone {
    if (this._zones.has(config.id)) {
      throw new Error(`[HazardManager] Zone "${config.id}" already registered`);
    }
    const zone = new HazardZone(config);
    this._zones.set(config.id, zone);
    this._zoneList.push(zone);
    this._grid.insert(zone);
    if (config.radius > this._cachedMaxRadius) {
      this._cachedMaxRadius = config.radius;
    }
    return zone;
  }

  removeZone(id: string): void {
    const zone = this._zones.get(id);
    if (!zone) return;
    this._zones.delete(id);
    const idx = this._zoneList.indexOf(zone);
    if (idx !== -1) this._zoneList.splice(idx, 1);
    this._grid.remove(zone);
    this._maxRadiusDirty = true;
  }

  tick(deltaMs: number, entities: ReadonlyArray<IHazardEntity>): void {
    this._elapsedMs += deltaMs;

    // ── Expiry check ──────────────────────────────────────────────────────────
    // Collect expired zones first to avoid mutating _zoneList during iteration.
    const expired: HazardZone[] = [];
    for (const zone of this._zoneList) {
      if (zone.config.expiresAtMs !== undefined && this._elapsedMs >= zone.config.expiresAtMs) {
        expired.push(zone);
      }
    }
    for (const zone of expired) {
      this.removeZone(zone.config.id);
      this._events.emit(HazardEvents.ZONE_EXPIRED, {
        zoneId: zone.config.id,
        zoneType: zone.config.type,
      });
    }

    // ── Zone processing ───────────────────────────────────────────────────────
    for (const zone of this._zoneList) {
      zone.advance(deltaMs);

      // Damage tick
      while (zone.isDamageTickReady()) {
        zone.consumeDamageTick();
        const rawDamage = zone.getDamagePerTick();
        const damageTypeId = zone.config.type;

        for (const entity of entities) {
          if (entity.isAlive?.() === false) continue;
          if (!zone.containsPoint(entity.position.x, entity.position.y)) continue;
          if (zone.config.entityFilter && !zone.config.entityFilter(entity)) continue;
          const resistance = entity.immunity?.get(damageTypeId) ?? 0;
          const damage = rawDamage * (1 - resistance);
          if (damage <= 0) continue;
          this._events.emit(HazardEvents.HAZARD_DAMAGE, {
            entityId: entity.id,
            zoneId: zone.config.id,
            zoneType: zone.config.type,
            damage,
            damageTypeId,
          });
        }
      }

      // Artefact spawn tick
      while (zone.isArtefactSpawnReady()) {
        zone.consumeArtefactCycle();
        if (!zone.isAtCapacity) {
          const spawnEvent = this._spawner.trySpawn(zone);
          if (spawnEvent) {
            zone.notifyArtefactAdded();
            this._events.emit(HazardEvents.ARTEFACT_SPAWNED, {
              artefactId: spawnEvent.artefactId,
              zoneId: spawnEvent.zoneId,
              x: spawnEvent.x,
              y: spawnEvent.y,
            });
          }
        }
      }
    }

    // Flush all queued events after processing all zones
    this._events.flush();
  }

  getZoneAtPoint(x: number, y: number): HazardZone | null {
    const maxR = this._getMaxRadius();
    for (const zone of this._grid.queryRadius({ x, y }, maxR)) {
      if (zone.containsPoint(x, y)) return zone;
    }
    return null;
  }

  getZonesInRadius(x: number, y: number, radius: number): HazardZone[] {
    const searchRadius = radius + this._getMaxRadius();
    const candidates = [...this._grid.queryRadius({ x, y }, searchRadius)];
    return candidates.filter(zone => {
      const dx = zone.config.x - x;
      const dy = zone.config.y - y;
      const threshold = radius + zone.config.radius;
      return dx * dx + dy * dy <= threshold * threshold;
    });
  }

  getZone(id: string): HazardZone | undefined { return this._zones.get(id); }
  getAllZones(): readonly HazardZone[] { return this._zoneList; }
  get size(): number { return this._zones.size; }

  notifyArtefactCollected(zoneId: string, instanceId: string, artefactId: string, collectorId: string): void {
    this._zones.get(zoneId)?.notifyArtefactRemoved();
    this._events.emit(HazardEvents.ARTEFACT_COLLECTED, { artefactId, instanceId, zoneId, collectorId });
    this._events.flush();
  }

  /**
   * Serialize runtime timer state and artefact counts for save/load.
   *
   * Zone configs are NOT serialized — they come from user code and must be
   * re-registered via `addZone()` before calling `restore()`.
   */
  serialize(): IHazardManagerState {
    const zones: IHazardZoneState[] = [];
    for (const zone of this._zoneList) {
      zones.push(zone.serialize());
    }
    return { elapsedMs: this._elapsedMs, zones };
  }

  /**
   * Restore runtime timer state and artefact counts from a snapshot.
   *
   * Zone configs must already be registered via `addZone()`. Zones present
   * in the snapshot but not in the manager are silently skipped.
   *
   * @param state - Snapshot from {@link serialize}.
   */
  restore(state: IHazardManagerState): void {
    this._elapsedMs = state.elapsedMs;
    for (const zoneState of state.zones) {
      const zone = this._zones.get(zoneState.zoneId);
      if (zone) {
        zone.restore(zoneState);
      }
    }
  }

  destroy(): void {
    this._zones.clear();
    this._zoneList.length = 0;
    this._grid.clear();
    // Do NOT call this._events.destroy() — the EventBus may be shared with
    // other systems (e.g. passed in by HazardsPlugin which owns its lifecycle).
    // HazardManager only emits events; it registers no listeners to clean up.
  }

  private _getMaxRadius(): number {
    if (this._maxRadiusDirty) {
      let max = 0;
      for (const z of this._zoneList) if (z.config.radius > max) max = z.config.radius;
      this._cachedMaxRadius = max;
      this._maxRadiusDirty = false;
    }
    return this._cachedMaxRadius;
  }
}
