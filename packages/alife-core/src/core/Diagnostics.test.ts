import { describe, it, expect } from 'vitest';
import { DiagnosticsCollector, ALifeValidationError } from './Diagnostics';
import type { IDiagnostic } from './Diagnostics';

describe('DiagnosticsCollector', () => {
  describe('empty collector', () => {
    it('hasErrors is false', () => {
      const dc = new DiagnosticsCollector();
      expect(dc.hasErrors).toBe(false);
    });

    it('errors, warnings, and all are empty', () => {
      const dc = new DiagnosticsCollector();
      expect(dc.errors).toEqual([]);
      expect(dc.warnings).toEqual([]);
      expect(dc.all).toEqual([]);
    });
  });

  describe('error()', () => {
    it('adds an error-severity diagnostic', () => {
      const dc = new DiagnosticsCollector();
      dc.error('kernel', 'ports.pathfinder', 'Missing port');

      expect(dc.all).toHaveLength(1);
      expect(dc.all[0]).toEqual({
        severity: 'error',
        source: 'kernel',
        path: 'ports.pathfinder',
        message: 'Missing port',
        hint: undefined,
      });
    });
  });

  describe('warning()', () => {
    it('adds a warning-severity diagnostic', () => {
      const dc = new DiagnosticsCollector();
      dc.warning('surge', 'config.duration', 'Too short');

      expect(dc.all).toHaveLength(1);
      expect(dc.all[0].severity).toBe('warning');
    });
  });

  describe('info()', () => {
    it('adds an info-severity diagnostic', () => {
      const dc = new DiagnosticsCollector();
      dc.info('loader', 'plugins', 'Loaded 3 plugins');

      expect(dc.all).toHaveLength(1);
      expect(dc.all[0].severity).toBe('info');
    });
  });

  describe('add()', () => {
    it('pushes a raw IDiagnostic', () => {
      const dc = new DiagnosticsCollector();
      const raw: IDiagnostic = {
        severity: 'warning',
        source: 'config',
        path: 'factions',
        message: 'Duplicate faction id',
        hint: 'Remove the duplicate',
      };
      dc.add(raw);

      expect(dc.all).toHaveLength(1);
      expect(dc.all[0]).toBe(raw);
    });
  });

  describe('errors getter', () => {
    it('filters only error-severity diagnostics', () => {
      const dc = new DiagnosticsCollector();
      dc.error('a', 'p1', 'err1');
      dc.warning('b', 'p2', 'warn1');
      dc.error('c', 'p3', 'err2');
      dc.info('d', 'p4', 'info1');

      const errors = dc.errors;
      expect(errors).toHaveLength(2);
      expect(errors.every((d) => d.severity === 'error')).toBe(true);
      expect(errors[0].message).toBe('err1');
      expect(errors[1].message).toBe('err2');
    });
  });

  describe('warnings getter', () => {
    it('filters only warning-severity diagnostics', () => {
      const dc = new DiagnosticsCollector();
      dc.error('a', 'p1', 'err1');
      dc.warning('b', 'p2', 'warn1');
      dc.warning('c', 'p3', 'warn2');
      dc.info('d', 'p4', 'info1');

      const warnings = dc.warnings;
      expect(warnings).toHaveLength(2);
      expect(warnings.every((d) => d.severity === 'warning')).toBe(true);
    });
  });

  describe('all getter', () => {
    it('returns everything in insertion order', () => {
      const dc = new DiagnosticsCollector();
      dc.info('a', 'p1', 'first');
      dc.error('b', 'p2', 'second');
      dc.warning('c', 'p3', 'third');

      const all = dc.all;
      expect(all).toHaveLength(3);
      expect(all[0].message).toBe('first');
      expect(all[1].message).toBe('second');
      expect(all[2].message).toBe('third');
    });
  });

  describe('hasErrors', () => {
    it('returns true when errors exist', () => {
      const dc = new DiagnosticsCollector();
      dc.warning('a', 'p', 'w');
      dc.error('b', 'p', 'e');

      expect(dc.hasErrors).toBe(true);
    });

    it('returns false when only warnings and infos are present', () => {
      const dc = new DiagnosticsCollector();
      dc.warning('a', 'p', 'w');
      dc.info('b', 'p', 'i');

      expect(dc.hasErrors).toBe(false);
    });
  });

  describe('throwIfErrors()', () => {
    it('does nothing when there are no errors', () => {
      const dc = new DiagnosticsCollector();
      dc.warning('a', 'p', 'w');
      dc.info('b', 'p', 'i');

      expect(() => dc.throwIfErrors()).not.toThrow();
    });

    it('throws ALifeValidationError when errors exist', () => {
      const dc = new DiagnosticsCollector();
      dc.error('kernel', 'ports.ai', 'Port missing');

      expect(() => dc.throwIfErrors()).toThrow(ALifeValidationError);
    });
  });

  describe('format()', () => {
    it('returns a human-readable string with severity labels', () => {
      const dc = new DiagnosticsCollector();
      dc.error('kernel', 'ports.ai', 'Port missing');
      dc.warning('config', 'surge.duration', 'Too short');
      dc.info('loader', 'plugins', 'All loaded');

      const output = dc.format();
      expect(output).toContain('[ERROR]');
      expect(output).toContain('[WARN]');
      expect(output).toContain('[INFO]');
      expect(output).toContain('kernel > ports.ai');
      expect(output).toContain('Port missing');
    });

    it('includes hint when provided', () => {
      const dc = new DiagnosticsCollector();
      dc.error('kernel', 'factions', 'Unknown faction', 'Did you mean "bandits"?');

      const output = dc.format();
      expect(output).toContain('hint: Did you mean "bandits"?');
    });
  });
});

describe('ALifeValidationError', () => {
  it('has name "ALifeValidationError" and exposes diagnostics', () => {
    const diags: IDiagnostic[] = [
      { severity: 'error', source: 'kernel', path: 'ports.ai', message: 'Missing' },
    ];
    const err = new ALifeValidationError(diags);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ALifeValidationError');
    expect(err.diagnostics).toEqual(diags);
    expect(err.message).toContain('A-Life validation failed:');
    expect(err.message).toContain('Missing');
  });
});
