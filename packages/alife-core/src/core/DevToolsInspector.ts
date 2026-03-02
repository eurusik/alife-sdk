// core/DevToolsInspector.ts
// Types for runtime inspection and developer tooling.

/**
 * Configuration for the DevTools inspector snapshot.
 */
export interface IDevToolsConfig {
  /** Include per-plugin inspection data. Default: true. */
  readonly includePlugins?: boolean;
  /** Include spatial grid statistics. Default: true. */
  readonly includeSpatialGrid?: boolean;
  /** Include port registry info. Default: true. */
  readonly includePorts?: boolean;
}

/**
 * Runtime snapshot of the kernel state for developer tooling.
 *
 * Returned by `kernel.inspect()`. Designed for overlay UIs, debug panels,
 * or automated monitoring.
 *
 * @example
 * ```ts
 * const snapshot = kernel.inspect();
 * console.log(`Tick: ${snapshot.tick}, Clock: ${snapshot.clock.gameHour}`);
 * for (const [name, data] of Object.entries(snapshot.plugins ?? {})) {
 *   console.log(`  ${name}:`, data);
 * }
 * ```
 */
export interface IDevToolsSnapshot {
  /** Current simulation tick. */
  readonly tick: number;
  /** Whether the kernel is running. */
  readonly running: boolean;
  /** Whether the kernel is paused. */
  readonly paused: boolean;
  /** Clock state. */
  readonly clock: {
    readonly gameHour: number;
    readonly isDay: boolean;
    readonly elapsedMs: number;
  };
  /** Spatial grid stats (when includeSpatialGrid is true). */
  readonly spatialGrid?: {
    readonly entityCount: number;
    readonly cellSize: number;
  };
  /** Registered port IDs (when includePorts is true). */
  readonly ports?: readonly string[];
  /** Installed plugin names in dependency order. */
  readonly pluginNames: readonly string[];
  /** Per-plugin inspection data (when includePlugins is true). */
  readonly plugins?: Readonly<Record<string, Record<string, unknown>>>;
}

export const DEFAULT_DEVTOOLS_CONFIG: IDevToolsConfig = {
  includePlugins: true,
  includeSpatialGrid: true,
  includePorts: true,
};
