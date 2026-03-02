import { describe, it, expect } from 'vitest';
import { AIPlugin, createDefaultAIPluginConfig } from './AIPlugin';
import { RestrictionType } from '../navigation/RestrictedZoneManager';

function makeRandom() {
  return { next: () => 0.5 };
}

function makeMinimalKernel() {
  const ports = new Map<string, unknown>();
  return {
    portRegistry: {
      tryGet: (token: { id: string }) => ports.get(token.id),
      require: (token: { id: string }) => {
        const v = ports.get(token.id);
        if (v === undefined) throw new Error(`Port ${token.id} not found`);
        return v;
      },
      has: (token: { id: string }) => ports.has(token.id),
      provide: (token: { id: string }, impl: unknown) => ports.set(token.id, impl),
      registeredIds: () => [...ports.keys()],
    },
    _ports: ports,
  };
}

describe('AIPlugin', () => {
  it('has correct name', () => {
    const plugin = new AIPlugin(makeRandom());
    expect(plugin.name).toBe('ai');
  });

  it('creates default subsystems', () => {
    const plugin = new AIPlugin(makeRandom());
    expect(plugin.coverRegistry).toBeDefined();
    expect(plugin.restrictedZones).toBeDefined();
  });

  it('install stores kernel reference', () => {
    const plugin = new AIPlugin(makeRandom());
    const kernel = makeMinimalKernel();
    plugin.install(kernel as any);
    // Should not throw.
    plugin.init();
  });

  it('init without cover source does not throw', () => {
    const plugin = new AIPlugin(makeRandom());
    const kernel = makeMinimalKernel();
    plugin.install(kernel as any);
    expect(() => plugin.init()).not.toThrow();
  });

  it('destroy clears subsystems', () => {
    const plugin = new AIPlugin(makeRandom());
    const kernel = makeMinimalKernel();
    plugin.install(kernel as any);
    plugin.init();
    plugin.coverRegistry.addPoint(100, 100);
    plugin.restrictedZones.addZone({
      id: 'z1', type: RestrictionType.OUT, x: 0, y: 0, radius: 50, active: true,
    });
    plugin.destroy();
    expect(plugin.coverRegistry.getSize()).toBe(0);
    expect(plugin.restrictedZones.size).toBe(0);
  });

  it('serialize/restore round-trips zones', () => {
    const plugin = new AIPlugin(makeRandom());
    const kernel = makeMinimalKernel();
    plugin.install(kernel as any);
    plugin.init();

    plugin.restrictedZones.addZone({
      id: 'z1', type: RestrictionType.DANGER, x: 100, y: 200, radius: 50, active: true, metadata: 'surge',
    });

    const state = plugin.serialize!();
    plugin.destroy();

    // Restore into fresh plugin.
    const plugin2 = new AIPlugin(makeRandom());
    plugin2.install(makeMinimalKernel() as any);
    plugin2.restore!(state);

    expect(plugin2.restrictedZones.size).toBe(1);
    expect(plugin2.restrictedZones.isDangerous(100, 200)).toBe(true);
  });

  it('getConfig returns ai configuration', () => {
    const plugin = new AIPlugin(makeRandom());
    const cfg = plugin.getConfig();
    expect(cfg.cover).toBeDefined();
    expect(cfg.navigation).toBeDefined();
    expect(cfg.weapon).toBeDefined();
    expect(cfg.squad).toBeDefined();
    expect(cfg.monsterAbility).toBeDefined();
  });
});

describe('createDefaultAIPluginConfig', () => {
  it('returns valid config', () => {
    const cfg = createDefaultAIPluginConfig();
    expect(cfg.ai).toBeDefined();
    expect(cfg.ai.cover.searchRadius).toBeGreaterThan(0);
  });
});

describe('AIPlugin deep merge', () => {
  it('deep merges partial ai config without losing nested defaults', () => {
    // Override only one nested field — cover.searchRadius.
    // All other cover fields, navigation, weapon, squad, monsterAbility etc.
    // must still be present with their default values.
    const customSearchRadius = 999;
    const plugin = new AIPlugin(makeRandom(), {
      ai: { cover: { searchRadius: customSearchRadius } },
    });

    const cfg = plugin.getConfig();

    // The overridden field has the custom value.
    expect(cfg.cover.searchRadius).toBe(customSearchRadius);

    // All other cover defaults must be preserved.
    expect(cfg.cover.pointRadius).toBeGreaterThan(0);
    expect(cfg.cover.occupyDistance).toBeGreaterThan(0);
    expect(cfg.cover.minScoreThreshold).toBeGreaterThan(0);
    expect(cfg.cover.loopholeMaxPerCover).toBeGreaterThan(0);

    // Unrelated top-level sections must still be fully populated.
    expect(cfg.navigation).toBeDefined();
    expect(cfg.navigation.arrivalThreshold).toBeGreaterThan(0);
    expect(cfg.navigation.smoothPointsPerSegment).toBeGreaterThan(0);

    expect(cfg.weapon).toBeDefined();
    expect(cfg.weapon.shotgunEffectiveMax).toBeGreaterThan(0);

    expect(cfg.squad).toBeDefined();
    expect(cfg.squad.nearbyRadius).toBeGreaterThan(0);

    expect(cfg.monsterAbility).toBeDefined();
    expect(cfg.monsterAbility.chargeWindupMs).toBeGreaterThan(0);

    expect(cfg.goap).toBeDefined();
    expect(cfg.goap.replanIntervalMs).toBeGreaterThan(0);
  });

  it('deep merges navigation override without affecting other sections', () => {
    const customArrivalThreshold = 42;
    const plugin = new AIPlugin(makeRandom(), {
      ai: { navigation: { arrivalThreshold: customArrivalThreshold } },
    });

    const cfg = plugin.getConfig();

    expect(cfg.navigation.arrivalThreshold).toBe(customArrivalThreshold);
    // Other navigation defaults still present.
    expect(cfg.navigation.smoothPointsPerSegment).toBeGreaterThan(0);
    expect(cfg.navigation.restrictedZoneSafeMargin).toBeGreaterThan(0);
    // Cover is untouched.
    expect(cfg.cover.searchRadius).toBeGreaterThan(0);
  });

  it('deep merges goap override without affecting cover or navigation', () => {
    const customReplanInterval = 1234;
    const plugin = new AIPlugin(makeRandom(), {
      ai: { goap: { replanIntervalMs: customReplanInterval } },
    });

    const cfg = plugin.getConfig();

    expect(cfg.goap.replanIntervalMs).toBe(customReplanInterval);
    // Other goap defaults preserved.
    expect(cfg.goap.maxPlanDepth).toBeGreaterThan(0);
    expect(cfg.goap.healHpThreshold).toBeGreaterThan(0);
    // Other sections untouched.
    expect(cfg.cover.searchRadius).toBeGreaterThan(0);
    expect(cfg.navigation.arrivalThreshold).toBeGreaterThan(0);
  });
});
