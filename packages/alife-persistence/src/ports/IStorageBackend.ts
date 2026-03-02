/**
 * Synchronous string key-value storage port.
 *
 * Implement this interface to provide a storage backend for PersistencePlugin:
 * - Browser: `localStorage` / `sessionStorage`
 * - Node.js / Electron: `fs.writeFileSync` wrapper
 * - Tests: `MemoryStorageProvider` (zero dependencies)
 *
 * NOTE: This interface is intentionally synchronous. For async backends
 * (IndexedDB, remote API), wrap with a sync cache layer or use a separate
 * async persistence strategy outside of PersistencePlugin.
 */
export interface IStorageBackend {
  save(key: string, data: string): void;
  load(key: string): string | null;
  remove(key: string): void;
  has(key: string): boolean;
}
