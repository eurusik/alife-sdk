/**
 * Integration tests: ArtefactRegistry freeze semantics and
 * WeightedArtefactSelector determinism under various conditions.
 *
 * No mocks (no vi.fn()). All real objects.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ALifeKernel } from '@alife-sdk/core';
import { ArtefactRegistry, WeightedArtefactSelector } from '../artefact/ArtefactRegistry';
import { HazardsPlugin } from '../plugin/HazardsPlugin';
import type { IArtefactFactory, IArtefactSpawnEvent } from '../ports/IArtefactFactory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRandom = { next: () => 0 };

function makeRegistry(): ArtefactRegistry {
  const selector = new WeightedArtefactSelector(mockRandom);
  return new ArtefactRegistry(selector);
}

function makeKernel(): ALifeKernel {
  return {} as unknown as ALifeKernel;
}

function makeSilentFactory(): IArtefactFactory {
  return { create: (_ev: IArtefactSpawnEvent) => { /* no-op */ } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtefactRegistry freeze semantics (integration)', () => {
  it('1. register() after freeze() throws [ArtefactRegistry] Cannot register after freeze()', () => {
    const registry = makeRegistry();
    registry.register({ id: 'crystal', zoneTypes: ['fire'], weight: 1 });
    registry.freeze();

    expect(() =>
      registry.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 }),
    ).toThrow('[ArtefactRegistry] Cannot register after freeze()');
  });

  it('2. freeze() is idempotent — can call twice without error', () => {
    const registry = makeRegistry();
    registry.register({ id: 'crystal', zoneTypes: ['fire'], weight: 1 });
    registry.freeze();

    expect(() => registry.freeze()).not.toThrow();
    expect(registry.isFrozen).toBe(true);
  });

  it('3. isFrozen is false before freeze(), true after', () => {
    const registry = makeRegistry();
    expect(registry.isFrozen).toBe(false);

    registry.freeze();
    expect(registry.isFrozen).toBe(true);
  });

  it('4. registered definitions survive freeze — get(), all(), pickForZone() still work', () => {
    const registry = makeRegistry();
    registry.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 2, custom: { price: 500 } });
    registry.register({ id: 'crystal', zoneTypes: ['fire', 'radiation'], weight: 1 });
    registry.freeze();

    // get() works
    const medusa = registry.get('medusa');
    expect(medusa).toBeDefined();
    expect(medusa?.id).toBe('medusa');
    expect(medusa?.weight).toBe(2);
    expect(medusa?.custom?.price).toBe(500);

    // all() works
    const all = [...registry.all()];
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.id).sort()).toEqual(['crystal', 'medusa']);

    // pickForZone() works
    const picked = registry.pickForZone('radiation');
    expect(picked).not.toBeNull();
    // With random=0 and candidates=[medusa(w=2), crystal(w=1)], total=3
    // roll = 0*3=0; after subtract medusa.weight(2): roll=-2 ≤ 0 → picks medusa
    expect(picked?.id).toBe('medusa');
  });

  it('5. pickForZone() with no matching zone type returns null even after freeze', () => {
    const registry = makeRegistry();
    registry.register({ id: 'crystal', zoneTypes: ['fire'], weight: 1 });
    registry.freeze();

    // Query for 'chemical' — nothing registered for it
    expect(registry.pickForZone('chemical')).toBeNull();
    // Query for 'radiation' — nothing registered for it
    expect(registry.pickForZone('radiation')).toBeNull();
  });

  it('6. WeightedArtefactSelector determinism: same seed → same result across 10 calls', () => {
    // Use a counter-based deterministic source that resets per "query"
    // Since each select() call consumes exactly one next() call, we can use
    // a fixed-value random to verify determinism.
    const fixedRandom = { next: () => 0.25 };
    const selector = new WeightedArtefactSelector(fixedRandom);

    const candidates = [
      { id: 'stone',   zoneTypes: ['radiation' as const], weight: 1 },
      { id: 'crystal', zoneTypes: ['radiation' as const], weight: 2 },
      { id: 'bubble',  zoneTypes: ['radiation' as const], weight: 1 },
    ];
    // total = 4, roll = 0.25 * 4 = 1.0
    // after stone(w=1): roll = 1.0 - 1 = 0 ≤ 0 → picks 'stone'

    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      const picked = selector.select(candidates, 'radiation');
      results.push(picked?.id ?? 'null');
    }

    // All 10 results should be identical (same seed)
    const firstResult = results[0];
    expect(results.every((r) => r === firstResult)).toBe(true);
    expect(firstResult).toBe('stone');
  });

  it('7. WeightedArtefactSelector with single-item list always returns that item regardless of random', () => {
    const candidates = [
      { id: 'solo', zoneTypes: ['psi' as const], weight: 5 },
    ];

    // Test with various random values
    const randomValues = [0, 0.1, 0.5, 0.9, 0.9999];
    for (const val of randomValues) {
      const selector = new WeightedArtefactSelector({ next: () => val });
      const result = selector.select(candidates, 'psi');
      expect(result?.id).toBe('solo');
    }
  });

  it('8. size reflects registered count after freeze', () => {
    const registry = makeRegistry();
    expect(registry.size).toBe(0);

    registry.register({ id: 'alpha', zoneTypes: ['fire'], weight: 1 });
    expect(registry.size).toBe(1);

    registry.register({ id: 'beta', zoneTypes: ['radiation'], weight: 2 });
    expect(registry.size).toBe(2);

    registry.register({ id: 'gamma', zoneTypes: ['chemical', 'psi'], weight: 3 });
    expect(registry.size).toBe(3);

    registry.freeze();
    // Size must not change after freeze
    expect(registry.size).toBe(3);
    expect(registry.isFrozen).toBe(true);
  });

  it('9. HazardsPlugin.init() calls artefacts.freeze() → plugin.artefacts.isFrozen === true', () => {
    const plugin = new HazardsPlugin(mockRandom, { artefactFactory: makeSilentFactory() });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'crystal', zoneTypes: ['fire'], weight: 1 });

    expect(plugin.artefacts.isFrozen).toBe(false);

    plugin.init(); // Should call artefacts.freeze()

    expect(plugin.artefacts.isFrozen).toBe(true);
  });
});
