/**
 * GOAP world state -- a key-value map of planning properties.
 *
 * Used both as the "current world state" fed to the planner and as
 * goal/precondition/effect descriptors on GOAPActions.
 *
 * Only properties that have been explicitly set() are considered active.
 * Unset properties are treated as absent (not false/0/""). This distinction
 * matters for satisfies(): a goal that only specifies { alive: true }
 * matches any world state where "alive" is true, regardless of all other
 * properties.
 *
 * Property values are polymorphic (boolean | number | string) to support
 * both boolean flags and numeric planning properties (e.g., ammo count).
 */

export type WorldStateValue = boolean | number | string;

export class WorldState {
  private readonly properties = new Map<string, WorldStateValue>();

  // -----------------------------------------------------------------------
  // Mutators
  // -----------------------------------------------------------------------

  set(key: string, value: WorldStateValue): void {
    this.properties.set(key, value);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  get(key: string): WorldStateValue | undefined {
    return this.properties.get(key);
  }

  has(key: string): boolean {
    return this.properties.has(key);
  }

  // -----------------------------------------------------------------------
  // Planning utilities
  // -----------------------------------------------------------------------

  /**
   * Check if this state satisfies all conditions in the goal.
   *
   * Returns true when every property defined in the goal has the same
   * value in this state. Properties present in this state but absent
   * in the goal are irrelevant.
   */
  satisfies(goal: WorldState): boolean {
    for (const [key, goalValue] of goal.properties) {
      const currentValue = this.properties.get(key);
      if (currentValue !== goalValue) return false;
    }
    return true;
  }

  /** Create a deep copy. */
  clone(): WorldState {
    const copy = new WorldState();
    for (const [key, value] of this.properties) {
      copy.properties.set(key, value);
    }
    return copy;
  }

  /**
   * Distance heuristic: count of differing properties.
   *
   * For A* planning, this counts properties in `other` that do not match
   * this state. This is an admissible heuristic because each action can
   * satisfy at most one property per step in the worst case.
   */
  distanceTo(other: WorldState): number {
    let count = 0;
    for (const [key, value] of other.properties) {
      if (this.properties.get(key) !== value) {
        count++;
      }
    }
    return count;
  }

  /**
   * Apply another state's properties as effects, returning a new WorldState.
   * Does not mutate the original.
   */
  applyEffects(effects: WorldState): WorldState {
    const next = this.clone();
    for (const [key, value] of effects.properties) {
      next.properties.set(key, value);
    }
    return next;
  }

  /** Return all property keys. Used by the planner for state fingerprinting. */
  keys(): IterableIterator<string> {
    return this.properties.keys();
  }
}
