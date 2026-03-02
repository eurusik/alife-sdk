// animation/AnimationController.ts
// Stateful per-entity animation controller with debounce and layer priority.
// Framework-agnostic via IAnimationDriver port.

import type { AnimLayer, IAnimationRequest } from './AnimationSelector';

/**
 * Port — developer injects a Phaser/Pixi/etc. implementation.
 */
export interface IAnimationDriver {
  play(key: string, options: IAnimPlayOptions): void;
  hasAnimation(key: string): boolean;
}

export interface IAnimPlayOptions {
  readonly loop: boolean;
  readonly frameRate: number;
}

/**
 * Optional per-layer priority override.
 * Default priority equals the numeric AnimLayer value (LEGS=0, TORSO=1, HEAD=2).
 */
export type ILayerPriorityMap = Readonly<Partial<Record<AnimLayer, number>>>;

export interface IAnimationControllerConfig {
  readonly driver: IAnimationDriver;
  readonly layerPriority?: ILayerPriorityMap;
}

/**
 * Stateful per-entity animation controller.
 *
 * - `request()` is debounced: skips play if same key+layer or lower priority layer is active.
 * - `force()` bypasses debounce and priority (for death, hit, ability anims).
 * - `reset()` clears state for respawn or object-pool reuse.
 */
export class AnimationController {
  private _currentKey: string | null = null;
  private _currentLayer: AnimLayer | null = null;
  private readonly driver: IAnimationDriver;
  private readonly layerPriority: ILayerPriorityMap;

  constructor(config: IAnimationControllerConfig) {
    this.driver = config.driver;
    this.layerPriority = config.layerPriority ?? {};
  }

  /**
   * Request an animation play.
   *
   * Plays only if:
   * 1. priority(req.layer) >= priority(currentLayer)  [null current = any allowed]
   * 2. req.key !== currentKey || req.layer !== currentLayer
   * 3. driver.hasAnimation(req.key) === true
   *
   * Returns true if driver.play() was actually called.
   */
  request(req: IAnimationRequest): boolean {
    if (this._currentLayer !== null) {
      const newPrio: number = this.layerPriority[req.layer] ?? req.layer;
      const curPrio: number = this.layerPriority[this._currentLayer] ?? this._currentLayer;
      if (newPrio < curPrio) return false;
    }

    if (req.key === this._currentKey && req.layer === this._currentLayer) return false;

    if (!this.driver.hasAnimation(req.key)) return false;

    this.driver.play(req.key, { loop: req.loop, frameRate: req.frameRate });
    this._currentKey = req.key;
    this._currentLayer = req.layer;
    return true;
  }

  /**
   * Force-play an animation, bypassing debounce and priority.
   * Useful for one-shot priority events: death, hit reaction, special ability.
   * No-ops silently if driver.hasAnimation() returns false.
   */
  force(req: IAnimationRequest): void {
    if (!this.driver.hasAnimation(req.key)) return;
    this.driver.play(req.key, { loop: req.loop, frameRate: req.frameRate });
    this._currentKey = req.key;
    this._currentLayer = req.layer;
  }

  /**
   * Reset controller state.
   * Call on respawn or when recycling from an object pool.
   */
  reset(): void {
    this._currentKey = null;
    this._currentLayer = null;
  }

  get currentKey(): string | null {
    return this._currentKey;
  }

  get currentLayer(): AnimLayer | null {
    return this._currentLayer;
  }
}
