import type { ALifeKernel } from '../core/ALifeKernel';
import type { PortToken } from '../core/PortRegistry';

/**
 * Lifecycle contract for A-Life kernel plugins.
 *
 * Plugins extend the kernel with domain-specific registries, event handlers,
 * and per-frame logic. Each plugin has a unique string name used for typed
 * retrieval via `kernel.getPlugin<T>(name)`.
 *
 * Lifecycle order:
 *   install() → init() → update() per frame → destroy()
 *
 * Only `name` and `install` are required. The remaining hooks are optional.
 */
export interface IALifePlugin {
  /** Unique identifier. Convention: lowercase noun ('monsters', 'surge'). */
  readonly name: string;

  /**
   * Hard dependencies — plugin names that must be installed before this one.
   * Init fails with a diagnostic error if any hard dependency is missing.
   */
  readonly dependencies?: readonly string[];

  /**
   * Soft dependencies — plugin names that this plugin can use but doesn't require.
   * A warning is emitted if a soft dependency is missing, but init continues.
   */
  readonly optionalDependencies?: readonly string[];

  /**
   * Port tokens that this plugin requires to function.
   * Init fails with a diagnostic error if any required port is not provided.
   */
  readonly requiredPorts?: readonly PortToken<unknown>[];

  /**
   * Called when `kernel.use(plugin)` is invoked.
   *
   * Registries are still mutable at this point — use this hook to store the
   * kernel reference and perform any pre-init setup.
   */
  install(kernel: ALifeKernel): void;

  /**
   * Called during `kernel.init()`, after all core registries are frozen.
   *
   * Use this to freeze plugin-owned registries and create internal
   * subsystems that depend on frozen registry data.
   */
  init?(): void;

  /**
   * Called every frame from `kernel.update(deltaMs)`, after core systems.
   *
   * Only implement when the plugin has per-frame simulation logic.
   */
  update?(deltaMs: number): void;

  /**
   * Called during `kernel.destroy()`, in reverse installation order.
   *
   * Use this to release subscriptions, timers, and internal state.
   */
  destroy?(): void;

  /**
   * Capture plugin-specific state for save/load.
   *
   * Return a plain JSON-serialisable object. Called by `kernel.serialize()`.
   */
  serialize?(): Record<string, unknown>;

  /**
   * Restore plugin state from a previously serialised snapshot.
   *
   * Called by `kernel.restoreState()` with the object returned by `serialize()`.
   */
  restore?(state: Record<string, unknown>): void;

  /**
   * Migrate plugin state from an older version.
   *
   * Called by `kernel.restoreState()` when the saved plugin state version
   * is older than the current version. Implementations should return the
   * migrated state object.
   *
   * @param state - The serialised plugin state from the save.
   * @param fromVersion - The version the state was saved with.
   * @returns The migrated state, compatible with the current version.
   */
  migrateState?(state: Record<string, unknown>, fromVersion: number): Record<string, unknown>;

  /**
   * Return a snapshot of the plugin's internal state for developer tooling.
   *
   * Called by `kernel.inspect()`. Return a plain object with whatever
   * diagnostic data is useful (entity counts, queue lengths, etc.).
   */
  inspect?(): Record<string, unknown>;
}
