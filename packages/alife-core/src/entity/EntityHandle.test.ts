import {
  makeHandle,
  indexOf,
  genOf,
  isValidHandle,
  handleToString,
  NULL_HANDLE,
  EntityHandleManager,
} from './EntityHandle';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe('makeHandle / indexOf / genOf', () => {
  it('round-trips index and generation', () => {
    const h = makeHandle(42, 7);
    expect(indexOf(h)).toBe(42);
    expect(genOf(h)).toBe(7);
  });

  it('NULL_HANDLE has index 0 and generation 0', () => {
    expect(NULL_HANDLE).toBe(0);
    expect(indexOf(NULL_HANDLE)).toBe(0);
    expect(genOf(NULL_HANDLE)).toBe(0);
  });

  it('isValidHandle returns false for NULL_HANDLE', () => {
    expect(isValidHandle(NULL_HANDLE)).toBe(false);
  });

  it('isValidHandle returns true for a non-null handle', () => {
    expect(isValidHandle(makeHandle(1, 1))).toBe(true);
  });

  it('handles with same index but different generation are distinct values', () => {
    const h1 = makeHandle(5, 1);
    const h2 = makeHandle(5, 2);
    expect(h1).not.toBe(h2);
    expect(indexOf(h1)).toBe(5);
    expect(indexOf(h2)).toBe(5);
    expect(genOf(h1)).toBe(1);
    expect(genOf(h2)).toBe(2);
  });
});

describe('handleToString', () => {
  it('formats NULL_HANDLE', () => {
    expect(handleToString(NULL_HANDLE)).toBe('Entity(NULL)');
  });

  it('formats a live handle', () => {
    const h = makeHandle(3, 2);
    expect(handleToString(h)).toBe('Entity(idx=3, gen=2)');
  });
});

// ---------------------------------------------------------------------------
// EntityHandleManager
// ---------------------------------------------------------------------------

describe('EntityHandleManager', () => {
  describe('alloc', () => {
    it('returns a valid handle', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('npc-1');
      expect(isValidHandle(h)).toBe(true);
    });

    it('resolve returns the id for a live handle', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('wolf-1');
      expect(mgr.resolve(h)).toBe('wolf-1');
    });

    it('allocated handles have distinct values', () => {
      const mgr = new EntityHandleManager();
      const h1 = mgr.alloc('a');
      const h2 = mgr.alloc('b');
      expect(h1).not.toBe(h2);
    });

    it('size increments with each alloc', () => {
      const mgr = new EntityHandleManager();
      expect(mgr.size).toBe(0);
      mgr.alloc('a');
      expect(mgr.size).toBe(1);
      mgr.alloc('b');
      expect(mgr.size).toBe(2);
    });
  });

  describe('free', () => {
    it('resolve returns null after free', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('npc-1');
      mgr.free(h);
      expect(mgr.resolve(h)).toBeNull();
    });

    it('isAlive returns false after free', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('npc-1');
      mgr.free(h);
      expect(mgr.isAlive(h)).toBe(false);
    });

    it('size decrements after free', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('a');
      mgr.alloc('b');
      mgr.free(h);
      expect(mgr.size).toBe(1);
    });

    it('freeing a stale handle does not throw', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('npc-1');
      mgr.free(h);
      expect(() => mgr.free(h)).not.toThrow();
    });

    it('freeing NULL_HANDLE does not throw', () => {
      const mgr = new EntityHandleManager();
      expect(() => mgr.free(NULL_HANDLE)).not.toThrow();
    });
  });

  describe('slot reuse (use-after-free protection)', () => {
    it('old handle is stale after slot is reused', () => {
      const mgr = new EntityHandleManager();
      const h1 = mgr.alloc('old-entity');
      mgr.free(h1);
      // slot reused for a different entity
      const h2 = mgr.alloc('new-entity');

      expect(mgr.resolve(h1)).toBeNull();   // stale — old generation
      expect(mgr.resolve(h2)).toBe('new-entity');
    });

    it('reused slot produces a handle with a higher generation', () => {
      const mgr = new EntityHandleManager();
      const h1 = mgr.alloc('a');
      mgr.free(h1);
      const h2 = mgr.alloc('b');

      expect(indexOf(h1)).toBe(indexOf(h2));  // same slot
      expect(genOf(h2)).toBeGreaterThan(genOf(h1));
    });

    it('multiple alloc/free cycles keep old handles stale', () => {
      const mgr = new EntityHandleManager();
      const h1 = mgr.alloc('v1');
      mgr.free(h1);
      const h2 = mgr.alloc('v2');
      mgr.free(h2);
      const h3 = mgr.alloc('v3');

      expect(mgr.resolve(h1)).toBeNull();
      expect(mgr.resolve(h2)).toBeNull();
      expect(mgr.resolve(h3)).toBe('v3');
    });
  });

  describe('resolve edge cases', () => {
    it('resolve NULL_HANDLE returns null', () => {
      const mgr = new EntityHandleManager();
      expect(mgr.resolve(NULL_HANDLE)).toBeNull();
    });

    it('isAlive returns true for a live handle', () => {
      const mgr = new EntityHandleManager();
      const h = mgr.alloc('npc');
      expect(mgr.isAlive(h)).toBe(true);
    });

    it('isAlive returns false for NULL_HANDLE', () => {
      const mgr = new EntityHandleManager();
      expect(mgr.isAlive(NULL_HANDLE)).toBe(false);
    });
  });
});
