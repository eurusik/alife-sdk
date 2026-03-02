import { describe, it, expect, vi } from 'vitest';
import { ALifeKernel, KERNEL_STATE_VERSION } from './ALifeKernel';
import { Ports } from './PortTokens';
import { createPortToken } from './PortRegistry';
import { ALifeValidationError } from './Diagnostics';
import { DefaultRandom } from '../ports/IRandom';
import type { IALifePlugin } from '../plugins/IALifePlugin';
import { createPluginToken } from '../plugins/PluginToken';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

function mockEntityAdapter(): IEntityAdapter {
  return {
    // IEntityQuery
    getPosition: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    isAlive: vi.fn().mockReturnValue(true),
    hasComponent: vi.fn().mockReturnValue(false),
    getComponentValue: vi.fn().mockReturnValue(null),
    // IEntityMutation
    setPosition: vi.fn(),
    setActive: vi.fn(),
    setVisible: vi.fn(),
    setVelocity: vi.fn(),
    getVelocity: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    setRotation: vi.fn(),
    teleport: vi.fn(),
    disablePhysics: vi.fn(),
    // IEntityRendering
    setAlpha: vi.fn(),
    playAnimation: vi.fn(),
    hasAnimation: vi.fn().mockReturnValue(false),
  };
}

function mockPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: vi.fn().mockReturnValue({ x: 100, y: 100 }) };
}

function mockEntityFactory(): IEntityFactory {
  return {
    createNPC: vi.fn().mockReturnValue('npc-1'),
    createMonster: vi.fn().mockReturnValue('monster-1'),
    destroyEntity: vi.fn(),
  };
}

function createKernel(): ALifeKernel {
  return new ALifeKernel();
}

function createPlugin(name: string, overrides?: Partial<IALifePlugin>): IALifePlugin {
  return {
    name,
    install: vi.fn(),
    init: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('ALifeKernel', () => {
  describe('Lifecycle: init -> start -> update', () => {
    it('init() sets isInitialized to true', () => {
      const kernel = createKernel();
      kernel.init();
      expect(kernel.isInitialized).toBe(true);
    });

    it('init() returns DiagnosticsCollector', () => {
      const kernel = createKernel();
      const diag = kernel.init();
      expect(diag).toBeDefined();
      expect(diag.all).toBeDefined();
    });

    it('init() twice throws', () => {
      const kernel = createKernel();
      kernel.init();
      expect(() => kernel.init()).toThrow('Already initialized');
    });

    it('start() before init throws', () => {
      const kernel = createKernel();
      expect(() => kernel.start()).toThrow('Not initialized');
    });

    it('start() sets isRunning to true', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.start();
      expect(kernel.isRunning).toBe(true);
    });

    it('start() twice throws', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.start();
      expect(() => kernel.start()).toThrow('Already started');
    });

    it('update() before init throws', () => {
      const kernel = createKernel();
      expect(() => kernel.update(16)).toThrow('Not initialized');
    });

    it('update() before start throws', () => {
      const kernel = createKernel();
      kernel.init();
      expect(() => kernel.update(16)).toThrow('Not running');
    });

    it('update() advances tick counter', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.start();
      expect(kernel.tick).toBe(0);
      kernel.update(16);
      expect(kernel.tick).toBe(1);
      kernel.update(16);
      expect(kernel.tick).toBe(2);
    });

    it('update() when paused is a no-op', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.start();
      kernel.pause();
      kernel.update(16);
      expect(kernel.tick).toBe(0);
    });

    it('update() calls plugin.update() for each plugin', () => {
      const kernel = createKernel();
      const plugin = createPlugin('test-plugin');
      kernel.use(plugin);
      kernel.init();
      kernel.start();
      kernel.update(16);
      expect(plugin.update).toHaveBeenCalledWith(16);
    });
  });

  describe('step()', () => {
    it('step() before init throws', () => {
      const kernel = createKernel();
      expect(() => kernel.step()).toThrow('Not initialized');
    });

    it('step(1) advances tick by 1', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.step(1);
      expect(kernel.tick).toBe(1);
    });

    it('step(5) advances tick by 5', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.step(5);
      expect(kernel.tick).toBe(5);
    });

    it('step() does not require start()', () => {
      const kernel = createKernel();
      kernel.init();
      expect(kernel.isRunning).toBe(false);
      kernel.step(1);
      expect(kernel.tick).toBe(1);
    });

    it('step() calls plugin.update() with config.tick.intervalMs', () => {
      const kernel = createKernel();
      const plugin = createPlugin('test-plugin');
      kernel.use(plugin);
      kernel.init();
      kernel.step(1);
      expect(plugin.update).toHaveBeenCalledWith(5000);
    });
  });

  describe('Pause / Resume', () => {
    it('pause() sets isPaused to true', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.pause();
      expect(kernel.isPaused).toBe(true);
    });

    it('resume() sets isPaused to false', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.pause();
      kernel.resume();
      expect(kernel.isPaused).toBe(false);
    });

    it('pause() pauses the clock', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.pause();
      expect(kernel.clock.isPaused).toBe(true);
    });

    it('resume() resumes the clock', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.pause();
      kernel.resume();
      expect(kernel.clock.isPaused).toBe(false);
    });

    it('step() works when paused', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.pause();
      kernel.step(1);
      expect(kernel.tick).toBe(1);
    });
  });

  describe('Port registration', () => {
    it('provide() registers port accessible via portRegistry', () => {
      const kernel = new ALifeKernel();
      kernel.provide(Ports.EntityAdapter, mockEntityAdapter());
      expect(kernel.portRegistry.has(Ports.EntityAdapter)).toBe(true);
    });

    it('provide() after init throws', () => {
      const kernel = createKernel();
      kernel.init();
      expect(() => kernel.provide(Ports.EntityAdapter, mockEntityAdapter())).toThrow(
        'Cannot provide ports after init()',
      );
    });

    it('entityAdapter getter works with provided ports', () => {
      const adapter = mockEntityAdapter();
      const kernel = new ALifeKernel();
      kernel.provide(Ports.EntityAdapter, adapter);
      expect(kernel.entityAdapter).toBe(adapter);
    });

    it('playerPosition getter works with provided ports', () => {
      const pos = mockPlayerPosition();
      const kernel = new ALifeKernel();
      kernel.provide(Ports.PlayerPosition, pos);
      expect(kernel.playerPosition).toBe(pos);
    });

    it('entityFactory getter works with provided ports', () => {
      const factory = mockEntityFactory();
      const kernel = new ALifeKernel();
      kernel.provide(Ports.EntityFactory, factory);
      expect(kernel.entityFactory).toBe(factory);
    });

    it('provide() supports chaining', () => {
      const kernel = new ALifeKernel();
      const result = kernel
        .provide(Ports.EntityAdapter, mockEntityAdapter())
        .provide(Ports.PlayerPosition, mockPlayerPosition())
        .provide(Ports.EntityFactory, mockEntityFactory());
      expect(result).toBe(kernel);
    });

    it('custom port tokens work alongside built-in ones', () => {
      interface IPathfinder { findPath(from: unknown, to: unknown): unknown[] }
      const PathfinderPort = createPortToken<IPathfinder>('pathfinder', 'A* pathfinder');
      const pf: IPathfinder = { findPath: vi.fn().mockReturnValue([]) };

      const kernel = createKernel();
      kernel.provide(PathfinderPort, pf);
      kernel.init();

      expect(kernel.portRegistry.require(PathfinderPort)).toBe(pf);
    });
  });

  describe('getPlugin()', () => {
    it('returns installed plugin by name', () => {
      const kernel = createKernel();
      const plugin = createPlugin('myPlugin');
      kernel.use(plugin);
      kernel.init();
      expect(kernel.getPlugin('myPlugin')).toBe(plugin);
    });

    it('throws for unknown plugin name', () => {
      const kernel = createKernel();
      kernel.init();
      expect(() => kernel.getPlugin('nonexistent')).toThrow('not installed');
    });

    it('hasPlugin() returns true for installed plugin', () => {
      const kernel = createKernel();
      kernel.use(createPlugin('myPlugin'));
      expect(kernel.hasPlugin('myPlugin')).toBe(true);
    });

    it('hasPlugin() returns false for missing plugin', () => {
      const kernel = createKernel();
      expect(kernel.hasPlugin('nonexistent')).toBe(false);
    });

    it('accepts a typed PluginToken and returns the plugin', () => {
      const kernel = createKernel();
      const plugin = createPlugin('typedPlugin');
      const token = createPluginToken<typeof plugin>('typedPlugin');
      kernel.use(plugin);
      kernel.init();
      expect(kernel.getPlugin(token)).toBe(plugin);
    });

    it('throws for PluginToken with unknown name', () => {
      const kernel = createKernel();
      kernel.init();
      const token = createPluginToken<IALifePlugin>('missing');
      expect(() => kernel.getPlugin(token)).toThrow('not installed');
    });
  });

  describe('IRandom auto-provide', () => {
    it('auto-provides DefaultRandom when no Random port given', () => {
      const kernel = createKernel();
      kernel.init();
      const random = kernel.portRegistry.tryGet(Ports.Random);
      expect(random).toBeInstanceOf(DefaultRandom);
    });

    it('does not overwrite user-provided Random port', () => {
      const customRandom = { next: () => 0.5, nextInt: () => 3, nextFloat: () => 5.0 };
      const kernel = createKernel();
      kernel.provide(Ports.Random, customRandom);
      kernel.init();
      expect(kernel.portRegistry.require(Ports.Random)).toBe(customRandom);
    });
  });

  describe('EntityAdapter / PlayerPosition / EntityFactory auto-provide', () => {
    it('init() without any provide() succeeds', () => {
      const kernel = new ALifeKernel();
      expect(() => kernel.init()).not.toThrow();
    });

    it('auto-provides no-op defaults for all 3 ports when none given', () => {
      const kernel = new ALifeKernel();
      kernel.init();
      expect(kernel.portRegistry.has(Ports.EntityAdapter)).toBe(true);
      expect(kernel.portRegistry.has(Ports.PlayerPosition)).toBe(true);
      expect(kernel.portRegistry.has(Ports.EntityFactory)).toBe(true);
    });

    it('does not overwrite user-provided EntityAdapter', () => {
      const adapter = mockEntityAdapter();
      const kernel = new ALifeKernel();
      kernel.provide(Ports.EntityAdapter, adapter);
      kernel.init();
      expect(kernel.entityAdapter).toBe(adapter);
    });

    it('does not overwrite user-provided PlayerPosition', () => {
      const pos = mockPlayerPosition();
      const kernel = new ALifeKernel();
      kernel.provide(Ports.PlayerPosition, pos);
      kernel.init();
      expect(kernel.playerPosition).toBe(pos);
    });

    it('does not overwrite user-provided EntityFactory', () => {
      const factory = mockEntityFactory();
      const kernel = new ALifeKernel();
      kernel.provide(Ports.EntityFactory, factory);
      kernel.init();
      expect(kernel.entityFactory).toBe(factory);
    });
  });

  describe('Plugin dependencies', () => {
    it('plugin with satisfied hard dependency inits successfully', () => {
      const kernel = createKernel();
      kernel.use(createPlugin('a'));
      kernel.use(createPlugin('b', { dependencies: ['a'] }));
      expect(() => kernel.init()).not.toThrow();
    });

    it('plugin with missing hard dependency causes init to throw ALifeValidationError', () => {
      const kernel = createKernel();
      kernel.use(createPlugin('b', { dependencies: ['a'] }));
      expect(() => kernel.init()).toThrow(ALifeValidationError);
    });

    it('plugin with missing optional dependency inits with warning', () => {
      const kernel = createKernel();
      kernel.use(createPlugin('b', { optionalDependencies: ['a'] }));
      const diag = kernel.init();
      expect(diag.warnings.length).toBeGreaterThan(0);
      expect(diag.warnings.some((w) => w.message.includes('a'))).toBe(true);
    });

    it('plugin with satisfied requiredPorts inits successfully', () => {
      const customPort = createPortToken<{ foo: string }>('customPort', 'A custom port');
      const kernel = createKernel();
      kernel.provide(customPort, { foo: 'bar' });
      kernel.use(createPlugin('needs-port', { requiredPorts: [customPort] }));
      expect(() => kernel.init()).not.toThrow();
    });

    it('plugin with missing requiredPorts causes init to throw ALifeValidationError', () => {
      const customPort = createPortToken<{ foo: string }>('customPort', 'A custom port');
      const kernel = createKernel();
      kernel.use(createPlugin('needs-port', { requiredPorts: [customPort] }));
      expect(() => kernel.init()).toThrow(ALifeValidationError);
    });
  });

  describe('Topological sort', () => {
    it('if B depends on A, A.init called before B.init', () => {
      const kernel = createKernel();
      const order: string[] = [];
      kernel.use(createPlugin('b', {
        dependencies: ['a'],
        init: vi.fn(() => order.push('b')),
      }));
      kernel.use(createPlugin('a', {
        init: vi.fn(() => order.push('a')),
      }));
      kernel.init();
      expect(order).toEqual(['a', 'b']);
    });

    it('circular dependency causes init to throw', () => {
      const kernel = createKernel();
      kernel.use(createPlugin('a', { dependencies: ['b'] }));
      kernel.use(createPlugin('b', { dependencies: ['a'] }));
      expect(() => kernel.init()).toThrow('Circular plugin dependency');
    });
  });

  describe('Serialization', () => {
    it('serialize() includes version = KERNEL_STATE_VERSION', () => {
      const kernel = createKernel();
      kernel.init();
      const state = kernel.serialize();
      expect(state.version).toBe(KERNEL_STATE_VERSION);
    });

    it('serialize() wraps plugin state in capsule format', () => {
      const kernel = createKernel();
      kernel.use(createPlugin('stateful', {
        serialize: vi.fn().mockReturnValue({ count: 42 }),
      }));
      kernel.init();
      const state = kernel.serialize();
      expect(state.plugins!['stateful']).toEqual({ version: KERNEL_STATE_VERSION, state: { count: 42 } });
    });

    it('restoreState() with matching version works', () => {
      const kernel = createKernel();
      kernel.init();
      const state = kernel.serialize();
      expect(() => kernel.restoreState(state)).not.toThrow();
    });

    it('restoreState() with newer version throws', () => {
      const kernel = createKernel();
      kernel.init();
      const state = kernel.serialize();
      const wrongVersion = { ...state, version: KERNEL_STATE_VERSION + 1 };
      expect(() => kernel.restoreState(wrongVersion)).toThrow('newer than current');
    });

    it('restoreState() with older version and no migration throws', () => {
      const kernel = createKernel();
      kernel.init();
      const state = kernel.serialize();
      const oldVersion = { ...state, version: 0 };
      expect(() => kernel.restoreState(oldVersion)).toThrow('No migration registered');
    });

    it('restoreState() with older version runs registered migration', () => {
      const kernel = createKernel();
      kernel.registerMigration(0, (s) => ({ ...s, version: 1 }));
      kernel.init();
      const state = { ...kernel.serialize(), version: 0 };
      expect(() => kernel.restoreState(state)).not.toThrow();
    });

    it('restoreState() restores plugin state from capsule', () => {
      const restoreFn = vi.fn();
      const kernel = createKernel();
      kernel.use(createPlugin('stateful', {
        serialize: vi.fn().mockReturnValue({ count: 42 }),
        restore: restoreFn,
      }));
      kernel.init();
      const state = kernel.serialize();
      kernel.restoreState(state);
      expect(restoreFn).toHaveBeenCalledWith({ count: 42 });
    });

    it('restoreState() restores tick counter', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.step(7);
      const state = kernel.serialize();

      const kernel2 = createKernel();
      kernel2.init();
      kernel2.restoreState(state);
      expect(kernel2.tick).toBe(7);
    });
  });

  describe('EventBus flush integration', () => {
    it('update() flushes events emitted by plugins', () => {
      const kernel = createKernel();
      const received: string[] = [];

      kernel.use(createPlugin('emitter', {
        update: vi.fn(() => {
          kernel.events.emit('time:hour_changed', { hour: 12 });
        }),
      }));

      kernel.init();
      kernel.start();

      kernel.events.on('time:hour_changed', (p) => {
        received.push(`hour:${p.hour}`);
      });

      kernel.update(16);
      expect(received).toEqual(['hour:12']);
    });

    it('step() flushes events after each tick', () => {
      const kernel = createKernel();
      let flushCount = 0;

      kernel.use(createPlugin('emitter', {
        update: vi.fn(() => {
          kernel.events.emit('time:hour_changed', { hour: 1 });
        }),
      }));

      kernel.init();

      kernel.events.on('time:hour_changed', () => {
        flushCount++;
      });

      kernel.step(3);
      // Clock also emits events, but at minimum plugin emits 3
      expect(flushCount).toBeGreaterThanOrEqual(3);
    });

    it('events emitted during update are not delivered synchronously', () => {
      const kernel = createKernel();
      const order: string[] = [];

      kernel.use(createPlugin('a', {
        update: vi.fn(() => {
          kernel.events.emit('time:hour_changed', { hour: 1 });
          order.push('after-emit');
        }),
      }));

      kernel.init();
      kernel.start();

      kernel.events.on('time:hour_changed', () => {
        order.push('handler');
      });

      kernel.update(16);
      // 'after-emit' should come before 'handler' because events are deferred
      expect(order).toEqual(['after-emit', 'handler']);
    });
  });

  describe('destroy()', () => {
    it('calls plugin.destroy() in reverse installation order', () => {
      const kernel = createKernel();
      const order: string[] = [];
      kernel.use(createPlugin('a', { destroy: vi.fn(() => order.push('a')) }));
      kernel.use(createPlugin('b', { destroy: vi.fn(() => order.push('b')) }));
      kernel.init();
      kernel.destroy();
      expect(order).toEqual(['b', 'a']);
    });

    it('resets all state flags', () => {
      const kernel = createKernel();
      kernel.init();
      kernel.start();
      kernel.pause();
      kernel.destroy();
      expect(kernel.isInitialized).toBe(false);
      expect(kernel.isRunning).toBe(false);
      expect(kernel.isPaused).toBe(false);
    });
  });
});
