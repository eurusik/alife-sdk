import type { Vec2 } from '../core/Vec2';

// ---------------------------------------------------------------------------
// IEntityQuery — read-only entity state queries (used by simulation + AI)
// ---------------------------------------------------------------------------

/** Read-only queries on entity state. No side effects. */
export interface IEntityQuery {
  /** Return world position (px), or `null` if entity no longer exists. */
  getPosition(entityId: string): Vec2 | null;
  /** Return `true` if entity exists and is alive. */
  isAlive(entityId: string): boolean;
  /** Check if entity has the named component. */
  hasComponent(entityId: string, componentName: string): boolean;
  /** Read a component value. Returns `null` if missing. */
  getComponentValue<T>(entityId: string, componentName: string): T | null;
  /** Read arbitrary metadata. Optional — return `undefined` when unsupported. */
  getMetadata?(entityId: string, key: string): unknown;
}

// ---------------------------------------------------------------------------
// IEntityMutation — state changes for simulation (offline + online)
// ---------------------------------------------------------------------------

/** Mutate entity state: position, velocity, rotation, visibility, activity. */
export interface IEntityMutation {
  /** Move entity to world coordinates (px). */
  setPosition(entityId: string, position: Vec2): void;
  /** Enable/disable entity. Inactive entities skip physics and rendering. */
  setActive(entityId: string, active: boolean): void;
  /** Show/hide entity. Separate from active (e.g. stealth = active + invisible). */
  setVisible(entityId: string, visible: boolean): void;
  /** Write arbitrary metadata. Optional — no-op when unsupported. */
  setMetadata?(entityId: string, key: string, value: unknown): void;
  /** Set physics velocity (px/s). FSM guarantees single-writer per entity/frame. */
  setVelocity(entityId: string, velocity: Vec2): void;
  /** Current physics velocity. Returns {x:0,y:0} for unknown IDs. */
  getVelocity(entityId: string): Vec2;
  /** Set facing rotation (radians, clockwise from +X). */
  setRotation(entityId: string, radians: number): void;
  /** Teleport entity instantly — bypasses physics interpolation. */
  teleport(entityId: string, position: Vec2): void;
  /** Disable physics body (corpses, death state). */
  disablePhysics(entityId: string): void;
}

// ---------------------------------------------------------------------------
// IEntityRendering — rendering-only operations (online AI only)
// ---------------------------------------------------------------------------

/** Rendering operations. Only needed by online AI, not by offline simulation. */
export interface IEntityRendering {
  /** Set transparency (0=invisible, 1=opaque). For stealth mechanics. */
  setAlpha(entityId: string, alpha: number): void;
  /** Play a named animation. When `ignoreIfPlaying` is true (default), skip if already playing this key. */
  playAnimation(entityId: string, key: string, ignoreIfPlaying?: boolean): void;
  /** Check if animation key exists for this entity. */
  hasAnimation(entityId: string, key: string): boolean;
}

// ---------------------------------------------------------------------------
// IEntityAdapter — full interface for game engines (union of all three)
// ---------------------------------------------------------------------------

/**
 * Full bridge between SDK and host game engine.
 *
 * Consumers that only need read access can depend on {@link IEntityQuery}.
 * Offline simulation needs {@link IEntityQuery} + {@link IEntityMutation}.
 * Online AI needs all three.
 */
export interface IEntityAdapter extends IEntityQuery, IEntityMutation, IEntityRendering {}

/** @deprecated Use IEntityRendering instead. */
export type IEntityPresentation = IEntityRendering;

/**
 * Create a no-op {@link IEntityAdapter} with safe default behaviour.
 *
 * Safe defaults:
 * - `getPosition` returns `null` — no world position.
 * - `isAlive` returns `true` — all entities considered alive.
 * - `hasComponent` returns `false` — no components present.
 * - `getComponentValue` returns `null` — no component values.
 * - `getVelocity` returns `{x:0,y:0}` — zero velocity.
 * - `hasAnimation` returns `false` — no animations available.
 * - All mutation/rendering methods are no-ops.
 *
 * @example
 * // Unit-testing kernel logic without a full game engine:
 * kernel.provide(Ports.EntityAdapter, createNoOpEntityAdapter());
 */
export function createNoOpEntityAdapter(): IEntityAdapter {
  return {
    getPosition: () => null,
    isAlive: () => true,
    hasComponent: () => false,
    getComponentValue: () => null,
    setPosition: () => {},
    setActive: () => {},
    setVisible: () => {},
    setVelocity: () => {},
    getVelocity: () => ({ x: 0, y: 0 }),
    setRotation: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    setAlpha: () => {},
    playAnimation: () => {},
    hasAnimation: () => false,
  };
}
