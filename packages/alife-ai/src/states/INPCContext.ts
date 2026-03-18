// states/INPCContext.ts
// Facade interface that online state handlers use to interact with an NPC.
//
// Design goals:
//   - Zero framework dependencies — no Phaser, no DOM, no Node APIs.
//   - Thin seams for each subsystem (perception, health, cover, etc.) so the
//     host implementation (PhaserNPCContext) wires them in lazily.
//   - All subsystems are optional (nullable) — state handlers must gracefully
//     degrade when a subsystem is absent (e.g. tests that mock only a subset).
//
// Usage pattern:
//   1. Host (Phaser layer) implements INPCContext on a per-entity wrapper.
//   2. State handlers receive INPCContext in enter/update/exit — no direct
//      Entity or Phaser.Physics.Arcade.Body references.
//   3. Tests provide a minimal mock implementing only the fields they need.

import type { INPCOnlineState } from './INPCOnlineState';
import type { ISharedTargetInfo } from '../squad/SquadSharedTarget';
import type { ConditionChannel } from '../conditions/ConditionBank';
import type { SuspicionStimulus } from '../suspicion/SuspicionAccumulator';
import type { IPackAccess } from './pack/IPackAccess';

// ---------------------------------------------------------------------------
// Sub-interfaces — optional seams for each AI subsystem
// ---------------------------------------------------------------------------

/**
 * Snapshot of what the NPC can currently see and hear.
 *
 * Populated by the host's perception system (e.g. ScenePerceptionSystem) before
 * each state handler update. State handlers call these methods to drive
 * threat detection and target acquisition.
 */
export interface INPCPerception {
  /**
   * All visible enemies this frame.
   * Returns a read-only snapshot — do not hold references across frames.
   */
  getVisibleEnemies(): ReadonlyArray<{ id: string; x: number; y: number; factionId: string }>;

  /**
   * All visible allied NPCs this frame.
   * Returns a read-only snapshot — do not hold references across frames.
   */
  getVisibleAllies(): ReadonlyArray<{ id: string; x: number; y: number }>;

  /**
   * Items visible or in immediate vicinity of the NPC.
   * Returns a read-only snapshot.
   */
  getNearbyItems(): ReadonlyArray<{ id: string; x: number; y: number; type: string }>;

  /** Quick guard — returns true if there is at least one visible enemy. */
  hasVisibleEnemy(): boolean;

  /**
   * Allied NPCs that are wounded (below HP threshold) this frame.
   *
   * Opt-in — implement only when using `HelpWoundedState`. Omitting this method
   * (or returning an empty array) disables the help-wounded seam in PatrolState /
   * IdleState without any code changes.
   */
  getWoundedAllies?(): ReadonlyArray<{ id: string; x: number; y: number; hpPercent: number }>;

  /**
   * Visible enemy NPCs that are wounded (below HP threshold) this frame.
   *
   * Opt-in — implement only when using `KillWoundedState`. Omitting this method
   * (or returning an empty array) disables the kill-wounded seam in CombatState /
   * AlertState without any code changes.
   *
   * The host should filter `getVisibleEnemies()` to those whose HP is below
   * `cfg.killWoundedEnemyHpThreshold` and that are still alive.
   */
  getWoundedEnemies?(): ReadonlyArray<{ id: string; x: number; y: number; hpPercent: number }>;

  /**
   * Dead allied NPCs (corpses) visible this frame.
   *
   * Opt-in — implement only when enabling corpse-detection suspicion accumulation
   * in PatrolState / IdleState. Omitting this method disables the seam silently.
   *
   * **Host contract — deduplication is the host's responsibility.**
   * PatrolState and IdleState call `suspicion.add(BODY_FOUND, ...)` for every
   * corpse returned here, every frame. To prevent an infinite
   * PATROL → ALERT → PATROL oscillation when the same corpse remains visible
   * across multiple PATROL entries, the host must filter out corpses that the
   * NPC has already reacted to (e.g. by maintaining a per-NPC `Set<string>` of
   * known corpse IDs and only returning new ones).
   */
  getVisibleCorpses?(): ReadonlyArray<{ id: string; x: number; y: number }>;
}

/**
 * Read/write access to the NPC's health.
 *
 * Exposed as a separate seam so state handlers (e.g. WoundedState) can
 * trigger heals without needing a direct reference to HealthComponent.
 */
export interface INPCHealth {
  /** Current hit points. */
  readonly hp: number;

  /** Maximum hit points. */
  readonly maxHp: number;

  /** Current HP expressed as a ratio in [0, 1]. */
  readonly hpPercent: number;

  /**
   * Apply a heal for the given amount.
   * Clamps the result to maxHp.
   *
   * @param amount - Positive number of HP to restore.
   */
  heal(amount: number): void;
}

/**
 * Cover point query interface.
 *
 * Wraps the engine-specific CoverRegistry / CoverSystem so state handlers
 * can request a cover position without a direct scene reference.
 */
export interface ICoverAccess {
  /**
   * Find the best available cover point near the given position.
   *
   * @param x       - Searcher world X.
   * @param y       - Searcher world Y.
   * @param enemyX  - Enemy world X (cover must hide from this direction).
   * @param enemyY  - Enemy world Y.
   * @param type    - Optional cover evaluator type hint (e.g. 'close', 'far', 'balanced', 'ambush', 'safe').
   * @returns Cover point world position, or null if no suitable cover is found.
   */
  findCover(
    x: number,
    y: number,
    enemyX: number,
    enemyY: number,
    type?: string,
  ): { x: number; y: number } | null;

  /**
   * Lock the most recently returned cover point for a given NPC.
   *
   * Called by state handlers immediately after a successful `findCover`.
   * Implementations that wrap `CoverRegistry` with a `CoverLockRegistry` should
   * store the last returned `ICoverPoint.id` and acquire a TTL lock here.
   *
   * No-op if the implementation does not support locking (optional method).
   * State handlers use optional chaining: `ctx.cover?.lockLastFound?.(npcId)`.
   *
   * @returns true if the lock was acquired or refreshed, false if contested.
   *          Returns true (vacuous success) when locking is not supported.
   */
  lockLastFound?(npcId: string, ttlMs?: number): boolean;

  /**
   * Release all cover locks held by the given NPC.
   *
   * Called by state handlers in `exit()` to free the point immediately
   * rather than waiting for TTL expiry.
   *
   * No-op if the implementation does not support locking (optional method).
   */
  unlockAll?(npcId: string): void;
}

/**
 * Danger-level query interface.
 *
 * Wraps the engine-specific DangerManager so state handlers can check
 * threat levels without importing game-layer classes.
 */
export interface IDangerAccess {
  /**
   * Return the aggregate threat score at the given position in [0, 1].
   *
   * @param x - World X to query.
   * @param y - World Y to query.
   */
  getDangerLevel(x: number, y: number): number;

  /**
   * Return active grenade/explosion danger affecting the given position, or null.
   *
   * @param x - World X to query.
   * @param y - World Y to query.
   * @returns Danger descriptor with its origin, or null if no active danger.
   */
  getGrenadeDanger(
    x: number,
    y: number,
  ): { active: boolean; originX: number; originY: number } | null;
}

/**
 * Restricted zone query interface.
 *
 * Wraps the engine-specific RestrictedZoneManager so state handlers can
 * check movement constraints without a direct manager reference.
 */
export interface IRestrictedZoneAccess {
  /**
   * Return true if the position satisfies all hard movement constraints.
   *
   * @param x - World X to test.
   * @param y - World Y to test.
   */
  isAccessible(x: number, y: number): boolean;

  /**
   * Filter a list of waypoints to those in accessible positions.
   *
   * @param points - Candidate world positions.
   * @returns Subset that passes all hard constraints.
   */
  filterAccessible(
    points: ReadonlyArray<{ x: number; y: number }>,
  ): Array<{ x: number; y: number }>;
}

/**
 * Condition state accessor.
 *
 * Wraps the per-NPC {@link ConditionBank} so state handlers can read
 * HP-independent condition levels (radiation, bleeding, etc.) without
 * importing the ConditionBank class directly.
 *
 * The host implements this interface by delegating to `ConditionBank`.
 * If not provided (`ctx.conditions === null`), all state handler checks
 * silently no-op via optional chaining.
 */
export interface IConditionAccess {
  /**
   * Current intensity of the given condition channel.
   * Returns `0` if the channel has never been applied or has fully recovered.
   *
   * @param channel - Any string channel key (e.g. 'radiation', 'stamina').
   */
  getLevel(channel: ConditionChannel): number;

  /**
   * Apply a condition effect to this NPC.
   *
   * **Host use only.** State handlers read conditions via `hasCondition()` / `getLevel()` only.
   *
   * Used by the host when an NPC takes damage from an anomaly, bleeds, etc.
   * Clamped to the configured `maxLevel`.
   *
   * @param channel - Target condition channel.
   * @param amount  - Positive amount to add.
   */
  apply(channel: ConditionChannel, amount: number): void;

  /**
   * Returns `true` if the channel intensity is **strictly greater than**
   * the given threshold.
   *
   * @param channel   - Condition channel to check.
   * @param threshold - Exclusive lower bound. @default 0
   */
  hasCondition(channel: ConditionChannel, threshold?: number): boolean;
}

/**
 * Suspicion level accessor.
 *
 * Wraps the per-NPC {@link SuspicionAccumulator} so state handlers can check
 * accumulated threat intensity without importing the accumulator class.
 *
 * The host implements this interface by delegating to `SuspicionAccumulator`.
 * If not provided (`ctx.suspicion === null`), all state handler checks
 * silently no-op via optional chaining.
 */
export interface ISuspicionAccess {
  /** Current suspicion level in `[0, maxLevel]`. */
  getLevel(): number;

  /**
   * Returns `true` if the current level is **strictly greater than**
   * the given threshold.
   *
   * @param threshold - Exclusive comparison value. Defaults to configured maxLevel.
   */
  hasReachedAlert(threshold?: number): boolean;

  /**
   * Last threat position associated with a suspicion stimulus.
   * Returns `null` if no position has been provided.
   */
  getLastKnownPosition(): { x: number; y: number } | null;

  /**
   * Add suspicion from a stimulus event.
   *
   * **Host use only.** State handlers read via `hasReachedAlert()` / `getLevel()` only.
   *
   * @param stimulus - Type of stimulus (semantic label).
   * @param amount   - Positive amount to add. Negative values are ignored.
   * @param x        - Optional threat X position → `getLastKnownPosition`.
   * @param y        - Optional threat Y position → `getLastKnownPosition`.
   */
  add(stimulus: SuspicionStimulus, amount: number, x?: number, y?: number): void;

  /**
   * Clear the stored threat position without resetting the suspicion level.
   * Useful when the host wants to discard a stale position.
   */
  clearPosition(): void;

  /**
   * Reset suspicion level and threat position.
   *
   * State handlers call this after triggering an alert transition so
   * the NPC starts fresh in the new state rather than re-triggering
   * immediately on re-entry to PATROL/IDLE.
   */
  clear(): void;
}

/**
 * Pathfinding query interface.
 *
 * Wraps the engine-specific pathfinding system (A*, NavMesh, etc.) so
 * state handlers can request paths without importing game-layer classes.
 *
 * The host implements this interface by delegating to its pathfinding
 * engine (e.g. PathFinding.js, EasyStar, or a NavMesh adapter).
 *
 * If not provided (`ctx.pathfinding === null`), state handlers fall back
 * to direct straight-line movement via `moveToward()`.
 */
export interface IPathfindingAccess {
  /**
   * Compute a path from the NPC's current position to the target.
   * The implementation should cache the result until `setPath()` or
   * a new `findPath()` call replaces it.
   *
   * @param targetX - Destination world X (px).
   * @param targetY - Destination world Y (px).
   * @returns Array of world-space waypoints, or null if no path exists.
   */
  findPath(targetX: number, targetY: number): ReadonlyArray<{ x: number; y: number }> | null;

  /**
   * Get the next waypoint the NPC should move toward.
   * Manages an internal cursor — advances when the NPC reaches each waypoint.
   *
   * @returns Next waypoint, or null if path is complete or no path is set.
   */
  getNextWaypoint(): { x: number; y: number } | null;

  /**
   * Replace the current path with new waypoints.
   * Resets the internal cursor to the first waypoint.
   *
   * @param waypoints - World-space path waypoints.
   */
  setPath(waypoints: ReadonlyArray<{ x: number; y: number }>): void;

  /**
   * True if the NPC is actively following a path (cursor not at end).
   */
  isNavigating(): boolean;

  /**
   * Stop following the current path and clear waypoints.
   * After this call, `isNavigating()` returns false.
   */
  clearPath(): void;
}

/**
 * Squad communication interface.
 *
 * Wraps the engine-specific SquadManager so state handlers can issue
 * commands and share intel without importing game-layer classes.
 */
export interface ISquadAccess {
  /**
   * Broadcast a target sighting to all squad members.
   *
   * @param targetId - Stable entity ID of the sighted enemy.
   * @param x        - Enemy world X.
   * @param y        - Enemy world Y.
   */
  shareTarget(targetId: string, x: number, y: number): void;

  /**
   * Return the stable entity ID of the squad leader, or null if the NPC is
   * not in a squad or there is no elected leader.
   */
  getLeaderId(): string | null;

  /** Total member count of the squad (including this NPC). */
  getMemberCount(): number;

  /**
   * Issue a tactical command to the whole squad.
   *
   * @param command - Command string (e.g. 'ATTACK', 'RETREAT', 'HOLD').
   */
  issueCommand(command: string): void;

  /**
   * Optional. Return shared enemy intel from squad members, or null if none.
   *
   * If not implemented, PatrolState's squad intel check silently no-ops via
   * `ctx.squad?.getSharedTarget?.()`. Implement using
   * {@link SquadSharedTargetTable.getSharedTarget}.
   *
   * Returning null means either no intel is available or it has expired (TTL).
   */
  getSharedTarget?(): ISharedTargetInfo | null;
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/**
 * Payload emitted when an NPC fires a shot.
 * The host listens to this event to spawn the actual projectile.
 */
export interface IShootPayload {
  /** Stable NPC identifier. */
  npcId: string;
  /** NPC world X at time of shot. */
  x: number;
  /** NPC world Y at time of shot. */
  y: number;
  /** Target world X. */
  targetX: number;
  /** Target world Y. */
  targetY: number;
  /** Active weapon type string (e.g. 'rifle', 'pistol'). */
  weaponType: string;
}

/**
 * Payload emitted when an NPC lands a melee hit.
 * The host listens to this event to apply damage to the target.
 */
export interface IMeleeHitPayload {
  /** Stable NPC identifier of the attacker. */
  npcId: string;
  /** Stable entity ID of the target hit. */
  targetId: string;
  /** Raw damage value to apply. */
  damage: number;
}

// ---------------------------------------------------------------------------
// Main facade interface
// ---------------------------------------------------------------------------

/**
 * Per-NPC context facade used by all online state handlers.
 *
 * Implement this interface on the Phaser side (PhaserNPCContext) to bridge
 * the game-layer Entity/Component world to the framework-agnostic state
 * handler SDK.
 *
 * All optional subsystem accessors (cover, danger, restrictedZones, squad)
 * may return null — state handlers must handle that case gracefully.
 *
 * @example
 * ```ts
 * class PhaserNPCContext implements INPCContext {
 *   constructor(private readonly entity: Entity) {}
 *   get npcId() { return this.entity.npcId; }
 *   get x() { return this.entity.x; }
 *   // ...
 * }
 * ```
 */
export interface INPCContext {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** Stable, unique identifier for this NPC. */
  readonly npcId: string;

  /** The NPC's faction identifier (e.g. 'military', 'bandits'). */
  readonly factionId: string;

  /**
   * High-level entity type string (e.g. 'npc', 'monster', 'player').
   * State handlers use this to distinguish human NPCs from monsters.
   */
  readonly entityType: string;

  // -------------------------------------------------------------------------
  // Position (read-only — world space, pixels)
  // -------------------------------------------------------------------------

  /** Current world X of the NPC (px). */
  readonly x: number;

  /** Current world Y of the NPC (px). */
  readonly y: number;

  // -------------------------------------------------------------------------
  // Mutable AI state bag
  // -------------------------------------------------------------------------

  /**
   * Per-NPC mutable AI data bag.
   *
   * All state handlers read and write this object each frame.
   * Create with {@link createDefaultNPCOnlineState}.
   */
  readonly state: INPCOnlineState;

  // -------------------------------------------------------------------------
  // Optional subsystem accessors
  // -------------------------------------------------------------------------

  /**
   * Perception snapshot for the current frame, or null if no perception
   * system is active for this NPC.
   */
  readonly perception: INPCPerception | null;

  /**
   * Health accessor, or null if the entity does not have a health component
   * (e.g. invincible story NPCs, scripted props).
   */
  readonly health: INPCHealth | null;

  // -------------------------------------------------------------------------
  // Movement & rendering control
  // -------------------------------------------------------------------------

  /**
   * Set the NPC's velocity in world space.
   *
   * @param vx - Horizontal velocity (px/s).
   * @param vy - Vertical velocity (px/s).
   */
  setVelocity(vx: number, vy: number): void;

  /** Immediately stop all movement (set velocity to zero). */
  halt(): void;

  /**
   * Set the NPC's facing direction.
   *
   * @param radians - Angle in radians (0 = right, π/2 = down).
   */
  setRotation(radians: number): void;

  /**
   * Set the NPC's visual transparency.
   *
   * @param alpha - Opacity in [0, 1].
   */
  setAlpha(alpha: number): void;

  /**
   * Teleport the NPC to a new world position instantly.
   * Bypasses physics and animation.
   *
   * @param x - Target world X (px).
   * @param y - Target world Y (px).
   */
  teleport(x: number, y: number): void;

  /**
   * Disable the NPC's physics body (e.g. when transitioning to DEAD state).
   * The NPC will no longer participate in collision detection.
   */
  disablePhysics(): void;

  // -------------------------------------------------------------------------
  // FSM control
  // -------------------------------------------------------------------------

  /**
   * Trigger an FSM state transition.
   *
   * Calls exit() on the current state handler and enter() on the new one.
   * The transition is performed synchronously in the current update frame.
   *
   * @param newStateId - Target state identifier (e.g. 'COMBAT', 'FLEE').
   */
  transition(newStateId: string): void;

  /** The identifier of the currently active FSM state. */
  readonly currentStateId: string;

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  /**
   * Emit a shoot event so the host can spawn a projectile.
   *
   * @param payload - Shoot event data.
   */
  emitShoot(payload: IShootPayload): void;

  /**
   * Emit a melee-hit event so the host can apply damage to the target.
   *
   * @param payload - Melee hit event data.
   */
  emitMeleeHit(payload: IMeleeHitPayload): void;

  /**
   * Emit a vocalization event (NPC voice line / bark).
   *
   * @param type - Vocalization type string (e.g. 'ENEMY_SPOTTED', 'PAIN').
   */
  emitVocalization(type: string): void;

  /**
   * Emit a PSI attack start event (Controller special ability).
   *
   * @param x - World X of the attack origin.
   * @param y - World Y of the attack origin.
   */
  emitPsiAttackStart(x: number, y: number): void;

  // -------------------------------------------------------------------------
  // SDK system accessors (optional — host provides what it supports)
  // -------------------------------------------------------------------------

  /**
   * Cover system accessor, or null if no cover system is registered.
   * TakeCoverState and RetreatState use this to locate cover points.
   */
  readonly cover: ICoverAccess | null;

  /**
   * Danger assessment accessor, or null if no DangerManager is registered.
   * CombatState and EvadeGrenadeState use this to detect grenade/explosion threats.
   */
  readonly danger: IDangerAccess | null;

  /**
   * Restricted zone accessor, or null if no RestrictedZoneManager is registered.
   * IdleState uses this to detect and escape active DANGER zones.
   */
  readonly restrictedZones: IRestrictedZoneAccess | null;

  /**
   * Squad communication accessor, or null if the NPC is not in a squad.
   * CombatState uses this to share target sightings with squad members.
   */
  readonly squad: ISquadAccess | null;

  /**
   * Pack coordination accessor, or null if the monster is not in a pack.
   * Used by AlertState, MonsterCombatController, IdleState, PatrolState, and
   * FleeState to broadcast and receive group alert signals (opt-in).
   */
  readonly pack: IPackAccess | null;

  /**
   * Condition bank accessor, or null if no condition system is registered.
   * IdleState uses this to detect fatigue/radiation and trigger rest transitions.
   */
  readonly conditions: IConditionAccess | null;

  /**
   * Suspicion accumulator accessor, or null if no suspicion system is registered.
   * PatrolState and IdleState use this to detect accumulated threat and trigger ALERT.
   */
  readonly suspicion: ISuspicionAccess | null;

  /**
   * Pathfinding system accessor, or null if no pathfinding is registered.
   *
   * When provided, state handlers can use `moveAlongPath()` instead of
   * `moveToward()` for obstacle-aware navigation. When null, handlers
   * fall back to direct straight-line movement.
   */
  readonly pathfinding: IPathfindingAccess | null;

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Return the current elapsed time in milliseconds.
   *
   * In Phaser this maps to `scene.time.now`. In tests use a deterministic
   * counter. All state timers are stored as absolute ms values and compared
   * against this return value.
   */
  now(): number;

  /**
   * Return a pseudo-random number in [0, 1).
   *
   * Allows tests to inject deterministic randomness via a seeded PRNG without
   * overriding `Math.random`.
   */
  random(): number;
}
