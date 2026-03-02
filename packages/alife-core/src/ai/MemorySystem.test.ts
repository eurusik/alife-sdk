import { MemoryBank, MemoryChannel } from './MemorySystem';

describe('MemoryBank', () => {
  // -------------------------------------------------------------------------
  // remember + recall
  // -------------------------------------------------------------------------

  describe('remember / recall', () => {
    it('stores and recalls a memory record', () => {
      const bank = new MemoryBank({ timeFn: () => 1000 });

      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 10, y: 20 } });

      const record = bank.recall('npc-1');
      expect(record).toBeDefined();
      expect(record!.sourceId).toBe('npc-1');
      expect(record!.channel).toBe(MemoryChannel.VISUAL);
      expect(record!.position).toEqual({ x: 10, y: 20 });
      expect(record!.confidence).toBe(1.0);
      expect(record!.timestamp).toBe(1000);
    });

    it('returns undefined for unknown sourceId', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });
      expect(bank.recall('unknown')).toBeUndefined();
    });

    it('overwrites existing record for the same sourceId', () => {
      let time = 100;
      const bank = new MemoryBank({ timeFn: () => time });

      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 10, y: 20 } });
      time = 200;
      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.SOUND, position: { x: 30, y: 40 }, confidence: 0.8 });

      const record = bank.recall('npc-1');
      expect(record!.channel).toBe(MemoryChannel.SOUND);
      expect(record!.position).toEqual({ x: 30, y: 40 });
      expect(record!.confidence).toBe(0.8);
      expect(record!.timestamp).toBe(200);
    });

    it('stores confidence: 0 as-is without defaulting to 1.0', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });

      bank.remember({ sourceId: 'zero-conf', channel: MemoryChannel.VISUAL, position: { x: 5, y: 5 }, confidence: 0 });

      const record = bank.recall('zero-conf');
      expect(record).toBeDefined();
      expect(record!.confidence).toBe(0);
    });

    it('clamps confidence to [0, 1]', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });

      bank.remember({ sourceId: 'high', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 5.0 });
      expect(bank.recall('high')!.confidence).toBe(1.0);

      bank.remember({ sourceId: 'low', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: -2.0 });
      expect(bank.recall('low')!.confidence).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Capacity eviction
  // -------------------------------------------------------------------------

  describe('capacity eviction', () => {
    it('evicts the lowest-confidence record when at capacity', () => {
      const bank = new MemoryBank({ maxRecords: 3, timeFn: () => 0 });

      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.5 });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.2 }); // lowest
      bank.remember({ sourceId: 'c', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.8 });

      // This should evict 'b' (confidence 0.2)
      bank.remember({ sourceId: 'd', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.9 });

      expect(bank.size).toBe(3);
      expect(bank.recall('b')).toBeUndefined();
      expect(bank.recall('a')).toBeDefined();
      expect(bank.recall('c')).toBeDefined();
      expect(bank.recall('d')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // update() — confidence decay
  // -------------------------------------------------------------------------

  describe('update (confidence decay)', () => {
    it('decays confidence by decayRate * deltaSec', () => {
      const bank = new MemoryBank({
        decayRate: 0.1,
        minConfidence: 0.01,
        timeFn: () => 0,
      });

      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 1.0 });
      bank.update(2); // decay = 0.1 * 2 = 0.2 → confidence = 0.8

      const record = bank.recall('npc-1');
      expect(record!.confidence).toBeCloseTo(0.8);
    });

    it('does not decay below 0', () => {
      const bank = new MemoryBank({
        decayRate: 1.0,
        minConfidence: 0.0,
        timeFn: () => 0,
      });

      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.5 });
      bank.update(10); // decay = 1.0 * 10 = 10 → clamped to 0

      const record = bank.recall('npc-1');
      // minConfidence is 0, but 0 < 0.0 is false, so not pruned at boundary
      // Actually 0 < 0 = false, so record stays at confidence 0
      expect(record).toBeDefined();
      expect(record!.confidence).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Pruning at minConfidence
  // -------------------------------------------------------------------------

  describe('pruning', () => {
    it('removes records that decay below minConfidence', () => {
      const bank = new MemoryBank({
        decayRate: 0.5,
        minConfidence: 0.1,
        timeFn: () => 0,
      });

      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.3 });
      bank.update(1); // decay = 0.5 → confidence = -0.2 → clamped to 0 → pruned (0 < 0.1)

      expect(bank.recall('npc-1')).toBeUndefined();
      expect(bank.size).toBe(0);
    });

    it('keeps records above minConfidence', () => {
      const bank = new MemoryBank({
        decayRate: 0.1,
        minConfidence: 0.05,
        timeFn: () => 0,
      });

      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 1.0 });
      bank.update(1); // confidence = 0.9 → kept

      expect(bank.recall('npc-1')).toBeDefined();
      expect(bank.recall('npc-1')!.confidence).toBeCloseTo(0.9);
    });
  });

  // -------------------------------------------------------------------------
  // getByChannel
  // -------------------------------------------------------------------------

  describe('getByChannel', () => {
    it('filters records by channel', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });

      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 } });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 } });
      bank.remember({ sourceId: 'c', channel: MemoryChannel.VISUAL, position: { x: 2, y: 2 } });
      bank.remember({ sourceId: 'd', channel: MemoryChannel.HIT, position: { x: 3, y: 3 } });

      const visual = bank.getByChannel(MemoryChannel.VISUAL);
      expect(visual).toHaveLength(2);
      expect(visual.map((r) => r.sourceId).sort()).toEqual(['a', 'c']);
    });

    it('returns empty array for a channel with no records', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });
      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 } });

      expect(bank.getByChannel(MemoryChannel.DANGER)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getMostConfident
  // -------------------------------------------------------------------------

  describe('getMostConfident', () => {
    it('returns the record with the highest confidence', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });

      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 0.3 });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 }, confidence: 0.9 });
      bank.remember({ sourceId: 'c', channel: MemoryChannel.HIT, position: { x: 2, y: 2 }, confidence: 0.5 });

      const best = bank.getMostConfident();
      expect(best).toBeDefined();
      expect(best!.sourceId).toBe('b');
      expect(best!.confidence).toBe(0.9);
    });

    it('returns undefined on an empty bank', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });
      expect(bank.getMostConfident()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Injectable timeFn for determinism
  // -------------------------------------------------------------------------

  describe('timeFn injection', () => {
    it('uses the provided timeFn for timestamps', () => {
      let clock = 0;
      const bank = new MemoryBank({ timeFn: () => clock });

      clock = 42;
      bank.remember({ sourceId: 'npc-1', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 } });
      expect(bank.recall('npc-1')!.timestamp).toBe(42);

      clock = 100;
      bank.remember({ sourceId: 'npc-2', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 } });
      expect(bank.recall('npc-2')!.timestamp).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // serialize / restore
  // -------------------------------------------------------------------------

  describe('serialize / restore', () => {
    it('round-trips all records', () => {
      const bank = new MemoryBank({ timeFn: () => 500 });

      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 10, y: 20 }, confidence: 0.8 });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 30, y: 40 }, confidence: 0.5 });

      const serialized = bank.serialize();
      expect(serialized).toHaveLength(2);

      const bank2 = new MemoryBank({ timeFn: () => 999 });
      bank2.restore(serialized);

      expect(bank2.size).toBe(2);
      const a = bank2.recall('a');
      expect(a!.channel).toBe(MemoryChannel.VISUAL);
      expect(a!.position).toEqual({ x: 10, y: 20 });
      expect(a!.confidence).toBe(0.8);
      expect(a!.timestamp).toBe(500);
    });

    it('restore clears previous records', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });

      bank.remember({ sourceId: 'old', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 } });
      bank.restore([
        {
          sourceId: 'new',
          channel: MemoryChannel.HIT,
          position: { x: 5, y: 5 },
          confidence: 0.7,
          timestamp: 100,
        },
      ]);

      expect(bank.recall('old')).toBeUndefined();
      expect(bank.recall('new')).toBeDefined();
      expect(bank.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Per-channel decay rates
  // -------------------------------------------------------------------------

  describe('channelDecayRates', () => {
    it('uses per-channel decay rate when provided', () => {
      const bank = new MemoryBank({
        decayRate: 0.1,
        minConfidence: 0.01,
        timeFn: () => 0,
        channelDecayRates: {
          [MemoryChannel.VISUAL]: 0.5, // fast visual decay
          [MemoryChannel.SOUND]: 0.02, // slow sound decay
        },
      });

      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 1.0 });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 }, confidence: 1.0 });
      bank.remember({ sourceId: 'c', channel: MemoryChannel.HIT, position: { x: 2, y: 2 }, confidence: 1.0 }); // no override → global 0.1

      bank.update(2); // 2 seconds

      // VISUAL: 1.0 - 0.5*2 = 0.0
      const a = bank.recall('a');
      // 0.0 < 0.01 minConfidence → pruned
      expect(a).toBeUndefined();

      // SOUND: 1.0 - 0.02*2 = 0.96
      const b = bank.recall('b');
      expect(b).toBeDefined();
      expect(b!.confidence).toBeCloseTo(0.96);

      // HIT: 1.0 - 0.1*2 = 0.8 (global fallback)
      const c = bank.recall('c');
      expect(c).toBeDefined();
      expect(c!.confidence).toBeCloseTo(0.8);
    });

    it('falls back to global decayRate for channels not in channelDecayRates', () => {
      const bank = new MemoryBank({
        decayRate: 0.2,
        minConfidence: 0.01,
        timeFn: () => 0,
        channelDecayRates: {
          [MemoryChannel.DANGER]: 0.05,
        },
      });

      bank.remember({ sourceId: 'd', channel: MemoryChannel.DANGER, position: { x: 0, y: 0 }, confidence: 1.0 });
      bank.remember({ sourceId: 'v', channel: MemoryChannel.VISUAL, position: { x: 1, y: 1 }, confidence: 1.0 });

      bank.update(1);

      // DANGER: 1.0 - 0.05*1 = 0.95
      expect(bank.recall('d')!.confidence).toBeCloseTo(0.95);

      // VISUAL: 1.0 - 0.2*1 = 0.8 (global fallback)
      expect(bank.recall('v')!.confidence).toBeCloseTo(0.8);
    });

    it('behaves identically without channelDecayRates', () => {
      const bank = new MemoryBank({
        decayRate: 0.1,
        minConfidence: 0.01,
        timeFn: () => 0,
      });

      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 }, confidence: 1.0 });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 }, confidence: 1.0 });

      bank.update(3);

      // Both should decay at global rate: 1.0 - 0.1*3 = 0.7
      expect(bank.recall('a')!.confidence).toBeCloseTo(0.7);
      expect(bank.recall('b')!.confidence).toBeCloseTo(0.7);
    });

    it('per-channel decay of zero prevents confidence loss', () => {
      const bank = new MemoryBank({
        decayRate: 0.5,
        minConfidence: 0.01,
        timeFn: () => 0,
        channelDecayRates: {
          [MemoryChannel.HIT]: 0, // no decay for hit memories
        },
      });

      bank.remember({ sourceId: 'h', channel: MemoryChannel.HIT, position: { x: 0, y: 0 }, confidence: 0.8 });
      bank.remember({ sourceId: 'v', channel: MemoryChannel.VISUAL, position: { x: 1, y: 1 }, confidence: 0.8 });

      bank.update(10); // 10 seconds

      // HIT: 0.8 - 0*10 = 0.8 (no decay)
      expect(bank.recall('h')!.confidence).toBeCloseTo(0.8);

      // VISUAL: 0.8 - 0.5*10 = -4.2 → clamped to 0 → pruned (0 < 0.01)
      expect(bank.recall('v')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // forget / clear / size
  // -------------------------------------------------------------------------

  describe('forget / clear / size', () => {
    it('forget removes a specific record', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });
      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 } });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 } });

      bank.forget('a');
      expect(bank.recall('a')).toBeUndefined();
      expect(bank.recall('b')).toBeDefined();
      expect(bank.size).toBe(1);
    });

    it('clear removes all records', () => {
      const bank = new MemoryBank({ timeFn: () => 0 });
      bank.remember({ sourceId: 'a', channel: MemoryChannel.VISUAL, position: { x: 0, y: 0 } });
      bank.remember({ sourceId: 'b', channel: MemoryChannel.SOUND, position: { x: 1, y: 1 } });

      bank.clear();
      expect(bank.size).toBe(0);
    });
  });
});
