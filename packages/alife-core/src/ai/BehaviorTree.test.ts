import {
  Blackboard,
  Task,
  Condition,
  Sequence,
  Selector,
  Parallel,
  Inverter,
  AlwaysSucceed,
  AlwaysFail,
  Repeater,
  Cooldown,
} from './BehaviorTree';
import type { TaskStatus, ITreeNode } from './BehaviorTree';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const succeed = (): ITreeNode => new Task(() => 'success');
const fail = (): ITreeNode => new Task(() => 'failure');
const run = (): ITreeNode => new Task(() => 'running');
const bb = () => new Blackboard();

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

describe('Blackboard', () => {
  it('stores and retrieves values', () => {
    const board = new Blackboard<{ hp: number }>({ hp: 100 });
    expect(board.get('hp')).toBe(100);
  });

  it('set updates a value', () => {
    const board = new Blackboard<{ hp: number }>({ hp: 100 });
    board.set('hp', 50);
    expect(board.get('hp')).toBe(50);
  });

  it('has returns false for absent keys', () => {
    const board = new Blackboard<{ hp: number }>();
    expect(board.has('hp')).toBe(false);
  });

  it('delete removes a key', () => {
    const board = new Blackboard<{ hp: number }>({ hp: 100 });
    board.delete('hp');
    expect(board.has('hp')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task / Condition
// ---------------------------------------------------------------------------

describe('Task', () => {
  it('returns whatever the callback returns', () => {
    expect(new Task(() => 'success').tick(bb())).toBe('success');
    expect(new Task(() => 'failure').tick(bb())).toBe('failure');
    expect(new Task(() => 'running').tick(bb())).toBe('running');
  });

  it('receives the blackboard', () => {
    const board = new Blackboard<{ x: number }>({ x: 42 });
    let received: number | undefined;
    new Task<typeof board>((b) => { received = b.get('x'); return 'success'; }).tick(board);
    expect(received).toBe(42);
  });
});

describe('Condition', () => {
  it('returns success when predicate is true', () => {
    expect(new Condition(() => true).tick(bb())).toBe('success');
  });

  it('returns failure when predicate is false', () => {
    expect(new Condition(() => false).tick(bb())).toBe('failure');
  });
});

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

describe('Sequence', () => {
  it('returns success when all children succeed', () => {
    expect(new Sequence([succeed(), succeed(), succeed()]).tick(bb())).toBe('success');
  });

  it('returns failure on first failing child and stops', () => {
    const after = vi.fn(() => 'success' as TaskStatus);
    const result = new Sequence([succeed(), fail(), new Task(after)]).tick(bb());
    expect(result).toBe('failure');
    expect(after).not.toHaveBeenCalled();
  });

  it('returns running on first running child and stops', () => {
    const after = vi.fn(() => 'success' as TaskStatus);
    const result = new Sequence([succeed(), run(), new Task(after)]).tick(bb());
    expect(result).toBe('running');
    expect(after).not.toHaveBeenCalled();
  });

  it('returns success for empty children', () => {
    expect(new Sequence([]).tick(bb())).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

describe('Selector', () => {
  it('returns success on first succeeding child and stops', () => {
    const after = vi.fn(() => 'success' as TaskStatus);
    const result = new Selector([fail(), succeed(), new Task(after)]).tick(bb());
    expect(result).toBe('success');
    expect(after).not.toHaveBeenCalled();
  });

  it('returns failure when all children fail', () => {
    expect(new Selector([fail(), fail(), fail()]).tick(bb())).toBe('failure');
  });

  it('returns running on first running child and stops', () => {
    const after = vi.fn(() => 'success' as TaskStatus);
    const result = new Selector([fail(), run(), new Task(after)]).tick(bb());
    expect(result).toBe('running');
    expect(after).not.toHaveBeenCalled();
  });

  it('returns failure for empty children', () => {
    expect(new Selector([]).tick(bb())).toBe('failure');
  });
});

// ---------------------------------------------------------------------------
// Parallel
// ---------------------------------------------------------------------------

describe('Parallel', () => {
  it('require-all: returns success when all succeed', () => {
    expect(new Parallel([succeed(), succeed()], 'require-all').tick(bb())).toBe('success');
  });

  it('require-all: returns running when any child is running', () => {
    expect(new Parallel([succeed(), run()], 'require-all').tick(bb())).toBe('running');
  });

  it('require-all: returns failure when any child fails', () => {
    expect(new Parallel([succeed(), fail()], 'require-all').tick(bb())).toBe('failure');
  });

  it('require-one: returns success when at least one succeeds', () => {
    expect(new Parallel([fail(), succeed()], 'require-one').tick(bb())).toBe('success');
  });

  it('require-one: returns failure when all children fail', () => {
    expect(new Parallel([fail(), fail()], 'require-one').tick(bb())).toBe('failure');
  });

  it('require-one: returns running when some fail but some are running', () => {
    expect(new Parallel([fail(), run()], 'require-one').tick(bb())).toBe('running');
  });

  it('default policy is require-all', () => {
    expect(new Parallel([succeed(), succeed()]).tick(bb())).toBe('success');
    expect(new Parallel([succeed(), run()]).tick(bb())).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// Inverter
// ---------------------------------------------------------------------------

describe('Inverter', () => {
  it('flips success to failure', () => {
    expect(new Inverter(succeed()).tick(bb())).toBe('failure');
  });

  it('flips failure to success', () => {
    expect(new Inverter(fail()).tick(bb())).toBe('success');
  });

  it('passes running unchanged', () => {
    expect(new Inverter(run()).tick(bb())).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// AlwaysSucceed / AlwaysFail
// ---------------------------------------------------------------------------

describe('AlwaysSucceed', () => {
  it.each([succeed(), fail(), run()] as ITreeNode[])(
    'always returns success regardless of child',
    (child) => {
      expect(new AlwaysSucceed(child).tick(bb())).toBe('success');
    },
  );
});

describe('AlwaysFail', () => {
  it.each([succeed(), fail(), run()] as ITreeNode[])(
    'always returns failure regardless of child',
    (child) => {
      expect(new AlwaysFail(child).tick(bb())).toBe('failure');
    },
  );
});

// ---------------------------------------------------------------------------
// Repeater
// ---------------------------------------------------------------------------

describe('Repeater', () => {
  it('returns running while repeating', () => {
    const node = new Repeater(succeed(), 3);
    expect(node.tick(bb())).toBe('running');
    expect(node.tick(bb())).toBe('running');
  });

  it('returns success after N successes', () => {
    const node = new Repeater(succeed(), 2);
    node.tick(bb()); // iteration 1 → running
    expect(node.tick(bb())).toBe('success'); // iteration 2 → success
  });

  it('returns failure immediately if child fails', () => {
    const node = new Repeater(fail(), 3);
    expect(node.tick(bb())).toBe('failure');
  });

  it('reset allows reuse', () => {
    const node = new Repeater(succeed(), 1);
    node.tick(bb()); // completes
    node.reset();
    expect(node.tick(bb())).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe('Cooldown', () => {
  it('ticks child normally when not on cooldown', () => {
    const node = new Cooldown(succeed(), 1000);
    expect(node.tick(bb())).toBe('success');
  });

  it('returns failure while on cooldown', () => {
    let now = 0;
    const clock = () => now;
    const node = new Cooldown(succeed(), 1000, clock);
    node.tick(bb()); // triggers cooldown
    now = 500;       // still within cooldown
    expect(node.tick(bb())).toBe('failure');
  });

  it('becomes available again after cooldown expires', () => {
    let now = 0;
    const clock = () => now;
    const node = new Cooldown(succeed(), 1000, clock);
    node.tick(bb());    // triggers cooldown at now=0, readyAt=1000
    now = 1000;         // exactly at readyAt
    expect(node.tick(bb())).toBe('success');
  });

  it('isOnCooldown reflects cooldown state', () => {
    let now = 0;
    const clock = () => now;
    const node = new Cooldown(succeed(), 1000, clock);
    expect(node.isOnCooldown).toBe(false);
    node.tick(bb());
    expect(node.isOnCooldown).toBe(true);
    now = 1001;
    expect(node.isOnCooldown).toBe(false);
  });

  it('reset clears the cooldown immediately', () => {
    let now = 0;
    const clock = () => now;
    const node = new Cooldown(succeed(), 1000, clock);
    node.tick(bb());
    node.reset();
    expect(node.isOnCooldown).toBe(false);
    expect(node.tick(bb())).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Integration — attack-or-patrol example
// ---------------------------------------------------------------------------

describe('Integration: attack-or-patrol', () => {
  it('attacks when target visible and has ammo; patrols otherwise', () => {
    type BB = { canSeeTarget: boolean; ammo: number };
    const board = new Blackboard<BB>({ canSeeTarget: false, ammo: 5 });

    const attacked: string[] = [];
    const patrolled: string[] = [];

    const tree = new Selector<Blackboard<BB>>([
      new Sequence([
        new Condition((b) => !!b.get('canSeeTarget')),
        new Condition((b) => (b.get('ammo') ?? 0) > 0),
        new Task((b) => { attacked.push('shot'); b.set('ammo', (b.get('ammo') ?? 0) - 1); return 'success'; }),
      ]),
      new Task(() => { patrolled.push('patrol'); return 'running'; }),
    ]);

    // no target → patrol
    tree.tick(board);
    expect(patrolled).toHaveLength(1);
    expect(attacked).toHaveLength(0);

    // target visible → attack
    board.set('canSeeTarget', true);
    tree.tick(board);
    expect(attacked).toHaveLength(1);
    expect(board.get('ammo')).toBe(4);
  });
});
