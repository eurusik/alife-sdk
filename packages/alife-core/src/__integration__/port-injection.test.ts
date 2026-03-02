// Integration tests: PortRegistry + cross-plugin port injection
//
// These tests use real PortRegistry objects and plain-object stubs.
// No vi.fn() is used — tracking is done with arrays and flags.

import { describe, it, expect, beforeEach } from 'vitest';
import { PortRegistry, createPortToken } from '../core/PortRegistry';
import { ALifeKernel } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import type { IALifePlugin } from '../plugins/IALifePlugin';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

// ---------------------------------------------------------------------------
// Helpers
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
// Standalone PortRegistry tests (no kernel needed)
// ---------------------------------------------------------------------------

describe('PortRegistry — standalone', () => {
  let registry: PortRegistry;

  beforeEach(() => {
    registry = new PortRegistry();
  });

  it('1. provide() + require() returns the same implementation', () => {
    interface ICalculator { add(a: number, b: number): number }
    const CalcToken = createPortToken<ICalculator>('calculator', 'Arithmetic service');
    const impl: ICalculator = { add: (a, b) => a + b };

    registry.provide(CalcToken, impl);

    const retrieved = registry.require(CalcToken);
    expect(retrieved).toBe(impl);
    expect(retrieved.add(2, 3)).toBe(5);
  });

  it('2. tryGet() returns the implementation when port is registered', () => {
    interface ILogger { log(msg: string): void }
    const LogToken = createPortToken<ILogger>('log', 'Logger port');
    const messages: string[] = [];
    const impl: ILogger = { log: (msg) => messages.push(msg) };

    registry.provide(LogToken, impl);
    const result = registry.tryGet(LogToken);

    expect(result).toBe(impl);
    result?.log('hello');
    expect(messages).toEqual(['hello']);
  });

  it('3. tryGet() returns undefined when port is NOT registered', () => {
    interface INonExistent { noop(): void }
    const MissingToken = createPortToken<INonExistent>('missing-port', 'Does not exist');

    const result = registry.tryGet(MissingToken);
    expect(result).toBeUndefined();
  });

  it('4. require() throws when port is NOT registered', () => {
    interface INonExistent { noop(): void }
    const MissingToken = createPortToken<INonExistent>('required-but-missing', 'Should throw');

    expect(() => registry.require(MissingToken)).toThrow('required-but-missing');
  });

  it('5. provide() twice with the same token throws immediately (no silent overwrite)', () => {
    interface IService { run(): void }
    const ServiceToken = createPortToken<IService>('duplicated-service', 'Duplicate test');
    const impl1: IService = { run: () => {} };
    const impl2: IService = { run: () => {} };

    registry.provide(ServiceToken, impl1);

    expect(() => registry.provide(ServiceToken, impl2)).toThrow('already registered');
  });

  it('6. has() returns true after provide(), false before', () => {
    interface IFlag { value: boolean }
    const FlagToken = createPortToken<IFlag>('flag', 'Boolean flag');

    expect(registry.has(FlagToken)).toBe(false);
    registry.provide(FlagToken, { value: true });
    expect(registry.has(FlagToken)).toBe(true);
  });

  it('7. registeredIds() lists all registered port IDs', () => {
    const TokenA = createPortToken<{ a: number }>('port-a', 'Port A');
    const TokenB = createPortToken<{ b: number }>('port-b', 'Port B');
    const TokenC = createPortToken<{ c: number }>('port-c', 'Port C');

    registry.provide(TokenA, { a: 1 });
    registry.provide(TokenB, { b: 2 });
    registry.provide(TokenC, { c: 3 });

    const ids = registry.registeredIds();
    expect(ids).toContain('port-a');
    expect(ids).toContain('port-b');
    expect(ids).toContain('port-c');
    expect(ids).toHaveLength(3);
  });

  it('8. multiple distinct tokens can coexist in the same registry', () => {
    interface IServiceX { x(): string }
    interface IServiceY { y(): number }
    const TokenX = createPortToken<IServiceX>('service-x', 'X');
    const TokenY = createPortToken<IServiceY>('service-y', 'Y');

    const implX: IServiceX = { x: () => 'X value' };
    const implY: IServiceY = { y: () => 42 };

    registry.provide(TokenX, implX);
    registry.provide(TokenY, implY);

    expect(registry.require(TokenX)).toBe(implX);
    expect(registry.require(TokenY)).toBe(implY);
    expect(registry.require(TokenX).x()).toBe('X value');
    expect(registry.require(TokenY).y()).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Cross-plugin port injection via ALifeKernel
// ---------------------------------------------------------------------------

describe('PortRegistry — cross-plugin injection via ALifeKernel', () => {
  it('9. pluginA provides a port during install(); pluginB reads it in install()', () => {
    interface IEventLog { entries: string[]; push(entry: string): void }
    const EventLogToken = createPortToken<IEventLog>('event-log', 'Shared event log');

    const sharedLog: IEventLog = { entries: [], push(e) { this.entries.push(e); } };
    const receivedLog: IEventLog[] = [];

    const pluginA: IALifePlugin = {
      name: 'log-provider',
      install(k: ALifeKernel) {
        k.portRegistry.provide(EventLogToken, sharedLog);
      },
    };

    const pluginB: IALifePlugin = {
      name: 'log-consumer',
      install(k: ALifeKernel) {
        const log = k.portRegistry.tryGet(EventLogToken);
        if (log) receivedLog.push(log);
      },
    };

    const kernel = createKernel();
    kernel.use(pluginA).use(pluginB); // A installed first → B can read A's port
    kernel.init();

    expect(receivedLog).toHaveLength(1);
    expect(receivedLog[0]).toBe(sharedLog);

    // Both plugins share the same object
    receivedLog[0].push('hello from B');
    expect(sharedLog.entries).toEqual(['hello from B']);

    kernel.destroy();
  });

  it('10. pluginB installed first cannot read pluginA port (A not yet installed)', () => {
    interface IService { ping(): string }
    const ServiceToken = createPortToken<IService>('ping-service', 'Ping service');
    let bSawPort = false;

    const pluginB: IALifePlugin = {
      name: 'consumer-first',
      install(k: ALifeKernel) {
        // A hasn't been installed yet, so port shouldn't be available
        const svc = k.portRegistry.tryGet(ServiceToken);
        bSawPort = svc !== undefined;
      },
    };

    const pluginA: IALifePlugin = {
      name: 'provider-second',
      install(k: ALifeKernel) {
        k.portRegistry.provide(ServiceToken, { ping: () => 'pong' });
      },
    };

    const kernel = createKernel();
    kernel.use(pluginB).use(pluginA); // B installed BEFORE A
    kernel.init();

    // B installed before A — it should not have seen the port
    expect(bSawPort).toBe(false);
    // But after init, both are registered and the port is accessible
    expect(kernel.portRegistry.require(ServiceToken).ping()).toBe('pong');

    kernel.destroy();
  });

  it('11. port registered by pluginA during install() is accessible after kernel.init()', () => {
    interface ICounter { increment(): void; count: number }
    const CounterToken = createPortToken<ICounter>('counter', 'Shared counter');
    const counter: ICounter = { count: 0, increment() { this.count++; } };

    const provider: IALifePlugin = {
      name: 'counter-provider',
      install(k: ALifeKernel) {
        k.portRegistry.provide(CounterToken, counter);
      },
    };

    const consumer: IALifePlugin = {
      name: 'counter-consumer',
      install(_k: ALifeKernel) {},
      init() {}, // access port inside update instead
      update(_delta: number) {
        // accessed during update — port is definitely available
      },
    };

    const kernel = createKernel();
    kernel.use(provider).use(consumer);
    kernel.init();

    // Port should be accessible from outside too
    const retrieved = kernel.portRegistry.require(CounterToken);
    retrieved.increment();
    retrieved.increment();
    expect(retrieved.count).toBe(2);
    expect(counter.count).toBe(2); // same object

    kernel.destroy();
  });

  it('12. kernel.provide() before init() makes port available to plugins during install()', () => {
    interface IConfig { maxNpcs: number }
    const ConfigToken = createPortToken<IConfig>('sim-config', 'Simulation config');
    const config: IConfig = { maxNpcs: 50 };

    const configsRead: IConfig[] = [];
    const plugin: IALifePlugin = {
      name: 'config-reader',
      install(k: ALifeKernel) {
        const cfg = k.portRegistry.tryGet(ConfigToken);
        if (cfg) configsRead.push(cfg);
      },
    };

    const kernel = createKernel();
    kernel.provide(ConfigToken, config); // provided on kernel before use()
    kernel.use(plugin);
    kernel.init();

    expect(configsRead).toHaveLength(1);
    expect(configsRead[0].maxNpcs).toBe(50);
    kernel.destroy();
  });

  it('13. kernel.provide() after init() throws with descriptive error', () => {
    interface IAnything { data: string }
    const LateToken = createPortToken<IAnything>('late-port', 'Late registration');

    const kernel = createKernel();
    kernel.init();

    expect(() =>
      kernel.provide(LateToken, { data: 'too late' }),
    ).toThrow('Cannot provide ports after init()');

    kernel.destroy();
  });

  it('14. two custom ports with different tokens do not conflict in the same kernel', () => {
    interface IAlpha { alpha(): string }
    interface IBeta { beta(): number }

    const AlphaToken = createPortToken<IAlpha>('custom-alpha', 'Alpha service');
    const BetaToken = createPortToken<IBeta>('custom-beta', 'Beta service');

    const alphaImpl: IAlpha = { alpha: () => 'A' };
    const betaImpl: IBeta = { beta: () => 99 };

    const kernel = createKernel();
    kernel.provide(AlphaToken, alphaImpl);
    kernel.provide(BetaToken, betaImpl);
    kernel.init();

    expect(kernel.portRegistry.require(AlphaToken)).toBe(alphaImpl);
    expect(kernel.portRegistry.require(BetaToken)).toBe(betaImpl);
    expect(kernel.portRegistry.require(AlphaToken).alpha()).toBe('A');
    expect(kernel.portRegistry.require(BetaToken).beta()).toBe(99);

    kernel.destroy();
  });

  it('15. port available in portRegistry.registeredIds() after kernel.provide()', () => {
    interface IPathfinder { findPath(): number[] }
    const PathfinderToken = createPortToken<IPathfinder>('pathfinder', 'Pathfinder');

    const kernel = createKernel();
    kernel.provide(PathfinderToken, { findPath: () => [1, 2, 3] });
    kernel.init();

    const ids = kernel.portRegistry.registeredIds();
    expect(ids).toContain('pathfinder');

    kernel.destroy();
  });
});
