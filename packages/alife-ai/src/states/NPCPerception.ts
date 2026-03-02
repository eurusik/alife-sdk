// states/NPCPerception.ts
// Concrete implementation of INPCPerception that wraps a simple data store.
//
// The host (e.g. PhaserNPCContext) calls sync() each frame after running the
// scene-level perception system to push fresh enemy/ally/item snapshots.
// State handlers then call the standard INPCPerception query methods — they
// never see the internal arrays directly.
//
// Defensive copying: sync() takes read-only arrays but stores shallow copies
// internally. Mutations of the input arrays after sync() do not affect the
// stored snapshots; mutations of the returned ReadonlyArray views do not affect
// internal storage either.

import type { INPCPerception } from './INPCContext';

// ---------------------------------------------------------------------------
// Internal data types
// ---------------------------------------------------------------------------

/**
 * A single visible entity as stored and returned by NPCPerception.
 * Used for both enemies and allies.
 */
export interface IVisibleEntity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly factionId: string;
}

/**
 * A single item visible or in the NPC's vicinity.
 */
export interface INearbyItem {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly type: string;
}

// ---------------------------------------------------------------------------
// NPCPerception
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of {@link INPCPerception}.
 *
 * Stores a per-frame snapshot of the NPC's world awareness.
 * The host calls {@link sync} to update the snapshot each frame before
 * state handlers run.
 *
 * @example
 * ```ts
 * const perception = new NPCPerception();
 *
 * // Called by the host after ScenePerceptionSystem.update():
 * perception.sync(visibleEnemies, visibleAllies, nearbyItems);
 *
 * // Called by state handlers:
 * if (perception.hasVisibleEnemy()) {
 *   ctx.transition('COMBAT');
 * }
 * ```
 */
export class NPCPerception implements INPCPerception {
  private _visibleEnemies: IVisibleEntity[] = [];
  private _visibleAllies: IVisibleEntity[] = [];
  private _nearbyItems: INearbyItem[] = [];

  // -------------------------------------------------------------------------
  // Host API
  // -------------------------------------------------------------------------

  /**
   * Push a fresh perception snapshot.
   *
   * Called by the host (e.g. PhaserNPCContext) each frame after the
   * scene-level perception system has run. Creates internal shallow copies of
   * all three arrays so neither the caller nor the state handlers can alias
   * the stored data.
   *
   * @param enemies - All visible hostile entities this frame.
   * @param allies  - All visible friendly entities this frame.
   * @param items   - All nearby items this frame.
   */
  sync(
    enemies: ReadonlyArray<IVisibleEntity>,
    allies: ReadonlyArray<IVisibleEntity>,
    items: ReadonlyArray<INearbyItem>,
  ): void {
    this._visibleEnemies = [...enemies];
    this._visibleAllies = [...allies];
    this._nearbyItems = [...items];
  }

  /**
   * Clear all perception data.
   * Equivalent to calling sync([], [], []).
   */
  clear(): void {
    this._visibleEnemies = [];
    this._visibleAllies = [];
    this._nearbyItems = [];
  }

  // -------------------------------------------------------------------------
  // INPCPerception implementation
  // -------------------------------------------------------------------------

  /**
   * All visible enemies this frame.
   *
   * Returns the internal array cast as ReadonlyArray — no additional copy is
   * made, so this is O(1). The contents are stable for the current frame.
   */
  getVisibleEnemies(): ReadonlyArray<{ id: string; x: number; y: number; factionId: string }> {
    return this._visibleEnemies;
  }

  /**
   * All visible allied NPCs this frame.
   *
   * Returns the internal array cast as ReadonlyArray — O(1).
   */
  getVisibleAllies(): ReadonlyArray<{ id: string; x: number; y: number }> {
    return this._visibleAllies;
  }

  /**
   * All nearby items this frame.
   *
   * Returns the internal array cast as ReadonlyArray — O(1).
   */
  getNearbyItems(): ReadonlyArray<{ id: string; x: number; y: number; type: string }> {
    return this._nearbyItems;
  }

  /**
   * Returns true if at least one visible enemy is in the snapshot.
   * O(1) — length check only.
   */
  hasVisibleEnemy(): boolean {
    return this._visibleEnemies.length > 0;
  }

  // -------------------------------------------------------------------------
  // Convenience queries (not part of INPCPerception but useful for tests)
  // -------------------------------------------------------------------------

  /** Total number of visible enemies. */
  get enemyCount(): number {
    return this._visibleEnemies.length;
  }

  /** Total number of visible allies. */
  get allyCount(): number {
    return this._visibleAllies.length;
  }

  /** Total number of nearby items. */
  get itemCount(): number {
    return this._nearbyItems.length;
  }
}
