// online/PhaserNPCContext.ts
// Phaser bridge that implements INPCContext using abstract host interfaces.
//
// Design goals:
//   - Zero direct Phaser class imports — the host provides all Phaser
//     operations through the IPhaserNPCHost duck-type interface.
//   - Implements every member of INPCContext by delegating to the host or
//     to optional subsystem accessors injected at construction time.
//   - All optional subsystems (perception, health, cover, danger,
//     restrictedZones, squad) default to null — state handlers degrade
//     gracefully when a subsystem is absent.
//
// Usage pattern:
//   1. The game layer creates a PhaserNPCContext per active NPC, wiring in
//      the entity's sprite operations through IPhaserNPCHost.
//   2. Pass the context to OnlineAIDriver as the IOnlineDriverHost.
//   3. The driver wraps it, intercepts transition() / currentStateId, and
//      calls state handler enter/update/exit each frame.

import type {
  INPCContext,
  INPCOnlineState,
  INPCPerception,
  INPCHealth,
  ICoverAccess,
  IDangerAccess,
  IRestrictedZoneAccess,
  ISquadAccess,
  IConditionAccess,
  ISuspicionAccess,
  IPackAccess,
  IShootPayload,
  IMeleeHitPayload,
} from '@alife-sdk/ai';

// ---------------------------------------------------------------------------
// IPhaserNPCHost — abstract host interface
// ---------------------------------------------------------------------------

/**
 * Abstract host interface that the Phaser entity layer must implement to
 * bridge game-layer sprite operations to the framework-agnostic
 * {@link PhaserNPCContext}.
 *
 * All methods correspond 1-to-1 with actions that online state handlers
 * request through {@link INPCContext}. The implementation typically delegates
 * to the NPC's Phaser.Physics.Arcade.Sprite and scene services.
 *
 * @example
 * ```ts
 * class EnemyNPCHost implements IPhaserNPCHost {
 *   constructor(private readonly sprite: Phaser.Physics.Arcade.Sprite) {}
 *   get npcId() { return 'enemy_1'; }
 *   getX() { return this.sprite.x; }
 *   setVelocity(vx, vy) { this.sprite.setVelocity(vx, vy); }
 *   // ... etc.
 * }
 * ```
 */
export interface IPhaserNPCHost {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** Stable, unique NPC identifier. Must match the entity's simulation ID. */
  readonly npcId: string;

  /** Faction identifier string (e.g. 'military', 'bandits'). */
  readonly factionId: string;

  /**
   * High-level entity type string (e.g. 'npc', 'monster', 'player').
   * Monster ability transitions are driven by this value.
   */
  readonly entityType: string;

  // -------------------------------------------------------------------------
  // Position
  // -------------------------------------------------------------------------

  /** Return the sprite's current world X position (px). */
  getX(): number;

  /** Return the sprite's current world Y position (px). */
  getY(): number;

  // -------------------------------------------------------------------------
  // Movement & physics
  // -------------------------------------------------------------------------

  /**
   * Set the sprite's physics body velocity.
   *
   * @param vx - Horizontal velocity (px/s).
   * @param vy - Vertical velocity (px/s).
   */
  setVelocity(vx: number, vy: number): void;

  /** Immediately zero out all velocity (stop movement). */
  halt(): void;

  /**
   * Set the sprite's rotation.
   *
   * @param radians - Angle in radians (0 = right, π/2 = down).
   */
  setRotation(radians: number): void;

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Set the sprite's alpha (opacity).
   *
   * @param alpha - Value in [0, 1].
   */
  setAlpha(alpha: number): void;

  // -------------------------------------------------------------------------
  // Teleport & physics control
  // -------------------------------------------------------------------------

  /**
   * Instantly move the sprite to the given world position.
   * Must reset velocity to prevent physics drift after teleport.
   *
   * @param x - Target world X (px).
   * @param y - Target world Y (px).
   */
  teleport(x: number, y: number): void;

  /**
   * Disable the sprite's physics body.
   * Called when the NPC enters the DEAD state so it no longer participates
   * in collision detection.
   */
  disablePhysics(): void;

  // -------------------------------------------------------------------------
  // FSM state query
  // -------------------------------------------------------------------------

  /**
   * Return the current FSM state identifier.
   *
   * When the context is wrapped by {@link OnlineAIDriver}, the driver
   * intercepts `currentStateId` with its own getter, so this method is only
   * called when the context is used without the driver (e.g. testing).
   */
  getCurrentStateId(): string;

  // -------------------------------------------------------------------------
  // Event callbacks
  // -------------------------------------------------------------------------

  /**
   * Called when a state handler requests a FSM transition.
   *
   * Note: When the context is wrapped by {@link OnlineAIDriver}, the driver
   * intercepts `ctx.transition()` and manages the FSM itself — this callback
   * is NOT invoked in that case. It serves as a fallback when PhaserNPCContext
   * is used standalone (e.g. as a plain INPCContext without the driver).
   *
   * @param newStateId - Target state identifier (e.g. 'COMBAT', 'FLEE').
   */
  onTransitionRequest(newStateId: string): void;

  /**
   * Called when a state handler requests a projectile to be spawned.
   *
   * @param payload - Shoot event data including target coordinates.
   */
  onShoot(payload: IShootPayload): void;

  /**
   * Called when a state handler reports a successful melee hit.
   *
   * @param payload - Melee hit event data including target ID and damage.
   */
  onMeleeHit(payload: IMeleeHitPayload): void;

  /**
   * Called when a state handler emits a vocalization (NPC bark / voice line).
   *
   * @param type - Vocalization type string (e.g. 'ENEMY_SPOTTED', 'PAIN').
   */
  onVocalization(type: string): void;

  /**
   * Called when a Controller NPC starts a PSI attack channel.
   *
   * @param x - World X of the attack origin.
   * @param y - World Y of the attack origin.
   */
  onPsiAttackStart(x: number, y: number): void;

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Return the current elapsed time in milliseconds.
   * Typically maps to `scene.time.now` in a Phaser context.
   */
  now(): number;

  /**
   * Return a pseudo-random number in [0, 1).
   * Typically maps to `Math.random()` or a seeded PRNG for deterministic replay.
   */
  random(): number;
}

// ---------------------------------------------------------------------------
// Optional subsystem bundle
// ---------------------------------------------------------------------------

/**
 * Optional AI subsystem accessors injected at construction time.
 *
 * All fields default to null when not provided — state handlers degrade
 * gracefully when a subsystem is absent.
 */
export interface IPhaserNPCSystemBundle {
  /** Perception snapshot (enemies / allies / items visible this frame). */
  perception?: INPCPerception | null;
  /** Health accessor (hp, maxHp, hpPercent, heal). */
  health?: INPCHealth | null;
  /** Cover system accessor (findCover). */
  cover?: ICoverAccess | null;
  /** Danger assessment accessor (getDangerLevel, getGrenadeDanger). */
  danger?: IDangerAccess | null;
  /** Restricted zone accessor (isAccessible, filterAccessible). */
  restrictedZones?: IRestrictedZoneAccess | null;
  /** Squad communication accessor (shareTarget, issueCommand, etc.). */
  squad?: ISquadAccess | null;
  /** Pack coordination accessor for monster groups (opt-in). */
  pack?: IPackAccess | null;
  /** Condition bank accessor (radiation, bleeding, etc.). */
  conditions?: IConditionAccess | null;
  /** Suspicion accumulator accessor for patrol/idle threat detection. */
  suspicion?: ISuspicionAccess | null;
}

// ---------------------------------------------------------------------------
// PhaserNPCContext
// ---------------------------------------------------------------------------

/**
 * Bridge between the Phaser entity layer and the framework-agnostic
 * {@link INPCContext} interface expected by all online state handlers.
 *
 * Construct one instance per active NPC and pass it to {@link OnlineAIDriver}
 * as the `IOnlineDriverHost`. The driver wraps this context, intercepting
 * `transition()` and `currentStateId` to manage the FSM lifecycle.
 *
 * @example
 * ```ts
 * // Phaser game setup:
 * const phaserCtx = new PhaserNPCContext(
 *   new EnemyNPCHost(sprite),           // IPhaserNPCHost
 *   createDefaultNPCOnlineState(),       // INPCOnlineState
 *   { perception: myPerceptionSystem },  // optional subsystems
 * );
 *
 * // Create driver — wraps phaserCtx, owns FSM transition logic:
 * const handlers = buildDefaultHandlerMap();
 * const driver = new OnlineAIDriver(phaserCtx, handlers, 'IDLE');
 *
 * // Each frame:
 * driver.update(scene.game.loop.delta);
 * ```
 */
export class PhaserNPCContext implements INPCContext {
  private readonly host: IPhaserNPCHost;

  readonly state: INPCOnlineState;
  readonly perception: INPCPerception | null;
  readonly health: INPCHealth | null;
  readonly cover: ICoverAccess | null;
  readonly danger: IDangerAccess | null;
  readonly restrictedZones: IRestrictedZoneAccess | null;
  readonly squad: ISquadAccess | null;
  readonly pack: IPackAccess | null;
  readonly conditions: IConditionAccess | null;
  readonly suspicion: ISuspicionAccess | null;

  constructor(
    host: IPhaserNPCHost,
    state: INPCOnlineState,
    systems?: IPhaserNPCSystemBundle,
  ) {
    this.host = host;
    this.state = state;
    this.perception = systems?.perception ?? null;
    this.health = systems?.health ?? null;
    this.cover = systems?.cover ?? null;
    this.danger = systems?.danger ?? null;
    this.restrictedZones = systems?.restrictedZones ?? null;
    this.squad = systems?.squad ?? null;
    this.pack = systems?.pack ?? null;
    this.conditions = systems?.conditions ?? null;
    this.suspicion = systems?.suspicion ?? null;
  }

  // -------------------------------------------------------------------------
  // Identity — delegate to host
  // -------------------------------------------------------------------------

  get npcId(): string { return this.host.npcId; }
  get factionId(): string { return this.host.factionId; }
  get entityType(): string { return this.host.entityType; }

  // -------------------------------------------------------------------------
  // Position — delegate to host
  // -------------------------------------------------------------------------

  get x(): number { return this.host.getX(); }
  get y(): number { return this.host.getY(); }

  // -------------------------------------------------------------------------
  // Movement & rendering — delegate to host
  // -------------------------------------------------------------------------

  setVelocity(vx: number, vy: number): void { this.host.setVelocity(vx, vy); }
  halt(): void { this.host.halt(); }
  setRotation(radians: number): void { this.host.setRotation(radians); }
  setAlpha(alpha: number): void { this.host.setAlpha(alpha); }
  teleport(x: number, y: number): void { this.host.teleport(x, y); }
  disablePhysics(): void { this.host.disablePhysics(); }

  // -------------------------------------------------------------------------
  // FSM control
  //
  // Note: When wrapped by OnlineAIDriver, the driver intercepts these two
  // members via DriverContext. These fallback implementations delegate back
  // to the host for standalone use (e.g. testing without the driver).
  // -------------------------------------------------------------------------

  get currentStateId(): string { return this.host.getCurrentStateId(); }
  transition(newStateId: string): void { this.host.onTransitionRequest(newStateId); }

  // -------------------------------------------------------------------------
  // Event emission — delegate to host
  // -------------------------------------------------------------------------

  emitShoot(payload: IShootPayload): void { this.host.onShoot(payload); }
  emitMeleeHit(payload: IMeleeHitPayload): void { this.host.onMeleeHit(payload); }
  emitVocalization(type: string): void { this.host.onVocalization(type); }
  emitPsiAttackStart(x: number, y: number): void { this.host.onPsiAttackStart(x, y); }

  // -------------------------------------------------------------------------
  // Utilities — delegate to host
  // -------------------------------------------------------------------------

  now(): number { return this.host.now(); }
  random(): number { return this.host.random(); }
}
