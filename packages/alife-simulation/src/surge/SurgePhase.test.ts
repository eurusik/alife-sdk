import { describe, it, expect } from 'vitest';
import { SurgePhase } from './SurgePhase';

describe('SurgePhase', () => {
  it('contains 4 phases', () => {
    expect(Object.keys(SurgePhase)).toHaveLength(4);
  });

  it('has all expected phase values', () => {
    expect(SurgePhase.INACTIVE).toBe('inactive');
    expect(SurgePhase.WARNING).toBe('warning');
    expect(SurgePhase.ACTIVE).toBe('active');
    expect(SurgePhase.AFTERMATH).toBe('aftermath');
  });

  it('all values are unique', () => {
    const values = Object.values(SurgePhase);
    expect(new Set(values).size).toBe(4);
  });
});
