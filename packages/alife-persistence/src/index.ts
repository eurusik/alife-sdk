// @alife-sdk/persistence — public API barrel
export type { IStorageBackend } from './ports/IStorageBackend';
export { MemoryStorageProvider } from './providers/MemoryStorageProvider';
export { PersistencePlugin, PersistencePluginToken } from './plugin/PersistencePlugin';
export type { IPersistencePluginConfig, SaveResult, LoadResult } from './plugin/PersistencePlugin';
export { createDefaultPersistenceConfig } from './plugin/createDefaultPersistenceConfig';
