/**
 * ReactiveQuery — observe when entities enter and exit a filtered set.
 *
 * Instead of polling the entire entity set every frame, a ReactiveQuery
 * maintains a stable "matched" set and fires change notifications only when
 * entities enter or leave the query (i.e. when the predicate result changes).
 *
 * Usage pattern:
 *   1. Create a query with a predicate.
 *   2. Subscribe to `onChange` to react to structural changes.
 *   3. Call `update(allEntities)` each tick to re-evaluate.
 *
 * @example
 * ```ts
 * const hostileQuery = new ReactiveQuery<IEntity>(
 *   (e) => e.isAlive && e.hasComponent('hostile')
 * );
 *
 * hostileQuery.onChange(({ added, removed }) => {
 *   added.forEach(e => combatSystem.track(e));
 *   removed.forEach(e => combatSystem.untrack(e));
 * });
 *
 * // Each tick:
 * hostileQuery.update(world.entities());
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Changes detected since the last `update()` call. */
export interface QueryChanges<T> {
  /** Entities that newly matched the predicate this update. */
  readonly added: readonly T[];
  /** Entities that no longer match the predicate this update. */
  readonly removed: readonly T[];
  /** All entities currently matching the predicate after this update. */
  readonly current: readonly T[];
}

/** Callback invoked when any entities are added or removed from the query. */
export type QueryChangeListener<T> = (changes: QueryChanges<T>) => void;

// ---------------------------------------------------------------------------
// ReactiveQuery
// ---------------------------------------------------------------------------

/**
 * Tracks which entities satisfy a predicate and fires change events when
 * the matched set changes.
 */
export class ReactiveQuery<T> {
  private matched = new Set<T>();
  private readonly listeners = new Set<QueryChangeListener<T>>();

  constructor(private readonly predicate: (entity: T) => boolean) {}

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Re-evaluate the predicate against `allEntities`.
   *
   * Fires `onChange` listeners if the matched set changed.
   * Call this once per tick from the owning system.
   */
  update(allEntities: Iterable<T>): void {
    const added: T[] = [];
    const removed: T[] = [];
    const nextMatched = new Set<T>();

    for (const entity of allEntities) {
      if (this.predicate(entity)) {
        nextMatched.add(entity);
        if (!this.matched.has(entity)) {
          added.push(entity);
        }
      }
    }

    for (const entity of this.matched) {
      if (!nextMatched.has(entity)) {
        removed.push(entity);
      }
    }

    // Commit new matched set
    this.matched = nextMatched;

    if (added.length > 0 || removed.length > 0) {
      const changes: QueryChanges<T> = {
        added,
        removed,
        current: [...this.matched],
      };
      for (const listener of this.listeners) {
        listener(changes);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /**
   * Subscribe to change events. Called whenever entities enter or exit the
   * matched set.
   *
   * @returns Unsubscribe function.
   */
  onChange(listener: QueryChangeListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** All entities currently matching the predicate (stable snapshot). */
  get current(): readonly T[] {
    return [...this.matched];
  }

  /** Number of currently matched entities. */
  get size(): number {
    return this.matched.size;
  }

  /** Return `true` if the entity is currently in the matched set. */
  has(entity: T): boolean {
    return this.matched.has(entity);
  }

  /**
   * Manually add an entity to the matched set without re-evaluating the
   * predicate. Fires `onChange` with the single addition.
   *
   * Useful when external code creates entities and knows they should match.
   */
  track(entity: T): void {
    if (this.matched.has(entity)) return;
    this.matched.add(entity);
    const changes: QueryChanges<T> = {
      added: [entity],
      removed: [],
      current: [...this.matched],
    };
    for (const listener of this.listeners) {
      listener(changes);
    }
  }

  /**
   * Manually remove an entity from the matched set.
   * Fires `onChange` with the single removal.
   *
   * Useful when entities are destroyed mid-tick.
   */
  untrack(entity: T): void {
    if (!this.matched.has(entity)) return;
    this.matched.delete(entity);
    const changes: QueryChanges<T> = {
      added: [],
      removed: [entity],
      current: [...this.matched],
    };
    for (const listener of this.listeners) {
      listener(changes);
    }
  }

  /** Remove all entities and clear all listeners. */
  dispose(): void {
    this.matched.clear();
    this.listeners.clear();
  }
}
