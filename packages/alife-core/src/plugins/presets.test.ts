import { ALifeKernel } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import { fullPreset, fullStalkerPreset, minimalPreset } from './presets';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

function createKernel(): ALifeKernel {
  const adapter: IEntityAdapter = {
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
  const pos: IPlayerPositionProvider = { getPlayerPosition: () => ({ x: 0, y: 0 }) };
  const factory: IEntityFactory = {
    createNPC: () => 'npc',
    createMonster: () => 'mon',
    destroyEntity: () => {},
  };

  return new ALifeKernel()
    .provide(Ports.EntityAdapter, adapter)
    .provide(Ports.PlayerPosition, pos)
    .provide(Ports.EntityFactory, factory);
}

describe('presets', () => {
  describe('fullPreset', () => {
    it('installs 6 plugins', () => {
      const kernel = createKernel();
      fullPreset(kernel);
      kernel.init();

      expect(kernel.hasPlugin('factions')).toBe(true);
      expect(kernel.hasPlugin('npcTypes')).toBe(true);
      expect(kernel.hasPlugin('combatSchema')).toBe(true);
      expect(kernel.hasPlugin('spawn')).toBe(true);
      expect(kernel.hasPlugin('monsters')).toBe(true);
      expect(kernel.hasPlugin('anomalies')).toBe(true);
      kernel.destroy();
    });

    it('returns the kernel for chaining', () => {
      const kernel = createKernel();
      const result = fullPreset(kernel);
      expect(result).toBe(kernel);
      kernel.destroy();
    });
  });

  describe('fullStalkerPreset (deprecated alias)', () => {
    it('is the same function as fullPreset', () => {
      expect(fullStalkerPreset).toBe(fullPreset);
    });
  });

  describe('minimalPreset', () => {
    it('installs 4 plugins (no monsters, anomalies)', () => {
      const kernel = createKernel();
      minimalPreset(kernel);
      kernel.init();

      expect(kernel.hasPlugin('factions')).toBe(true);
      expect(kernel.hasPlugin('npcTypes')).toBe(true);
      expect(kernel.hasPlugin('combatSchema')).toBe(true);
      expect(kernel.hasPlugin('spawn')).toBe(true);
      expect(kernel.hasPlugin('monsters')).toBe(false);
      expect(kernel.hasPlugin('anomalies')).toBe(false);
      kernel.destroy();
    });
  });
});
