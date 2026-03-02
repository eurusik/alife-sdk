import { createPluginToken, EventBus } from '@alife-sdk/core';
import type { IALifePlugin, ALifeKernel, IRandom } from '@alife-sdk/core';
import { HazardManager } from '../manager/HazardManager';
import type { IHazardManagerConfig, IHazardManagerState } from '../manager/HazardManager';
import { ArtefactRegistry, WeightedArtefactSelector } from '../artefact/ArtefactRegistry';
import type { IArtefactSelector } from '../artefact/ArtefactRegistry';
import type { IArtefactFactory } from '../ports/IArtefactFactory';
import type { IHazardZoneConfig } from '../zone/HazardZone';
import type { HazardEventPayloads } from '../events/HazardEvents';

export const HazardsPluginToken = createPluginToken<HazardsPlugin>('hazards');

export interface IHazardsPluginConfig {
  readonly zones?: ReadonlyArray<IHazardZoneConfig>;
  readonly artefactFactory: IArtefactFactory;
  readonly artefactSelector?: IArtefactSelector;
  readonly spatialGridCellSize?: number;
}

/**
 * Optional ALifeKernel plugin wrapping HazardManager.
 *
 * The plugin owns a typed `EventBus<HazardEventPayloads>` for hazard-specific
 * events (`'hazard:damage'`, `'hazard:artefact_spawned'`, etc.) that are
 * separate from the kernel's core event bus. The bus is created during
 * `install(kernel)` so that the kernel logger is available for error reporting.
 *
 * @example
 * ```ts
 * const hazards = new HazardsPlugin(random, {
 *   zones: anomaliesJson,
 *   artefactFactory: { create(ev) { scene.spawnPickup(ev); } },
 * });
 * hazards.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 0.3 });
 * kernel.use(hazards);
 * kernel.init();
 *
 * hazards.events.on('hazard:damage', ({ entityId, damage }) => { ... });
 * ```
 */
export class HazardsPlugin implements IALifePlugin {
  readonly name = 'hazards';

  readonly artefacts: ArtefactRegistry;

  private _events: EventBus<HazardEventPayloads> | null = null;
  private _manager: HazardManager | null = null;
  private readonly _config: IHazardsPluginConfig;
  private readonly _random: IRandom;

  constructor(random: IRandom, config: IHazardsPluginConfig) {
    this._random = random;
    this._config = config;
    const selector = config.artefactSelector ?? new WeightedArtefactSelector(random);
    this.artefacts = new ArtefactRegistry(selector);
  }

  /**
   * The plugin's typed event bus for hazard-specific events.
   *
   * Available after `kernel.use(hazardsPlugin)` is called.
   * Subscribe before `kernel.init()` to avoid missing early events.
   */
  get events(): EventBus<HazardEventPayloads> {
    if (!this._events) {
      throw new Error(
        'HazardsPlugin.events accessed before install(). ' +
        'Call kernel.use(hazardsPlugin) before accessing events.',
      );
    }
    return this._events;
  }

  get manager(): HazardManager {
    if (!this._manager) {
      throw new Error(
        'HazardsPlugin.manager accessed before install(). ' +
        'Call kernel.use(hazardsPlugin) before kernel.init().',
      );
    }
    return this._manager;
  }

  install(_kernel: ALifeKernel): void {
    // Create the event bus here so the kernel logger is available for error
    // reporting inside the bus. HazardEventPayloads uses distinct 'hazard:*'
    // keys that are not part of ALifeEventPayloads, so this plugin owns its
    // own typed bus rather than forwarding through kernel.events.
    this._events = new EventBus<HazardEventPayloads>();

    this._manager = new HazardManager(this._events, this.artefacts, {
      artefactFactory: this._config.artefactFactory,
      random: this._random,
      spatialGridCellSize: this._config.spatialGridCellSize,
    } satisfies IHazardManagerConfig);

    if (this._config.zones) {
      for (const z of this._config.zones) this._manager.addZone(z);
    }
  }

  init(): void {
    this.artefacts.freeze();
  }

  update(_deltaMs: number): void {
    // HazardsPlugin.update() is called by kernel.update().
    // Entities must be provided by the host by calling manager.tick() directly,
    // OR override this method to pull from a port/registry.
    // Default: no-op (host ticks manually via manager.tick())
  }

  serialize(): Record<string, unknown> {
    if (!this._manager) return {};
    return this._manager.serialize() as unknown as Record<string, unknown>;
  }

  /**
   * Restore hazard manager state from a snapshot.
   *
   * Zones must already be registered in the manager (via the `zones` config
   * option or manual `manager.addZone()` calls) before calling `restore()`.
   * Zone configs are never serialized — they come from user code.
   */
  restore(state: Record<string, unknown>): void {
    if (!this._manager) return;
    if (typeof state.elapsedMs === 'number' && Array.isArray(state.zones)) {
      this._manager.restore(state as unknown as IHazardManagerState);
    }
  }

  destroy(): void {
    this._manager?.destroy();
    this._events?.destroy();
    this._events = null;
    this._manager = null;
  }
}
