// src/MapGenerator.test.ts
// Unit tests for the MapDefinition seed capture fix in MapGenerator.
//
// The fix: MapDefinition.seed is always set to cfg.seed (the original user
// seed) rather than the per-candidate seed suffix (e.g. "seed_c0", "seed_c1")
// that was previously written for multi-candidate runs.
//
// Four invariants are verified:
//   1. Single-candidate: map.seed equals the input seed.
//   2. Multi-candidate:  map.seed equals the input seed, not any "_cN" variant.
//   3. Reproducibility:  generate({seed: map.seed}) reproduces the same map.
//   4. Uniqueness:       different input seeds produce structurally different maps.

import { describe, it, expect } from 'vitest';
import { MapGenerator } from './MapGenerator';
import type { MapDefinition } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compact structural fingerprint of a MapDefinition.
 * Covers zone placement, prop positions, and cover-point positions — enough
 * signal to distinguish two differently-seeded maps with high confidence.
 */
function fingerprint(map: MapDefinition): string {
  const zoneIds  = map.zones.map(z => `${z.type}@${z.tileBounds.x},${z.tileBounds.y}`).join('|');
  const propXY   = map.props.slice(0, 8).map(p => `${p.type}:${Math.round(p.x)},${Math.round(p.y)}`).join('|');
  const coverXY  = map.coverPoints.slice(0, 8).map(c => `${Math.round(c.x)},${Math.round(c.y)}`).join('|');
  return [zoneIds, propXY, coverXY].join('//');
}

/** Minimal config that runs fast: 1 or N candidates, single zone. */
function smallConfig(seed: string, candidateCount: number) {
  return {
    seed,
    candidateCount,
    width: 60,
    height: 50,
    zoneConfig: {
      minZones: 2,
      maxZones: 2,
      edgeMarginTiles: 2,
      minZoneDistanceTiles: 8,
      laneCount: 2,
      typeWeights: { camp: 1 } as Record<string, number>,
      factionWeights: { bandits: 1 },
    },
    propConfig: {
      treeDensity: 4,
      grassDensity: 2,
      barrelsPerZone: 1,
      carsPerZone: 0,
      poissonRadius: 64,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Single-candidate: map.seed equals input seed
// ---------------------------------------------------------------------------

describe('MapGenerator.generate — seed capture fix (single candidate)', () => {
  it('map.seed equals the input seed when candidateCount = 1', () => {
    const generator = new MapGenerator();
    const inputSeed = 'single-candidate-seed';

    const map = generator.generate(smallConfig(inputSeed, 1));

    expect(map.seed).toBe(inputSeed);
  });

  it('map.seed is a plain string with no "_c0" suffix appended', () => {
    const generator = new MapGenerator();
    const inputSeed = 'no-suffix-seed';

    const map = generator.generate(smallConfig(inputSeed, 1));

    expect(map.seed).not.toContain('_c0');
    expect(map.seed).toBe(inputSeed);
  });

  it('map.seed reflects a custom seed string exactly as provided', () => {
    const generator = new MapGenerator();

    const map = generator.generate(smallConfig('custom::seed::value', 1));

    expect(map.seed).toBe('custom::seed::value');
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-candidate: map.seed equals input seed, not "_cN" variants
// ---------------------------------------------------------------------------

describe('MapGenerator.generate — seed capture fix (multi-candidate)', () => {
  it('map.seed equals the input seed when candidateCount = 3', () => {
    const generator = new MapGenerator();
    const inputSeed = 'multi-candidate-seed';

    const map = generator.generate(smallConfig(inputSeed, 3));

    expect(map.seed).toBe(inputSeed);
  });

  it('map.seed does not contain "_c0" through "_c4" for a 5-candidate run', () => {
    const generator = new MapGenerator();
    const inputSeed = 'five-candidates';

    const map = generator.generate(smallConfig(inputSeed, 5));

    for (let i = 0; i < 5; i++) {
      expect(map.seed).not.toBe(`${inputSeed}_c${i}`);
    }
    expect(map.seed).toBe(inputSeed);
  });

  it('map.seed is identical whether candidateCount is 1 or 4', () => {
    const gen1 = new MapGenerator();
    const gen4 = new MapGenerator();
    const inputSeed = 'same-seed-different-candidates';

    const mapSingle = gen1.generate(smallConfig(inputSeed, 1));
    const mapMulti  = gen4.generate(smallConfig(inputSeed, 4));

    expect(mapMulti.seed).toBe(mapSingle.seed);
  });
});

// ---------------------------------------------------------------------------
// 3. Reproducibility: generate({seed: map.seed}) reproduces the same map
// ---------------------------------------------------------------------------

describe('MapGenerator.generate — reproducibility via stored seed', () => {
  it('re-running with map.seed from a single-candidate run reproduces the same map', () => {
    const generator = new MapGenerator();
    const cfg = smallConfig('reproduce-single', 1);

    const first  = generator.generate(cfg);
    const second = generator.generate({ ...cfg, seed: first.seed });

    expect(fingerprint(second)).toBe(fingerprint(first));
  });

  it('re-running with map.seed from a multi-candidate run reproduces the same map', () => {
    // Because the winning candidate from a multi-candidate run is determined by
    // per-candidate seeds (cfg.seed + "_cN"), storing cfg.seed lets the caller
    // feed it back to generate() to obtain the same candidate selection and
    // therefore the same winning map.
    const generator = new MapGenerator();
    const cfg = smallConfig('reproduce-multi', 3);

    const first  = generator.generate(cfg);
    const second = generator.generate({ ...cfg, seed: first.seed });

    expect(fingerprint(second)).toBe(fingerprint(first));
  });

  it('map.seed can be round-tripped through JSON without losing reproducibility', () => {
    const generator = new MapGenerator();
    const cfg = smallConfig('json-roundtrip-seed', 2);

    const first = generator.generate(cfg);

    // Simulate serialising and deserialising the seed (as a client would do
    // when storing map metadata in JSON).
    const storedSeed: string = JSON.parse(JSON.stringify(first.seed));

    const second = generator.generate({ ...cfg, seed: storedSeed });

    expect(fingerprint(second)).toBe(fingerprint(first));
  });
});

// ---------------------------------------------------------------------------
// 4. Uniqueness: different input seeds produce different maps
// ---------------------------------------------------------------------------

describe('MapGenerator.generate — different seeds produce different maps', () => {
  it('two different seeds produce maps with different zone placements', () => {
    const generator = new MapGenerator();

    const mapA = generator.generate(smallConfig('seed-alpha', 1));
    const mapB = generator.generate(smallConfig('seed-beta',  1));

    // Zone positions are RNG-derived: collisions are astronomically unlikely.
    const zonesA = mapA.zones.map(z => `${z.tileBounds.x},${z.tileBounds.y}`).join('|');
    const zonesB = mapB.zones.map(z => `${z.tileBounds.x},${z.tileBounds.y}`).join('|');

    expect(zonesA).not.toBe(zonesB);
  });

  it('two different seeds have different overall structural fingerprints', () => {
    const generator = new MapGenerator();

    const mapA = generator.generate(smallConfig('seed-one',   1));
    const mapB = generator.generate(smallConfig('seed-two',   1));

    expect(fingerprint(mapA)).not.toBe(fingerprint(mapB));
  });

  it('the same seed always produces the same fingerprint (determinism baseline)', () => {
    const gen1 = new MapGenerator();
    const gen2 = new MapGenerator();
    const cfg  = smallConfig('determinism-check', 1);

    expect(fingerprint(gen1.generate(cfg))).toBe(fingerprint(gen2.generate(cfg)));
  });
});
