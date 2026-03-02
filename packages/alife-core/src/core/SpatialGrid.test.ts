import { SpatialGrid } from './SpatialGrid';
import type { Vec2 } from './Vec2';

interface TestItem {
  id: string;
  pos: Vec2;
}

function makeItem(id: string, x: number, y: number): TestItem {
  return { id, pos: { x, y } };
}

describe('SpatialGrid', () => {
  let grid: SpatialGrid<TestItem>;

  beforeEach(() => {
    grid = new SpatialGrid<TestItem>(100, (item) => item.pos);
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('throws on cellSize <= 0', () => {
      expect(() => new SpatialGrid<TestItem>(0, (i) => i.pos)).toThrow(RangeError);
      expect(() => new SpatialGrid<TestItem>(-10, (i) => i.pos)).toThrow(RangeError);
    });

    it('accepts a positive cellSize', () => {
      expect(() => new SpatialGrid<TestItem>(1, (i) => i.pos)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // insert + queryRadius
  // ---------------------------------------------------------------------------
  describe('insert + queryRadius', () => {
    it('finds an item within radius', () => {
      const a = makeItem('a', 50, 50);
      grid.insert(a);

      const results = grid.queryRadius({ x: 50, y: 50 }, 10);
      expect(results).toContain(a);
    });

    it('does not find an item outside radius', () => {
      const a = makeItem('a', 50, 50);
      grid.insert(a);

      const results = grid.queryRadius({ x: 200, y: 200 }, 10);
      expect(results).not.toContain(a);
    });

    it('finds multiple items within radius', () => {
      const a = makeItem('a', 10, 10);
      const b = makeItem('b', 15, 15);
      const c = makeItem('c', 500, 500);
      grid.insert(a);
      grid.insert(b);
      grid.insert(c);

      const results = grid.queryRadius({ x: 12, y: 12 }, 20);
      expect(results).toContain(a);
      expect(results).toContain(b);
      expect(results).not.toContain(c);
    });

    it('boundary: item exactly on radius is included (<=)', () => {
      const a = makeItem('a', 100, 0);
      grid.insert(a);

      // distance from (0,0) to (100,0) = 100, radius = 100
      const results = grid.queryRadius({ x: 0, y: 0 }, 100);
      expect(results).toContain(a);
    });

    it('returns empty array when grid is empty', () => {
      const results = grid.queryRadius({ x: 0, y: 0 }, 1000);
      expect(results).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // queryRect
  // ---------------------------------------------------------------------------
  describe('queryRect', () => {
    it('finds items inside the rectangle', () => {
      const a = makeItem('a', 50, 50);
      const b = makeItem('b', 150, 150);
      grid.insert(a);
      grid.insert(b);

      const results = grid.queryRect({ x: 0, y: 0, width: 100, height: 100 });
      expect(results).toContain(a);
      expect(results).not.toContain(b);
    });

    it('includes items on the boundary (inclusive check)', () => {
      const a = makeItem('a', 0, 0);
      const b = makeItem('b', 100, 100);
      grid.insert(a);
      grid.insert(b);

      const results = grid.queryRect({ x: 0, y: 0, width: 100, height: 100 });
      expect(results).toContain(a);
      expect(results).toContain(b);
    });

    it('returns empty for a rect with no items', () => {
      const a = makeItem('a', 500, 500);
      grid.insert(a);

      const results = grid.queryRect({ x: 0, y: 0, width: 50, height: 50 });
      expect(results).toEqual([]);
    });

    it('returns correct results for a non-origin rectangle', () => {
      const inside = makeItem('inside', 100, 100);
      const before = makeItem('before', 10, 10);
      const after = makeItem('after', 200, 200);
      grid.insert(inside);
      grid.insert(before);
      grid.insert(after);

      const results = grid.queryRect({ x: 50, y: 50, width: 100, height: 100 });
      expect(results).toContain(inside);
      expect(results).not.toContain(before);
      expect(results).not.toContain(after);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('removes an item so it is no longer found', () => {
      const a = makeItem('a', 50, 50);
      grid.insert(a);
      expect(grid.size).toBe(1);

      const removed = grid.remove(a);
      expect(removed).toBe(true);
      expect(grid.size).toBe(0);

      const results = grid.queryRadius({ x: 50, y: 50 }, 100);
      expect(results).not.toContain(a);
    });

    it('returns false when removing an item not in the grid', () => {
      const a = makeItem('a', 50, 50);
      expect(grid.remove(a)).toBe(false);
    });

    it('does not affect other items', () => {
      const a = makeItem('a', 10, 10);
      const b = makeItem('b', 20, 20);
      grid.insert(a);
      grid.insert(b);

      grid.remove(a);
      expect(grid.size).toBe(1);

      const results = grid.queryRadius({ x: 20, y: 20 }, 5);
      expect(results).toContain(b);
    });
  });

  // ---------------------------------------------------------------------------
  // update (cell migration)
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('migrates an item to a new cell when position crosses boundary', () => {
      const a = makeItem('a', 10, 10); // cell 0_0 (cellSize=100)
      grid.insert(a);

      // Move to a different cell
      a.pos = { x: 250, y: 250 }; // cell 2_2
      grid.update(a);

      // Should no longer appear near old position
      const oldResults = grid.queryRadius({ x: 10, y: 10 }, 20);
      expect(oldResults).not.toContain(a);

      // Should appear near new position
      const newResults = grid.queryRadius({ x: 250, y: 250 }, 20);
      expect(newResults).toContain(a);
    });

    it('is a no-op if position stays in the same cell', () => {
      const a = makeItem('a', 10, 10);
      grid.insert(a);

      // Move within the same cell (0_0 for cellSize=100)
      a.pos = { x: 50, y: 50 };
      grid.update(a);

      expect(grid.size).toBe(1);
      const results = grid.queryRadius({ x: 50, y: 50 }, 10);
      expect(results).toContain(a);
    });

    it('inserts automatically if item is not yet tracked', () => {
      const a = makeItem('a', 10, 10);
      grid.update(a); // not yet inserted — should auto-insert

      expect(grid.size).toBe(1);
      const results = grid.queryRadius({ x: 10, y: 10 }, 20);
      expect(results).toContain(a);
    });
  });

  // ---------------------------------------------------------------------------
  // clear + size
  // ---------------------------------------------------------------------------
  describe('clear + size', () => {
    it('starts with size 0', () => {
      expect(grid.size).toBe(0);
    });

    it('size reflects the number of tracked items', () => {
      grid.insert(makeItem('a', 0, 0));
      grid.insert(makeItem('b', 100, 100));
      expect(grid.size).toBe(2);
    });

    it('clear removes all items', () => {
      grid.insert(makeItem('a', 0, 0));
      grid.insert(makeItem('b', 100, 100));
      grid.insert(makeItem('c', 200, 200));

      grid.clear();
      expect(grid.size).toBe(0);

      const results = grid.queryRadius({ x: 0, y: 0 }, 10000);
      expect(results).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Duplicate insert
  // ---------------------------------------------------------------------------
  describe('duplicate insert', () => {
    it('re-inserting the same item acts like update', () => {
      const a = makeItem('a', 10, 10);
      grid.insert(a);
      grid.insert(a); // duplicate — should not create a second entry

      expect(grid.size).toBe(1);
    });
  });
});
