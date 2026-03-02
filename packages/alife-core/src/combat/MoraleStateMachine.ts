/**
 * 3-state morale system: STABLE / SHAKEN / PANICKED.
 *
 * Morale is a value in [-1, 1] that determines the NPC's psychological state:
 *   - STABLE:   morale > shakenThreshold  (-0.3 by default), recovery +0.005/s toward 0
 *   - SHAKEN:   morale between shaken and panicked thresholds, recovery +0.01/s toward 0
 *   - PANICKED: morale <= panicThreshold (-0.7 by default), no recovery
 *
 * External systems call {@link adjust} to apply morale hits/boosts
 * and {@link update} each frame to apply recovery.
 */

import { clamp, moveTowardZero } from '../core/math/utils';

export const MoraleState = {
  STABLE: 'stable',
  SHAKEN: 'shaken',
  PANICKED: 'panicked',
} as const;

export type MoraleState = (typeof MoraleState)[keyof typeof MoraleState];

export interface IMoraleConfig {
  /** Threshold below which the NPC becomes SHAKEN. Default -0.3. */
  shakenThreshold: number;
  /** Threshold at or below which the NPC becomes PANICKED. Default -0.7. */
  panicThreshold: number;
  /** Recovery rate (per second) while STABLE. Default 0.005. */
  stableRecoveryRate: number;
  /** Recovery rate (per second) while SHAKEN. Default 0.01. */
  shakenRecoveryRate: number;
}

const DEFAULT_CONFIG: IMoraleConfig = {
  shakenThreshold: -0.3,
  panicThreshold: -0.7,
  stableRecoveryRate: 0.005,
  shakenRecoveryRate: 0.01,
};

const MORALE_MIN = -1;
const MORALE_MAX = 1;

export class MoraleTracker {
  private currentMorale = 0;
  private _cachedState: MoraleState;
  private readonly config: IMoraleConfig;

  constructor(config?: Partial<IMoraleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._cachedState = deriveState(this.currentMorale, this.config);
  }

  /** Current morale value in [-1, 1]. */
  get morale(): number {
    return this.currentMorale;
  }

  /** Derived morale state based on current value and thresholds. */
  get state(): MoraleState {
    return this._cachedState;
  }

  /**
   * Apply a morale adjustment (positive = boost, negative = hit).
   * Result is clamped to [-1, 1].
   */
  adjust(delta: number): void {
    this.currentMorale = clamp(
      this.currentMorale + delta,
      MORALE_MIN,
      MORALE_MAX,
    );
    this._cachedState = deriveState(this.currentMorale, this.config);
  }

  /**
   * Tick recovery. Should be called each frame with the elapsed seconds.
   *
   * - STABLE: recovers toward 0 at stableRecoveryRate per second.
   * - SHAKEN: recovers toward 0 at shakenRecoveryRate per second.
   * - PANICKED: no recovery.
   */
  update(deltaSec: number): void {
    if (deltaSec <= 0) return;

    const currentState = this._cachedState;

    if (currentState === MoraleState.PANICKED) return;

    const rate =
      currentState === MoraleState.SHAKEN
        ? this.config.shakenRecoveryRate
        : this.config.stableRecoveryRate;

    const recovery = rate * deltaSec;
    this.currentMorale = moveTowardZero(this.currentMorale, recovery);
    this._cachedState = deriveState(this.currentMorale, this.config);
  }

  /** Reset morale to 0 (STABLE). */
  reset(): void {
    this.currentMorale = 0;
    this._cachedState = deriveState(this.currentMorale, this.config);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveState(morale: number, config: IMoraleConfig): MoraleState {
  if (morale <= config.panicThreshold) return MoraleState.PANICKED;
  if (morale <= config.shakenThreshold) return MoraleState.SHAKEN;
  return MoraleState.STABLE;
}
