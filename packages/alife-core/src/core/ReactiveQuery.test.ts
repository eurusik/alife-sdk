import { ReactiveQuery } from './ReactiveQuery';
import type { QueryChanges } from './ReactiveQuery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Entity {
  id: string;
  alive: boolean;
  hostile: boolean;
}

const e = (id: string, alive = true, hostile = false): Entity => ({ id, alive, hostile });

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('ReactiveQuery.update', () => {
  it('matches entities satisfying the predicate', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    q.update([e('a'), e('b', false), e('c')]);
    expect(q.current.map(x => x.id)).toEqual(expect.arrayContaining(['a', 'c']));
    expect(q.size).toBe(2);
  });

  it('fires onChange with added entries on first update', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));

    q.update([e('a'), e('b'), e('c', false)]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.added.map(x => x.id)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(calls[0]!.removed).toHaveLength(0);
  });

  it('fires onChange with removed entries when entity leaves the set', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const calls: QueryChanges<Entity>[] = [];

    const entity = e('a');
    q.update([entity]);
    q.onChange((ch) => calls.push(ch));

    entity.alive = false;
    q.update([entity]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.removed.map(x => x.id)).toEqual(['a']);
    expect(calls[0]!.added).toHaveLength(0);
  });

  it('does NOT fire onChange when the matched set is unchanged', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const entity = e('a');
    q.update([entity]);

    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));

    q.update([entity]); // same entity, still matches
    expect(calls).toHaveLength(0);
  });

  it('fires both added and removed in the same update when the set changes', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const calls: QueryChanges<Entity>[] = [];

    const a = e('a');
    const b = e('b', false);
    q.update([a, b]);

    q.onChange((ch) => calls.push(ch));

    // a dies, b becomes alive
    a.alive = false;
    b.alive = true;
    q.update([a, b]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.removed.map(x => x.id)).toEqual(['a']);
    expect(calls[0]!.added.map(x => x.id)).toEqual(['b']);
  });

  it('current snapshot reflects state after the update', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const a = e('a');
    const b = e('b', false);
    q.update([a, b]);
    expect(q.current.map(x => x.id)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// has / size
// ---------------------------------------------------------------------------

describe('has / size', () => {
  it('has returns true for matched entities', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const a = e('a');
    q.update([a]);
    expect(q.has(a)).toBe(true);
  });

  it('has returns false for unmatched entities', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const a = e('a', false);
    q.update([a]);
    expect(q.has(a)).toBe(false);
  });

  it('size reflects the number of matched entities', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    q.update([e('a'), e('b'), e('c', false)]);
    expect(q.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// onChange subscription
// ---------------------------------------------------------------------------

describe('onChange subscription', () => {
  it('unsubscribe stops future notifications', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const calls: number[] = [];
    const unsub = q.onChange(() => calls.push(1));
    q.update([e('a')]);
    unsub();
    q.update([e('b')]);
    expect(calls).toHaveLength(1);
  });

  it('multiple listeners all receive the same changes', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const results: string[][] = [];

    q.onChange(({ added }) => results.push(added.map(x => x.id)));
    q.onChange(({ added }) => results.push(added.map(x => x.id)));

    q.update([e('a')]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
  });

  it('current in the change event is the post-update matched set', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const snapshots: string[][] = [];
    q.onChange(({ current }) => snapshots.push(current.map(x => x.id)));

    q.update([e('a'), e('b')]);
    expect(snapshots[0]).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

// ---------------------------------------------------------------------------
// track / untrack
// ---------------------------------------------------------------------------

describe('track / untrack', () => {
  it('track adds an entity to the matched set and fires onChange', () => {
    const q = new ReactiveQuery<Entity>(() => false);
    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));

    const a = e('a');
    q.track(a);

    expect(q.has(a)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.added).toContain(a);
  });

  it('track does nothing for an already-tracked entity', () => {
    const q = new ReactiveQuery<Entity>(() => true);
    const a = e('a');
    q.update([a]);

    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));
    q.track(a);

    expect(calls).toHaveLength(0);
  });

  it('untrack removes an entity and fires onChange', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const a = e('a');
    q.update([a]);

    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));
    q.untrack(a);

    expect(q.has(a)).toBe(false);
    expect(calls[0]!.removed).toContain(a);
  });

  it('untrack does nothing for a non-tracked entity', () => {
    const q = new ReactiveQuery<Entity>(() => false);
    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));

    q.untrack(e('x'));
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('clears matched set immediately', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    q.update([e('a'), e('b')]);
    expect(q.size).toBe(2);
    q.dispose();
    expect(q.size).toBe(0);
  });

  it('removes all listeners so subsequent track/untrack fire nothing', () => {
    const q = new ReactiveQuery<Entity>((e) => e.alive);
    const a = e('a');
    q.update([a]);

    const calls: QueryChanges<Entity>[] = [];
    q.onChange((ch) => calls.push(ch));
    q.dispose();

    q.track(a);
    q.untrack(a);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration — hostile entity tracking
// ---------------------------------------------------------------------------

describe('Integration: hostile entity tracking', () => {
  it('tracks transitions from peaceful to hostile mid-simulation', () => {
    const entities: Entity[] = [
      e('guard', true, false),
      e('wolf', true, true),
      e('corpse', false, false),
    ];

    const q = new ReactiveQuery<Entity>((e) => e.alive && e.hostile);
    const tracked: string[] = [];
    const untracked: string[] = [];

    q.onChange(({ added, removed }) => {
      added.forEach(e => tracked.push(e.id));
      removed.forEach(e => untracked.push(e.id));
    });

    q.update(entities); // wolf enters
    expect(tracked).toEqual(['wolf']);

    // guard becomes hostile
    entities[0]!.hostile = true;
    q.update(entities);
    expect(tracked).toContain('guard');

    // wolf dies
    entities[1]!.alive = false;
    q.update(entities);
    expect(untracked).toContain('wolf');
  });
});
