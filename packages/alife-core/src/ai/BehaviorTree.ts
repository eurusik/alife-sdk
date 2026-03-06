/**
 * Behavior Tree — hierarchical AI task composition.
 *
 * Pairs well with GOAP: GOAP decides *what* goal to pursue, the BT decides
 * *how* to execute it step by step. The BT is driven externally by calling
 * `tree.tick(blackboard)` each frame or simulation step.
 *
 * Node types:
 *   Composites  — Sequence, Selector, Parallel
 *   Decorators  — Inverter, Repeater, AlwaysSucceed, AlwaysFail, Cooldown
 *   Leaves      — Task (action), Condition
 *
 * Blackboard:
 *   Typed key-value store shared across all nodes in one tick. Nodes read
 *   perception data from it and write intermediate results to it.
 *
 * @example
 * ```ts
 * const bb = new Blackboard({ canSeeTarget: false, ammoCount: 10 });
 *
 * const tree = new Selector([
 *   new Sequence([
 *     new Condition((bb) => bb.get('canSeeTarget')),
 *     new Condition((bb) => bb.get('ammoCount') > 0),
 *     new Task((bb) => { shoot(); return 'success'; }),
 *   ]),
 *   new Task(() => { patrol(); return 'running'; }),
 * ]);
 *
 * // Each frame:
 * tree.tick(bb);
 * ```
 */

// ---------------------------------------------------------------------------
// TaskStatus
// ---------------------------------------------------------------------------

/** Result returned by every node's `tick()`. */
export type TaskStatus = 'success' | 'failure' | 'running';

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

/**
 * Typed key-value store shared across all nodes during a single tick.
 *
 * Initialize it with a plain object; the keys become the allowed set of keys
 * via the generic type parameter.
 */
export class Blackboard<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly data: Map<keyof T, T[keyof T]>;

  constructor(initial: Partial<T> = {}) {
    this.data = new Map(Object.entries(initial) as [keyof T, T[keyof T]][]);
  }

  get<K extends keyof T>(key: K): T[K] | undefined {
    return this.data.get(key) as T[K] | undefined;
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data.set(key, value);
  }

  has(key: keyof T): boolean {
    return this.data.has(key);
  }

  delete(key: keyof T): void {
    this.data.delete(key);
  }
}

// ---------------------------------------------------------------------------
// ITreeNode
// ---------------------------------------------------------------------------

/** Every node in the tree implements this single interface. */
export interface ITreeNode<TBB extends Blackboard = Blackboard> {
  tick(blackboard: TBB): TaskStatus;
}

// ---------------------------------------------------------------------------
// Leaf nodes
// ---------------------------------------------------------------------------

/**
 * Task (action leaf).
 * Runs an arbitrary callback; the callback returns the status directly.
 */
export class Task<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly action: (bb: TBB) => TaskStatus) {}

  tick(bb: TBB): TaskStatus {
    return this.action(bb);
  }
}

/**
 * Condition (boolean leaf).
 * Returns 'success' when the predicate is true, 'failure' otherwise.
 */
export class Condition<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly predicate: (bb: TBB) => boolean) {}

  tick(bb: TBB): TaskStatus {
    return this.predicate(bb) ? 'success' : 'failure';
  }
}

// ---------------------------------------------------------------------------
// Composite nodes
// ---------------------------------------------------------------------------

/**
 * Sequence — AND gate.
 * Ticks children left-to-right. Returns 'failure' on the first failing child,
 * 'running' on the first running child, 'success' when all succeed.
 */
export class Sequence<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly children: ITreeNode<TBB>[]) {}

  tick(bb: TBB): TaskStatus {
    for (const child of this.children) {
      const status = child.tick(bb);
      if (status !== 'success') return status;
    }
    return 'success';
  }
}

/**
 * Selector — OR gate.
 * Ticks children left-to-right. Returns 'success' on the first succeeding
 * child, 'running' on the first running child, 'failure' when all fail.
 */
export class Selector<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly children: ITreeNode<TBB>[]) {}

  tick(bb: TBB): TaskStatus {
    for (const child of this.children) {
      const status = child.tick(bb);
      if (status !== 'failure') return status;
    }
    return 'failure';
  }
}

/** Policy for the Parallel node. */
export type ParallelPolicy = 'require-all' | 'require-one';

/**
 * Parallel — ticks ALL children every tick simultaneously.
 *
 * `require-all` (default — AND semantics):
 *   - Success: all children succeed.
 *   - Failure: any child fails.
 *   - Running: otherwise.
 *
 * `require-one` (OR semantics):
 *   - Success: at least one child succeeds.
 *   - Failure: all children fail.
 *   - Running: otherwise (some running, none succeeded yet).
 */
export class Parallel<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(
    private readonly children: ITreeNode<TBB>[],
    private readonly successPolicy: ParallelPolicy = 'require-all',
  ) {}

  tick(bb: TBB): TaskStatus {
    let successCount = 0;
    let failureCount = 0;

    for (const child of this.children) {
      const status = child.tick(bb);
      if (status === 'success') successCount++;
      else if (status === 'failure') failureCount++;
    }

    if (this.successPolicy === 'require-all') {
      if (failureCount > 0) return 'failure';
      if (successCount === this.children.length) return 'success';
    } else {
      if (successCount > 0) return 'success';
      if (failureCount === this.children.length) return 'failure';
    }

    return 'running';
  }
}

// ---------------------------------------------------------------------------
// Decorator nodes
// ---------------------------------------------------------------------------

/**
 * Inverter — flips 'success' ↔ 'failure'; passes 'running' unchanged.
 */
export class Inverter<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly child: ITreeNode<TBB>) {}

  tick(bb: TBB): TaskStatus {
    const status = this.child.tick(bb);
    if (status === 'success') return 'failure';
    if (status === 'failure') return 'success';
    return 'running';
  }
}

/**
 * AlwaysSucceed — maps any child result to 'success'.
 */
export class AlwaysSucceed<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly child: ITreeNode<TBB>) {}

  tick(bb: TBB): TaskStatus {
    this.child.tick(bb);
    return 'success';
  }
}

/**
 * AlwaysFail — maps any child result to 'failure'.
 */
export class AlwaysFail<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  constructor(private readonly child: ITreeNode<TBB>) {}

  tick(bb: TBB): TaskStatus {
    this.child.tick(bb);
    return 'failure';
  }
}

/**
 * Repeater — ticks its child N times, returning 'success' after all iterations.
 * If the child returns 'failure' the repeater short-circuits with 'failure'.
 * Pass `Infinity` for an endless loop (returns 'running' every tick).
 */
export class Repeater<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  private remaining: number;

  constructor(
    private readonly child: ITreeNode<TBB>,
    private readonly times: number,
  ) {
    this.remaining = times;
  }

  tick(bb: TBB): TaskStatus {
    if (this.remaining <= 0) return 'success';

    const status = this.child.tick(bb);
    if (status === 'failure') return 'failure';

    if (status === 'success') {
      this.remaining--;
      if (this.remaining <= 0) return 'success';
    }

    return 'running';
  }

  /** Reset the repeat counter to allow reuse. */
  reset(): void {
    this.remaining = this.times;
  }
}

/**
 * Cooldown — blocks its child while a cooldown timer is active.
 *
 * When the cooldown is inactive: ticks the child normally. If the child
 * succeeds, starts the cooldown and returns 'success'. While the cooldown
 * is active: immediately returns 'failure' (the action is on cooldown).
 *
 * `now` defaults to `Date.now` — inject a custom clock for deterministic tests.
 */
export class Cooldown<TBB extends Blackboard = Blackboard> implements ITreeNode<TBB> {
  private readyAt = 0;

  constructor(
    private readonly child: ITreeNode<TBB>,
    private readonly durationMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  tick(bb: TBB): TaskStatus {
    if (this.clock() < this.readyAt) return 'failure';

    const status = this.child.tick(bb);
    if (status === 'success') {
      this.readyAt = this.clock() + this.durationMs;
    }
    return status;
  }

  /** Force the cooldown to expire immediately. */
  reset(): void {
    this.readyAt = 0;
  }

  /** `true` while the cooldown timer is active. */
  get isOnCooldown(): boolean {
    return this.clock() < this.readyAt;
  }
}
