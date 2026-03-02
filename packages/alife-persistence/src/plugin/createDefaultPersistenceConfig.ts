import type { IStorageBackend } from '../ports/IStorageBackend';
import type { IPersistencePluginConfig } from './PersistencePlugin';

/**
 * Create a default IPersistencePluginConfig with sensible defaults.
 *
 * All other SDK packages expose a factory like this so consumers don't
 * have to remember required fields and their default values.
 *
 * @param backend - The storage backend to use (e.g. LocalStorageBackend, MemoryStorageProvider).
 * @param overrides - Optional overrides for any field except `backend`.
 *
 * @example
 * ```ts
 * const config = createDefaultPersistenceConfig(new LocalStorageBackend());
 * const plugin = new PersistencePlugin(config);
 * kernel.use(plugin);
 * ```
 */
export function createDefaultPersistenceConfig(
  backend: IStorageBackend,
  overrides?: Partial<Omit<IPersistencePluginConfig, 'backend'>>,
): IPersistencePluginConfig {
  return {
    backend,
    saveKey: 'alife_save',
    ...overrides,
  };
}
