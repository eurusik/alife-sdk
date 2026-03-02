// squad/SquadSharedTarget.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SquadSharedTargetTable,
  createDefaultSquadSharedTargetConfig,
  type ISharedTargetInfo,
  type ISquadSharedTargetConfig,
} from './SquadSharedTarget';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple npcToSquad map for tests. */
function makeSquadMap(entries: Record<string, string>): (npcId: string) => string | null {
  return (npcId: string) => entries[npcId] ?? null;
}

// ---------------------------------------------------------------------------
// createDefaultSquadSharedTargetConfig
// ---------------------------------------------------------------------------

describe('createDefaultSquadSharedTargetConfig', () => {
  it('returns defaults when called with no args', () => {
    const cfg = createDefaultSquadSharedTargetConfig();
    expect(cfg.ttlMs).toBe(10_000);
    expect(cfg.sharedConfidence).toBe(0.8);
  });

  it('merges overrides without affecting other fields', () => {
    const cfg = createDefaultSquadSharedTargetConfig({ ttlMs: 5_000 });
    expect(cfg.ttlMs).toBe(5_000);
    expect(cfg.sharedConfidence).toBe(0.8); // unchanged
  });

  it('applies both overrides independently', () => {
    const cfg = createDefaultSquadSharedTargetConfig({ ttlMs: 3_000, sharedConfidence: 0.6 });
    expect(cfg.ttlMs).toBe(3_000);
    expect(cfg.sharedConfidence).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// SquadSharedTargetTable — shareTarget / getSharedTarget basics
// ---------------------------------------------------------------------------

describe('SquadSharedTargetTable — basics', () => {
  let now = 0;
  let table: SquadSharedTargetTable;

  beforeEach(() => {
    now = 1_000;
    const npcToSquad = makeSquadMap({ npc1: 'squad-A', npc2: 'squad-A', npc3: 'squad-B' });
    table = new SquadSharedTargetTable(npcToSquad, {}, () => now);
  });

  it('getSharedTarget returns null when no target has been shared yet', () => {
    expect(table.getSharedTarget('npc1')).toBeNull();
  });

  it('getSharedTarget returns null when NPC is not in any squad', () => {
    expect(table.getSharedTarget('npc-no-squad')).toBeNull();
  });

  it('shareTarget for a squadless NPC is a no-op — no throw', () => {
    expect(() => table.shareTarget('npc-no-squad', 'enemy1', 100, 200)).not.toThrow();
    // Subsequent reads for real squad members still return null
    expect(table.getSharedTarget('npc1')).toBeNull();
  });

  it('returns ISharedTargetInfo after shareTarget is called', () => {
    table.shareTarget('npc1', 'enemy1', 300, 400);
    const info = table.getSharedTarget('npc1');
    expect(info).not.toBeNull();
    expect(info!.targetId).toBe('enemy1');
    expect(info!.x).toBe(300);
    expect(info!.y).toBe(400);
  });

  it('any squad member can read the shared target (not just the sender)', () => {
    table.shareTarget('npc1', 'enemy1', 300, 400);
    const infoForNpc2 = table.getSharedTarget('npc2');
    expect(infoForNpc2).not.toBeNull();
    expect(infoForNpc2!.targetId).toBe('enemy1');
  });

  it('info.confidence matches sharedConfidence config', () => {
    const customTable = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      { sharedConfidence: 0.6 },
      () => now,
    );
    customTable.shareTarget('npc1', 'enemy1', 0, 0);
    expect(customTable.getSharedTarget('npc1')!.confidence).toBe(0.6);
  });

  it('info.sharedAtMs matches the nowFn at time of shareTarget call', () => {
    now = 5_000;
    table.shareTarget('npc1', 'enemy1', 0, 0);
    expect(table.getSharedTarget('npc1')!.sharedAtMs).toBe(5_000);
  });

  it('second shareTarget overwrites the first (latest wins)', () => {
    table.shareTarget('npc1', 'enemy1', 100, 100);
    table.shareTarget('npc1', 'enemy2', 200, 200);
    const info = table.getSharedTarget('npc1');
    expect(info!.targetId).toBe('enemy2');
    expect(info!.x).toBe(200);
    expect(info!.y).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// TTL expiry
// ---------------------------------------------------------------------------

describe('SquadSharedTargetTable — TTL', () => {
  it('returns info when intel is within TTL', () => {
    let now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      { ttlMs: 10_000 },
      () => now,
    );

    now = 1_000;
    table.shareTarget('npc1', 'enemy1', 0, 0);

    now = 10_999; // 9_999ms elapsed — still within TTL
    expect(table.getSharedTarget('npc1')).not.toBeNull();
  });

  it('returns null when TTL has elapsed', () => {
    let now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      { ttlMs: 10_000 },
      () => now,
    );

    now = 1_000;
    table.shareTarget('npc1', 'enemy1', 0, 0);

    now = 12_000; // 11_000ms elapsed — TTL exceeded
    expect(table.getSharedTarget('npc1')).toBeNull();
  });

  it('expired entry is cleaned up — subsequent getSharedTarget still returns null', () => {
    let now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      { ttlMs: 5_000 },
      () => now,
    );

    now = 0;
    table.shareTarget('npc1', 'enemy1', 0, 0);

    now = 6_000; // expired
    table.getSharedTarget('npc1'); // triggers cleanup

    now = 6_001; // still after expiry
    expect(table.getSharedTarget('npc1')).toBeNull();
  });

  it('shareTarget after expiry refreshes the entry', () => {
    let now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      { ttlMs: 5_000 },
      () => now,
    );

    now = 0;
    table.shareTarget('npc1', 'enemy1', 100, 100);

    now = 6_000; // expired
    expect(table.getSharedTarget('npc1')).toBeNull();

    // Re-share after expiry
    table.shareTarget('npc1', 'enemy2', 200, 200);
    const info = table.getSharedTarget('npc1');
    expect(info).not.toBeNull();
    expect(info!.targetId).toBe('enemy2');
  });
});

// ---------------------------------------------------------------------------
// invalidate
// ---------------------------------------------------------------------------

describe('SquadSharedTargetTable — invalidate', () => {
  it('invalidate clears intel for the given squadId', () => {
    const now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      {},
      () => now,
    );
    table.shareTarget('npc1', 'enemy1', 0, 0);
    table.invalidate('squad-A');
    expect(table.getSharedTarget('npc1')).toBeNull();
  });

  it('invalidate on unknown squadId is a no-op', () => {
    expect(() => {
      const table = new SquadSharedTargetTable(makeSquadMap({}), {}, () => 0);
      table.invalidate('nonexistent-squad');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('SquadSharedTargetTable — clear', () => {
  it('clear removes intel for all squads', () => {
    const now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A', npc2: 'squad-B' }),
      {},
      () => now,
    );
    table.shareTarget('npc1', 'enemy-A', 0, 0);
    table.shareTarget('npc2', 'enemy-B', 0, 0);
    table.clear();
    expect(table.getSharedTarget('npc1')).toBeNull();
    expect(table.getSharedTarget('npc2')).toBeNull();
  });

  it('clear on empty table is a no-op', () => {
    const table = new SquadSharedTargetTable(makeSquadMap({}), {}, () => 0);
    expect(() => table.clear()).not.toThrow();
  });

  it('shareTarget after clear works normally', () => {
    const now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      {},
      () => now,
    );
    table.shareTarget('npc1', 'enemy-A', 100, 200);
    table.clear();
    table.shareTarget('npc1', 'enemy-B', 300, 400);
    const info = table.getSharedTarget('npc1');
    expect(info).not.toBeNull();
    expect(info!.targetId).toBe('enemy-B');
  });
});

// ---------------------------------------------------------------------------
// Multi-squad isolation
// ---------------------------------------------------------------------------

describe('SquadSharedTargetTable — multi-squad isolation', () => {
  it('intel shared in squad-A is NOT visible to squad-B members', () => {
    const now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A', npc3: 'squad-B' }),
      {},
      () => now,
    );

    table.shareTarget('npc1', 'enemy1', 100, 100);

    expect(table.getSharedTarget('npc1')).not.toBeNull();
    expect(table.getSharedTarget('npc3')).toBeNull();
  });

  it('each squad maintains independent intel', () => {
    const now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A', npc2: 'squad-B' }),
      {},
      () => now,
    );

    table.shareTarget('npc1', 'enemy-A', 10, 20);
    table.shareTarget('npc2', 'enemy-B', 30, 40);

    expect(table.getSharedTarget('npc1')!.targetId).toBe('enemy-A');
    expect(table.getSharedTarget('npc2')!.targetId).toBe('enemy-B');
  });

  it('invalidating one squad does not affect the other', () => {
    const now = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A', npc2: 'squad-B' }),
      {},
      () => now,
    );

    table.shareTarget('npc1', 'enemy-A', 0, 0);
    table.shareTarget('npc2', 'enemy-B', 0, 0);
    table.invalidate('squad-A');

    expect(table.getSharedTarget('npc1')).toBeNull();
    expect(table.getSharedTarget('npc2')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// nowFn injection — deterministic clock control
// ---------------------------------------------------------------------------

describe('SquadSharedTargetTable — nowFn injection', () => {
  it('uses custom nowFn for both shareTarget and TTL checks', () => {
    let fakeNow = 0;
    const table = new SquadSharedTargetTable(
      makeSquadMap({ npc1: 'squad-A' }),
      { ttlMs: 1_000 },
      () => fakeNow,
    );

    fakeNow = 500;
    table.shareTarget('npc1', 'enemy1', 0, 0);

    fakeNow = 1_499; // 999ms elapsed — within TTL
    expect(table.getSharedTarget('npc1')).not.toBeNull();

    fakeNow = 1_501; // 1_001ms elapsed — expired
    expect(table.getSharedTarget('npc1')).toBeNull();
  });
});
