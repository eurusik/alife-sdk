/**
 * Integration tests: AnimationController + AnimationSelector — per-NPC animation pipeline.
 *
 * Exercises the full animation pipeline end-to-end: AI state → animation key selection
 * via AnimationSelector, then debounce/priority gating via AnimationController.
 *
 * The in-memory driver tracks actual play calls without any framework dependency.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnimationController,
} from '../animation/AnimationController';
import type { IAnimationDriver, IAnimPlayOptions } from '../animation/AnimationController';
import {
  getAnimationRequest,
  getAnimationKey,
  AnimLayer,
  CompassIndex,
} from '../animation/AnimationSelector';
import type { IAnimationRequest } from '../animation/AnimationSelector';
import { WeaponCategory } from '../types/IWeaponTypes';

// ---------------------------------------------------------------------------
// InMemoryAnimDriver — deterministic driver, no vi.fn()
// ---------------------------------------------------------------------------

/**
 * In-memory animation driver that records every play() call.
 * Supports a configurable set of valid animation keys.
 */
class InMemoryAnimDriver implements IAnimationDriver {
  readonly plays: Array<{ key: string; options: IAnimPlayOptions }> = [];
  private readonly validKeys: Set<string>;

  constructor(validKeys?: string[]) {
    // If no valid keys specified, accept all animations.
    this.validKeys = validKeys ? new Set(validKeys) : new Set<string>();
    this._acceptAll = validKeys === undefined;
  }

  private _acceptAll: boolean;

  play(key: string, options: IAnimPlayOptions): void {
    this.plays.push({ key, options });
  }

  hasAnimation(key: string): boolean {
    return this._acceptAll || this.validKeys.has(key);
  }

  /** Helper: total number of times driver.play() was called. */
  get playCount(): number {
    return this.plays.length;
  }

  /** Helper: last played animation key. */
  get lastKey(): string | undefined {
    return this.plays.at(-1)?.key;
  }
}

// ---------------------------------------------------------------------------
// Per-NPC system — mirrors how the real game manages one controller per entity.
// ---------------------------------------------------------------------------

class NPCAnimationSystem {
  private readonly controllers = new Map<string, AnimationController>();
  private readonly drivers = new Map<string, InMemoryAnimDriver>();

  /**
   * Register an NPC with an optional list of valid animation keys.
   * Omit validKeys to accept all animations (default open driver).
   */
  register(npcId: string, validKeys?: string[]): void {
    const driver = new InMemoryAnimDriver(validKeys);
    const ctrl = new AnimationController({ driver });
    this.controllers.set(npcId, ctrl);
    this.drivers.set(npcId, driver);
  }

  getController(npcId: string): AnimationController {
    const c = this.controllers.get(npcId);
    if (!c) throw new Error(`NPC "${npcId}" not registered`);
    return c;
  }

  getDriver(npcId: string): InMemoryAnimDriver {
    const d = this.drivers.get(npcId);
    if (!d) throw new Error(`NPC "${npcId}" not registered`);
    return d;
  }

  /** Convenience: request an animation for an NPC. */
  request(npcId: string, req: IAnimationRequest): boolean {
    return this.getController(npcId).request(req);
  }

  /** Convenience: force-play an animation for an NPC. */
  force(npcId: string, req: IAnimationRequest): void {
    this.getController(npcId).force(req);
  }

  /** Convenience: reset the animation state for an NPC (e.g. on respawn). */
  reset(npcId: string): void {
    this.getController(npcId).reset();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(key: string, layer: AnimLayer, loop = true, frameRate = 10): IAnimationRequest {
  return { key, loop, frameRate, layer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnimationController + AnimationSelector integration — per-NPC pipeline', () => {
  let sys: NPCAnimationSystem;

  beforeEach(() => {
    sys = new NPCAnimationSystem();
  });

  // -------------------------------------------------------------------------
  // 1. request() plays animation on first call — returns true
  // -------------------------------------------------------------------------
  it('1. request() plays the animation on the first call and returns true', () => {
    sys.register('npc_1');
    const req = makeReq('idle_rifle_S', AnimLayer.LEGS);

    const played = sys.request('npc_1', req);

    expect(played).toBe(true);
    expect(sys.getDriver('npc_1').playCount).toBe(1);
    expect(sys.getDriver('npc_1').lastKey).toBe('idle_rifle_S');
  });

  // -------------------------------------------------------------------------
  // 2. Same key again — debounced, returns false, no redundant play call
  // -------------------------------------------------------------------------
  it('2. requesting the same key+layer twice is debounced — returns false, no redundant play', () => {
    sys.register('npc_1');
    const req = makeReq('walk_rifle_N', AnimLayer.LEGS);

    sys.request('npc_1', req);
    const secondCall = sys.request('npc_1', req);

    expect(secondCall).toBe(false);
    // Driver.play should have been called only once total.
    expect(sys.getDriver('npc_1').playCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3. Different key — allowed immediately even in same layer
  // -------------------------------------------------------------------------
  it('3. requesting a different key on the same layer plays immediately', () => {
    sys.register('npc_1');

    sys.request('npc_1', makeReq('idle_rifle_S', AnimLayer.LEGS));
    const result = sys.request('npc_1', makeReq('walk_rifle_S', AnimLayer.LEGS));

    expect(result).toBe(true);
    expect(sys.getDriver('npc_1').playCount).toBe(2);
    expect(sys.getDriver('npc_1').lastKey).toBe('walk_rifle_S');
  });

  // -------------------------------------------------------------------------
  // 4. force() always plays — bypasses debounce even for same key
  // -------------------------------------------------------------------------
  it('4. force() always plays even when the same key+layer is already active', () => {
    sys.register('npc_1');
    const req = makeReq('idle_rifle_S', AnimLayer.LEGS);

    sys.request('npc_1', req); // first play sets debounce state
    sys.force('npc_1', req);   // force — must bypass debounce

    // force() always calls driver.play() regardless.
    expect(sys.getDriver('npc_1').playCount).toBe(2);
    expect(sys.getDriver('npc_1').lastKey).toBe('idle_rifle_S');
  });

  // -------------------------------------------------------------------------
  // 5. hasAnimation returns false for unknown key — request() skips play
  // -------------------------------------------------------------------------
  it('5. request() is skipped when driver.hasAnimation returns false for the key', () => {
    // Register NPC with a known set of animations that does NOT include 'missing_key'.
    sys.register('npc_1', ['idle_rifle_S', 'walk_rifle_S']);

    const result = sys.request('npc_1', makeReq('missing_key', AnimLayer.LEGS));

    expect(result).toBe(false);
    expect(sys.getDriver('npc_1').playCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. AnimationSelector.getAnimationKey: IDLE + pistol + south
  // -------------------------------------------------------------------------
  it('6. getAnimationKey: IDLE + PISTOL + South = idle_pistol_S', () => {
    const key = getAnimationKey('IDLE', WeaponCategory.PISTOL, CompassIndex.S);
    expect(key).toBe('idle_pistol_S');
  });

  // -------------------------------------------------------------------------
  // 7. AnimationSelector.getAnimationKey: COMBAT + rifle + north
  // -------------------------------------------------------------------------
  it('7. getAnimationKey: COMBAT + RIFLE + North = combat_rifle_N', () => {
    const key = getAnimationKey('COMBAT', WeaponCategory.RIFLE, CompassIndex.N);
    expect(key).toBe('combat_rifle_N');
  });

  // -------------------------------------------------------------------------
  // 8. getAnimationKey: unknown state falls back to idle descriptor
  // -------------------------------------------------------------------------
  it('8. getAnimationKey: unknown state falls back to idle base', () => {
    const key = getAnimationKey('NONEXISTENT_STATE', WeaponCategory.RIFLE, CompassIndex.S);
    // DEFAULT_DESCRIPTOR has base='idle' and omitDirection=false.
    expect(key).toBe('idle_rifle_S');
  });

  // -------------------------------------------------------------------------
  // 9. Multiple NPCs — debounce state is isolated per NPC
  // -------------------------------------------------------------------------
  it('9. debounce state is isolated per NPC — NPC B is unaffected by NPC A plays', () => {
    sys.register('npc_a');
    sys.register('npc_b');
    const req = makeReq('walk_rifle_E', AnimLayer.LEGS);

    // npc_a plays and enters debounce.
    sys.request('npc_a', req);
    const npcASecond = sys.request('npc_a', req);
    expect(npcASecond).toBe(false);

    // npc_b has its own fresh controller — first play should succeed.
    const npcBFirst = sys.request('npc_b', req);
    expect(npcBFirst).toBe(true);
    expect(sys.getDriver('npc_b').playCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 10. reset() clears debounce — next request goes through
  // -------------------------------------------------------------------------
  it('10. reset() clears debounce state — the next identical request plays again', () => {
    sys.register('npc_1');
    const req = makeReq('idle_rifle_S', AnimLayer.LEGS);

    sys.request('npc_1', req); // sets debounce
    sys.reset('npc_1');        // clears currentKey/currentLayer

    // After reset, same key should play.
    const result = sys.request('npc_1', req);
    expect(result).toBe(true);
    expect(sys.getDriver('npc_1').playCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 11. Priority: LEGS (0) active → TORSO (1) request succeeds (higher priority)
  // -------------------------------------------------------------------------
  it('11. higher-priority TORSO request succeeds when LEGS layer is active', () => {
    sys.register('npc_1');

    // LEGS layer active.
    sys.request('npc_1', makeReq('idle_rifle_S', AnimLayer.LEGS));

    // TORSO has priority 1 > LEGS priority 0 — must succeed.
    const result = sys.request('npc_1', makeReq('combat_rifle_S', AnimLayer.TORSO));

    expect(result).toBe(true);
    expect(sys.getController('npc_1').currentLayer).toBe(AnimLayer.TORSO);
  });

  // -------------------------------------------------------------------------
  // 12. Priority: HEAD (2) active → LEGS (0) request blocked (lower priority)
  // -------------------------------------------------------------------------
  it('12. lower-priority LEGS request is blocked when HEAD layer is active', () => {
    sys.register('npc_1');

    // HEAD layer is highest priority by default (2).
    sys.request('npc_1', makeReq('head_idle', AnimLayer.HEAD));

    // LEGS layer (priority 0) — lower than HEAD — should be blocked.
    const result = sys.request('npc_1', makeReq('idle_rifle_S', AnimLayer.LEGS));

    expect(result).toBe(false);
    // Controller should still show HEAD as the active layer.
    expect(sys.getController('npc_1').currentLayer).toBe(AnimLayer.HEAD);
  });

  // -------------------------------------------------------------------------
  // 13. Full pipeline: getAnimationRequest -> controller.request end-to-end
  // -------------------------------------------------------------------------
  it('13. full pipeline: getAnimationRequest produces key that controller plays correctly', () => {
    sys.register('npc_1');

    // Resolve an animation request for PATROL state moving east.
    const req = getAnimationRequest({
      state: 'PATROL',
      weaponCategory: WeaponCategory.RIFLE,
      velocity: { x: 100, y: 0 }, // moving east
    });

    // Key should be walk_rifle_E.
    expect(req.key).toBe('walk_rifle_E');
    expect(req.layer).toBe(AnimLayer.LEGS);

    const played = sys.request('npc_1', req);
    expect(played).toBe(true);
    expect(sys.getController('npc_1').currentKey).toBe('walk_rifle_E');
  });

  // -------------------------------------------------------------------------
  // 14. Full pipeline: direction changes produce distinct keys — each plays
  // -------------------------------------------------------------------------
  it('14. direction changes produce distinct keys and each successfully plays', () => {
    sys.register('npc_1');

    const eastReq = getAnimationRequest({
      state: 'PATROL',
      weaponCategory: WeaponCategory.RIFLE,
      velocity: { x: 100, y: 0 },
    });
    const westReq = getAnimationRequest({
      state: 'PATROL',
      weaponCategory: WeaponCategory.RIFLE,
      velocity: { x: -100, y: 0 },
    });

    expect(eastReq.key).toBe('walk_rifle_E');
    expect(westReq.key).toBe('walk_rifle_W');

    sys.request('npc_1', eastReq);
    const result = sys.request('npc_1', westReq);

    expect(result).toBe(true);
    expect(sys.getDriver('npc_1').playCount).toBe(2);
    expect(sys.getController('npc_1').currentKey).toBe('walk_rifle_W');
  });

  // -------------------------------------------------------------------------
  // 15. force() updates currentKey even after a higher-priority layer is active
  // -------------------------------------------------------------------------
  it('15. force() updates currentKey and currentLayer regardless of previous priority state', () => {
    sys.register('npc_1');

    // HEAD (highest priority) is active.
    sys.request('npc_1', makeReq('head_idle', AnimLayer.HEAD));

    // force LEGS (lowest priority) — bypasses priority check.
    sys.force('npc_1', makeReq('death_rifle', AnimLayer.LEGS));

    // After force, current state reflects the forced animation.
    expect(sys.getController('npc_1').currentKey).toBe('death_rifle');
    expect(sys.getController('npc_1').currentLayer).toBe(AnimLayer.LEGS);
    expect(sys.getDriver('npc_1').playCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 16. Spray simulation: same animation key requested 5 times — only 1 play
  // -------------------------------------------------------------------------
  it('16. repeated identical requests during a game loop tick cause only 1 driver.play call', () => {
    sys.register('npc_1');
    const req = getAnimationRequest({
      state: 'COMBAT',
      weaponCategory: WeaponCategory.SHOTGUN,
      velocity: { x: 0, y: 100 },
    });

    // Simulate 5 consecutive game-loop ticks all resolving to the same state.
    for (let i = 0; i < 5; i++) {
      sys.request('npc_1', req);
    }

    // Should have played exactly once — every subsequent call was debounced.
    expect(sys.getDriver('npc_1').playCount).toBe(1);
  });
});
