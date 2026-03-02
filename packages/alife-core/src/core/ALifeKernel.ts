// core/ALifeKernel.ts
// Central orchestrator and developer entry point for the A-Life SDK.
//
// The kernel owns the event bus, clock, spatial grid, and logger. Domain-specific registries and features (factions, NPC types,
// monsters, anomalies, surge, squads, etc.) are added via plugins — see `use()`.
//
// Lifecycle:
//   1. Construct with optional config/clock/logger overrides
//   2. provide() port adapters via token-based registry
//   3. use() plugins
//   4. init() — validate, create subsystems, init plugins
//   5. start() — enable frame-based updates
//   6. update(deltaMs) each frame  OR  step(count) for deterministic tests
//   7. pause() / resume() to freeze/unfreeze time
//   8. destroy() on shutdown

import { EventBus } from '../events/EventBus';
import type { ALifeEventPayloads } from '../events/ALifeEvents';
import { Clock } from './Clock';
import type { IClockConfig, IClockState } from './Clock';
import { SpatialGrid } from './SpatialGrid';
import { Logger } from '../logger/Logger';
import type { ILoggerConfig } from '../logger/Logger';
import { type IALifeConfig, createDefaultConfig } from '../config/ALifeConfig';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import { createNoOpEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import { createNoOpPlayerPosition } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';
import { createNoOpEntityFactory } from '../ports/IEntityFactory';
import type { ILogger } from '../ports/ILogger';
import type { IALifePlugin } from '../plugins/IALifePlugin';
import type { PluginToken } from '../plugins/PluginToken';
import type { Vec2 } from './Vec2';
import { PortRegistry, type PortToken } from './PortRegistry';
import { Ports, REQUIRED_PORTS } from './PortTokens';
import { DiagnosticsCollector } from './Diagnostics';
import { DefaultRandom } from '../ports/IRandom';
import type { IDevToolsSnapshot, IDevToolsConfig } from './DevToolsInspector';
import { DEFAULT_DEVTOOLS_CONFIG } from './DevToolsInspector';

// ---------------------------------------------------------------------------
// Kernel configuration
// ---------------------------------------------------------------------------

/** Optional overrides for kernel sub-systems. */
export interface IALifeKernelConfig {
  readonly config?: Partial<IALifeConfig>;
  readonly logger?: ILoggerConfig;
  readonly clock?: Omit<IClockConfig, 'onHourChanged' | 'onDayNightChanged'>;
}

/** @deprecated Use IALifeKernelConfig */
export type IALifeKernelOptions = IALifeKernelConfig;

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Current serialisation format version. */
export const KERNEL_STATE_VERSION = 1;

/**
 * Migration function that transforms kernel state from one version to the next.
 *
 * @param state - The kernel state object to migrate.
 * @returns The migrated state for the next version.
 */
export type StateMigration = (state: IALifeKernelState) => IALifeKernelState;

/** Wrapper for per-plugin state with version tag. */
export interface IPluginStateCapsule {
  readonly version?: number;
  readonly state: Record<string, unknown>;
}

export interface IALifeKernelState {
  readonly version: number;
  readonly clock: IClockState;
  readonly tick: number;
  readonly plugins?: Readonly<Record<string, IPluginStateCapsule>>;
}

// ---------------------------------------------------------------------------
// ALifeKernel
// ---------------------------------------------------------------------------

export class ALifeKernel {
  // -- Events ---------------------------------------------------------------

  readonly events = new EventBus<ALifeEventPayloads>();

  // -- Ports ----------------------------------------------------------------

  readonly portRegistry = new PortRegistry();

  // -- Plugins --------------------------------------------------------------

  private readonly plugins = new Map<string, IALifePlugin>();
  private pluginOrder: IALifePlugin[] = [];

  // -- Migrations -----------------------------------------------------------

  private readonly migrations = new Map<number, StateMigration>();

  // -- Infrastructure (created in init()) -----------------------------------

  private _clock!: Clock;
  private _logger!: Logger;
  private _spatialGrid!: SpatialGrid<{ id: string; position: Vec2 }>;

  // -- Config ---------------------------------------------------------------

  private readonly config: IALifeConfig;
  private readonly loggerConfig: ILoggerConfig;
  private readonly clockConfig: Omit<IClockConfig, 'onHourChanged' | 'onDayNightChanged'>;

  // -- State ----------------------------------------------------------------

  private initialized = false;
  private _running = false;
  private _paused = false;
  private _tick = 0;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a new A-Life kernel.
   *
   * @example
   * ```ts
   * const kernel = new ALifeKernel();
   * kernel.provide(Ports.EntityAdapter, myAdapter);
   * kernel.use(new SimulationPlugin());
   * kernel.init();
   * kernel.start();
   * ```
   */
  constructor(options: IALifeKernelConfig = {}) {
    this.config = mergeConfig(createDefaultConfig(), options.config);
    this.loggerConfig = options.logger ?? {};
    this.clockConfig = options.clock ?? {};
  }

  // -------------------------------------------------------------------------
  // Port API
  // -------------------------------------------------------------------------

  /** Register a port adapter by token. Must be called before `init()`. */
  provide<T>(token: PortToken<T>, impl: T): this {
    if (this.initialized) {
      throw new Error('[ALifeKernel] Cannot provide ports after init()');
    }
    this.portRegistry.provide(token, impl);
    return this;
  }

  // -------------------------------------------------------------------------
  // Plugin API
  // -------------------------------------------------------------------------

  /**
   * Install a plugin. Must be called before `init()`.
   *
   * Plugins extend the kernel with domain-specific registries and logic.
   * Each plugin is identified by its `name` property — duplicates throw.
   */
  use(plugin: IALifePlugin): this {
    if (this.initialized) {
      throw new Error('[ALifeKernel] Cannot install plugins after init()');
    }
    if (this.plugins.has(plugin.name)) {
      throw new Error(`[ALifeKernel] Plugin "${plugin.name}" already installed`);
    }

    this.plugins.set(plugin.name, plugin);
    this.pluginOrder.push(plugin);
    plugin.install(this);

    return this;
  }

  /** Retrieve an installed plugin by typed token or name string. */
  getPlugin<T extends IALifePlugin>(token: PluginToken<T>): T;
  getPlugin<T extends IALifePlugin>(name: string): T;
  getPlugin<T extends IALifePlugin>(nameOrToken: string | PluginToken<T>): T {
    const name = typeof nameOrToken === 'string' ? nameOrToken : nameOrToken.name;
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`[ALifeKernel] Plugin "${name}" not installed`);
    }
    return plugin as T;
  }

  /** Check whether a plugin is installed. */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  // -------------------------------------------------------------------------
  // Migration API
  // -------------------------------------------------------------------------

  /**
   * Register a state migration from one version to the next.
   *
   * When `restoreState()` receives a save with `state.version < KERNEL_STATE_VERSION`,
   * the kernel applies registered migrations in sequence to bring the state up to date.
   *
   * @param fromVersion - The version this migration upgrades FROM (migrates to fromVersion + 1).
   * @param migration - A function that transforms the state.
   */
  registerMigration(fromVersion: number, migration: StateMigration): this {
    if (this.migrations.has(fromVersion)) {
      throw new Error(`[ALifeKernel] Migration from version ${fromVersion} already registered`);
    }
    this.migrations.set(fromVersion, migration);
    return this;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Validate configuration, create subsystems, and initialize plugins
   * in dependency order.
   *
   * Returns a {@link DiagnosticsCollector} with all warnings/infos.
   * Throws {@link ALifeValidationError} if any required port is missing
   * or a plugin hard-dependency is unresolved.
   */
  init(): DiagnosticsCollector {
    if (this.initialized) {
      throw new Error('[ALifeKernel] Already initialized');
    }

    const diag = new DiagnosticsCollector();

    this.validatePorts(diag);
    this.validatePluginDeps(diag);
    this.validateConfig(diag);
    diag.throwIfErrors();

    if (!this.portRegistry.has(Ports.Random)) {
      this.portRegistry.provide(Ports.Random, new DefaultRandom());
    }
    if (!this.portRegistry.has(Ports.EntityAdapter)) {
      this.portRegistry.provide(Ports.EntityAdapter, createNoOpEntityAdapter());
    }
    if (!this.portRegistry.has(Ports.PlayerPosition)) {
      this.portRegistry.provide(Ports.PlayerPosition, createNoOpPlayerPosition());
    }
    if (!this.portRegistry.has(Ports.EntityFactory)) {
      this.portRegistry.provide(Ports.EntityFactory, createNoOpEntityFactory());
    }

    this.pluginOrder = this.topologicalSort();

    this.createSubsystems();

    // Mark as initialized early so plugins can access kernel accessors
    // (e.g. logger, clock) during their init() calls.
    this.initialized = true;

    for (const plugin of this.pluginOrder) {
      plugin.init?.();
    }

    this._logger.info('kernel', 'ALifeKernel initialized', {
      plugins: this.pluginOrder.map((p) => p.name),
      ports: this.portRegistry.registeredIds(),
    });

    return diag;
  }

  /**
   * Start the simulation — enables frame-based `update()`.
   * Must be called after `init()`.
   */
  start(): void {
    this.ensureInitialized('start');
    if (this._running) {
      throw new Error('[ALifeKernel] Already started');
    }
    this._running = true;
    this._logger.info('kernel', 'Simulation started');
  }

  /**
   * Advance the simulation by `deltaMs` real milliseconds.
   * Requires `init()` + `start()`. No-op when paused.
   */
  update(deltaMs: number): void {
    this.ensureInitialized('update');
    this.ensureRunning('update');

    if (this._paused) return;

    this._tick++;
    this._clock.update(deltaMs);
    for (const plugin of this.pluginOrder) {
      plugin.update?.(deltaMs);
    }
    this.events.flush();
  }

  /**
   * Advance the simulation by a fixed number of ticks at the configured
   * interval. Does not require `start()` — ideal for deterministic tests.
   *
   * @param count - Number of ticks to execute (default: 1).
   */
  step(count: number = 1): void {
    this.ensureInitialized('step');

    const intervalMs = this.config.tick.intervalMs;
    for (let i = 0; i < count; i++) {
      this._tick++;
      this._clock.update(intervalMs);
      for (const plugin of this.pluginOrder) {
        plugin.update?.(intervalMs);
      }
      this.events.flush();
    }
  }

  /** Pause the simulation — `update()` becomes a no-op, clock freezes. */
  pause(): void {
    this.ensureInitialized('pause');
    this._paused = true;
    this._clock.pause();
  }

  /** Resume after a `pause()`. */
  resume(): void {
    this.ensureInitialized('resume');
    this._paused = false;
    this._clock.resume();
  }

  /** Release all resources and subscriptions. */
  destroy(): void {
    for (let i = this.pluginOrder.length - 1; i >= 0; i--) {
      this.pluginOrder[i].destroy?.();
    }
    this.plugins.clear();
    this.pluginOrder = [];

    this.events.destroy();
    this._spatialGrid?.clear();
    this._logger?.info('kernel', 'ALifeKernel destroyed');
    this.initialized = false;
    this._running = false;
    this._paused = false;
    this._tick = 0;
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  get clock(): Clock {
    this.ensureInitialized('clock');
    return this._clock;
  }

  get logger(): ILogger {
    this.ensureInitialized('logger');
    return this._logger;
  }

  get spatialGrid(): SpatialGrid<{ id: string; position: Vec2 }> {
    this.ensureInitialized('spatialGrid');
    return this._spatialGrid;
  }

  get entityAdapter(): IEntityAdapter {
    return this.portRegistry.require(Ports.EntityAdapter);
  }

  get playerPosition(): IPlayerPositionProvider {
    return this.portRegistry.require(Ports.PlayerPosition);
  }

  get entityFactory(): IEntityFactory {
    return this.portRegistry.require(Ports.EntityFactory);
  }

  get currentConfig(): IALifeConfig {
    return this.config;
  }

  get tick(): number {
    return this._tick;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get isPaused(): boolean {
    return this._paused;
  }

  // -------------------------------------------------------------------------
  // Serialisation
  // -------------------------------------------------------------------------

  serialize(): IALifeKernelState {
    this.ensureInitialized('serialize');
    return {
      version: KERNEL_STATE_VERSION,
      clock: this._clock.serialize(),
      tick: this._tick,
      plugins: this.collectPluginState(),
    };
  }

  restoreState(state: IALifeKernelState): void {
    this.ensureInitialized('restoreState');

    let migrated = state;

    if (migrated.version > KERNEL_STATE_VERSION) {
      throw new Error(
        `[ALifeKernel] Save version ${migrated.version} is newer than current ${KERNEL_STATE_VERSION}`,
      );
    }

    // Run kernel-level migrations in sequence.
    while (migrated.version < KERNEL_STATE_VERSION) {
      const migration = this.migrations.get(migrated.version);
      if (!migration) {
        throw new Error(
          `[ALifeKernel] No migration registered from version ${migrated.version} to ${migrated.version + 1}`,
        );
      }
      const prevVersion = migrated.version;
      this._logger.info('kernel', `Migrating save from v${prevVersion} to v${prevVersion + 1}`);
      migrated = migration(migrated);
      if (migrated.version <= prevVersion) {
        throw new Error(
          `[ALifeKernel] Migration from version ${prevVersion} did not increment version (got ${migrated.version}). ` +
          `Ensure the migration function returns a state with version: ${prevVersion + 1}.`,
        );
      }
    }

    this._clock = Clock.fromState(migrated.clock, {
      dayStartHour: this.config.time.dayStartHour,
      dayEndHour: this.config.time.dayEndHour,
      onHourChanged: (h, d) => this.events.emit('time:hour_changed', { hour: h, day: d, isDay: this._clock.isDay }),
      onDayNightChanged: (isDay) => this.events.emit('time:day_night_changed', { isDay }),
    });
    this._tick = migrated.tick;

    if (migrated.plugins) {
      for (const plugin of this.pluginOrder) {
        const capsule = migrated.plugins[plugin.name];
        if (capsule && plugin.restore) {
          // Run plugin-level migration if the capsule has a version tag
          // that is older than the current kernel version.
          let pluginState = capsule.state;
          const capsuleVersion = capsule.version ?? migrated.version;
          if (capsuleVersion < KERNEL_STATE_VERSION && plugin.migrateState) {
            pluginState = plugin.migrateState(pluginState, capsuleVersion);
          }
          plugin.restore(pluginState);
        }
      }
    }

    this._logger.info('kernel', 'State restored', { tick: migrated.tick, version: migrated.version });
  }

  // -------------------------------------------------------------------------
  // DevTools
  // -------------------------------------------------------------------------

  /**
   * Create a runtime snapshot of the kernel state for developer tooling.
   *
   * @param config - Optional configuration to control what data is included.
   * @returns A plain, JSON-serialisable snapshot.
   */
  inspect(config?: IDevToolsConfig): IDevToolsSnapshot {
    this.ensureInitialized('inspect');

    const opts = { ...DEFAULT_DEVTOOLS_CONFIG, ...config };
    const pluginNames = this.pluginOrder.map((p) => p.name);

    const snapshot: IDevToolsSnapshot = {
      tick: this._tick,
      running: this._running,
      paused: this._paused,
      clock: {
        gameHour: this._clock.hour,
        isDay: this._clock.isDay,
        elapsedMs: this._clock.totalGameSeconds * 1000,
      },
      pluginNames,
    };

    if (opts.includeSpatialGrid) {
      (snapshot as { spatialGrid: IDevToolsSnapshot['spatialGrid'] }).spatialGrid = {
        entityCount: this._spatialGrid.size,
        cellSize: this.config.simulation.spatialGridCellSize,
      };
    }

    if (opts.includePorts) {
      (snapshot as { ports: IDevToolsSnapshot['ports'] }).ports = this.portRegistry.registeredIds();
    }

    if (opts.includePlugins) {
      const pluginsData: Record<string, Record<string, unknown>> = {};
      for (const plugin of this.pluginOrder) {
        if (plugin.inspect) {
          pluginsData[plugin.name] = plugin.inspect();
        }
      }
      (snapshot as { plugins: IDevToolsSnapshot['plugins'] }).plugins = pluginsData;
    }

    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Private — validation
  // -------------------------------------------------------------------------

  private validatePorts(diag: DiagnosticsCollector): void {
    for (const token of REQUIRED_PORTS) {
      if (!this.portRegistry.has(token)) {
        diag.error(
          'kernel',
          `ports.${token.id}`,
          `Required port "${token.id}" not provided`,
          `Call kernel.provide(Ports.${capitalize(token.id)}, impl) before init()`,
        );
      }
    }

    for (const plugin of this.pluginOrder) {
      if (plugin.requiredPorts) {
        for (const token of plugin.requiredPorts) {
          if (!this.portRegistry.has(token)) {
            diag.error(
              plugin.name,
              `ports.${token.id}`,
              `Plugin "${plugin.name}" requires port "${token.id}" (${token.description})`,
            );
          }
        }
      }
    }
  }

  private validatePluginDeps(diag: DiagnosticsCollector): void {
    for (const plugin of this.pluginOrder) {
      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.plugins.has(dep)) {
            diag.error(
              plugin.name,
              `dependencies.${dep}`,
              `Missing required dependency "${dep}"`,
              `Install it with kernel.use(new ${capitalize(dep)}Plugin()) before "${plugin.name}"`,
            );
          }
        }
      }

      if (plugin.optionalDependencies) {
        for (const dep of plugin.optionalDependencies) {
          if (!this.plugins.has(dep)) {
            diag.warning(
              plugin.name,
              `optionalDependencies.${dep}`,
              `Optional dependency "${dep}" not installed — some features may be limited`,
            );
          }
        }
      }
    }
  }

  private validateConfig(diag: DiagnosticsCollector): void {
    const c = this.config;
    if (c.tick.intervalMs <= 0) {
      diag.error('kernel', 'config.tick.intervalMs', 'Must be > 0');
    }
    if (c.simulation.spatialGridCellSize <= 0) {
      diag.error('kernel', 'config.simulation.spatialGridCellSize', 'Must be > 0');
    }
    if (c.time.dayStartHour >= c.time.dayEndHour) {
      diag.warning('kernel', 'config.time', 'dayStartHour >= dayEndHour — day/night transitions may behave unexpectedly');
    }
  }

  // -------------------------------------------------------------------------
  // Private — topological sort (Kahn's algorithm)
  // -------------------------------------------------------------------------

  private topologicalSort(): IALifePlugin[] {
    const pluginMap = this.plugins;
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const [name] of pluginMap) {
      inDegree.set(name, 0);
      adjacency.set(name, []);
    }

    for (const plugin of this.pluginOrder) {
      const deps = plugin.dependencies ?? [];
      for (const dep of deps) {
        if (pluginMap.has(dep)) {
          adjacency.get(dep)!.push(plugin.name);
          inDegree.set(plugin.name, (inDegree.get(plugin.name) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: IALifePlugin[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(pluginMap.get(name)!);

      for (const neighbor of adjacency.get(name)!) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== pluginMap.size) {
      const remaining = [...pluginMap.keys()].filter(
        (n) => !sorted.some((p) => p.name === n),
      );
      throw new Error(
        `[ALifeKernel] Circular plugin dependency detected among: ${remaining.join(', ')}`,
      );
    }

    return sorted;
  }

  // -------------------------------------------------------------------------
  // Private — lifecycle helpers
  // -------------------------------------------------------------------------

  private collectPluginState(): Record<string, IPluginStateCapsule> {
    const state: Record<string, IPluginStateCapsule> = {};
    for (const plugin of this.pluginOrder) {
      if (plugin.serialize) {
        state[plugin.name] = { version: KERNEL_STATE_VERSION, state: plugin.serialize() };
      }
    }
    return state;
  }

  private createSubsystems(): void {
    this._logger = new Logger(this.loggerConfig);

    this._clock = new Clock({
      ...this.clockConfig,
      timeFactor: this.clockConfig.timeFactor ?? this.config.time.timeFactor,
      startHour: this.clockConfig.startHour ?? this.config.time.startHour,
      dayStartHour: this.config.time.dayStartHour,
      dayEndHour: this.config.time.dayEndHour,
      onHourChanged: (h, d) => this.events.emit('time:hour_changed', { hour: h, day: d, isDay: this._clock.isDay }),
      onDayNightChanged: (isDay) => this.events.emit('time:day_night_changed', { isDay }),
    });

    this._spatialGrid = new SpatialGrid<{ id: string; position: Vec2 }>(
      this.config.simulation.spatialGridCellSize,
      (item) => item.position,
    );
  }

  private ensureInitialized(operation: string): void {
    if (!this.initialized) {
      throw new Error(`[ALifeKernel] Not initialized — call init() before ${operation}`);
    }
  }

  private ensureRunning(operation: string): void {
    if (!this._running) {
      throw new Error(`[ALifeKernel] Not running — call start() before ${operation}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mergeConfig(
  base: IALifeConfig,
  overrides?: Partial<IALifeConfig>,
): IALifeConfig {
  if (!overrides) return base;

  return {
    tick: { ...base.tick, ...overrides.tick },
    simulation: { ...base.simulation, ...overrides.simulation },
    time: { ...base.time, ...overrides.time },
    combat: { ...base.combat, ...overrides.combat },
    morale: { ...base.morale, ...overrides.morale },
    spawn: { ...base.spawn, ...overrides.spawn },
    memory: { ...base.memory, ...overrides.memory },
    surge: { ...base.surge, ...overrides.surge },
    monster: { ...base.monster, ...overrides.monster },
    trade: { ...base.trade, ...overrides.trade },
  };
}
