/**
 * Type-safe plugin retrieval token.
 *
 * Associates a plugin name string with its concrete class type,
 * eliminating magic strings and unsafe generic casts in `getPlugin()`.
 *
 * @example
 * ```ts
 * const MY_PLUGIN = createPluginToken<MyPlugin>('myPlugin');
 * kernel.use(new MyPlugin());
 * const p = kernel.getPlugin(MY_PLUGIN); // typed as MyPlugin
 * ```
 */

import type { IALifePlugin } from './IALifePlugin';

// ---------------------------------------------------------------------------
// PluginToken
// ---------------------------------------------------------------------------

export interface PluginToken<T extends IALifePlugin> {
  readonly name: string;
  /** @internal Phantom field for type inference — never set at runtime. */
  readonly _phantom?: T;
}

/**
 * Create a typed plugin token for use with `kernel.getPlugin()`.
 *
 * @param name - Plugin name string (must match `plugin.name`).
 */
export function createPluginToken<T extends IALifePlugin>(name: string): PluginToken<T> {
  return { name };
}
