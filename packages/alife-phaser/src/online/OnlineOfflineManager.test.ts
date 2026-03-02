import { describe, it, expect } from 'vitest';
import { OnlineOfflineManager } from './OnlineOfflineManager';
import type { IOnlineRecord } from '../types/IOnlineOfflineConfig';

function makeRecord(
  entityId: string,
  x: number,
  y: number,
  isOnline = false,
  isAlive = true,
): IOnlineRecord {
  return { entityId, x, y, isOnline, isAlive };
}

describe('OnlineOfflineManager', () => {
  // Default config: switchDistance=700, hysteresisFactor=0.15
  // onlineDistance = 700 × 0.85 = 595
  // offlineDistance = 700 × 1.15 = 805

  describe('config', () => {
    it('uses default config values', () => {
      const mgr = new OnlineOfflineManager();
      expect(mgr.onlineDistance).toBe(595);
      expect(mgr.offlineDistance).toBeCloseTo(805);
    });

    it('accepts custom config', () => {
      const mgr = new OnlineOfflineManager({
        switchDistance: 1000,
        hysteresisFactor: 0.1,
      });
      expect(mgr.onlineDistance).toBe(900);
      expect(mgr.offlineDistance).toBe(1100);
    });

    it('accepts partial config', () => {
      const mgr = new OnlineOfflineManager({ switchDistance: 500 });
      expect(mgr.onlineDistance).toBe(425);
    });
  });

  describe('individual transitions', () => {
    const mgr = new OnlineOfflineManager();

    it('returns empty result for empty records', () => {
      const result = mgr.evaluate(0, 0, []);
      expect(result.goOnline).toHaveLength(0);
      expect(result.goOffline).toHaveLength(0);
    });

    it('transitions offline NPC to online when inside online range', () => {
      const records = [makeRecord('a', 100, 0, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toContain('a');
      expect(result.goOffline).toHaveLength(0);
    });

    it('transitions online NPC to offline when beyond offline range', () => {
      const records = [makeRecord('a', 900, 0, true)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOffline).toContain('a');
      expect(result.goOnline).toHaveLength(0);
    });

    it('keeps offline NPC in hysteresis band offline', () => {
      // 700px is in [595, 805] hysteresis band
      const records = [makeRecord('a', 700, 0, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toHaveLength(0);
      expect(result.goOffline).toHaveLength(0);
    });

    it('keeps online NPC in hysteresis band online', () => {
      const records = [makeRecord('a', 700, 0, true)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toHaveLength(0);
      expect(result.goOffline).toHaveLength(0);
    });

    it('does not transition NPC already online inside online range', () => {
      const records = [makeRecord('a', 100, 0, true)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toHaveLength(0);
      expect(result.goOffline).toHaveLength(0);
    });

    it('does not transition NPC already offline beyond offline range', () => {
      const records = [makeRecord('a', 900, 0, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toHaveLength(0);
      expect(result.goOffline).toHaveLength(0);
    });

    it('handles NPC at exact player position', () => {
      const records = [makeRecord('a', 0, 0, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toContain('a');
    });

    it('uses squared distance (diagonal NPC)', () => {
      // Diagonal: sqrt(400^2 + 400^2) ≈ 565.7 < 595 → goes online
      const records = [makeRecord('a', 400, 400, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toContain('a');
    });

    it('handles non-zero player position', () => {
      const records = [makeRecord('a', 550, 500, false)];
      // Distance from (500, 500): sqrt(50^2) = 50 < 595 → online
      const result = mgr.evaluate(500, 500, records);
      expect(result.goOnline).toContain('a');
    });

    it('handles multiple NPCs with mixed states', () => {
      const records = [
        makeRecord('close_offline', 100, 0, false),  // → goOnline
        makeRecord('far_online', 900, 0, true),       // → goOffline
        makeRecord('band_offline', 700, 0, false),    // → stays
        makeRecord('band_online', 700, 0, true),      // → stays
      ];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toEqual(['close_offline']);
      expect(result.goOffline).toEqual(['far_online']);
    });
  });

  describe('dead entity handling', () => {
    const mgr = new OnlineOfflineManager();

    it('skips dead NPCs', () => {
      const records = [makeRecord('dead', 100, 0, false, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toHaveLength(0);
    });

    it('skips dead NPC even if online and far', () => {
      const records = [makeRecord('dead', 900, 0, true, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOffline).toHaveLength(0);
    });
  });

  describe('squad-aware switching', () => {
    const mgr = new OnlineOfflineManager();

    const squadResolver = (npcId: string): readonly string[] | null => {
      const squads: Record<string, string[]> = {
        a: ['a', 'b', 'c'],
        b: ['a', 'b', 'c'],
        c: ['a', 'b', 'c'],
        solo: null as unknown as string[],
      };
      return squads[npcId] ?? null;
    };

    it('brings entire squad online when any member in range', () => {
      const records = [
        makeRecord('a', 100, 0, false),  // In online range
        makeRecord('b', 700, 0, false),  // In hysteresis band
        makeRecord('c', 900, 0, false),  // Beyond offline range
      ];
      const result = mgr.evaluate(0, 0, records, squadResolver);
      expect(result.goOnline).toContain('a');
      expect(result.goOnline).toContain('b');
      expect(result.goOnline).toContain('c');
    });

    it('takes entire squad offline when all beyond offline range', () => {
      const records = [
        makeRecord('a', 900, 0, true),
        makeRecord('b', 1000, 0, true),
        makeRecord('c', 1100, 0, true),
      ];
      const result = mgr.evaluate(0, 0, records, squadResolver);
      expect(result.goOffline).toContain('a');
      expect(result.goOffline).toContain('b');
      expect(result.goOffline).toContain('c');
    });

    it('maintains squad state when in hysteresis band', () => {
      const records = [
        makeRecord('a', 700, 0, true),   // In band, online
        makeRecord('b', 750, 0, true),   // In band, online
        makeRecord('c', 780, 0, true),   // In band, online
      ];
      const result = mgr.evaluate(0, 0, records, squadResolver);
      expect(result.goOnline).toHaveLength(0);
      expect(result.goOffline).toHaveLength(0);
    });

    it('does not duplicate transitions for squad members', () => {
      const records = [
        makeRecord('a', 100, 0, false),
        makeRecord('b', 200, 0, false),
        makeRecord('c', 300, 0, false),
      ];
      const result = mgr.evaluate(0, 0, records, squadResolver);
      // Each member should appear exactly once
      const unique = new Set(result.goOnline);
      expect(unique.size).toBe(result.goOnline.length);
    });

    it('skips already-online squad members when bringing online', () => {
      const records = [
        makeRecord('a', 100, 0, false),  // In range, offline → goOnline
        makeRecord('b', 200, 0, true),   // In range, already online → skip
        makeRecord('c', 700, 0, false),  // In band, offline → goOnline (squad pull)
      ];
      const result = mgr.evaluate(0, 0, records, squadResolver);
      expect(result.goOnline).toContain('a');
      expect(result.goOnline).not.toContain('b');
      expect(result.goOnline).toContain('c');
    });

    it('skips dead squad members', () => {
      const records = [
        makeRecord('a', 100, 0, false),         // In range
        makeRecord('b', 200, 0, false, false),   // Dead
        makeRecord('c', 300, 0, false),          // Alive
      ];
      const result = mgr.evaluate(0, 0, records, squadResolver);
      expect(result.goOnline).toContain('a');
      expect(result.goOnline).not.toContain('b');
      expect(result.goOnline).toContain('c');
    });

    it('treats single-member squad as individual', () => {
      const singleSquad = (id: string) => id === 'solo' ? ['solo'] : null;
      const records = [makeRecord('solo', 700, 0, false)];
      const result = mgr.evaluate(0, 0, records, singleSquad);
      // Single member in hysteresis band → individual rule → stays offline
      expect(result.goOnline).toHaveLength(0);
    });

    it('handles mixed squads and individuals', () => {
      const records = [
        makeRecord('a', 100, 0, false),    // Squad member, in range
        makeRecord('b', 700, 0, false),    // Squad member
        makeRecord('c', 700, 0, false),    // Squad member
        makeRecord('solo', 100, 0, false), // Individual, in range
      ];
      const mixedResolver = (id: string) => {
        if (id === 'a' || id === 'b' || id === 'c') return ['a', 'b', 'c'];
        return null;
      };
      const result = mgr.evaluate(0, 0, records, mixedResolver);
      expect(result.goOnline).toContain('a');
      expect(result.goOnline).toContain('b');
      expect(result.goOnline).toContain('c');
      expect(result.goOnline).toContain('solo');
    });
  });

  describe('scratch field reuse', () => {
    it('sequential evaluate() calls return independent results', () => {
      const mgr = new OnlineOfflineManager();

      // First call: one NPC goes online
      const r1 = mgr.evaluate(0, 0, [makeRecord('a', 100, 0, false)]);
      expect(r1.goOnline).toEqual(['a']);

      // Second call: different NPC goes offline, no online transitions
      const r2 = mgr.evaluate(0, 0, [makeRecord('b', 900, 0, true)]);
      expect(r2.goOnline).toHaveLength(0);
      expect(r2.goOffline).toEqual(['b']);
    });

    it('sequential evaluate() with squads does not leak state', () => {
      const mgr = new OnlineOfflineManager();

      const squad1 = (id: string) => (id === 'a' || id === 'b') ? ['a', 'b'] : null;
      const squad2 = (id: string) => (id === 'c' || id === 'd') ? ['c', 'd'] : null;

      // First: squad1 goes online
      const r1 = mgr.evaluate(
        0, 0,
        [makeRecord('a', 100, 0, false), makeRecord('b', 700, 0, false)],
        squad1,
      );
      expect(r1.goOnline).toContain('a');
      expect(r1.goOnline).toContain('b');

      // Second: squad2 goes offline — should not contain squad1 members
      const r2 = mgr.evaluate(
        0, 0,
        [makeRecord('c', 900, 0, true), makeRecord('d', 1000, 0, true)],
        squad2,
      );
      expect(r2.goOffline).toContain('c');
      expect(r2.goOffline).toContain('d');
      expect(r2.goOnline).toHaveLength(0);
    });
  });

  describe('boundary precision', () => {
    // Use exact thresholds for boundary testing
    const mgr = new OnlineOfflineManager({ switchDistance: 100, hysteresisFactor: 0 });
    // onlineDist = offlineDist = 100, distSq = 10000

    it('NPC exactly at threshold distance (offline → online uses strict <)', () => {
      // At exactly 100px, distSq = 10000 which is NOT < 10000
      const records = [makeRecord('a', 100, 0, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toHaveLength(0);
    });

    it('NPC just inside threshold goes online', () => {
      const records = [makeRecord('a', 99, 0, false)];
      const result = mgr.evaluate(0, 0, records);
      expect(result.goOnline).toContain('a');
    });
  });
});
