import { describe, it, expect } from 'vitest';
import { createPhaserKernel } from './createPhaserKernel';
import type { IEntityAdapter } from '@alife-sdk/core';
import type { IPlayerPositionProvider, IEntityFactory } from '@alife-sdk/core';
import type { ISimulationBridge } from '@alife-sdk/simulation';

// Minimal stubs for required ports

const stubEntityAdapter: IEntityAdapter = {
  getPosition: () => null,
  isAlive: () => false,
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

const stubPlayerPosition: IPlayerPositionProvider = {
  getPlayerPosition: () => ({ x: 0, y: 0 }),
};

const stubEntityFactory: IEntityFactory = {
  createNPC: () => 'npc_stub',
  createMonster: () => 'monster_stub',
  destroyEntity: () => {},
};

const stubSimulationBridge: ISimulationBridge = {
  isAlive: () => false,
  applyDamage: () => true,
  getEffectiveDamage: (_id, raw) => raw,
  adjustMorale: () => {},
};

const stubPorts = {
  entityAdapter: stubEntityAdapter,
  playerPosition: stubPlayerPosition,
  entityFactory: stubEntityFactory,
};

describe('createPhaserKernel', () => {
  it('creates kernel with minimal preset', () => {
    const { kernel, simulation, onlineOffline } = createPhaserKernel({
      ports: stubPorts,
      config: { preset: 'minimal' },
    });

    expect(kernel).toBeDefined();
    expect(simulation).toBeNull();
    expect(onlineOffline).toBeDefined();
  });

  it('creates kernel with simulation preset', () => {
    const { kernel, simulation } = createPhaserKernel({
      ports: { ...stubPorts, simulationBridge: stubSimulationBridge },
      config: { preset: 'simulation' },
    });

    expect(kernel).toBeDefined();
    expect(simulation).not.toBeNull();
  });

  it('creates kernel with factions', () => {
    const { kernel } = createPhaserKernel({
      ports: stubPorts,
      data: {
        factions: [
          { id: 'stalker', relations: { bandit: -60 } },
          { id: 'bandit', relations: { stalker: -60 } },
        ],
      },
      config: { preset: 'minimal' },
    });

    expect(kernel).toBeDefined();
  });

  it('onlineOffline uses custom config', () => {
    const { onlineOffline } = createPhaserKernel({
      ports: stubPorts,
      config: {
        preset: 'minimal',
        onlineOffline: { switchDistance: 1000, hysteresisFactor: 0.2 },
      },
    });

    expect(onlineOffline.onlineDistance).toBe(800);
    expect(onlineOffline.offlineDistance).toBe(1200);
  });

  it('initializes and starts without errors', () => {
    const { kernel } = createPhaserKernel({
      ports: { ...stubPorts, simulationBridge: stubSimulationBridge },
      data: { factions: [{ id: 'stalker' }] },
      config: { preset: 'simulation' },
    });

    const diag = kernel.init();
    expect(diag.hasErrors).toBe(false);

    expect(() => kernel.start()).not.toThrow();
    expect(() => kernel.update(16)).not.toThrow();
    kernel.destroy();
  });
});
