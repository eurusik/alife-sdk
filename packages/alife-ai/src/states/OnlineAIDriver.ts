// states/OnlineAIDriver.ts
// Per-NPC coordinator for the online AI tick.
//
// Owns:
//   - A Map<stateId, IOnlineStateHandler> shared handler registry
//   - An INPCContext facade wired to drive FSM transitions
//
// Design: OnlineAIDriver does NOT use the core StateMachine (which works with
// IEntity + AIStateRegistry). Instead it owns a minimal FSM — a currentStateId
// string and direct enter/update/exit calls — to keep alife-ai independent of
// any entity or registry contract.
//
// The host (e.g. Phaser layer) calls:
//   1. update(deltaMs)  — each frame
//   2. destroy()        — when the entity is removed

import type { INPCContext } from './INPCContext';
import type { IOnlineStateHandler } from './IOnlineStateHandler';
import { StateHandlerMap } from './StateHandlerMap';

// ---------------------------------------------------------------------------
// IOnlineDriverHost — everything OnlineAIDriver needs from the caller
// ---------------------------------------------------------------------------

/**
 * Minimal host interface provided by the caller when constructing an
 * {@link OnlineAIDriver}.
 *
 * Omits `transition` and `currentStateId` from {@link INPCContext} because
 * those two fields are owned by the driver itself — it wraps `hostCtx` and
 * injects its own implementations.
 *
 * All other fields are delegated transparently to the host object.
 */
export type IOnlineDriverHost = Omit<INPCContext, 'transition' | 'currentStateId'>;

// ---------------------------------------------------------------------------
// OnlineAIDriver
// ---------------------------------------------------------------------------

/**
 * Per-NPC coordinator that drives a lightweight finite state machine over a
 * set of {@link IOnlineStateHandler} instances.
 *
 * Create one driver per active NPC entity and call {@link update} each frame.
 *
 * @example
 * ```ts
 * const handlers = buildDefaultHandlerMap();
 * const driver = new OnlineAIDriver(phaserNPCContext, handlers, 'IDLE');
 *
 * // Game loop:
 * driver.update(scene.game.loop.delta);
 *
 * // On NPC death / scene shutdown:
 * driver.destroy();
 * ```
 */
export class OnlineAIDriver {
  private readonly handlers: ReadonlyMap<string, IOnlineStateHandler>;
  private _currentStateId: string;
  private readonly ctx: INPCContext;

  /** True while a transition is in progress (guards against re-entrant transitions). */
  private _transitioning = false;

  /** True after destroy() has been called. Guards against use-after-destroy. */
  private _destroyed = false;

  constructor(
    host: IOnlineDriverHost,
    handlers: StateHandlerMap | ReadonlyMap<string, IOnlineStateHandler>,
    initialState: string,
  ) {
    this.handlers = handlers instanceof StateHandlerMap ? handlers.toMap() : handlers;
    this._currentStateId = initialState;

    // Build the wrapped context that intercepts transition() and currentStateId.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const driver = this;
    this.ctx = new DriverContext(host, driver);

    // Call enter() on the initial state.
    this.getHandler(initialState).enter(this.ctx);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Identifier of the currently active state. */
  get currentStateId(): string {
    return this._currentStateId;
  }

  /**
   * Run one frame of the AI.
   *
   * Calls `update(ctx, deltaMs)` on the current state handler.
   * If the handler called `ctx.transition()` the FSM will have already
   * performed exit/enter — no additional bookkeeping is required.
   *
   * @param deltaMs - Elapsed time since the last frame (milliseconds).
   */
  update(deltaMs: number): void {
    if (this._destroyed) return;
    this.getHandler(this._currentStateId).update(this.ctx, deltaMs);
  }

  /**
   * Exit the current state.
   *
   * Call when the NPC entity is destroyed or the scene shuts down.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.getHandler(this._currentStateId).exit(this.ctx);
  }

  // -------------------------------------------------------------------------
  // Internal — called by DriverContext
  // -------------------------------------------------------------------------

  /** @internal Called by {@link DriverContext.transition}. */
  _doTransition(newStateId: string): void {
    if (this._transitioning) {
      // Re-entrant guard: a transition triggered while another is in progress
      // is silently ignored to prevent stack overflow in pathological handlers.
      return;
    }

    this._transitioning = true;
    try {
      this.getHandler(this._currentStateId).exit(this.ctx);
      this._currentStateId = newStateId;
      this.getHandler(newStateId).enter(this.ctx);
    } finally {
      this._transitioning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getHandler(stateId: string): IOnlineStateHandler {
    const h = this.handlers.get(stateId);
    if (!h) {
      throw new Error(`OnlineAIDriver: no handler registered for state "${stateId}"`);
    }
    return h;
  }
}

// ---------------------------------------------------------------------------
// DriverContext — internal INPCContext wrapper
// ---------------------------------------------------------------------------

/**
 * Internal wrapper that delegates all INPCContext members to the host object
 * except `currentStateId` and `transition`, which are owned by the driver.
 *
 * Using a class (rather than an object literal) lets us refer to it by type
 * internally and avoids closure-per-field allocation on hot paths.
 *
 * @internal
 */
class DriverContext implements INPCContext {
  constructor(
    private readonly host: IOnlineDriverHost,
    private readonly driver: OnlineAIDriver,
  ) {}

  // Identity
  get npcId() { return this.host.npcId; }
  get factionId() { return this.host.factionId; }
  get entityType() { return this.host.entityType; }

  // Position
  get x() { return this.host.x; }
  get y() { return this.host.y; }

  // Mutable AI state bag
  get state() { return this.host.state; }

  // Optional subsystems
  get perception() { return this.host.perception; }
  get health() { return this.host.health; }
  get cover() { return this.host.cover; }
  get danger() { return this.host.danger; }
  get restrictedZones() { return this.host.restrictedZones; }
  get squad() { return this.host.squad; }
  get pack() { return this.host.pack; }
  get conditions() { return this.host.conditions; }
  get suspicion() { return this.host.suspicion; }

  // Movement & rendering — delegate to host
  setVelocity(vx: number, vy: number): void { this.host.setVelocity(vx, vy); }
  halt(): void { this.host.halt(); }
  setRotation(r: number): void { this.host.setRotation(r); }
  setAlpha(a: number): void { this.host.setAlpha(a); }
  teleport(x: number, y: number): void { this.host.teleport(x, y); }
  disablePhysics(): void { this.host.disablePhysics(); }

  // FSM control — owned by driver
  get currentStateId(): string { return this.driver.currentStateId; }
  transition(newStateId: string): void { this.driver._doTransition(newStateId); }

  // Event emission — delegate to host
  emitShoot(p: Parameters<INPCContext['emitShoot']>[0]): void { this.host.emitShoot(p); }
  emitMeleeHit(p: Parameters<INPCContext['emitMeleeHit']>[0]): void { this.host.emitMeleeHit(p); }
  emitVocalization(t: string): void { this.host.emitVocalization(t); }
  emitPsiAttackStart(x: number, y: number): void { this.host.emitPsiAttackStart(x, y); }

  // Utilities — delegate to host
  now(): number { return this.host.now(); }
  random(): number { return this.host.random(); }
}
