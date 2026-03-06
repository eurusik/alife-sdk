/**
 * A*-based GOAP (Goal-Oriented Action Planning) solver.
 *
 * The planner treats the problem as a graph search:
 *   - Each NODE is a world state reachable by applying a sequence of actions.
 *   - Each EDGE is a GOAPAction whose preconditions are satisfied by the
 *     node's world state and whose effects advance toward the goal.
 *   - The cost of a path is the sum of action cost values along it.
 *   - The heuristic is state.distanceTo(goal) -- the count of unsatisfied
 *     goal properties (admissible, since each action satisfies at most one).
 *
 * Complexity:
 *   Time:  O(b^d) where b = |availableActions|, d = plan depth (<= maxDepth)
 *   Space: O(b^d) for the open/closed sets, bounded by maxDepth
 */

import { GOAPAction, ActionStatus } from './GOAPAction';
import type { GOAPActionDef } from './GOAPAction';
import { WorldState } from './WorldState';
import type { IEntity } from '../entity/IEntity';

// ---------------------------------------------------------------------------
// Internal planning node
// ---------------------------------------------------------------------------

interface PlanNode {
  /** World state at this node (after applying parent's action). */
  state: WorldState;
  /** The action taken from the parent to reach this node. Null for root. */
  action: GOAPAction | null;
  /** Parent node in the search graph. Null for root. */
  parent: PlanNode | null;
  /** Accumulated action cost from root to this node (g in A*). */
  g: number;
  /** Heuristic estimate of remaining cost to goal (h in A*). */
  h: number;
  /** f = g + h, used to sort the open set. */
  f: number;
  /** Depth of this node in the search tree (0 for root). */
  depth: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DEPTH = 10;

// ---------------------------------------------------------------------------
// GOAPPlanner
// ---------------------------------------------------------------------------

export class GOAPPlanner {
  private readonly actions: GOAPAction[] = [];
  private readonly defaultMaxDepth: number;

  // Scratch fields — reused across plan() calls
  private _sortedKeys: string[] | null = null;
  private readonly _closed = new Set<number>();

  // P21: Incrementally accumulated keys from all registered actions.
  private readonly _actionKeys = new Set<string>();

  // P19: Binary min-heap storage for the open set (reused across plan() calls).
  private readonly _open: PlanNode[] = [];

  constructor(defaultMaxDepth: number = DEFAULT_MAX_DEPTH) {
    this.defaultMaxDepth = defaultMaxDepth;
  }

  /** Register an action that the planner can use when building plans. */
  registerAction(action: GOAPAction | GOAPActionDef): void {
    const resolved: GOAPAction = isGOAPActionDef(action)
      ? new InlineGOAPAction(action)
      : action;
    this.actions.push(resolved);

    // P21: Cache action keys incrementally.
    for (const k of resolved.getPreconditions().keys()) this._actionKeys.add(k);
    for (const k of resolved.getEffects().keys()) this._actionKeys.add(k);
  }

  /**
   * Find the optimal action sequence from the current state to the goal.
   *
   * @param currentState - Live world state snapshot for the agent.
   * @param goal         - Desired world state the agent wants to achieve.
   * @param maxDepth     - Maximum plan depth (default 10).
   * @returns Ordered action list (index 0 = first), or null if no plan found.
   */
  plan(
    currentState: WorldState,
    goal: WorldState,
    maxDepth: number = this.defaultMaxDepth,
  ): GOAPAction[] | null {
    const root: PlanNode = {
      state: currentState.clone(),
      action: null,
      parent: null,
      g: 0,
      h: currentState.distanceTo(goal),
      f: currentState.distanceTo(goal),
      depth: 0,
    };

    // P19: Reuse heap storage, clear from previous plan() call.
    const open = this._open;
    open.length = 0;
    this._heapPush(root);

    // Build sorted key universe from current state + goal + cached action keys.
    // This ensures the bitmask covers ALL keys that can appear during planning.
    this._buildKeyUniverse(currentState, goal);

    // Closed set: bitmask fingerprints to prevent re-expansion.
    this._closed.clear();

    while (open.length > 0) {
      const current = this._heapPop();

      // Goal check.
      if (current.state.satisfies(goal)) {
        return this.reconstructPlan(current);
      }

      // P20: Depth limit using stored depth.
      if (current.depth >= maxDepth) {
        continue;
      }

      // Mark visited.
      const stateKey = this.fingerprint(current.state);
      if (this._closed.has(stateKey)) {
        continue;
      }
      this._closed.add(stateKey);

      // Expand: try each action whose preconditions are met.
      for (const action of this.actions) {
        if (!current.state.satisfies(action.getPreconditions())) {
          continue;
        }

        // Apply action effects using WorldState's public API.
        const nextState = current.state.applyEffects(action.getEffects());
        const g = current.g + action.cost;
        const h = nextState.distanceTo(goal);

        const successor: PlanNode = {
          state: nextState,
          action,
          parent: current,
          g,
          h,
          f: g + h,
          depth: current.depth + 1,
        };

        const successorKey = this.fingerprint(nextState);
        if (!this._closed.has(successorKey)) {
          this._heapPush(successor);
        }
      }
    }

    // No plan found.
    return null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Walk from goal node to root, collecting actions in execution order. */
  private reconstructPlan(goalNode: PlanNode): GOAPAction[] {
    const plan: GOAPAction[] = [];
    let node: PlanNode | null = goalNode;

    while (node !== null && node.action !== null) {
      plan.push(node.action);
      node = node.parent;
    }

    plan.reverse();
    return plan;
  }

  // -----------------------------------------------------------------------
  // P19: Binary min-heap (keyed on f)
  // -----------------------------------------------------------------------

  /** Push a node onto the min-heap. */
  private _heapPush(node: PlanNode): void {
    this._open.push(node);
    this._heapSiftUp(this._open.length - 1);
  }

  /** Pop the node with the smallest f value from the min-heap. */
  private _heapPop(): PlanNode {
    const heap = this._open;
    if (heap.length === 0) {
      throw new Error('GOAPPlanner._heapPop: heap is empty');
    }
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      this._heapSiftDown(0);
    }
    return top;
  }

  /** Restore heap property upward from index i. */
  private _heapSiftUp(i: number): void {
    const heap = this._open;
    const node = heap[i];
    while (i > 0) {
      const parentIdx = (i - 1) >>> 1;
      if (heap[parentIdx].f <= node.f) break;
      heap[i] = heap[parentIdx];
      i = parentIdx;
    }
    heap[i] = node;
  }

  /** Restore heap property downward from index i. */
  private _heapSiftDown(i: number): void {
    const heap = this._open;
    const len = heap.length;
    const node = heap[i];
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && heap[left].f < heap[smallest].f) smallest = left;
      if (right < len && heap[right].f < heap[smallest].f) smallest = right;
      if (smallest === i) break;
      heap[i] = heap[smallest];
      i = smallest;
    }
    heap[i] = node;
  }

  /**
   * Create a compact numeric fingerprint of ALL world-state values.
   *
   * For boolean-only states (the common case with DEFAULT_WORLD_PROPERTY_BUILDERS),
   * encodes as a 31-bit bitmask — zero allocations. Result is always non-negative
   * (0 to 2^31-1). Falls back to djb2 hash when:
   *   - key universe exceeds 31 keys (C2: avoids sign-bit corruption at i=31)
   *   - an explicit `false` value is present (C1: distinguishes false from absent)
   *   - a non-boolean value is present
   * djb2 results are tagged with 0x80000000, making them always negative and
   * thus disjoint from the bitmask domain (C3: no cross-domain collisions).
   */
  private fingerprint(state: WorldState): number {
    const keys = this._sortedKeys!;

    // C2: fall through to hash when key universe exceeds safe bitmask capacity.
    // Using 31 bits avoids sign-bit issues with `1 << 31` in 32-bit signed int.
    if (keys.length >= 31) {
      return this.fingerprintHash(state);
    }

    let mask = 0;
    for (let i = 0; i < keys.length; i++) {
      const val = state.get(keys[i]);
      if (val === true) {
        mask |= (1 << i);
      } else if (val === false) {
        // C1: explicit false vs absent key (undefined) are semantically different
        // in WorldState.satisfies() — must use hash to distinguish them.
        return this.fingerprintHash(state);
      } else if (val !== undefined) {
        // Non-boolean value — use hash.
        return this.fingerprintHash(state);
      }
      // undefined (absent key): bit stays 0.
    }
    return mask; // Non-negative: 0 to 2^30
  }

  /**
   * Build the sorted key universe from current state, goal, and cached
   * action keys. Ensures the bitmask fingerprint covers every key that
   * can appear during planning.
   *
   * P21: Action keys are accumulated incrementally in registerAction(),
   * so this method only needs to union them with state/goal keys.
   */
  private _buildKeyUniverse(currentState: WorldState, goal: WorldState): void {
    const keySet = new Set<string>(this._actionKeys);
    for (const k of currentState.keys()) keySet.add(k);
    for (const k of goal.keys()) keySet.add(k);
    this._sortedKeys = [...keySet].sort();
  }

  /**
   * djb2 hash fallback for WorldStates containing non-boolean values,
   * explicit `false` keys, or key universes larger than 31.
   *
   * C3: Result is always tagged with 0x80000000, making it a negative
   * int32. This keeps the djb2 domain (negative) disjoint from the
   * bitmask domain (non-negative, 0 to 2^30), preventing cross-domain
   * fingerprint collisions.
   */
  private fingerprintHash(state: WorldState): number {
    let h = 5381;
    for (const key of this._sortedKeys!) {
      const val = state.get(key);
      const str = `${key}:${val}`;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) + str.charCodeAt(i);
      }
    }
    // Tag with high bit: result is always negative (int32), disjoint from bitmask.
    return h | 0x80000000;
  }
}

// ---------------------------------------------------------------------------
// Plain-object action support (module-private)
// ---------------------------------------------------------------------------

function isGOAPActionDef(a: GOAPAction | GOAPActionDef): a is GOAPActionDef {
  return !(a instanceof GOAPAction);
}

class InlineGOAPAction extends GOAPAction {
  readonly id: string;
  readonly cost: number;
  private readonly _pre: WorldState;
  private readonly _eff: WorldState;
  private readonly _isValid?: (entity: IEntity) => boolean;
  private readonly _execute?: (entity: IEntity, delta: number) => ActionStatus;

  constructor(def: GOAPActionDef) {
    super();
    this.id   = def.id;
    this.cost = def.cost;
    this._pre = WorldState.from(def.preconditions);
    this._eff = WorldState.from(def.effects);
    this._isValid  = def.isValid;
    this._execute  = def.execute;
  }

  getPreconditions(): WorldState { return this._pre; }
  getEffects():       WorldState { return this._eff; }
  isValid(entity: IEntity): boolean  { return this._isValid ? this._isValid(entity) : true; }
  execute(entity: IEntity, delta: number): ActionStatus {
    return this._execute ? this._execute(entity, delta) : ActionStatus.SUCCESS;
  }
}
