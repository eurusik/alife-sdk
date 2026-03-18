// src/core/Rng.ts
// Deterministic PRNG based on a splitmix64-inspired 32-bit variant.
// Seeded with a string; produces reproducible sequences for the same seed.

/**
 * Lightweight seeded pseudo-random number generator.
 *
 * Uses the mulberry32 algorithm — fast, zero external deps, good distribution.
 * Produces a deterministic sequence for a given numeric seed.
 */
export class Rng {
  private state: number;
  private readonly _seed: string;

  constructor(seed: string) {
    this._seed = seed;
    this.state = Rng.hashString(seed);
  }

  /** Hash a string to a 32-bit unsigned integer using FNV-1a. */
  private static hashString(s: string): number {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h === 0 ? 1 : h;
  }

  /**
   * Returns the next float in [0, 1).
   * Mulberry32: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
   */
  next(): number {
    let t = (this.state + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.state = t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /**
   * Returns a random integer in [min, max] (inclusive).
   */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Returns a random float in [min, max).
   */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /**
   * Returns true with the given probability [0..1].
   */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * Picks a random element from an array.
   */
  pick<T>(arr: ReadonlyArray<T>): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * Shuffles an array in-place (Fisher-Yates).
   * Returns the same array reference.
   */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Picks a weighted random key from a weight map.
   * Weights are relative (need not sum to 1).
   */
  weightedPick<K extends string>(weights: Partial<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((sum, [, w]) => sum + (w ?? 0), 0);
    if (total <= 0) {
      throw new RangeError(
        `weightedPick: total weight must be > 0, got ${total}. ` +
        `Ensure at least one key has a positive weight.`,
      );
    }
    let roll = this.next() * total;
    for (const [key, w] of entries) {
      roll -= w ?? 0;
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * Fork a new Rng from the current state using a namespace suffix.
   * Useful for giving sub-systems their own independent sequence.
   */
  fork(namespace: string): Rng {
    const child = new Rng(`${this._seed}-${namespace}`);
    return child;
  }
}
