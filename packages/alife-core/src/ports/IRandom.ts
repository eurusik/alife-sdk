/**
 * Injectable random number generator port.
 * Allows deterministic testing via SeededRandom while using Math.random() in production.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IRandom {
  /** Return a pseudo-random float in [0, 1). */
  next(): number;

  /** Return a pseudo-random integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number;

  /** Return a pseudo-random float in [min, max). */
  nextFloat(min: number, max: number): number;
}

// ---------------------------------------------------------------------------
// DefaultRandom — delegates to Math.random()
// ---------------------------------------------------------------------------

export class DefaultRandom implements IRandom {
  next(): number {
    return Math.random();
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}

// ---------------------------------------------------------------------------
// SeededRandom — deterministic mulberry32 PRNG
// ---------------------------------------------------------------------------

export class SeededRandom implements IRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    let t = (this.state += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}
