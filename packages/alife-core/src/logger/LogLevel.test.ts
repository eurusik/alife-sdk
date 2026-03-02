import { describe, it, expect } from 'vitest';
import { LogLevel } from './LogLevel';

describe('LogLevel', () => {
  it('contains 5 levels', () => {
    expect(Object.keys(LogLevel)).toHaveLength(5);
  });

  it('has correct ordering: DEBUG < INFO < WARN < ERROR < NONE', () => {
    expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
    expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
    expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    expect(LogLevel.ERROR).toBeLessThan(LogLevel.NONE);
  });

  it('DEBUG is 0', () => {
    expect(LogLevel.DEBUG).toBe(0);
  });
});
