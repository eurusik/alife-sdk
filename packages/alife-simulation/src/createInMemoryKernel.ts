/**
 * createInMemoryKernel — zero-boilerplate kernel factory for Node.js prototyping.
 *
 * The SDK normally requires you to implement three port adapters (IEntityAdapter,
 * IEntityFactory, IPlayerPositionProvider) and wire them manually before the
 * kernel accepts init(). For a running game engine that wiring is meaningful.
 * For exploration, unit-testing, and early prototyping it's unnecessary noise.
 *
 * This factory provides safe no-op implementations of every required port so
 * you can focus on simulation logic from line 1.
 *
 * @example
 * // Minimal usage — kernel is already init()'d and start()'d:
 * import { createInMemoryKernel } from '@alife-sdk/simulation';
 *
 * const { kernel, sim, factions } = createInMemoryKernel();
 *
 * factions.factions.register('stalker', new FactionBuilder('stalker').build());
 * sim.addTerrain(new SmartTerrain({ id: 'camp', ... }));
 * sim.registerNPC({ entityId: 'wolf', factionId: 'stalker', ... });
 *
 * kernel.update(5_001); // advance one tick
 *
 * @example
 * // Custom tick interval:
 * const { kernel, sim } = createInMemoryKernel({ tickIntervalMs: 1_000 });
 *
 * @example
 * // Custom player position (affects online/offline detection):
 * const { kernel } = createInMemoryKernel({
 *   playerPosition: { x: 400, y: 300 },
 * });
 */

import {
  ALifeKernel,
  Ports,
  FactionsPlugin,
  createNoOpEntityAdapter,
  createNoOpEntityFactory,
} from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';

import { SimulationPlugin, SimulationPorts, createNoOpBridge } from './index';
import type { ISimulationPluginConfig } from './plugin/SimulationPlugin';

export interface IInMemoryKernelOptions {
  /**
   * How often the offline tick pipeline fires (ms of simulated time per tick).
   * Default: 5 000 ms — matches the production default.
   */
  tickIntervalMs?: number;

  /**
   * Player world position used for online/offline proximity checks.
   * Default: { x: 0, y: 0 } — all NPCs start far away and stay offline.
   */
  playerPosition?: Vec2;

  /**
   * Full SimulationPlugin config override. `tickIntervalMs` above is a shortcut
   * for the most common option; use this for advanced tuning.
   */
  simulationConfig?: Partial<ISimulationPluginConfig>;
}

export interface IInMemoryKernelResult {
  /** The central kernel. Use kernel.events.on(), kernel.update(), kernel.destroy(). */
  kernel: ALifeKernel;
  /** SimulationPlugin — registerNPC(), addTerrain(), getNPCRecord(), … */
  sim: SimulationPlugin;
  /** FactionsPlugin — factions.register() to define faction relations. */
  factions: FactionsPlugin;
}

/**
 * Build a fully wired, already-started ALifeKernel backed by in-memory
 * no-op adapters.
 *
 * Ports provided:
 * - `EntityAdapter`     — all reads return null/false; writes are no-ops.
 * - `EntityFactory`     — create returns a sequential ID; destroy is a no-op.
 * - `PlayerPosition`    — returns the `playerPosition` option (default origin).
 * - `SimulationBridge`  — all NPCs are alive, no damage is applied.
 *
 * Plugins installed (in dependency order):
 * - `FactionsPlugin`   — ready to accept faction registrations.
 * - `SimulationPlugin` — configured with `tickIntervalMs`.
 *
 * The kernel is already in the `running` state when returned.
 * Call `kernel.update(deltaMs)` to advance simulation.
 */
export function createInMemoryKernel(
  options: IInMemoryKernelOptions = {},
): IInMemoryKernelResult {
  const {
    tickIntervalMs = 5_000,
    playerPosition = { x: 0, y: 0 },
    simulationConfig,
  } = options;

  const kernel = new ALifeKernel();

  // Wire all required ports with safe no-op implementations.
  kernel.provide(Ports.EntityAdapter,  createNoOpEntityAdapter());
  kernel.provide(Ports.EntityFactory,  createNoOpEntityFactory());
  kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => playerPosition });
  kernel.provide(SimulationPorts.SimulationBridge, createNoOpBridge());

  const factions = new FactionsPlugin();
  const sim = new SimulationPlugin({ tickIntervalMs, ...simulationConfig });

  // FactionsPlugin must be installed before SimulationPlugin (dependency order).
  kernel.use(factions);
  kernel.use(sim);

  kernel.init();
  kernel.start();

  return { kernel, sim, factions };
}
