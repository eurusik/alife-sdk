// scene/createPhaserKernel.ts
// Facade: wires all SDK plugins and adapters into a running kernel.

import {
  ALifeKernel,
  Ports,
  FactionBuilder,
  FactionsPlugin,
  SpawnPlugin,
  DefaultRandom,
} from '@alife-sdk/core';
import type {
  IALifeKernelOptions,
  IEntityAdapter,
  IPlayerPositionProvider,
  IEntityFactory,
  IRandom,
  SmartTerrain,
} from '@alife-sdk/core';
import {
  SimulationPlugin,
  SimulationPorts,
  createDefaultPluginConfig,
} from '@alife-sdk/simulation';
import type {
  ISimulationBridge,
} from '@alife-sdk/simulation';
import { AIPlugin } from '@alife-sdk/ai';
import type { IAIPluginConfig } from '@alife-sdk/ai';
import { SocialPlugin } from '@alife-sdk/social';
import type { ISocialPluginConfig } from '@alife-sdk/social';

import { OnlineOfflineManager } from '../online/OnlineOfflineManager';
import type { IOnlineOfflineConfig } from '../types/IOnlineOfflineConfig';

// ---------------------------------------------------------------------------
// Facade config
// ---------------------------------------------------------------------------

/** Faction definition for kernel setup. */
export interface IFactionDef {
  readonly id: string;
  /** Display name. Defaults to id if omitted. */
  readonly displayName?: string;
  readonly relations?: Readonly<Record<string, number>>;
}

/** Preset level for plugin inclusion. */
export type KernelPreset = 'minimal' | 'simulation' | 'full';

/**
 * Configuration for createPhaserKernel facade.
 *
 * Grouped into 4 sections:
 * - `ports` — required and optional adapters
 * - `data` — factions and terrain definitions
 * - `plugins` — per-plugin configs
 * - `config` — kernel-level settings
 *
 * @example
 * ```ts
 * createPhaserKernel({
 *   ports: {
 *     entityAdapter: new PhaserEntityAdapter(),
 *     playerPosition: new PhaserPlayerPosition(player),
 *     entityFactory: new PhaserEntityFactory({ ... }),
 *     simulationBridge: bridge,
 *   },
 *   data: {
 *     factions: [{ id: 'stalker', relations: { bandit: -60 } }],
 *   },
 *   config: { preset: 'full' },
 * });
 * ```
 */
export interface IPhaserKernelConfig {
  /** Adapters bridging the SDK to the host game engine. */
  readonly ports: {
    readonly entityAdapter: IEntityAdapter;
    readonly playerPosition: IPlayerPositionProvider;
    readonly entityFactory: IEntityFactory;
    readonly simulationBridge?: ISimulationBridge;
    readonly random?: IRandom;
  };
  /** Static data definitions. */
  readonly data?: {
    readonly factions?: readonly IFactionDef[];
    readonly terrains?: readonly SmartTerrain[];
  };
  /** Per-plugin configuration overrides. */
  readonly plugins?: {
    readonly simulation?: Parameters<typeof createDefaultPluginConfig>[0];
    readonly ai?: Partial<IAIPluginConfig>;
    readonly social?: Partial<ISocialPluginConfig>;
  };
  /** Kernel-level settings. */
  readonly config?: {
    /** Plugin preset (default: 'simulation'). */
    readonly preset?: KernelPreset;
    readonly kernel?: Partial<IALifeKernelOptions>;
    readonly onlineOffline?: Partial<IOnlineOfflineConfig>;
    /** Spawn point cooldown (ms). Default 30000. */
    readonly spawnCooldownMs?: number;
  };
}

/** Result of createPhaserKernel. */
export interface IPhaserKernelResult {
  readonly kernel: ALifeKernel;
  readonly simulation: SimulationPlugin | null;
  readonly onlineOffline: OnlineOfflineManager;
}

/**
 * Facade: create a fully wired A-Life kernel in one call.
 *
 * @example
 * ```ts
 * const { kernel, simulation, onlineOffline } = createPhaserKernel({
 *   ports: {
 *     entityAdapter: new PhaserEntityAdapter(),
 *     playerPosition: new PhaserPlayerPosition(player),
 *     entityFactory: new PhaserEntityFactory({ ... }),
 *     simulationBridge: new PhaserSimulationBridge(),
 *   },
 *   data: {
 *     factions: [
 *       { id: 'stalker', relations: { bandit: -60, military: -20 } },
 *       { id: 'bandit', relations: { stalker: -60 } },
 *     ],
 *   },
 *   config: { preset: 'full' },
 * });
 *
 * kernel.start();
 * // In update loop: kernel.update(deltaMs);
 * ```
 */
export function createPhaserKernel(config: IPhaserKernelConfig): IPhaserKernelResult {
  const preset = config.config?.preset ?? 'simulation';
  const kernel = new ALifeKernel(config.config?.kernel);

  // -- Provide required ports ------------------------------------------------
  kernel.provide(Ports.EntityAdapter, config.ports.entityAdapter);
  kernel.provide(Ports.PlayerPosition, config.ports.playerPosition);
  kernel.provide(Ports.EntityFactory, config.ports.entityFactory);

  if (config.ports.random) {
    kernel.provide(Ports.Random, config.ports.random);
  }

  // -- Factions plugin (always added) ----------------------------------------
  const factionsPlugin = new FactionsPlugin();
  if (config.data?.factions) {
    for (const fDef of config.data.factions) {
      const builder = new FactionBuilder(fDef.id)
        .displayName(fDef.displayName ?? fDef.id);
      if (fDef.relations) {
        for (const [otherId, score] of Object.entries(fDef.relations)) {
          builder.relation(otherId, score);
        }
      }
      factionsPlugin.factions.register(fDef.id, builder.build());
    }
  }
  kernel.use(factionsPlugin);

  // -- Spawn plugin (always added) -------------------------------------------
  const spawnPlugin = new SpawnPlugin(config.config?.spawnCooldownMs ?? 30_000);
  kernel.use(spawnPlugin);

  // -- Simulation plugin (simulation + full presets) -------------------------
  let simulationPlugin: SimulationPlugin | null = null;

  if (preset === 'simulation' || preset === 'full') {
    if (config.ports.simulationBridge) {
      kernel.provide(SimulationPorts.SimulationBridge, config.ports.simulationBridge);
    }

    simulationPlugin = new SimulationPlugin(config.plugins?.simulation);

    if (config.data?.terrains) {
      for (const terrain of config.data.terrains) {
        simulationPlugin.addTerrain(terrain);
      }
    }

    kernel.use(simulationPlugin);
  }

  // -- AI + Social plugins (full preset) ------------------------------------
  if (preset === 'full') {
    const random: IRandom = config.ports?.random ?? new DefaultRandom();
    kernel.use(new AIPlugin(random, config.plugins?.ai));
    kernel.use(new SocialPlugin(random, config.plugins?.social));
  }

  // -- Online/Offline manager ------------------------------------------------
  const onlineOffline = new OnlineOfflineManager(config.config?.onlineOffline);

  return { kernel, simulation: simulationPlugin, onlineOffline };
}
