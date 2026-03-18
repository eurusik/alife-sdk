import { describe, it, expect } from 'vitest';
import { CoverLockRegistry } from './CoverLockRegistry';
import { createDefaultCoverLockConfig } from './ICoverLockConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(ttlMs = 10_000) {
  let t = 0;
  const timeFn = () => t;
  const reg = new CoverLockRegistry(timeFn, { defaultTtlMs: ttlMs, autoPurgeInterval: 0 });
  const advance = (ms: number) => { t += ms; };
  return { reg, timeFn, advance };
}

// ---------------------------------------------------------------------------
// tryLock
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.tryLock', () => {
  it('acquires a lock on an empty point', () => {
    const { reg } = makeRegistry();
    expect(reg.tryLock('cover_001', 'npc_a')).toBe(true);
    expect(reg.lockedPointCount).toBe(1);
  });

  it('is idempotent for the same NPC (refreshes TTL)', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    expect(reg.tryLock('cover_001', 'npc_a')).toBe(true);
    expect(reg.lockedPointCount).toBe(1);
  });

  it('rejects a second NPC when capacity=1 (default)', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    expect(reg.tryLock('cover_001', 'npc_b')).toBe(false);
  });

  it('allows multiple NPCs up to custom capacity', () => {
    const { reg } = makeRegistry();
    expect(reg.tryLock('bunker', 'npc_a', { capacity: 3 })).toBe(true);
    expect(reg.tryLock('bunker', 'npc_b', { capacity: 3 })).toBe(true);
    expect(reg.tryLock('bunker', 'npc_c', { capacity: 3 })).toBe(true);
    expect(reg.tryLock('bunker', 'npc_d', { capacity: 3 })).toBe(false);
  });

  it('acquires on expired lock from a different NPC', () => {
    const { reg, advance } = makeRegistry(1_000);
    reg.tryLock('cover_001', 'npc_a');
    advance(2_000);  // expire npc_a lock
    expect(reg.tryLock('cover_001', 'npc_b')).toBe(true);
  });

  it('multiple independent points can be locked simultaneously', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    reg.tryLock('cover_002', 'npc_b');
    expect(reg.lockedPointCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// unlock
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.unlock', () => {
  it('releases a held lock', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    reg.unlock('cover_001', 'npc_a');
    expect(reg.lockedPointCount).toBe(0);
    expect(reg.tryLock('cover_001', 'npc_b')).toBe(true);
  });

  it('is a no-op for an NPC that does not hold the lock', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    expect(() => reg.unlock('cover_001', 'npc_b')).not.toThrow();
    expect(reg.lockedPointCount).toBe(1);
  });

  it('is a no-op for an unknown point', () => {
    const { reg } = makeRegistry();
    expect(() => reg.unlock('ghost', 'npc_a')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// unlockAll
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.unlockAll', () => {
  it('removes all locks held by a given NPC across multiple points', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    reg.tryLock('cover_002', 'npc_a');
    reg.tryLock('cover_003', 'npc_b');
    reg.unlockAll('npc_a');
    expect(reg.lockedPointCount).toBe(1);  // npc_b's lock remains
    expect(reg.isAvailable('cover_001', 'npc_x')).toBe(true);
    expect(reg.isAvailable('cover_002', 'npc_x')).toBe(true);
    expect(reg.isAvailable('cover_003', 'npc_x')).toBe(false);
  });

  it('is a no-op when NPC holds no locks', () => {
    const { reg } = makeRegistry();
    expect(() => reg.unlockAll('ghost')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.isAvailable', () => {
  it('returns true for a point with no locks', () => {
    const { reg } = makeRegistry();
    expect(reg.isAvailable('cover_001', 'npc_a')).toBe(true);
  });

  it('returns true when the querying NPC holds the lock', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    expect(reg.isAvailable('cover_001', 'npc_a')).toBe(true);
  });

  it('returns false when a different NPC holds the lock', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(false);
  });

  it('returns true after the other NPC lock expires', () => {
    const { reg, advance } = makeRegistry(1_000);
    reg.tryLock('cover_001', 'npc_a');
    advance(2_000);
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TTL / expiry
// ---------------------------------------------------------------------------

describe('TTL expiry', () => {
  it('lock expires after defaultTtlMs', () => {
    const { reg, advance } = makeRegistry(5_000);
    reg.tryLock('cover_001', 'npc_a');
    advance(4_999);
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(false);
    advance(2);
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(true);
  });

  it('re-locking the same point refreshes TTL', () => {
    const { reg, advance } = makeRegistry(5_000);
    reg.tryLock('cover_001', 'npc_a');
    advance(4_000);
    reg.tryLock('cover_001', 'npc_a');  // refresh
    advance(4_000);
    // Would have expired at t=5000 if not refreshed; now expires at t=4000+5000=9000
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(false);
  });

  it('custom ttlMs per tryLock call', () => {
    const { reg, advance } = makeRegistry(10_000);
    reg.tryLock('cover_001', 'npc_a', { ttlMs: 1_000 });
    advance(1_500);
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// purgeExpired
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.purgeExpired', () => {
  it('removes expired locks and returns count', () => {
    const { reg, advance } = makeRegistry(1_000);
    reg.tryLock('cover_001', 'npc_a');
    reg.tryLock('cover_002', 'npc_b');
    advance(2_000);
    const purged = reg.purgeExpired();
    expect(purged).toBe(2);
    expect(reg.lockedPointCount).toBe(0);
  });

  it('keeps unexpired locks', () => {
    const { reg, advance } = makeRegistry(5_000);
    reg.tryLock('cover_001', 'npc_a', { ttlMs: 1_000 });
    reg.tryLock('cover_002', 'npc_b', { ttlMs: 10_000 });
    advance(2_000);
    const purged = reg.purgeExpired();
    expect(purged).toBe(1);
    expect(reg.lockedPointCount).toBe(1);
  });

  it('returns 0 when no locks are expired', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    expect(reg.purgeExpired()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// auto-purge
// ---------------------------------------------------------------------------

describe('auto-purge', () => {
  it('purges expired locks automatically at autoPurgeInterval', () => {
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 3,  // purge every 3 checks
    });

    reg.tryLock('cover_001', 'npc_a');
    t = 2_000;  // expire npc_a

    // After 3 isAvailable calls, auto-purge should remove npc_a's expired lock.
    reg.isAvailable('cover_002', 'npc_x');
    reg.isAvailable('cover_002', 'npc_x');
    reg.isAvailable('cover_002', 'npc_x');  // triggers purge

    expect(reg.lockedPointCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// auto-purge via unlock
// ---------------------------------------------------------------------------

describe('auto-purge via unlock', () => {
  it('unlock triggers auto-purge at the configured interval', () => {
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 3,  // purge every 3 calls
    });

    // Lock two separate points.
    reg.tryLock('cover_001', 'npc_a');
    reg.tryLock('cover_002', 'npc_b');

    t = 2_000;  // expire both locks

    // Drive the counter to the threshold exclusively through unlock() calls.
    // Each unlock() call increments _checkCounter via _maybeAutoPurge().
    reg.unlock('cover_003', 'npc_x');  // call 1 — no-op unlock, counter = 1
    reg.unlock('cover_003', 'npc_x');  // call 2, counter = 2
    reg.unlock('cover_003', 'npc_x');  // call 3, counter hits 3 → auto-purge fires

    expect(reg.lockedPointCount).toBe(0);
  });

  it('unlock does not trigger auto-purge before the interval is reached', () => {
    // autoPurgeInterval=5 means the 5th call to any public method fires the purge.
    // tryLock uses call #1; calls #2-#4 via unlock should NOT fire; call #5 should.
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 5,
    });

    reg.tryLock('cover_001', 'npc_a');  // counter = 1
    t = 2_000;  // expire npc_a

    // 3 more unlock calls bring the counter to 4 — one below the threshold.
    for (let i = 0; i < 3; i++) {
      reg.unlock('cover_002', 'npc_x');  // no-op unlocks, counter 2 → 3 → 4
    }

    // Entry still present (expired but not yet purged).
    expect(reg.lockedPointCount).toBe(1);

    // Fifth call crosses the threshold and fires the purge.
    reg.unlock('cover_002', 'npc_x');  // counter = 5 → purge fires
    expect(reg.lockedPointCount).toBe(0);
  });

  it('expired entries are eventually purged after many unlock() calls', () => {
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 4,
    });

    // Populate several points with short-lived locks.
    for (let i = 0; i < 5; i++) {
      reg.tryLock(`cover_${i}`, `npc_${i}`);
    }
    t = 5_000;  // expire every lock

    // Issue enough unlock() calls to cross the auto-purge threshold at least once.
    for (let i = 0; i < 8; i++) {
      reg.unlock('ghost', 'npc_x');  // no-op unlocks — only here to advance the counter
    }

    expect(reg.lockedPointCount).toBe(0);
  });

  it('unlock shares the auto-purge counter with tryLock and isAvailable', () => {
    // All three public methods increment the same _checkCounter via
    // _maybeAutoPurge(). This test verifies that mixing unlock/tryLock/isAvailable
    // calls advances the counter jointly and triggers purge at the right total.
    //
    // autoPurgeInterval=4: purge fires on the 4th call (counter 1→2→3→4 → purge).
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 4,
    });

    reg.tryLock('cover_001', 'npc_a');  // counter = 1
    t = 2_000;                          // expire npc_a

    // One call each from unlock and isAvailable advances counter to 3.
    reg.unlock('ghost', 'npc_z');            // counter = 2 — no purge yet
    reg.isAvailable('ghost', 'npc_z');       // counter = 3 — no purge yet
    expect(reg.lockedPointCount).toBe(1);   // expired entry still present

    // Fourth call via unlock crosses the threshold.
    reg.unlock('ghost', 'npc_z');            // counter = 4 → purge fires
    expect(reg.lockedPointCount).toBe(0);
  });

  it('unlock still removes the NPC lock even when auto-purge fires on the same call', () => {
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 10_000,
      autoPurgeInterval: 1,  // purge on every single call
    });

    // Lock two points for two different NPCs.
    reg.tryLock('cover_001', 'npc_a');
    reg.tryLock('cover_002', 'npc_b');

    // Expire npc_b's lock only.
    t = 20_000;
    // Re-lock npc_a so it has a fresh, non-expired entry.
    reg.tryLock('cover_001', 'npc_a', { ttlMs: 60_000 });

    // unlock() will: (1) run _maybeAutoPurge — removes expired npc_b entry,
    //                (2) then remove npc_a's lock from cover_001.
    reg.unlock('cover_001', 'npc_a');

    // Both points should now be fully gone.
    expect(reg.lockedPointCount).toBe(0);
    expect(reg.isAvailable('cover_001', 'npc_x')).toBe(true);
  });

  it('unlock auto-purge with autoPurgeInterval=0 is a no-op (disabled)', () => {
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 0,  // disabled
    });

    reg.tryLock('cover_001', 'npc_a');
    t = 2_000;  // expire lock

    // Many unlock() calls — auto-purge is disabled so the stale entry persists.
    for (let i = 0; i < 100; i++) {
      reg.unlock('ghost', 'npc_x');
    }

    // lockedPointCount still reflects the un-purged expired entry.
    expect(reg.lockedPointCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.clear', () => {
  it('removes all locks', () => {
    const { reg } = makeRegistry();
    reg.tryLock('cover_001', 'npc_a');
    reg.tryLock('cover_002', 'npc_b');
    reg.clear();
    expect(reg.lockedPointCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lockedPointCount
// ---------------------------------------------------------------------------

describe('CoverLockRegistry.lockedPointCount', () => {
  it('counts distinct locked points', () => {
    const { reg } = makeRegistry();
    expect(reg.lockedPointCount).toBe(0);
    reg.tryLock('cover_001', 'npc_a');
    expect(reg.lockedPointCount).toBe(1);
    reg.tryLock('cover_002', 'npc_b');
    expect(reg.lockedPointCount).toBe(2);
    reg.tryLock('cover_001', 'npc_a');  // same point, no change
    expect(reg.lockedPointCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Per-point capacity tracking (regression for finding #4)
// ---------------------------------------------------------------------------

describe('per-point capacity tracking', () => {
  it('isAvailable respects per-point capacity set via tryLock', () => {
    const { reg } = makeRegistry();
    // Lock with capacity=3; isAvailable should return true until 3 locks held.
    reg.tryLock('multi', 'npc_a', { capacity: 3 });
    reg.tryLock('multi', 'npc_b', { capacity: 3 });
    expect(reg.isAvailable('multi', 'npc_c')).toBe(true);
    reg.tryLock('multi', 'npc_c', { capacity: 3 });
    // Now at capacity — npc_d should see it as unavailable.
    expect(reg.isAvailable('multi', 'npc_d')).toBe(false);
  });

  it('capacity is promoted to the maximum ever seen for a point', () => {
    const { reg } = makeRegistry();
    reg.tryLock('multi', 'npc_a', { capacity: 2 });
    // Raise capacity to 5 on a subsequent lock.
    reg.tryLock('multi', 'npc_b', { capacity: 5 });
    reg.tryLock('multi', 'npc_c', { capacity: 1 });  // lower — should not reduce capacity
    reg.tryLock('multi', 'npc_d');
    reg.tryLock('multi', 'npc_e');
    // 5 locks held; should be at capacity now.
    expect(reg.isAvailable('multi', 'npc_f')).toBe(false);
    // 4 locks held after removing one; should be available again.
    reg.unlock('multi', 'npc_e');
    expect(reg.isAvailable('multi', 'npc_f')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Re-lock with shorter TTL
// ---------------------------------------------------------------------------

describe('re-lock TTL behaviour', () => {
  it('re-lock with shorter TTL brings expiry forward', () => {
    const { reg, advance } = makeRegistry(10_000);
    reg.tryLock('cover_001', 'npc_a');         // expires at t=10000
    advance(9_000);
    reg.tryLock('cover_001', 'npc_a', { ttlMs: 100 });  // re-lock, expires at t=9100
    advance(200);                                // t=9200 — past the re-lock expiry
    expect(reg.isAvailable('cover_001', 'npc_b')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clear resets auto-purge counter
// ---------------------------------------------------------------------------

describe('clear resets auto-purge counter', () => {
  it('requires a full autoPurgeInterval after clear before auto-purge fires', () => {
    let t = 0;
    const reg = new CoverLockRegistry(() => t, {
      defaultTtlMs: 1_000,
      autoPurgeInterval: 3,
    });

    reg.tryLock('cover_001', 'npc_a');
    t = 2_000;  // expire npc_a

    // Consume 2 of 3 slots, then clear (resets counter).
    reg.isAvailable('cover_002', 'npc_x');
    reg.isAvailable('cover_002', 'npc_x');
    reg.clear();

    // After clear, the internal counter is 0. Firing 2 more checks should NOT
    // trigger auto-purge; the expired entry from before clear is gone anyway,
    // but a fresh lock added after clear should not be purged by 2 checks.
    reg.tryLock('cover_003', 'npc_b');  // new lock, not expired
    reg.isAvailable('cover_003', 'npc_x');
    reg.isAvailable('cover_003', 'npc_x');
    // Only 2 checks since clear — counter should be at 2, not triggered yet.
    expect(reg.lockedPointCount).toBe(1);  // npc_b still locked
  });
});

// ---------------------------------------------------------------------------
// createDefaultCoverLockConfig validation
// ---------------------------------------------------------------------------

describe('createDefaultCoverLockConfig validation', () => {
  it('accepts valid config', () => {
    expect(() => createDefaultCoverLockConfig({ defaultTtlMs: 5_000 })).not.toThrow();
  });

  it('throws when defaultTtlMs <= 0', () => {
    expect(() => createDefaultCoverLockConfig({ defaultTtlMs: 0 })).toThrow(RangeError);
    expect(() => createDefaultCoverLockConfig({ defaultTtlMs: -1 })).toThrow(RangeError);
  });

  it('throws when defaultCapacity < 1 or non-integer', () => {
    expect(() => createDefaultCoverLockConfig({ defaultCapacity: 0 })).toThrow(RangeError);
    expect(() => createDefaultCoverLockConfig({ defaultCapacity: -1 })).toThrow(RangeError);
    expect(() => createDefaultCoverLockConfig({ defaultCapacity: 1.5 })).toThrow(RangeError);
  });

  it('throws when autoPurgeInterval < 0 or non-integer', () => {
    expect(() => createDefaultCoverLockConfig({ autoPurgeInterval: -1 })).toThrow(RangeError);
    expect(() => createDefaultCoverLockConfig({ autoPurgeInterval: 0.5 })).toThrow(RangeError);
  });

  it('allows autoPurgeInterval = 0 (disables auto-purge)', () => {
    expect(() => createDefaultCoverLockConfig({ autoPurgeInterval: 0 })).not.toThrow();
  });
});
