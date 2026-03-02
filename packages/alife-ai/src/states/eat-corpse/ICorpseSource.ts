// states/eat-corpse/ICorpseSource.ts
// Host-implemented corpse discovery and consumption interface.
// The SDK never creates, stores, or destroys corpse records.

/**
 * A single corpse available for consumption.
 *
 * Populated by the host from its own entity system.
 * `healAmount` is per-corpse so different enemy types can yield
 * different rewards (e.g. boar corpse > dog corpse).
 * `corpseType` is a passthrough tag — the SDK ignores it, but the host
 * may use it inside `findCorpses()` to filter by edibility.
 */
export interface ICorpseRecord {
  /** Stable entity ID of the corpse. */
  readonly id: string;
  /** World X of the corpse (px). */
  readonly x: number;
  /** World Y of the corpse (px). */
  readonly y: number;
  /**
   * HP to restore to the eating NPC on successful consumption.
   * 0 means no HP reward (morale boost still applies).
   */
  readonly healAmount: number;
  /**
   * Optional tag for host-side filtering (e.g. 'human', 'animal').
   * The SDK never reads this field.
   */
  readonly corpseType?: string;
}

/**
 * Callback interface the host injects into `EatCorpseState`.
 *
 * Mirrors the `emitMeleeHit()` / `emitShoot()` pattern:
 * the SDK declares intent (`consumeCorpse`) and the host executes the
 * side-effect (entity removal, loot drop, etc.).
 *
 * @example
 * ```ts
 * // Phaser layer implementation:
 * const corpseSource: ICorpseSource = {
 *   findCorpses(npcId, x, y, radius) {
 *     return spatialGrid.query(x, y, radius)
 *       .filter(e => e.type === 'corpse')
 *       .map(e => ({ id: e.id, x: e.x, y: e.y, healAmount: 20 }));
 *   },
 *   consumeCorpse(_npcId, corpseId) {
 *     const entity = scene.getEntityById(corpseId);
 *     if (!entity) return false;
 *     entity.destroy();
 *     return true;
 *   },
 * };
 * ```
 */
export interface ICorpseSource {
  /**
   * Return corpses within `radius` px of the NPC, sorted nearest-first.
   *
   * @param npcId  - ID of the requesting NPC (for ownership checks if needed).
   * @param x      - Searcher world X.
   * @param y      - Searcher world Y.
   * @param radius - Search radius (px).
   */
  findCorpses(
    npcId: string,
    x: number,
    y: number,
    radius: number,
  ): ReadonlyArray<ICorpseRecord>;

  /**
   * Mark a corpse as consumed (remove it from the world).
   *
   * Called by `EatCorpseState` after the eating timer completes.
   * If `corpseId` was already removed (race with another NPC or despawn),
   * return `false` — the SDK will skip the heal and morale reward.
   *
   * @param npcId    - ID of the consuming NPC.
   * @param corpseId - ID of the corpse to remove.
   * @returns `true` if the corpse was successfully consumed, `false` if it
   *          was already gone (duplicate eat, early despawn, etc.).
   *
   * @example
   * ```ts
   * consumeCorpse(_npcId, corpseId) {
   *   const entity = scene.getEntityById(corpseId);
   *   if (!entity) return false;
   *   entity.destroy();
   *   return true;
   * },
   * ```
   */
  consumeCorpse(npcId: string, corpseId: string): boolean;
}
