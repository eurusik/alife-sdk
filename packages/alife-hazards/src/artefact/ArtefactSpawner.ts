import type { HazardZone, IHazardZoneConfig } from '../zone/HazardZone';
import type { ArtefactRegistry } from './ArtefactRegistry';
import type { IArtefactFactory, IArtefactSpawnEvent } from '../ports/IArtefactFactory';

/**
 * Runs the artefact spawn lottery for a zone and invokes IArtefactFactory.
 * Position: polar random point at 60–95% of zone radius (perimeter aesthetic).
 */
export class ArtefactSpawner {
  constructor(
    private readonly registry: ArtefactRegistry,
    private readonly factory: IArtefactFactory,
    private readonly random: { next(): number },
  ) {}

  /**
   * Attempt spawn lottery for a zone.
   * Returns the spawn event if factory.create() was called, or null otherwise.
   * Caller (HazardManager) is responsible for calling zone.notifyArtefactAdded().
   */
  trySpawn(zone: HazardZone): IArtefactSpawnEvent | null {
    if (zone.isAtCapacity) return null;
    if (this.random.next() > zone.config.artefactChance) return null;

    const def = this.registry.pickForZone(zone.config.type);
    if (!def) return null;

    const pos = this._samplePerimeterPoint(zone.config);
    const event: IArtefactSpawnEvent = {
      artefactId: def.id,
      zoneId: zone.config.id,
      zoneType: zone.config.type,
      x: pos.x,
      y: pos.y,
    };
    this.factory.create(event);
    return event;
  }

  private _samplePerimeterPoint(cfg: IHazardZoneConfig): { x: number; y: number } {
    const angle = this.random.next() * Math.PI * 2;
    const dist = cfg.radius * (0.6 + this.random.next() * 0.35);
    return { x: cfg.x + Math.cos(angle) * dist, y: cfg.y + Math.sin(angle) * dist };
  }
}
