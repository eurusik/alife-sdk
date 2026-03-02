// Integration tests: Logger + kernel.inspect() (DevToolsInspector)
//
// These tests verify the Logger ring-buffer API and kernel.inspect() snapshot
// in integration with a real ALifeKernel. No vi.fn() — plain-object stubs only.

import { describe, it, expect, beforeEach } from 'vitest';
import { ALifeKernel } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import { Logger } from '../logger/Logger';
import { LogLevel } from '../logger/LogLevel';
import { LogChannel } from '../logger/LogChannel';
import type { ILogEntry } from '../logger/ILogEntry';
import type { ILogOutput } from '../ports/ILogger';
import type { IALifePlugin } from '../plugins/IALifePlugin';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

// ---------------------------------------------------------------------------
// Plain-object stubs
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
// Logger integration tests
// ---------------------------------------------------------------------------

describe('Logger integration', () => {
  // -------------------------------------------------------------------------
  // 1. info() records entry with INFO level
  // -------------------------------------------------------------------------

  it('1. info() records an entry with INFO level and correct channel/message', () => {
    let tick = 0;
    const logger = new Logger({ timestampFn: () => ++tick });

    logger.info(LogChannel.ALIFE, 'npc spawned');

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe(LogLevel.INFO);
    expect(entries[0].channel).toBe(LogChannel.ALIFE);
    expect(entries[0].message).toBe('npc spawned');
  });

  // -------------------------------------------------------------------------
  // 2. warn() records entry with WARN level
  // -------------------------------------------------------------------------

  it('2. warn() records an entry with WARN level', () => {
    const logger = new Logger({ timestampFn: () => 0 });
    logger.warn(LogChannel.AI, 'target lost');

    const entries = logger.getEntries();
    expect(entries[0].level).toBe(LogLevel.WARN);
  });

  // -------------------------------------------------------------------------
  // 3. error() records entry with ERROR level
  // -------------------------------------------------------------------------

  it('3. error() records an entry with ERROR level', () => {
    const logger = new Logger({ timestampFn: () => 0 });
    logger.error(LogChannel.COMBAT, 'invalid damage type');

    const entries = logger.getEntries({ level: LogLevel.ERROR });
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe(LogLevel.ERROR);
    expect(entries[0].message).toBe('invalid damage type');
  });

  // -------------------------------------------------------------------------
  // 4. debug() records entry with DEBUG level
  // -------------------------------------------------------------------------

  it('4. debug() records an entry with DEBUG level', () => {
    const logger = new Logger({ timestampFn: () => 0 });
    logger.debug(LogChannel.SPAWN, 'calculating spawn points');

    const entries = logger.getEntries();
    expect(entries[0].level).toBe(LogLevel.DEBUG);
    expect(entries[0].channel).toBe(LogChannel.SPAWN);
  });

  // -------------------------------------------------------------------------
  // 5. Log channels are independent — getEntries(channel) filters correctly
  // -------------------------------------------------------------------------

  it('5. getEntries({ channel }) returns only entries for the given channel', () => {
    const logger = new Logger({ timestampFn: () => 0 });

    logger.info(LogChannel.ALIFE, 'alife message');
    logger.info(LogChannel.AI, 'ai message 1');
    logger.warn(LogChannel.AI, 'ai message 2');
    logger.error(LogChannel.COMBAT, 'combat error');

    const aiEntries = logger.getEntries({ channel: LogChannel.AI });
    expect(aiEntries).toHaveLength(2);
    expect(aiEntries.every((e) => e.channel === LogChannel.AI)).toBe(true);

    const combatEntries = logger.getEntries({ channel: LogChannel.COMBAT });
    expect(combatEntries).toHaveLength(1);
    expect(combatEntries[0].channel).toBe(LogChannel.COMBAT);
  });

  // -------------------------------------------------------------------------
  // 6. clear() empties all entries from the ring buffer
  // -------------------------------------------------------------------------

  it('6. clear() removes all entries from the buffer', () => {
    const logger = new Logger({ timestampFn: () => 0 });
    logger.info(LogChannel.ALIFE, 'a');
    logger.warn(LogChannel.AI, 'b');
    logger.error(LogChannel.COMBAT, 'c');

    expect(logger.entryCount).toBe(3);

    logger.clear();

    expect(logger.entryCount).toBe(0);
    expect(logger.getEntries()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 7. Level filtering: WARN level drops INFO and DEBUG messages
  // -------------------------------------------------------------------------

  it('7. level=WARN discards INFO and DEBUG messages', () => {
    const logger = new Logger({ level: LogLevel.WARN, timestampFn: () => 0 });

    logger.debug(LogChannel.ALIFE, 'debug — dropped');
    logger.info(LogChannel.ALIFE, 'info — dropped');
    logger.warn(LogChannel.ALIFE, 'warn — kept');
    logger.error(LogChannel.ALIFE, 'error — kept');

    expect(logger.entryCount).toBe(2);
    const messages = logger.getEntries().map((e) => e.message);
    expect(messages).toContain('warn — kept');
    expect(messages).toContain('error — kept');
    expect(messages).not.toContain('debug — dropped');
    expect(messages).not.toContain('info — dropped');
  });

  // -------------------------------------------------------------------------
  // 8. Structured log entries have timestamp, level, channel, and message fields
  // -------------------------------------------------------------------------

  it('8. each ILogEntry has timestamp, level, channel, and message fields', () => {
    let now = 1_000_000;
    const logger = new Logger({ timestampFn: () => now++ });

    logger.info(LogChannel.SURGE, 'surge warning', { intensity: 0.8 });

    const entry: ILogEntry = logger.getEntries()[0];
    expect(typeof entry.timestamp).toBe('number');
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.level).toBe(LogLevel.INFO);
    expect(entry.channel).toBe(LogChannel.SURGE);
    expect(entry.message).toBe('surge warning');
    expect(entry.data).toEqual({ intensity: 0.8 });
  });

  // -------------------------------------------------------------------------
  // 9. ILogOutput sink receives every accepted entry
  // -------------------------------------------------------------------------

  it('9. ILogOutput sink receives each accepted log entry in order', () => {
    const received: ILogEntry[] = [];
    const sink: ILogOutput = { write: (e) => received.push(e) };

    const logger = new Logger({ outputs: [sink], timestampFn: () => 0 });

    logger.info(LogChannel.TRADE, 'item sold');
    logger.warn(LogChannel.FACTION, 'relation drop');

    expect(received).toHaveLength(2);
    expect(received[0].channel).toBe(LogChannel.TRADE);
    expect(received[1].channel).toBe(LogChannel.FACTION);
  });

  // -------------------------------------------------------------------------
  // 10. ILogOutput sink respects level filter — entries below level not forwarded
  // -------------------------------------------------------------------------

  it('10. ILogOutput sink does not receive entries below configured level', () => {
    const received: ILogEntry[] = [];
    const sink: ILogOutput = { write: (e) => received.push(e) };

    const logger = new Logger({ outputs: [sink], level: LogLevel.ERROR, timestampFn: () => 0 });

    logger.debug(LogChannel.AI, 'verbose debug');
    logger.info(LogChannel.AI, 'lifecycle info');
    logger.warn(LogChannel.AI, 'mild warning');
    logger.error(LogChannel.AI, 'critical error');

    expect(received).toHaveLength(1);
    expect(received[0].level).toBe(LogLevel.ERROR);
    expect(received[0].message).toBe('critical error');
  });

  // -------------------------------------------------------------------------
  // 11. getEntries({ level }) returns only entries at or above that level
  // -------------------------------------------------------------------------

  it('11. getEntries({ level: WARN }) returns entries with level >= WARN', () => {
    const logger = new Logger({ timestampFn: () => 0 });

    logger.debug(LogChannel.ALIFE, 'debug');
    logger.info(LogChannel.ALIFE, 'info');
    logger.warn(LogChannel.ALIFE, 'warn');
    logger.error(LogChannel.ALIFE, 'error');

    const atLeastWarn = logger.getEntries({ level: LogLevel.WARN });
    expect(atLeastWarn).toHaveLength(2);
    expect(atLeastWarn.every((e) => e.level >= LogLevel.WARN)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 12. getEntries({ limit }) returns only the most recent N entries
  // -------------------------------------------------------------------------

  it('12. getEntries({ limit }) returns most-recent N entries in chronological order', () => {
    const logger = new Logger({ timestampFn: () => 0 });

    logger.info(LogChannel.ALIFE, 'first');
    logger.info(LogChannel.ALIFE, 'second');
    logger.info(LogChannel.ALIFE, 'third');
    logger.info(LogChannel.ALIFE, 'fourth');

    const recent = logger.getEntries({ limit: 2 });
    expect(recent).toHaveLength(2);
    expect(recent[0].message).toBe('third');
    expect(recent[1].message).toBe('fourth');
  });
});

// ---------------------------------------------------------------------------
// kernel.inspect() integration tests
// ---------------------------------------------------------------------------

describe('kernel.inspect() DevTools snapshot integration', () => {
  let kernel: ALifeKernel;

  beforeEach(() => {
    kernel = createKernel();
  });

  // -------------------------------------------------------------------------
  // 1. inspect() returns a snapshot with the correct tick count
  // -------------------------------------------------------------------------

  it('1. inspect() snapshot.tick is 0 immediately after init', () => {
    kernel.init();

    const snapshot = kernel.inspect();
    expect(snapshot.tick).toBe(0);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 2. inspect() snapshot.tick increments after step()
  // -------------------------------------------------------------------------

  it('2. snapshot.tick increases by N after step(N)', () => {
    kernel.init();

    kernel.step(5);
    const snapshot = kernel.inspect();
    expect(snapshot.tick).toBe(5);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 3. inspect() snapshot.running reflects kernel.isRunning
  // -------------------------------------------------------------------------

  it('3. snapshot.running is false before start() and true after', () => {
    kernel.init();
    const before = kernel.inspect();
    expect(before.running).toBe(false);

    kernel.start();
    const after = kernel.inspect();
    expect(after.running).toBe(true);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 4. inspect() snapshot.paused reflects pause/resume state
  // -------------------------------------------------------------------------

  it('4. snapshot.paused is true after pause() and false after resume()', () => {
    kernel.init();
    kernel.start();

    kernel.pause();
    expect(kernel.inspect().paused).toBe(true);

    kernel.resume();
    expect(kernel.inspect().paused).toBe(false);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 5. inspect() snapshot.clock exposes gameHour, isDay, elapsedMs
  // -------------------------------------------------------------------------

  it('5. snapshot.clock has gameHour, isDay, and elapsedMs fields', () => {
    kernel.init();
    const snapshot = kernel.inspect();

    expect(typeof snapshot.clock.gameHour).toBe('number');
    expect(typeof snapshot.clock.isDay).toBe('boolean');
    expect(typeof snapshot.clock.elapsedMs).toBe('number');
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 6. inspect() snapshot includes pluginNames in dependency order
  // -------------------------------------------------------------------------

  it('6. snapshot.pluginNames lists installed plugin names', () => {
    const pluginA: IALifePlugin = {
      name: 'plugin-a',
      install() {},
    };

    const pluginB: IALifePlugin = {
      name: 'plugin-b',
      install() {},
    };

    kernel.use(pluginA).use(pluginB);
    kernel.init();

    const snapshot = kernel.inspect();
    expect(snapshot.pluginNames).toContain('plugin-a');
    expect(snapshot.pluginNames).toContain('plugin-b');
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 7. inspect() snapshot.plugins contains per-plugin inspect() data
  // -------------------------------------------------------------------------

  it('7. snapshot.plugins contains data from plugin.inspect() for each plugin', () => {
    const plugin: IALifePlugin = {
      name: 'inspectable-plugin',
      install() {},
      inspect() {
        return { npcCount: 42, queueLen: 7 };
      },
    };

    kernel.use(plugin);
    kernel.init();

    const snapshot = kernel.inspect();
    expect(snapshot.plugins).toBeDefined();
    expect(snapshot.plugins!['inspectable-plugin']).toEqual({ npcCount: 42, queueLen: 7 });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 8. inspect({ includePlugins: false }) omits per-plugin data
  // -------------------------------------------------------------------------

  it('8. inspect({ includePlugins: false }) snapshot has no plugins data', () => {
    const plugin: IALifePlugin = {
      name: 'hidden-plugin',
      install() {},
      inspect() { return { secret: true }; },
    };

    kernel.use(plugin);
    kernel.init();

    const snapshot = kernel.inspect({ includePlugins: false });
    // plugins key is either absent or an empty object
    const hasHiddenData = snapshot.plugins?.['hidden-plugin'] !== undefined;
    expect(hasHiddenData).toBe(false);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 9. inspect() snapshot.spatialGrid has entityCount and cellSize
  // -------------------------------------------------------------------------

  it('9. snapshot.spatialGrid has entityCount and cellSize when includeSpatialGrid is true', () => {
    kernel.init();

    const snapshot = kernel.inspect({ includeSpatialGrid: true });
    expect(snapshot.spatialGrid).toBeDefined();
    expect(typeof snapshot.spatialGrid!.entityCount).toBe('number');
    expect(typeof snapshot.spatialGrid!.cellSize).toBe('number');
    expect(snapshot.spatialGrid!.cellSize).toBeGreaterThan(0);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 10. inspect({ includeSpatialGrid: false }) omits spatialGrid
  // -------------------------------------------------------------------------

  it('10. inspect({ includeSpatialGrid: false }) omits spatialGrid from snapshot', () => {
    kernel.init();

    const snapshot = kernel.inspect({ includeSpatialGrid: false });
    expect(snapshot.spatialGrid).toBeUndefined();
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 11. inspect() snapshot.ports lists registered port IDs
  // -------------------------------------------------------------------------

  it('11. snapshot.ports includes the required port IDs when includePorts is true', () => {
    kernel.init();

    const snapshot = kernel.inspect({ includePorts: true });
    expect(snapshot.ports).toBeDefined();
    expect(Array.isArray(snapshot.ports)).toBe(true);
    // Must have at least the 3 required ports
    expect(snapshot.ports!.length).toBeGreaterThanOrEqual(3);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 12. inspect({ includePorts: false }) omits ports from snapshot
  // -------------------------------------------------------------------------

  it('12. inspect({ includePorts: false }) omits ports from snapshot', () => {
    kernel.init();

    const snapshot = kernel.inspect({ includePorts: false });
    expect(snapshot.ports).toBeUndefined();
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 13. inspect() before init() throws
  // -------------------------------------------------------------------------

  it('13. inspect() before init() throws because kernel is not initialized', () => {
    expect(() => kernel.inspect()).toThrow('Not initialized');
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 14. plugin without inspect() does not appear in snapshot.plugins
  // -------------------------------------------------------------------------

  it('14. plugin without inspect() is not included in snapshot.plugins data', () => {
    const plugin: IALifePlugin = {
      name: 'silent-plugin',
      install() {},
      // No inspect() defined
    };

    kernel.use(plugin);
    kernel.init();

    const snapshot = kernel.inspect();
    // The plugin name is in pluginNames, but has no data in plugins map
    expect(snapshot.pluginNames).toContain('silent-plugin');
    const hasData = snapshot.plugins?.['silent-plugin'] !== undefined;
    expect(hasData).toBe(false);
    kernel.destroy();
  });
});
