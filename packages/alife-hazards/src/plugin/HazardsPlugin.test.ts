import { describe, it, expect, vi } from 'vitest';
import type { ALifeKernel } from '@alife-sdk/core';
import { HazardsPlugin, HazardsPluginToken } from './HazardsPlugin';
import { HazardManager } from '../manager/HazardManager';
import { ArtefactRegistry } from '../artefact/ArtefactRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRandom = { next: () => 0, nextInt: (_min: number, max: number) => max, nextFloat: (_min: number, max: number) => max };
const mockFactory = { create: vi.fn() };

function makeKernel(): ALifeKernel {
  return {} as unknown as ALifeKernel;
}

function makePlugin(zones?: Parameters<typeof HazardsPlugin>[1]['zones']) {
  return new HazardsPlugin(mockRandom, {
    artefactFactory: mockFactory,
    zones,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HazardsPlugin', () => {
  it('1. HazardsPluginToken.name === "hazards"', () => {
    expect(HazardsPluginToken.name).toBe('hazards');
  });

  it('2. plugin.artefacts is an ArtefactRegistry', () => {
    const plugin = makePlugin();
    expect(plugin.artefacts).toBeInstanceOf(ArtefactRegistry);
  });

  it('3. plugin.manager throws before install()', () => {
    const plugin = makePlugin();
    expect(() => plugin.manager).toThrow('HazardsPlugin.manager accessed before install()');
  });

  it('4. After install(), plugin.manager is a HazardManager', () => {
    const plugin = makePlugin();
    const kernel = makeKernel();
    plugin.install(kernel);
    expect(plugin.manager).toBeInstanceOf(HazardManager);
  });

  it('5. After install() with zones config, zones are registered in manager', () => {
    const zones = [
      { id: 'rad_1', type: 'radiation' as const, x: 100, y: 100, radius: 50,
        damagePerSecond: 8, artefactChance: 0.15, maxArtefacts: 2 },
      { id: 'fire_1', type: 'fire' as const, x: 200, y: 300, radius: 60,
        damagePerSecond: 12, artefactChance: 0.2, maxArtefacts: 1 },
    ];
    const plugin = makePlugin(zones);
    const kernel = makeKernel();
    plugin.install(kernel);

    expect(plugin.manager.size).toBe(2);
    expect(plugin.manager.getZone('rad_1')).toBeDefined();
    expect(plugin.manager.getZone('fire_1')).toBeDefined();
  });
});
