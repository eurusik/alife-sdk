import { Logger } from './Logger';
import { LogLevel } from './LogLevel';
import type { ILogOutput } from '../ports/ILogger';

describe('Logger', () => {
  // -----------------------------------------------------------------------
  // Basic logging
  // -----------------------------------------------------------------------

  describe('level methods', () => {
    it('writes entries via debug/info/warn/error', () => {
      const logger = new Logger({ timestampFn: () => 1000 });
      logger.debug('ai', 'debug msg');
      logger.info('kernel', 'info msg');
      logger.warn('kernel', 'warn msg');
      logger.error('kernel', 'error msg');

      expect(logger.entryCount).toBe(4);
    });

    it('stores data alongside messages', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.info('test', 'msg', { key: 'value' });

      const entries = logger.getEntries();
      expect(entries[0].data).toEqual({ key: 'value' });
    });
  });

  // -----------------------------------------------------------------------
  // Level filtering
  // -----------------------------------------------------------------------

  describe('level filtering', () => {
    it('filters below configured level', () => {
      const logger = new Logger({ level: LogLevel.WARN, timestampFn: () => 0 });
      logger.debug('ch', 'discarded');
      logger.info('ch', 'discarded');
      logger.warn('ch', 'kept');
      logger.error('ch', 'kept');

      expect(logger.entryCount).toBe(2);
    });

    it('NONE level suppresses all output', () => {
      const logger = new Logger({ level: LogLevel.NONE, timestampFn: () => 0 });
      logger.debug('ch', 'a');
      logger.info('ch', 'b');
      logger.warn('ch', 'c');
      logger.error('ch', 'd');

      expect(logger.entryCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Channel filtering
  // -----------------------------------------------------------------------

  describe('channel filtering', () => {
    it('only accepts listed channels', () => {
      const logger = new Logger({
        enabledChannels: ['ai'],
        timestampFn: () => 0,
      });

      logger.info('ai', 'kept');
      logger.info('kernel', 'discarded');
      logger.info('plugin', 'discarded');

      expect(logger.entryCount).toBe(1);
      expect(logger.getEntries()[0].channel).toBe('ai');
    });

    it('accepts all channels when enabledChannels is undefined', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.info('ai', 'a');
      logger.info('kernel', 'b');
      expect(logger.entryCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Ring buffer
  // -----------------------------------------------------------------------

  describe('ring buffer', () => {
    it('overwrites oldest entries when full', () => {
      const logger = new Logger({ bufferSize: 3, timestampFn: () => 0 });
      logger.info('ch', 'a');
      logger.info('ch', 'b');
      logger.info('ch', 'c');
      logger.info('ch', 'd');

      expect(logger.entryCount).toBe(3);
      const messages = logger.getEntries().map((e) => e.message);
      expect(messages).toEqual(['b', 'c', 'd']);
    });

    it('returns entries in chronological order', () => {
      let time = 0;
      const logger = new Logger({ bufferSize: 5, timestampFn: () => ++time });
      logger.info('ch', 'first');
      logger.info('ch', 'second');
      logger.info('ch', 'third');

      const entries = logger.getEntries();
      expect(entries[0].timestamp).toBeLessThan(entries[1].timestamp);
      expect(entries[1].timestamp).toBeLessThan(entries[2].timestamp);
    });
  });

  // -----------------------------------------------------------------------
  // getEntries filtering
  // -----------------------------------------------------------------------

  describe('getEntries', () => {
    it('filters by channel', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.info('ai', 'a');
      logger.info('kernel', 'b');
      logger.info('ai', 'c');

      const aiEntries = logger.getEntries({ channel: 'ai' });
      expect(aiEntries).toHaveLength(2);
    });

    it('filters by minimum level', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.debug('ch', 'a');
      logger.warn('ch', 'b');
      logger.error('ch', 'c');

      const warnings = logger.getEntries({ level: LogLevel.WARN });
      expect(warnings).toHaveLength(2);
    });

    it('limits to most recent N entries', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.info('ch', 'a');
      logger.info('ch', 'b');
      logger.info('ch', 'c');

      const recent = logger.getEntries({ limit: 2 });
      expect(recent).toHaveLength(2);
      expect(recent[0].message).toBe('b');
      expect(recent[1].message).toBe('c');
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('removes all entries', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.info('ch', 'a');
      logger.info('ch', 'b');
      expect(logger.entryCount).toBe(2);

      logger.clear();
      expect(logger.entryCount).toBe(0);
      expect(logger.getEntries()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Output sinks
  // -----------------------------------------------------------------------

  describe('outputs', () => {
    it('forwards entries to configured outputs', () => {
      const received: string[] = [];
      const output: ILogOutput = {
        write: (entry) => received.push(entry.message),
      };
      const logger = new Logger({ outputs: [output], timestampFn: () => 0 });

      logger.info('ch', 'hello');
      logger.warn('ch', 'world');

      expect(received).toEqual(['hello', 'world']);
    });

    it('outputs respect level filter', () => {
      const received: string[] = [];
      const output: ILogOutput = {
        write: (entry) => received.push(entry.message),
      };
      const logger = new Logger({
        outputs: [output],
        level: LogLevel.ERROR,
        timestampFn: () => 0,
      });

      logger.info('ch', 'ignored');
      logger.error('ch', 'kept');

      expect(received).toEqual(['kept']);
    });
  });

  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------

  describe('defaults', () => {
    it('defaults to 1024 buffer capacity', () => {
      const logger = new Logger();
      // Fill past default
      for (let i = 0; i < 1030; i++) {
        logger.info('ch', `msg_${i}`);
      }
      expect(logger.entryCount).toBe(1024);
    });

    it('defaults to DEBUG level', () => {
      const logger = new Logger({ timestampFn: () => 0 });
      logger.debug('ch', 'should pass');
      expect(logger.entryCount).toBe(1);
    });
  });
});
