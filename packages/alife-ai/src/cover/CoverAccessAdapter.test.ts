// cover/CoverAccessAdapter.test.ts

import { describe, it, expect, vi } from 'vitest';
import { CoverAccessAdapter } from './CoverAccessAdapter';
import type { ICoverLockRegistry } from './ICoverLockConfig';
import type { ICoverPoint } from '../types/ICoverPoint';
import { CoverType } from '../types/ICoverPoint';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCoverPoint(id: string, x: number, y: number): ICoverPoint {
  return { id, x, y, radius: 32, occupiedBy: null, loopholes: [] };
}

function makeRegistryMock(): CoverRegistryMock {
  return new CoverRegistryMock();
}

/** Minimal CoverRegistry stand-in. */
class CoverRegistryMock {
  returnPoint: ICoverPoint | null = null;
  lastCallArgs: unknown[] = [];

  findCover(
    type: string,
    npcPosition: { x: number; y: number },
    enemies: { x: number; y: number }[],
    npcId: string,
  ): ICoverPoint | null {
    this.lastCallArgs = [type, npcPosition, enemies, npcId];
    return this.returnPoint;
  }
}

function makeLockMock(): jest.Mocked<ICoverLockRegistry> {
  return {
    tryLock: vi.fn().mockReturnValue(true),
    unlock: vi.fn(),
    unlockAll: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
    purgeExpired: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
    get lockedPointCount() { return 0; },
  } as unknown as jest.Mocked<ICoverLockRegistry>;
}

// ---------------------------------------------------------------------------
// findCover
// ---------------------------------------------------------------------------

describe('CoverAccessAdapter.findCover', () => {
  it('delegates to CoverRegistry with correct arguments', () => {
    const reg = makeRegistryMock();
    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    const adapter = new CoverAccessAdapter(reg as never, null, 'npc_a');

    const result = adapter.findCover(10, 20, 300, 400);

    expect(result).toEqual({ x: 100, y: 200 });
    expect(reg.lastCallArgs[0]).toBe(CoverType.BALANCED);  // default type
    expect(reg.lastCallArgs[1]).toEqual({ x: 10, y: 20 });
    expect(reg.lastCallArgs[2]).toEqual([{ x: 300, y: 400 }]);
    expect(reg.lastCallArgs[3]).toBe('npc_a');
  });

  it('passes custom type hint to CoverRegistry', () => {
    const reg = makeRegistryMock();
    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    const adapter = new CoverAccessAdapter(reg as never, null, 'npc_a');

    adapter.findCover(10, 20, 300, 400, 'far');

    expect(reg.lastCallArgs[0]).toBe('far');
  });

  it('returns null when no cover found', () => {
    const reg = makeRegistryMock();
    const adapter = new CoverAccessAdapter(reg as never, null, 'npc_a');

    expect(adapter.findCover(0, 0, 0, 0)).toBeNull();
  });

  it('does not expose ICoverPoint internals (only x/y)', () => {
    const reg = makeRegistryMock();
    const point = makeCoverPoint('cover_007', 50, 75);
    reg.returnPoint = point;
    const adapter = new CoverAccessAdapter(reg as never, null, 'npc_a');

    const result = adapter.findCover(0, 0, 0, 0);
    expect(result).toEqual({ x: 50, y: 75 });
    expect((result as unknown as Record<string, unknown>).id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// lockLastFound
// ---------------------------------------------------------------------------

describe('CoverAccessAdapter.lockLastFound', () => {
  it('calls tryLock with the last found point ID', () => {
    const reg = makeRegistryMock();
    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    const lock = makeLockMock();
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    adapter.findCover(0, 0, 0, 0);
    const result = adapter.lockLastFound('npc_a');

    expect(lock.tryLock).toHaveBeenCalledWith('cover_001', 'npc_a', undefined);
    expect(result).toBe(true);
  });

  it('passes ttlMs when provided', () => {
    const reg = makeRegistryMock();
    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    const lock = makeLockMock();
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    adapter.findCover(0, 0, 0, 0);
    adapter.lockLastFound('npc_a', 5_000);

    expect(lock.tryLock).toHaveBeenCalledWith('cover_001', 'npc_a', { ttlMs: 5_000 });
  });

  it('returns true (vacuous success) when no cover was found yet', () => {
    const reg = makeRegistryMock();
    const lock = makeLockMock();
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    // No findCover call — _lastFoundId is null
    expect(adapter.lockLastFound('npc_a')).toBe(true);
    expect(lock.tryLock).not.toHaveBeenCalled();
  });

  it('returns true (vacuous success) when findCover returned null', () => {
    const reg = makeRegistryMock();  // returnPoint = null by default
    const lock = makeLockMock();
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    adapter.findCover(0, 0, 0, 0);
    expect(adapter.lockLastFound('npc_a')).toBe(true);
    expect(lock.tryLock).not.toHaveBeenCalled();
  });

  it('returns true (vacuous success) when no lock registry provided', () => {
    const reg = makeRegistryMock();
    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    const adapter = new CoverAccessAdapter(reg as never, null, 'npc_a');

    adapter.findCover(0, 0, 0, 0);
    expect(adapter.lockLastFound('npc_a')).toBe(true);
  });

  it('returns false when lock registry reports point at capacity', () => {
    const reg = makeRegistryMock();
    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    const lock = makeLockMock();
    (lock.tryLock as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    adapter.findCover(0, 0, 0, 0);
    expect(adapter.lockLastFound('npc_a')).toBe(false);
  });

  it('uses the most recent findCover result (not a stale one)', () => {
    const reg = makeRegistryMock();
    const lock = makeLockMock();
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    reg.returnPoint = makeCoverPoint('cover_001', 100, 200);
    adapter.findCover(0, 0, 0, 0);

    reg.returnPoint = makeCoverPoint('cover_002', 150, 250);
    adapter.findCover(0, 0, 0, 0);  // overwrites _lastFoundId

    adapter.lockLastFound('npc_a');
    expect(lock.tryLock).toHaveBeenCalledWith('cover_002', 'npc_a', undefined);
  });
});

// ---------------------------------------------------------------------------
// unlockAll
// ---------------------------------------------------------------------------

describe('CoverAccessAdapter.unlockAll', () => {
  it('delegates to lockRegistry.unlockAll', () => {
    const reg = makeRegistryMock();
    const lock = makeLockMock();
    const adapter = new CoverAccessAdapter(reg as never, lock, 'npc_a');

    adapter.unlockAll('npc_a');

    expect(lock.unlockAll).toHaveBeenCalledWith('npc_a');
  });

  it('is a no-op when no lock registry provided', () => {
    const reg = makeRegistryMock();
    const adapter = new CoverAccessAdapter(reg as never, null, 'npc_a');

    expect(() => adapter.unlockAll('npc_a')).not.toThrow();
  });
});
