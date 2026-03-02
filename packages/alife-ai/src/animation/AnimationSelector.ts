// animation/AnimationSelector.ts
// Pure state → animation key resolver.
// No framework dependencies — only string/number operations.

import type { Vec2 } from '@alife-sdk/core';

/**
 * 8-way directional system for animation facing.
 * Indexed 0–7 clockwise from North.
 */
export const CompassIndex = {
  N: 0,
  NE: 1,
  E: 2,
  SE: 3,
  S: 4,
  SW: 5,
  W: 6,
  NW: 7,
} as const;

export type CompassIndex = (typeof CompassIndex)[keyof typeof CompassIndex];

const DIRECTION_SUFFIXES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Animation layer for multi-layer sprite rigs.
 */
export const AnimLayer = {
  LEGS: 0,
  TORSO: 1,
  HEAD: 2,
} as const;

export type AnimLayer = (typeof AnimLayer)[keyof typeof AnimLayer];

/**
 * Descriptor for a state → animation mapping entry.
 */
export interface IAnimDescriptor {
  readonly base: string;
  readonly loop: boolean;
  readonly frameRate: number;
  readonly layer: AnimLayer;
  readonly omitDirection: boolean;
}

/**
 * Resolved animation request ready for the host renderer.
 */
export interface IAnimationRequest {
  readonly key: string;
  readonly loop: boolean;
  readonly frameRate: number;
  readonly layer: AnimLayer;
}

/**
 * AI state → animation descriptor mapping.
 * Exported as default; callers may supply a custom map to override.
 */
export const DEFAULT_STATE_ANIM_MAP: Readonly<Record<string, IAnimDescriptor>> = {
  IDLE: { base: 'idle', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false },
  PATROL: { base: 'walk', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false },
  ALERT: { base: 'walk_alert', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false },
  COMBAT: { base: 'combat', loop: false, frameRate: 12, layer: AnimLayer.TORSO, omitDirection: false },
  TAKE_COVER: { base: 'crouch', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false },
  SEARCH: { base: 'walk_search', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false },
  FLEE: { base: 'run', loop: true, frameRate: 14, layer: AnimLayer.LEGS, omitDirection: false },
  DEAD: { base: 'death', loop: false, frameRate: 8, layer: AnimLayer.LEGS, omitDirection: true },
  GRENADE: { base: 'throw', loop: false, frameRate: 10, layer: AnimLayer.TORSO, omitDirection: true },
  EVADE_GRENADE: { base: 'sprint', loop: true, frameRate: 14, layer: AnimLayer.LEGS, omitDirection: false },
  WOUNDED: { base: 'crawl', loop: true, frameRate: 6, layer: AnimLayer.LEGS, omitDirection: false },
  RETREAT: { base: 'run_fire', loop: true, frameRate: 14, layer: AnimLayer.LEGS, omitDirection: false },
  CAMP: { base: 'idle', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false },
  SLEEP: { base: 'sleep', loop: true, frameRate: 4, layer: AnimLayer.LEGS, omitDirection: true },
  // Monster states
  CHARGE: { base: 'charge', loop: false, frameRate: 14, layer: AnimLayer.LEGS, omitDirection: false },
  STALK: { base: 'stalk', loop: true, frameRate: 8, layer: AnimLayer.LEGS, omitDirection: false },
  LEAP: { base: 'leap', loop: false, frameRate: 14, layer: AnimLayer.LEGS, omitDirection: false },
  PSI_ATTACK: { base: 'psi', loop: false, frameRate: 10, layer: AnimLayer.TORSO, omitDirection: true },
};

const DEFAULT_DESCRIPTOR: IAnimDescriptor = {
  base: 'idle', loop: true, frameRate: 10, layer: AnimLayer.LEGS, omitDirection: false,
};

/**
 * Weapon suffix lookup.
 * GRENADE and MEDKIT use 'unarmed' (no held weapon visible).
 * Keys are strings for extensibility; numeric categories are stringified at lookup time.
 */
export const DEFAULT_WEAPON_SUFFIXES: Readonly<Record<string, string>> = {
  '0': 'pistol',
  '1': 'shotgun',
  '2': 'rifle',
  '3': 'sniper',
  '4': 'unarmed',
  '5': 'unarmed',
};

// ---------------------------------------------------------------------------
// Direction caching — avoids atan2 + quantize when velocity barely changes.
// ---------------------------------------------------------------------------

/** Squared magnitude threshold below which a velocity delta is "insignificant". */
const DIRECTION_CACHE_EPSILON_SQ = 4.0; // ~2px/s change

/**
 * Per-entity direction cache.  Stores the last computed direction and the
 * velocity that produced it.  `resolve()` only calls `getDirection()` when the
 * velocity has changed more than a small epsilon (squared-magnitude test).
 *
 * Allocate one instance per NPC and pass it into `getAnimationRequest()`.
 */
export class DirectionCache {
  private _lastVx = NaN;
  private _lastVy = NaN;
  private _dir: CompassIndex = CompassIndex.S;

  /**
   * Return the cached direction or recompute if velocity changed significantly.
   */
  resolve(vx: number, vy: number): CompassIndex {
    const dx = vx - this._lastVx;
    const dy = vy - this._lastVy;

    // NaN check on first call (NaN - anything = NaN, NaN > anything = false)
    if (dx * dx + dy * dy > DIRECTION_CACHE_EPSILON_SQ || this._lastVx !== this._lastVx) {
      this._lastVx = vx;
      this._lastVy = vy;
      this._dir = getDirection(vx, vy);
    }

    return this._dir;
  }

  /** Force-invalidate the cache (e.g. on teleport). */
  invalidate(): void {
    this._lastVx = NaN;
    this._lastVy = NaN;
  }
}

// ---------------------------------------------------------------------------
// Pre-built lookup table for default maps — avoids template literal per frame.
// Key format: `${state}|${weaponCategory}|${direction}`
// ---------------------------------------------------------------------------
const _defaultKeyLookup: Map<string, string> = /* @__PURE__ */ (() => {
  const lut = new Map<string, string>();
  const states = Object.keys(DEFAULT_STATE_ANIM_MAP);
  const weaponKeys = Object.keys(DEFAULT_WEAPON_SUFFIXES);

  for (const state of states) {
    const desc = DEFAULT_STATE_ANIM_MAP[state];
    for (const wk of weaponKeys) {
      const weapon = DEFAULT_WEAPON_SUFFIXES[wk];
      if (desc.omitDirection) {
        const animKey = `${desc.base}_${weapon}`;
        for (let d = 0; d < 8; d++) {
          lut.set(`${state}|${wk}|${d}`, animKey);
        }
      } else {
        for (let d = 0; d < 8; d++) {
          lut.set(
            `${state}|${wk}|${d}`,
            `${desc.base}_${weapon}_${DIRECTION_SUFFIXES[d]}`,
          );
        }
      }
    }
  }
  return lut;
})();

/**
 * Convert a 2D velocity vector to an 8-way CompassIndex.
 * Zero vector defaults to South (rest facing).
 */
export function getDirection(vx: number, vy: number): CompassIndex {
  if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) return CompassIndex.S;

  // atan2 gives angle from positive X axis, CCW positive.
  // Adding π/2 rotates so that North (vy<0 in screen space) maps to 0,
  // East to π/2, South to π, West to 3π/2 — clockwise from North.
  const angle = Math.atan2(vy, vx);

  // Map to [0, 2π] then quantize into 8 sectors (each sector = π/4).
  const normalized = ((angle + Math.PI * 0.5) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.floor((normalized + Math.PI / 8) / (Math.PI / 4)) % 8;

  return sector as CompassIndex;
}

/**
 * Build an animation key from state, weapon type, and direction.
 *
 * Format: `{base}_{weapon}_{direction}` or `{base}_{weapon}` if direction omitted.
 * Falls back to 'rifle' for unknown weapon types.
 *
 * @param animMap - Custom state → descriptor map. Uses DEFAULT_STATE_ANIM_MAP when omitted.
 * @param weaponSuffixes - Custom weapon suffix map. Uses DEFAULT_WEAPON_SUFFIXES when omitted.
 */
export function getAnimationKey(
  state: string,
  weaponType: number | string,
  direction: CompassIndex,
  animMap?: Readonly<Record<string, IAnimDescriptor>>,
  weaponSuffixes?: Readonly<Record<string, string>>,
): string {
  // Fast path: use pre-built lookup table when both maps are defaults
  if (animMap === undefined && weaponSuffixes === undefined) {
    const cached = _defaultKeyLookup.get(`${state}|${String(weaponType)}|${direction}`);
    if (cached !== undefined) return cached;
  }

  // Slow path: custom maps or unknown state/weapon combination
  const map = animMap ?? DEFAULT_STATE_ANIM_MAP;
  const suffixes = weaponSuffixes ?? DEFAULT_WEAPON_SUFFIXES;
  const desc = map[state] ?? DEFAULT_DESCRIPTOR;
  const weapon = suffixes[String(weaponType)] ?? 'rifle';

  if (desc.omitDirection) {
    return `${desc.base}_${weapon}`;
  }

  return `${desc.base}_${weapon}_${DIRECTION_SUFFIXES[direction]}`;
}

/**
 * Input for resolving an animation request from AI state and movement data.
 * Groups all parameters into a single object for ergonomic callsites.
 */
export interface IAnimationInput {
  readonly state: string;
  readonly weaponCategory: number | string;
  readonly velocity: Vec2;
  readonly animMap?: Readonly<Record<string, IAnimDescriptor>>;
  readonly weaponSuffixes?: Readonly<Record<string, string>>;
  readonly directionCache?: DirectionCache;
}

/**
 * Resolve a full animation request from AI state and movement data.
 *
 * @param input - Animation input (state, weapon, velocity, optional maps/cache).
 * @returns Complete animation request with key, loop, frame rate, and layer.
 */
export function getAnimationRequest(
  input: IAnimationInput,
): IAnimationRequest {
  const { state, weaponCategory, velocity, animMap, weaponSuffixes, directionCache } = input;
  const map = animMap ?? DEFAULT_STATE_ANIM_MAP;
  const desc = map[state] ?? DEFAULT_DESCRIPTOR;
  const direction = directionCache ? directionCache.resolve(velocity.x, velocity.y) : getDirection(velocity.x, velocity.y);
  const key = getAnimationKey(state, weaponCategory, direction, animMap, weaponSuffixes);

  return {
    key,
    loop: desc.loop,
    frameRate: desc.frameRate,
    layer: desc.layer,
  };
}
