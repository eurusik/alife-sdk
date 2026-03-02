// Integration tests: ALifeKernel full lifecycle
//
// These tests use real objects (no vi.fn()) and plain-object stubs
// with tracking arrays to verify end-to-end kernel behaviour.

import { describe, it, expect, beforeEach } from 'vitest';
import { ALifeKernel, KERNEL_STATE_VERSION } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import { createPortToken } from '../core/PortRegistry';
import type { IALifePlugin } from '../plugins/IALifePlugin';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';
import { FactionsPlugin } from '../plugins/FactionsPlugin';
import { SpawnPlugin } from '../plugins/SpawnPlugin';

// ---------------------------------------------------------------------------
// Minimal plain-object stubs (no vi.fn())
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
  return { getPlayerPosition: () => ({ x: 0, y: 0 }) };
}

function stubEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'npc-stub',
    createMonster: () => 'mon-stub',
    destroyEntity: () => {},
  };
}

function createKernel(): ALifeKernel {
  return new ALifeKernel()
    .provide(Ports.EntityAdapter, stubEntityAdapter())
    .provide(Ports.PlayerPosition, stubPlayerPosition())
    .provide(Ports.EntityFactory, stubEntityFactory());
}

// ---------------------------------------------------------------------------
// Tracking plugin builder (plain object, no vi.fn())
// ---------------------------------------------------------------------------

interface TrackingPlugin extends IALifePlugin {
  installCalled: boolean;
  initCalled: boolean;
  updateDeltas: number[];
  destroyCalled: boolean;
  serializedState: Record<string, unknown>;
  restoredState: Record<string, unknown> | null;
}

function makeTrackingPlugin(
  name: string,
  overrides: Partial<IALifePlugin> = {},
): TrackingPlugin {
  const plugin: TrackingPlugin = {
    name,
    installCalled: false,
    initCalled: false,
    updateDeltas: [],
    destroyCalled: false,
    serializedState: { counter: 0 },
    restoredState: null,

    install(_kernel: ALifeKernel) {
      plugin.installCalled = true;
    },
    init() {
      plugin.initCalled = true;
    },
    update(deltaMs: number) {
      plugin.updateDeltas.push(deltaMs);
    },
    destroy() {
      plugin.destroyCalled = true;
    },
    serialize() {
      return plugin.serializedState;
    },
    restore(state: Record<string, unknown>) {
      plugin.restoredState = state;
    },
    ...overrides,
  };
  return plugin;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ALifeKernel integration — full lifecycle', () => {
  let kernel: ALifeKernel;

  beforeEach(() => {
    kernel = createKernel();
  });

  // -------------------------------------------------------------------------
  // 1. Basic lifecycle: construct → use → init → start → update → destroy
  // -------------------------------------------------------------------------

  it('1. complete lifecycle does not throw', () => {
    const plugin = makeTrackingPlugin('alpha');
    kernel.use(plugin);
    kernel.init();
    kernel.start();
    kernel.update(16);
    kernel.destroy();

    expect(plugin.installCalled).toBe(true);
    expect(plugin.initCalled).toBe(true);
    expect(plugin.updateDeltas).toEqual([16]);
    expect(plugin.destroyCalled).toBe(true);
  });

  it('2. install() is called immediately when use() is invoked (before init)', () => {
    const plugin = makeTrackingPlugin('beta');
    expect(plugin.installCalled).toBe(false);
    kernel.use(plugin);
    expect(plugin.installCalled).toBe(true);
  });

  it('3. init() calls plugin.init() and marks kernel as initialized', () => {
    const plugin = makeTrackingPlugin('gamma');
    kernel.use(plugin);
    expect(plugin.initCalled).toBe(false);
    kernel.init();
    expect(plugin.initCalled).toBe(true);
    expect(kernel.isInitialized).toBe(true);
  });

  it('4. start() marks kernel as running without calling plugin methods again', () => {
    const plugin = makeTrackingPlugin('delta');
    kernel.use(plugin);
    kernel.init();
    kernel.start();
    expect(kernel.isRunning).toBe(true);
    // install and init should each have been called exactly once
    expect(plugin.installCalled).toBe(true);
    expect(plugin.initCalled).toBe(true);
    // update has NOT been called yet
    expect(plugin.updateDeltas).toHaveLength(0);
  });

  it('5. update(deltaMs) calls plugin.update(deltaMs) with the exact delta', () => {
    const plugin = makeTrackingPlugin('epsilon');
    kernel.use(plugin);
    kernel.init();
    kernel.start();

    kernel.update(33);
    kernel.update(17);
    kernel.update(8);

    expect(plugin.updateDeltas).toEqual([33, 17, 8]);
  });

  it('6. tick counter increments once per update() call', () => {
    kernel.init();
    kernel.start();
    expect(kernel.tick).toBe(0);
    kernel.update(16);
    expect(kernel.tick).toBe(1);
    kernel.update(16);
    expect(kernel.tick).toBe(2);
  });

  it('7. destroy() calls plugin.destroy() and resets kernel flags', () => {
    const plugin = makeTrackingPlugin('zeta');
    kernel.use(plugin);
    kernel.init();
    kernel.start();
    kernel.destroy();

    expect(plugin.destroyCalled).toBe(true);
    expect(kernel.isInitialized).toBe(false);
    expect(kernel.isRunning).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. Two plugins together
  // -------------------------------------------------------------------------

  it('8. two plugins both receive kernel reference and lifecycle hooks', () => {
    const pluginA = makeTrackingPlugin('plugin-a');
    const pluginB = makeTrackingPlugin('plugin-b');

    kernel.use(pluginA).use(pluginB);
    kernel.init();
    kernel.start();
    kernel.update(25);
    kernel.destroy();

    expect(pluginA.installCalled).toBe(true);
    expect(pluginB.installCalled).toBe(true);
    expect(pluginA.initCalled).toBe(true);
    expect(pluginB.initCalled).toBe(true);
    expect(pluginA.updateDeltas).toEqual([25]);
    expect(pluginB.updateDeltas).toEqual([25]);
    expect(pluginA.destroyCalled).toBe(true);
    expect(pluginB.destroyCalled).toBe(true);
  });

  it('9. destroy() calls plugins in reverse installation order', () => {
    const destroyOrder: string[] = [];

    const pluginA = makeTrackingPlugin('pa', {
      destroy() { destroyOrder.push('pa'); },
    });
    const pluginB = makeTrackingPlugin('pb', {
      destroy() { destroyOrder.push('pb'); },
    });
    const pluginC = makeTrackingPlugin('pc', {
      destroy() { destroyOrder.push('pc'); },
    });

    kernel.use(pluginA).use(pluginB).use(pluginC);
    kernel.init();
    kernel.destroy();

    expect(destroyOrder).toEqual(['pc', 'pb', 'pa']);
  });

  // -------------------------------------------------------------------------
  // 10. Port sharing between plugins
  // -------------------------------------------------------------------------

  it('10. pluginA provides a custom port; pluginB reads it during install', () => {
    interface IGreeter { greet(): string }
    const GreeterToken = createPortToken<IGreeter>('greeter', 'Greeting service');

    const greetReceived: string[] = [];

    const pluginA: IALifePlugin = {
      name: 'provider-plugin',
      install(k: ALifeKernel) {
        k.portRegistry.provide(GreeterToken, { greet: () => 'Привіт!' });
      },
    };

    const pluginB: IALifePlugin = {
      name: 'consumer-plugin',
      install(k: ALifeKernel) {
        const greeter = k.portRegistry.tryGet(GreeterToken);
        if (greeter) {
          greetReceived.push(greeter.greet());
        }
      },
    };

    kernel.use(pluginA).use(pluginB);
    kernel.init();

    expect(greetReceived).toEqual(['Привіт!']);
    kernel.destroy();
  });

  it('11. custom port provided before init() is accessible via portRegistry.require()', () => {
    interface IScorer { score(a: number, b: number): number }
    const ScorerToken = createPortToken<IScorer>('scorer', 'Scoring service');
    const impl: IScorer = { score: (a, b) => a + b };

    kernel.provide(ScorerToken, impl);
    kernel.init();

    const retrieved = kernel.portRegistry.require(ScorerToken);
    expect(retrieved).toBe(impl);
    expect(retrieved.score(3, 4)).toBe(7);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 12. init() throws when a required kernel port is missing
  // -------------------------------------------------------------------------

  it('12. init() succeeds without ports — EntityAdapter/PlayerPosition/EntityFactory are auto-provided', () => {
    const bareKernel = new ALifeKernel(); // no ports provided
    expect(() => bareKernel.init()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 13. serialize() → restoreState()
  // -------------------------------------------------------------------------

  it('13. serialize() → restoreState() restores tick counter and plugin state', () => {
    const plugin = makeTrackingPlugin('stateful', {
      serialize() { return { score: 99 }; },
      restore(state) { plugin.restoredState = state; },
    });

    kernel.use(plugin);
    kernel.init();
    kernel.step(10);

    const saved = kernel.serialize();
    expect(saved.version).toBe(KERNEL_STATE_VERSION);
    expect(saved.tick).toBe(10);

    // Restore into same kernel
    kernel.restoreState(saved);

    expect(kernel.tick).toBe(10);
    expect(plugin.restoredState).toEqual({ score: 99 });
    kernel.destroy();
  });

  it('14. serialize() captures plugins map under saved version capsule', () => {
    const plugin = makeTrackingPlugin('capsule-plugin', {
      serialize() { return { items: ['sword', 'shield'] }; },
    });

    kernel.use(plugin);
    kernel.init();

    const saved = kernel.serialize();
    const capsule = saved.plugins?.['capsule-plugin'];
    expect(capsule).toBeDefined();
    expect(capsule?.state).toEqual({ items: ['sword', 'shield'] });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 15. destroy() → update() throws (not running / not initialized)
  // -------------------------------------------------------------------------

  it('15. after destroy(), kernel.update() throws because kernel is no longer initialized', () => {
    kernel.init();
    kernel.start();
    kernel.update(16);
    kernel.destroy();

    // After destroy, isInitialized = false, so update should throw
    expect(() => kernel.update(16)).toThrow();
  });

  // -------------------------------------------------------------------------
  // 16. Event communication between two plugins via kernel.events
  // -------------------------------------------------------------------------

  it('16. plugin emits event during update(); second plugin receives it via kernel.events.on()', () => {
    const receivedHours: number[] = [];

    const emitter: IALifePlugin = {
      name: 'emitter',
      install(_k: ALifeKernel) {},
      update(delta: number) {
        void delta;
        kernel.events.emit('time:hour_changed', { hour: 7, day: 1, isDay: true });
      },
    };

    kernel.use(emitter);
    kernel.init();
    kernel.start();

    // Subscribe after init (before update)
    kernel.events.on('time:hour_changed', (p) => {
      receivedHours.push(p.hour);
    });

    kernel.update(16);

    expect(receivedHours).toEqual([7]);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 17. Events are deferred — not synchronous during emit
  // -------------------------------------------------------------------------

  it('17. events emitted inside update() are deferred until flush at end of update()', () => {
    const order: string[] = [];

    const emitterPlugin: IALifePlugin = {
      name: 'deferred-emitter',
      install(_k: ALifeKernel) {},
      update(_delta: number) {
        kernel.events.emit('time:hour_changed', { hour: 3, day: 1, isDay: false });
        order.push('plugin-after-emit');
      },
    };

    kernel.use(emitterPlugin);
    kernel.init();
    kernel.start();

    kernel.events.on('time:hour_changed', () => {
      order.push('event-handler');
    });

    kernel.update(16);

    // Plugin code runs first (emitting is deferred), then event handler
    expect(order).toEqual(['plugin-after-emit', 'event-handler']);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 18. step() works without start() — useful for deterministic tests
  // -------------------------------------------------------------------------

  it('18. step(count) advances tick without requiring start()', () => {
    const plugin = makeTrackingPlugin('stepper');
    kernel.use(plugin);
    kernel.init();

    expect(kernel.isRunning).toBe(false);
    kernel.step(5);

    expect(kernel.tick).toBe(5);
    expect(plugin.updateDeltas).toHaveLength(5);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 19. Real plugins (FactionsPlugin + SpawnPlugin) together
  // -------------------------------------------------------------------------

  it('19. FactionsPlugin and SpawnPlugin install and init together without errors', () => {
    const factionsPlugin = new FactionsPlugin();
    const spawnPlugin = new SpawnPlugin(15_000);

    kernel.use(factionsPlugin).use(spawnPlugin);
    kernel.init();
    kernel.start();

    // FactionsPlugin exposes frozen registry
    expect(factionsPlugin.factions.isFrozen).toBe(true);
    // SpawnPlugin exposes spawn registry
    expect(spawnPlugin.spawns).toBeDefined();

    kernel.update(100);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 20. Plugin dependency ordering — dependent plugin inits after dependency
  // -------------------------------------------------------------------------

  it('20. plugin with dependency declares via "dependencies" and inits in correct order', () => {
    const initOrder: string[] = [];

    const base: IALifePlugin = {
      name: 'base-service',
      install(_k: ALifeKernel) {},
      init() { initOrder.push('base-service'); },
    };

    const dependent: IALifePlugin = {
      name: 'dependent-service',
      dependencies: ['base-service'],
      install(_k: ALifeKernel) {},
      init() { initOrder.push('dependent-service'); },
    };

    // Install dependent BEFORE base — kernel should reorder via topological sort
    kernel.use(dependent).use(base);
    kernel.init();

    expect(initOrder).toEqual(['base-service', 'dependent-service']);
    kernel.destroy();
  });
});
