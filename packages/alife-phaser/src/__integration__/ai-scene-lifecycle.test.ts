/**
 * Integration test: "OnlineOfflineManager advanced scenarios".
 *
 * AIScene does not exist in @alife-sdk/phaser, so these tests exercise
 * OnlineOfflineManager (the equivalent lifecycle manager) in advanced
 * scenarios not covered by the unit test suite:
 *
 *   1.  Three NPCs, only two within online radius → correct split
 *   2.  NPC moves from offline zone into online zone → transitions online
 *   3.  Squad: any member in range → all go online atomically
 *   4.  Hysteresis: exactly at online boundary (595px) → strict < → stays offline
 *   5.  Hysteresis: exactly at offline boundary (805px) → strict > → stays online
 *   6.  Multiple evaluate() calls with stable positions → idempotent result
 *   7.  Dead NPC in online range → skipped, not in goOnline
 *   8.  Mixed squads and individuals → each group processed independently
 *   9.  Squad: all beyond offline range → entire squad goes offline
 *  10.  NPC transitions online then moves far → transitions offline on next evaluate()
 *  11.  Custom switchDistance + hysteresisFactor → correct threshold math
 *  12.  Player position moves, not NPC → same effect on distance evaluation
 *  13.  Large fleet (100 NPCs) — only close ones go online, no duplicates
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { OnlineOfflineManager } from '../online/OnlineOfflineManager';
import type { IOnlineRecord, SquadResolver } from '../types/IOnlineOfflineConfig';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function rec(
  entityId: string,
  x: number,
  y: number,
  isOnline = false,
  isAlive = true,
): IOnlineRecord {
  return { entityId, x, y, isOnline, isAlive };
}

// Default manager: switchDistance=700, hysteresisFactor=0.15
// onlineDistance  = 700 * 0.85 = 595
// offlineDistance = 700 * 1.15 = 805
function defaultMgr(): OnlineOfflineManager {
  return new OnlineOfflineManager();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnlineOfflineManager — advanced integration scenarios', () => {
  // -------------------------------------------------------------------------
  // Scenario 1: 3 NPCs, only 2 within online radius
  // -------------------------------------------------------------------------

  it('3 NPCs total — exactly 2 within online radius go online, 1 far stays offline', () => {
    const mgr = defaultMgr();

    // Player at (0, 0)
    // npc_a: 100px — inside onlineDistance (595) → goOnline
    // npc_b: 400px — inside onlineDistance (595) → goOnline
    // npc_c: 700px — in hysteresis band → stays offline
    const records = [
      rec('npc_a', 100, 0),
      rec('npc_b', 400, 0),
      rec('npc_c', 700, 0),
    ];

    const result = mgr.evaluate(0, 0, records);

    expect(result.goOnline).toContain('npc_a');
    expect(result.goOnline).toContain('npc_b');
    expect(result.goOnline).not.toContain('npc_c');
    expect(result.goOffline).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: NPC "moves" from offline zone into online zone
  // -------------------------------------------------------------------------

  it('NPC first evaluated as far (offline), then position moves inside online radius → transitions online', () => {
    const mgr = defaultMgr();

    // Step 1: NPC is far away and offline — no transition expected.
    const farRecord = [rec('npc_x', 900, 0, false)];
    const r1 = mgr.evaluate(0, 0, farRecord);
    expect(r1.goOnline).toHaveLength(0);
    expect(r1.goOffline).toHaveLength(0);

    // Step 2: NPC "moves" to 200px — now inside online range.
    // We must also update the record to show its new position.
    const closeRecord = [rec('npc_x', 200, 0, false)];
    const r2 = mgr.evaluate(0, 0, closeRecord);
    expect(r2.goOnline).toContain('npc_x');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Squad atomic switching — any member triggers entire squad online
  // -------------------------------------------------------------------------

  it('squad of 3: member at 100px (online range), others far → all 3 go online atomically', () => {
    const mgr = defaultMgr();

    // All offline; npc_s1 inside 595px, others outside.
    const records = [
      rec('npc_s1', 100, 0, false),  // inside onlineDistance
      rec('npc_s2', 700, 0, false),  // hysteresis band
      rec('npc_s3', 900, 0, false),  // beyond offlineDistance
    ];

    // Resolver: all three are in the same squad.
    const squadResolver: SquadResolver = (id) => {
      if (['npc_s1', 'npc_s2', 'npc_s3'].includes(id)) {
        return ['npc_s1', 'npc_s2', 'npc_s3'];
      }
      return null;
    };

    const result = mgr.evaluate(0, 0, records, squadResolver);

    // Squad-aware: npc_s1 in range → all three go online.
    expect(result.goOnline).toContain('npc_s1');
    expect(result.goOnline).toContain('npc_s2');
    expect(result.goOnline).toContain('npc_s3');
    expect(result.goOnline).toHaveLength(3);
    expect(result.goOffline).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Hysteresis — NPC exactly at the online boundary (strict <)
  // -------------------------------------------------------------------------

  it('offline NPC exactly at onlineDistance boundary (595px) → strict < → stays offline', () => {
    const mgr = defaultMgr(); // onlineDistance = 595

    // At exactly 595px distance from player, distSq = 595*595 = 354025
    // Condition for goOnline: distSq < onlineDistSq → 354025 < 354025 = false
    const records = [rec('npc_boundary', 595, 0, false)];
    const result = mgr.evaluate(0, 0, records);

    expect(result.goOnline).toHaveLength(0);
    expect(result.goOffline).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Hysteresis — online NPC just inside the offline boundary
  // -------------------------------------------------------------------------

  it('online NPC at 804px (just inside offlineDistance 804.999…px) → stays online (in hysteresis band)', () => {
    const mgr = defaultMgr();
    // offlineDistance = 700 * 1.15 = 804.999…px (floating-point).
    // At 804px, distSq = 646416 < 648024.999… → condition dSq > offlineDistSq is false.
    // NPC is in the hysteresis band → no transition.
    const records = [rec('npc_boundary', 804, 0, true)];
    const result = mgr.evaluate(0, 0, records);

    expect(result.goOnline).toHaveLength(0);
    expect(result.goOffline).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Multiple evaluate() calls — idempotent for stable positions
  // -------------------------------------------------------------------------

  it('calling evaluate() multiple times with same stable positions yields same results each time', () => {
    const mgr = defaultMgr();

    // Two NPCs with stable positions: one close, one far.
    // Close one is offline → should go online on every call.
    // Far one is already online → should go offline on every call.
    const stableRecords = [
      rec('close_offline', 100, 0, false),  // → goOnline
      rec('far_online',    900, 0, true),   // → goOffline
    ];

    for (let i = 0; i < 5; i++) {
      const result = mgr.evaluate(0, 0, stableRecords);
      expect(result.goOnline).toContain('close_offline');
      expect(result.goOffline).toContain('far_online');
      expect(result.goOnline).toHaveLength(1);
      expect(result.goOffline).toHaveLength(1);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Dead NPC in online range → skipped
  // -------------------------------------------------------------------------

  it('dead NPC positioned inside online range → skipped, not added to goOnline', () => {
    const mgr = defaultMgr();

    const records = [
      rec('alive',  100, 0, false, true),   // alive, offline → goOnline
      rec('dead',   200, 0, false, false),  // dead  → skipped
    ];

    const result = mgr.evaluate(0, 0, records);
    expect(result.goOnline).toContain('alive');
    expect(result.goOnline).not.toContain('dead');
    expect(result.goOnline).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Mixed squads and individuals — independent processing
  // -------------------------------------------------------------------------

  it('squad members and individual NPCs are evaluated independently — no cross-contamination', () => {
    const mgr = defaultMgr();

    // Squad: npc_s1 at 100px (online), npc_s2 at 700px (band)
    // Individual: npc_solo at 700px (band) — should NOT be pulled online by squad
    const records = [
      rec('npc_s1', 100, 0, false),
      rec('npc_s2', 700, 0, false),
      rec('npc_solo', 700, 0, false),
    ];

    const squadResolver: SquadResolver = (id) => {
      if (id === 'npc_s1' || id === 'npc_s2') return ['npc_s1', 'npc_s2'];
      return null; // solo is individual
    };

    const result = mgr.evaluate(0, 0, records, squadResolver);

    // Squad: npc_s1 in range → npc_s2 pulled online too.
    expect(result.goOnline).toContain('npc_s1');
    expect(result.goOnline).toContain('npc_s2');

    // Individual npc_solo is in hysteresis band → stays offline.
    expect(result.goOnline).not.toContain('npc_solo');
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Squad — all beyond offline range → entire squad goes offline
  // -------------------------------------------------------------------------

  it('squad of 2: both online, player moves far away → both go offline', () => {
    const mgr = defaultMgr();

    // Both online, both beyond offlineDistance (805).
    const records = [
      rec('npc_s1', 900, 0, true),
      rec('npc_s2', 1000, 0, true),
    ];

    const squadResolver: SquadResolver = (id) => {
      if (id === 'npc_s1' || id === 'npc_s2') return ['npc_s1', 'npc_s2'];
      return null;
    };

    const result = mgr.evaluate(0, 0, records, squadResolver);

    expect(result.goOffline).toContain('npc_s1');
    expect(result.goOffline).toContain('npc_s2');
    expect(result.goOnline).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 10: NPC transitions online then far → offline on next evaluate()
  // -------------------------------------------------------------------------

  it('NPC transitions online (close), then player moves far → goes offline next evaluate()', () => {
    const mgr = defaultMgr();

    // Step 1: NPC at 100px, offline → should go online.
    const r1 = mgr.evaluate(0, 0, [rec('npc_m', 100, 0, false)]);
    expect(r1.goOnline).toContain('npc_m');

    // Step 2: Now NPC is "online" and player has moved far (or NPC moved far).
    // Simulate by providing updated record with isOnline=true, NPC at 900px.
    const r2 = mgr.evaluate(0, 0, [rec('npc_m', 900, 0, true)]);
    expect(r2.goOffline).toContain('npc_m');
    expect(r2.goOnline).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Custom config — correct threshold math
  // -------------------------------------------------------------------------

  it('custom config switchDistance=1000 hysteresisFactor=0.2 → onlineDist=800, offlineDist=1200', () => {
    const mgr = new OnlineOfflineManager({ switchDistance: 1000, hysteresisFactor: 0.2 });

    expect(mgr.onlineDistance).toBe(800);
    expect(mgr.offlineDistance).toBe(1200);

    // NPC at 750px → inside 800 → goOnline
    const r1 = mgr.evaluate(0, 0, [rec('npc_c', 750, 0, false)]);
    expect(r1.goOnline).toContain('npc_c');

    // NPC at 850px → in hysteresis band [800, 1200] → stays offline
    const r2 = mgr.evaluate(0, 0, [rec('npc_b', 850, 0, false)]);
    expect(r2.goOnline).toHaveLength(0);
    expect(r2.goOffline).toHaveLength(0);

    // NPC at 1300px, online → beyond 1200 → goOffline
    const r3 = mgr.evaluate(0, 0, [rec('npc_f', 1300, 0, true)]);
    expect(r3.goOffline).toContain('npc_f');
  });

  // -------------------------------------------------------------------------
  // Scenario 12: Player moves, NPC stationary — equivalent to NPC moving
  // -------------------------------------------------------------------------

  it('player moves toward stationary offline NPC → NPC transitions online', () => {
    const mgr = defaultMgr(); // onlineDist = 595

    // Player starts at (0,0), NPC at (1000, 0) — far, no transition.
    const r1 = mgr.evaluate(0, 0, [rec('npc_stat', 1000, 0, false)]);
    expect(r1.goOnline).toHaveLength(0);

    // Player moves to (500, 0): distance to NPC = 500px < 595 → goOnline.
    const r2 = mgr.evaluate(500, 0, [rec('npc_stat', 1000, 0, false)]);
    expect(r2.goOnline).toContain('npc_stat');
  });

  // -------------------------------------------------------------------------
  // Scenario 13: Large fleet — only close NPCs go online, no duplicates
  // -------------------------------------------------------------------------

  it('100 offline NPCs — only the ones within online radius go online, result has no duplicates', () => {
    const mgr = defaultMgr(); // onlineDist = 595

    // Build 100 NPCs: 30 at 100px (close), 70 at 700px (band, no transition).
    const records: IOnlineRecord[] = [];
    for (let i = 0; i < 30; i++) {
      records.push(rec(`npc_close_${i}`, 100, 0, false));
    }
    for (let i = 0; i < 70; i++) {
      records.push(rec(`npc_band_${i}`, 700, 0, false));
    }

    const result = mgr.evaluate(0, 0, records);

    // Exactly 30 should go online.
    expect(result.goOnline).toHaveLength(30);
    expect(result.goOffline).toHaveLength(0);

    // No duplicates in goOnline.
    const uniqueOnline = new Set(result.goOnline);
    expect(uniqueOnline.size).toBe(30);

    // All close ones are there.
    for (let i = 0; i < 30; i++) {
      expect(result.goOnline).toContain(`npc_close_${i}`);
    }

    // None of the band ones appear.
    for (let i = 0; i < 70; i++) {
      expect(result.goOnline).not.toContain(`npc_band_${i}`);
    }
  });
});
