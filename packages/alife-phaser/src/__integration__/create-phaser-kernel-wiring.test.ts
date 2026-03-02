/**
 * Integration test: "createPhaserKernel wiring".
 *
 * Verifies that the createPhaserKernel facade correctly:
 *   1. Wires all plugins according to the selected preset
 *   2. Resolves required ports without errors
 *   3. Returns the correct IPhaserKernelResult shape
 *   4. Starts and updates without errors
 *   5. Registers factions accessible via the kernel
 *   6. Cleanly destroys without error
 *   7. Allows multiple independent kernels (no singleton leakage)
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * No Phaser imports — all adapters are plain-object stubs.
 */

import { describe, it, expect } from 'vitest';
import {
  Plugins,
  Ports,
} from '@alife-sdk/core';
import type {
  IEntityAdapter,
  IPlayerPositionProvider,
  IEntityFactory,
  IRandom,
} from '@alife-sdk/core';
import type { ISimulationBridge } from '@alife-sdk/simulation';
import { SimulationPlugin } from '@alife-sdk/simulation';
import { AIPlugin } from '@alife-sdk/ai';
import { SocialPlugin } from '@alife-sdk/social';

import { createPhaserKernel } from '../scene/createPhaserKernel';

// ---------------------------------------------------------------------------
// Port stubs — plain objects implementing SDK interfaces, no Phaser classes
// ---------------------------------------------------------------------------

function stubEntityAdapter(): IEntityAdapter {
  return {
    getPosition: () => ({ x: 0, y: 0 }),
    isAlive: () => true,
    hasComponent: () => false,
    getComponentValue: () => null,
    setPosition: () => {},
    setActive: () => {},
    setVisible: () => {},
    setVelocity: () => {},
    getVelocity: () => ({ x: 0, y: 0 }),
    setRotation: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    setAlpha: () => {},
    playAnimation: () => {},
    hasAnimation: () => false,
  };
}

function stubPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 9999, y: 9999 }) };
}

function stubEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'stub',
    createMonster: () => 'stub',
    destroyEntity: () => {},
  };
}

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
  };
}

const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPhaserKernel wiring (integration)', () => {
  it("'minimal' preset — kernel starts without error, simulation is null", () => {
    const { kernel, simulation, onlineOffline } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
      },
      config: { preset: 'minimal' },
    });

    const diag = kernel.init();
    expect(diag.hasErrors).toBe(false);

    expect(() => kernel.start()).not.toThrow();
    expect(() => kernel.update(16)).not.toThrow();

    expect(simulation).toBeNull();
    expect(onlineOffline).toBeDefined();

    kernel.destroy();
  });

  it("'simulation' preset — kernel has SimulationPlugin installed", () => {
    const { kernel, simulation } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
      },
      config: { preset: 'simulation' },
    });

    kernel.init();
    kernel.start();

    expect(simulation).not.toBeNull();
    expect(simulation).toBeInstanceOf(SimulationPlugin);
    expect(kernel.hasPlugin('simulation')).toBe(true);

    kernel.destroy();
  });

  it("'full' preset — all plugins present: simulation, ai, social", () => {
    const { kernel, simulation } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
        random: SEEDED_RANDOM,
      },
      config: { preset: 'full' },
    });

    kernel.init();
    kernel.start();

    expect(simulation).not.toBeNull();
    expect(kernel.hasPlugin('simulation')).toBe(true);
    expect(kernel.hasPlugin('ai')).toBe(true);
    expect(kernel.hasPlugin('social')).toBe(true);

    const aiPlugin = kernel.getPlugin<AIPlugin>('ai');
    expect(aiPlugin).toBeInstanceOf(AIPlugin);

    const socialPlugin = kernel.getPlugin<SocialPlugin>('social');
    expect(socialPlugin).toBeInstanceOf(SocialPlugin);

    kernel.destroy();
  });

  it("'full' preset — kernel.update(16) completes without error", () => {
    const { kernel } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
        random: SEEDED_RANDOM,
      },
      config: { preset: 'full' },
    });

    kernel.init();
    kernel.start();

    // Run multiple update cycles to exercise all plugin pipelines
    expect(() => {
      for (let i = 0; i < 10; i++) kernel.update(16);
    }).not.toThrow();

    kernel.destroy();
  });

  it('factions defined in config → accessible via FactionsPlugin after init', () => {
    const { kernel } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
      },
      data: {
        factions: [
          { id: 'stalker', relations: { bandit: -60 } },
          { id: 'bandit', relations: { stalker: -60 } },
        ],
      },
      config: { preset: 'simulation' },
    });

    kernel.init();
    kernel.start();

    const factionsPlugin = kernel.getPlugin(Plugins.FACTIONS);
    expect(factionsPlugin.factions.has('stalker')).toBe(true);
    expect(factionsPlugin.factions.has('bandit')).toBe(true);

    kernel.destroy();
  });

  it('kernel.destroy() completes without error', () => {
    const { kernel } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
      },
      config: { preset: 'simulation' },
    });

    kernel.init();
    kernel.start();
    kernel.update(16);

    expect(() => kernel.destroy()).not.toThrow();
  });

  it('two separate kernels can be created independently (no singleton state leaked)', () => {
    const { kernel: kernelA, simulation: simA } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
      },
      data: { factions: [{ id: 'loner', relations: { bandit: -50 } }] },
      config: { preset: 'simulation' },
    });

    const { kernel: kernelB, simulation: simB } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
      },
      data: { factions: [{ id: 'military', relations: { bandit: -80 } }] },
      config: { preset: 'simulation' },
    });

    kernelA.init();
    kernelA.start();
    kernelB.init();
    kernelB.start();

    // Each kernel has its own independent state
    expect(simA).not.toBe(simB);

    const factionsA = kernelA.getPlugin(Plugins.FACTIONS);
    const factionsB = kernelB.getPlugin(Plugins.FACTIONS);

    expect(factionsA.factions.has('loner')).toBe(true);
    expect(factionsA.factions.has('military')).toBe(false);

    expect(factionsB.factions.has('military')).toBe(true);
    expect(factionsB.factions.has('loner')).toBe(false);

    // Factions plugin instances are different
    expect(factionsA).not.toBe(factionsB);

    kernelA.destroy();
    kernelB.destroy();
  });

  it("'minimal' preset with custom onlineOffline config → OOM distances configured", () => {
    const { onlineOffline } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
      },
      config: {
        preset: 'minimal',
        onlineOffline: { switchDistance: 600, hysteresisFactor: 0.1 },
      },
    });

    // switchDistance=600, hysteresisFactor=0.1
    // onlineDist = 600 * (1 - 0.1) = 540
    // offlineDist = 600 * (1 + 0.1) = 660
    expect(onlineOffline.onlineDistance).toBe(540);
    expect(onlineOffline.offlineDistance).toBe(660);
  });

  it("'simulation' preset — kernel.portRegistry has EntityAdapter and PlayerPosition", () => {
    const { kernel } = createPhaserKernel({
      ports: {
        entityAdapter: stubEntityAdapter(),
        playerPosition: stubPlayerPosition(),
        entityFactory: stubEntityFactory(),
        simulationBridge: stubBridge(),
      },
      config: { preset: 'simulation' },
    });

    // Ports provided before init — portRegistry should have them
    expect(kernel.portRegistry.has(Ports.EntityAdapter)).toBe(true);
    expect(kernel.portRegistry.has(Ports.PlayerPosition)).toBe(true);
    expect(kernel.portRegistry.has(Ports.EntityFactory)).toBe(true);

    kernel.init();
    kernel.destroy();
  });
});
