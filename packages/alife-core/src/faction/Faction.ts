/**
 * Faction — two-layer relation model.
 *
 * Base relations come from the config (IFactionDefinition) and are immutable.
 * Dynamic goodwill is mutable at runtime and decays toward 0 each tick.
 * The effective relation is the sum of both layers, clamped to [-100, 100].
 */

import type { IFactionDefinition } from '../registry/FactionRegistry';
import { clamp, moveTowardZero } from '../core/math/utils';

const RELATION_MIN = -100;
const RELATION_MAX = 100;
const DEFAULT_HOSTILE_THRESHOLD = -50;
const DEFAULT_ALLY_THRESHOLD = 50;

/** Configurable thresholds for faction diplomacy classification. */
export interface IFactionThresholds {
  /** Relation below this value is considered hostile. Default: -50. */
  readonly hostile: number;
  /** Relation above this value is considered allied. Default: 50. */
  readonly ally: number;
}

export class Faction {
  readonly id: string;
  readonly name: string;
  readonly metadata: ReadonlyMap<string, unknown>;

  private readonly baseRelations: ReadonlyMap<string, number>;
  private readonly dynamicGoodwill = new Map<string, number>();
  private readonly thresholds: IFactionThresholds;
  private readonly _keysToRemove: string[] = [];

  constructor(
    id: string,
    definition: IFactionDefinition,
    thresholds?: Partial<IFactionThresholds>,
  ) {
    this.id = id;
    this.name = definition.name;
    this.baseRelations = new Map(Object.entries(definition.baseRelations));
    this.metadata = new Map(Object.entries(definition.metadata ?? {}));
    this.thresholds = {
      hostile: thresholds?.hostile ?? DEFAULT_HOSTILE_THRESHOLD,
      ally: thresholds?.ally ?? DEFAULT_ALLY_THRESHOLD,
    };
  }

  /**
   * Combined relation = base + dynamic, clamped to [-100, 100].
   * Returns 0 when no relation data exists for the other faction.
   */
  getRelation(otherFactionId: string): number {
    const base = this.baseRelations.get(otherFactionId) ?? 0;
    const dynamic = this.dynamicGoodwill.get(otherFactionId) ?? 0;
    return clamp(base + dynamic, RELATION_MIN, RELATION_MAX);
  }

  /**
   * Modify dynamic goodwill (not base). The stored value is clamped to [-100, 100].
   */
  adjustGoodwill(otherFactionId: string, delta: number): void {
    const current = this.dynamicGoodwill.get(otherFactionId) ?? 0;
    const next = clamp(current + delta, RELATION_MIN, RELATION_MAX);

    if (next === 0) {
      this.dynamicGoodwill.delete(otherFactionId);
    } else {
      this.dynamicGoodwill.set(otherFactionId, next);
    }
  }

  /** Relation is hostile when the combined score drops below the hostile threshold. */
  isHostile(otherFactionId: string): boolean {
    return this.getRelation(otherFactionId) < this.thresholds.hostile;
  }

  /** Relation is allied when the combined score exceeds the ally threshold. */
  isAlly(otherFactionId: string): boolean {
    return this.getRelation(otherFactionId) > this.thresholds.ally;
  }

  /** Relation is neutral when it falls between hostile and ally thresholds inclusive. */
  isNeutral(otherFactionId: string): boolean {
    const relation = this.getRelation(otherFactionId);
    return relation >= this.thresholds.hostile && relation <= this.thresholds.ally;
  }

  /**
   * Decay every dynamic goodwill entry toward 0 by the given rate.
   * Entries that reach 0 are removed to keep the map clean.
   */
  decayGoodwill(rate: number): void {
    if (rate <= 0) return;

    this._keysToRemove.length = 0;

    for (const [factionId, value] of this.dynamicGoodwill) {
      const decayed = moveTowardZero(value, rate);

      if (decayed === 0) {
        this._keysToRemove.push(factionId);
      } else {
        this.dynamicGoodwill.set(factionId, decayed);
      }
    }

    for (let i = 0; i < this._keysToRemove.length; i++) {
      this.dynamicGoodwill.delete(this._keysToRemove[i]);
    }
  }

  /** Reset all dynamic goodwill to zero. */
  resetGoodwill(): void {
    this.dynamicGoodwill.clear();
  }

  // -----------------------------------------------------------------------
  // Serialisation
  // -----------------------------------------------------------------------

  serialize(): IFactionState {
    return {
      dynamicGoodwill: Object.fromEntries(this.dynamicGoodwill),
    };
  }

  restore(state: IFactionState): void {
    this.dynamicGoodwill.clear();
    for (const [id, value] of Object.entries(state.dynamicGoodwill)) {
      this.dynamicGoodwill.set(id, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Serialisation state
// ---------------------------------------------------------------------------

export interface IFactionState {
  readonly dynamicGoodwill: Readonly<Record<string, number>>;
}

