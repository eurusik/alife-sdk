import type { IStorageBackend } from '../ports/IStorageBackend';

/**
 * In-memory IStorageBackend implementation.
 *
 * Intended for unit tests and Node.js environments where no persistent
 * storage is needed. Zero browser or filesystem dependencies.
 *
 * Provides `clear()` and `size()` as test helpers beyond the IStorageBackend contract.
 */
export class MemoryStorageProvider implements IStorageBackend {
  private readonly _store = new Map<string, string>();

  save(key: string, data: string): void {
    this._store.set(key, data);
  }

  load(key: string): string | null {
    return this._store.get(key) ?? null;
  }

  remove(key: string): void {
    this._store.delete(key);
  }

  has(key: string): boolean {
    return this._store.has(key);
  }

  /** Remove all entries. Useful for test teardown. */
  clear(): void {
    this._store.clear();
  }

  /** Number of stored entries. Useful for test assertions. */
  size(): number {
    return this._store.size;
  }
}
