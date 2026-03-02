import { createPluginToken } from '@alife-sdk/core';
import type { IALifePlugin, ALifeKernel, IALifeKernelState } from '@alife-sdk/core';
import type { IStorageBackend } from '../ports/IStorageBackend';

/** Kernel plugin lookup token for {@link PersistencePlugin}. */
export const PersistencePluginToken = createPluginToken<PersistencePlugin>('persistence');

export interface IPersistencePluginConfig {
  backend: IStorageBackend;
  /** Storage key for the save slot. Default: 'alife_save'. */
  saveKey?: string;
}

/**
 * Returned by `PersistencePlugin.save()`.
 *
 * On success: `{ ok: true }`.
 * On failure: `{ ok: false; reason: ...; message: string }` with a machine-readable
 * reason code so the caller can decide how to react (log, retry, notify the user, etc.).
 */
export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'serialize_failed' | 'write_failed'; message: string };

/**
 * Returned by `PersistencePlugin.load()`.
 *
 * On success: `{ ok: true }`.
 * On failure: `{ ok: false; reason: ...; message: string }` with a machine-readable
 * reason code so the caller can decide how to react (log, show "no save found", etc.).
 */
export type LoadResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'parse_failed' | 'restore_failed'; message: string };

/**
 * Kernel plugin that wires save/load to a pluggable IStorageBackend.
 *
 * @example
 * ```ts
 * const persistence = new PersistencePlugin({ backend: new LocalStorageBackend() });
 * kernel.use(persistence);
 * kernel.init();
 *
 * // Save (e.g. F5):
 * const result = kernel.getPlugin(PersistencePluginToken).save();
 * if (!result.ok) console.error(result.reason, result.message);
 *
 * // Load (e.g. F9):
 * const result = kernel.getPlugin(PersistencePluginToken).load();
 * if (!result.ok) console.warn(result.reason, result.message);
 * ```
 */
export class PersistencePlugin implements IALifePlugin {
  readonly name = 'persistence';

  private readonly _backend: IStorageBackend;
  private readonly _saveKey: string;
  private _kernel: ALifeKernel | null = null;

  constructor(config: IPersistencePluginConfig) {
    this._backend = config.backend;
    this._saveKey = config.saveKey ?? 'alife_save';
  }

  install(kernel: ALifeKernel): void {
    this._kernel = kernel;
  }

  /**
   * Serialize kernel state and write to the backend.
   *
   * @returns `{ ok: true }` on success, or `{ ok: false, reason, message }` on failure.
   * @throws if called before `kernel.use(plugin)`.
   */
  save(): SaveResult {
    if (!this._kernel) {
      throw new Error('PersistencePlugin.save() called before install(). Call kernel.use(plugin) first.');
    }

    let serialized: string;
    try {
      const state = this._kernel.serialize();
      serialized = JSON.stringify(state);
    } catch (err) {
      return {
        ok: false,
        reason: 'serialize_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      this._backend.save(this._saveKey, serialized);
    } catch (err) {
      return {
        ok: false,
        reason: 'write_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    return { ok: true };
  }

  /**
   * Load state from the backend and restore into the kernel.
   *
   * @returns `{ ok: true }` on success, or `{ ok: false, reason, message }` on failure.
   * @throws if called before `kernel.use(plugin)`.
   */
  load(): LoadResult {
    if (!this._kernel) {
      throw new Error('PersistencePlugin.load() called before install(). Call kernel.use(plugin) first.');
    }

    const raw = this._backend.load(this._saveKey);
    if (raw === null) {
      return { ok: false, reason: 'not_found', message: `No save found at key "${this._saveKey}".` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        reason: 'parse_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (typeof (parsed as Record<string, unknown>)?.version !== 'number') {
      return { ok: false, reason: 'parse_failed', message: 'Save data is missing a valid version field.' };
    }

    const state = parsed as IALifeKernelState;
    try {
      this._kernel.restoreState(state);
    } catch (err) {
      return {
        ok: false,
        reason: 'restore_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    return { ok: true };
  }

  /** Returns true if a save slot exists in the backend. */
  hasSave(): boolean {
    return this._backend.has(this._saveKey);
  }

  /** Remove the save slot from the backend. */
  deleteSave(): void {
    this._backend.remove(this._saveKey);
  }
}
