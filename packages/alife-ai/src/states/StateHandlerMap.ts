// states/StateHandlerMap.ts
// Fluent registry for online state handlers.
//
// Usage:
//   const handlers = buildDefaultHandlerMap(cfg, tr)
//     .register('HUNT', new HuntState(cfg))
//     .register('AMBUSH', new AmbushState(cfg));
//
//   const driver = new OnlineAIDriver(ctx, handlers, 'IDLE');

import type { IOnlineStateHandler } from './IOnlineStateHandler';

/**
 * Type-safe registry for online NPC state handlers.
 *
 * Wraps a Map<string, IOnlineStateHandler> with a fluent API to make
 * custom state registration explicit and discoverable.
 *
 * @example
 * ```ts
 * // Zombie game with custom states
 * const handlers = buildDefaultHandlerMap(cfg, {
 *   combatOnPanicked: 'shamble_away',
 *   monsterOnNoEnemy: 'wander',
 * })
 *   .register('HUNT', new HuntState(cfg))
 *   .register('shamble_away', new ShamblingFleeState(cfg))
 *   .extend(buildMonsterHandlerMap(cfg));
 * ```
 */
export class StateHandlerMap {
  private readonly _map: Map<string, IOnlineStateHandler>;

  constructor(entries?: Iterable<[string, IOnlineStateHandler]>) {
    this._map = new Map(entries);
  }

  /**
   * Register a handler for a state ID.
   * Overwrites any existing handler for that ID.
   * Returns `this` for fluent chaining.
   */
  register(stateId: string, handler: IOnlineStateHandler): this {
    this._map.set(stateId, handler);
    return this;
  }

  /**
   * Merge all handlers from another StateHandlerMap or Map.
   * Existing IDs in `this` are NOT overwritten — use {@link register} for targeted overrides.
   * Returns `this` for fluent chaining.
   */
  extend(other: StateHandlerMap | Map<string, IOnlineStateHandler>): this {
    const source = other instanceof StateHandlerMap ? other._map : other;
    for (const [id, handler] of source) {
      if (!this._map.has(id)) {
        this._map.set(id, handler);
      }
    }
    return this;
  }

  /**
   * Override all handlers from another StateHandlerMap or Map.
   * Existing IDs in `this` ARE overwritten.
   * Returns `this` for fluent chaining.
   */
  override(other: StateHandlerMap | Map<string, IOnlineStateHandler>): this {
    const source = other instanceof StateHandlerMap ? other._map : other;
    for (const [id, handler] of source) {
      this._map.set(id, handler);
    }
    return this;
  }

  /** Returns the handler registered for `stateId`, or undefined. */
  get(stateId: string): IOnlineStateHandler | undefined {
    return this._map.get(stateId);
  }

  /** Returns true if a handler for `stateId` is registered. */
  has(stateId: string): boolean {
    return this._map.has(stateId);
  }

  /** Number of registered handlers. */
  get size(): number {
    return this._map.size;
  }

  /** Iterate over all [stateId, handler] pairs. */
  [Symbol.iterator](): IterableIterator<[string, IOnlineStateHandler]> {
    return this._map[Symbol.iterator]();
  }

  /** Returns the underlying Map (read-only view). */
  toMap(): ReadonlyMap<string, IOnlineStateHandler> {
    return this._map;
  }
}
