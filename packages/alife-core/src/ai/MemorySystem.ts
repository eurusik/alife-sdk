/**
 * Multi-channel memory bank with confidence decay.
 *
 * MemoryBank provides per-NPC episodic memory storage. Memories are
 * categorised by channel (visual, sound, hit, danger) and decay over time.
 * Records below the minimum confidence threshold are pruned automatically
 * during update().
 *
 * Storage layout: Map keyed by sourceId for O(1) read/write per entry.
 * A single entity may have at most one record per sourceId; newer
 * observations overwrite older ones.
 */

import type { Vec2 } from '../core/Vec2';

// ---------------------------------------------------------------------------
// Memory channel
// ---------------------------------------------------------------------------

export const MemoryChannel = {
  VISUAL: 'visual',
  SOUND: 'sound',
  HIT: 'hit',
  DANGER: 'danger',
} as const;

export type MemoryChannel = (typeof MemoryChannel)[keyof typeof MemoryChannel] | (string & {});

// ---------------------------------------------------------------------------
// Memory record
// ---------------------------------------------------------------------------

export interface MemoryRecord {
  readonly sourceId: string;
  readonly channel: MemoryChannel;
  readonly position: Vec2;
  /** Confidence level in [0, 1]. Decays over time. */
  readonly confidence: number;
  /** Timestamp (accumulated delta or game time) when record was last updated. */
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RECORDS = 32;
const DEFAULT_DECAY_RATE = 0.1; // confidence per second
const DEFAULT_MIN_CONFIDENCE = 0.05;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for MemoryBank construction. */
export interface IMemoryBankConfig {
  /** Time provider for timestamps. Required for deterministic behavior. */
  readonly timeFn: () => number;
  /** Maximum memory entries kept per NPC. Default: 32. */
  readonly maxRecords?: number;
  /** Confidence decay rate per second. Default: 0.1. */
  readonly decayRate?: number;
  /** Confidence below which a record is pruned. Default: 0.05. */
  readonly minConfidence?: number;
  /** Per-channel decay rate overrides. Keys are MemoryChannel values. Falls back to global decayRate when a channel is not present. */
  readonly channelDecayRates?: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Memory input
// ---------------------------------------------------------------------------

export interface IMemoryInput {
  readonly sourceId: string;
  readonly channel: MemoryChannel;
  readonly position: Vec2;
  readonly confidence?: number;
}

// ---------------------------------------------------------------------------
// MemoryBank
// ---------------------------------------------------------------------------

export class MemoryBank {
  private readonly records = new Map<string, MutableRecord>();
  private readonly byChannel = new Map<string, Set<MutableRecord>>();
  private readonly maxRecords: number;
  private readonly decayRate: number;
  private readonly minConfidence: number;
  private readonly timeFn: () => number;
  private readonly channelDecayRates?: Readonly<Record<string, number>>;
  private readonly _toDelete: string[] = [];

  constructor(config: IMemoryBankConfig) {
    this.timeFn = config.timeFn;
    this.maxRecords = config.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.decayRate = config.decayRate ?? DEFAULT_DECAY_RATE;
    this.minConfidence = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.channelDecayRates = config.channelDecayRates;
  }

  // -----------------------------------------------------------------------
  // Mutation
  // -----------------------------------------------------------------------

  /**
   * Add or update a memory record.
   *
   * If a record for this sourceId already exists, its position and timestamp
   * are updated and confidence is reset to the provided value (default 1.0).
   * If the bank is at capacity, the lowest-confidence record is evicted.
   */
  remember(input: IMemoryInput): void {
    const { sourceId, channel, position, confidence = 1.0 } = input;
    const existing = this.records.get(sourceId);

    if (existing) {
      // If channel changed, migrate between index sets.
      if (existing.channel !== channel) {
        this.removeFromChannelIndex(existing);
        existing.channel = channel;
        this.addToChannelIndex(existing);
      }
      existing.position = position;
      existing.confidence = Math.max(0, Math.min(1, confidence));
      existing.timestamp = this.timeFn();
      return;
    }

    if (this.records.size >= this.maxRecords) {
      this.evictLowestConfidence();
    }

    const record: MutableRecord = {
      sourceId,
      channel,
      position,
      confidence: Math.max(0, Math.min(1, confidence)),
      timestamp: this.timeFn(),
    };
    this.records.set(sourceId, record);
    this.addToChannelIndex(record);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Get memory of a specific source. */
  recall(sourceId: string): MemoryRecord | undefined {
    return this.records.get(sourceId);
  }

  /** Get all records on a specific channel. */
  getByChannel(channel: MemoryChannel): MemoryRecord[] {
    const set = this.byChannel.get(channel);
    if (!set || set.size === 0) return [];
    return Array.from(set);
  }

  /** Get the highest-confidence record, or undefined if the bank is empty. */
  getMostConfident(): MemoryRecord | undefined {
    let best: MutableRecord | undefined;

    for (const record of this.records.values()) {
      if (!best || record.confidence > best.confidence) {
        best = record;
      }
    }

    return best;
  }

  // -----------------------------------------------------------------------
  // Decay and housekeeping
  // -----------------------------------------------------------------------

  /**
   * Decay all records and remove those below the minimum confidence threshold.
   *
   * @param deltaSec      - Seconds elapsed since the last update.
   * @param minConfidence - Records below this threshold are pruned.
   */
  update(deltaSec: number): void {
    this._toDelete.length = 0;

    for (const [id, record] of this.records) {
      const rate = this.channelDecayRates?.[record.channel] ?? this.decayRate;
      const decay = rate * deltaSec;
      record.confidence = Math.max(0, record.confidence - decay);
      if (record.confidence < this.minConfidence) {
        this._toDelete.push(id);
      }
    }

    for (let i = 0; i < this._toDelete.length; i++) {
      const id = this._toDelete[i];
      const record = this.records.get(id);
      if (record) {
        this.removeFromChannelIndex(record);
        this.records.delete(id);
      }
    }
  }

  /** Forget a specific source. */
  forget(sourceId: string): void {
    const record = this.records.get(sourceId);
    if (record) {
      this.removeFromChannelIndex(record);
      this.records.delete(sourceId);
    }
  }

  /** Clear all memories. */
  clear(): void {
    this.records.clear();
    this.byChannel.clear();
  }

  get size(): number {
    return this.records.size;
  }

  // -----------------------------------------------------------------------
  // Serialisation
  // -----------------------------------------------------------------------

  serialize(): MemoryRecord[] {
    return [...this.records.values()].map((r) => ({
      sourceId: r.sourceId,
      channel: r.channel,
      position: r.position,
      confidence: r.confidence,
      timestamp: r.timestamp,
    }));
  }

  restore(records: MemoryRecord[]): void {
    this.records.clear();
    this.byChannel.clear();
    for (const r of records) {
      const mutable: MutableRecord = { ...r };
      this.records.set(r.sourceId, mutable);
      this.addToChannelIndex(mutable);
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /** Evict the record with the lowest confidence to make room. */
  private evictLowestConfidence(): void {
    let lowestId: string | undefined;
    let lowestConfidence = Infinity;

    for (const [id, record] of this.records) {
      if (record.confidence < lowestConfidence) {
        lowestConfidence = record.confidence;
        lowestId = id;
      }
    }

    if (lowestId !== undefined) {
      const record = this.records.get(lowestId);
      if (record) {
        this.removeFromChannelIndex(record);
      }
      this.records.delete(lowestId);
    }
  }

  /** Add a record to the byChannel secondary index. */
  private addToChannelIndex(record: MutableRecord): void {
    let set = this.byChannel.get(record.channel);
    if (!set) {
      set = new Set();
      this.byChannel.set(record.channel, set);
    }
    set.add(record);
  }

  /** Remove a record from the byChannel secondary index. */
  private removeFromChannelIndex(record: MutableRecord): void {
    const set = this.byChannel.get(record.channel);
    if (set) {
      set.delete(record);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal mutable record type
// ---------------------------------------------------------------------------

interface MutableRecord {
  readonly sourceId: string;
  channel: MemoryChannel;
  position: Vec2;
  confidence: number;
  timestamp: number;
}
