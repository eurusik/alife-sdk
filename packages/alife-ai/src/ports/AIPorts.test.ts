import { describe, it, expect } from 'vitest';
import { AIPorts } from './AIPorts';

describe('AIPorts', () => {
  it('exports CoverPointSource token', () => {
    expect(AIPorts.CoverPointSource).toBeDefined();
    expect(AIPorts.CoverPointSource.id).toBe('coverPointSource');
    expect(typeof AIPorts.CoverPointSource.description).toBe('string');
  });

  it('exports PerceptionProvider token', () => {
    expect(AIPorts.PerceptionProvider).toBeDefined();
    expect(AIPorts.PerceptionProvider.id).toBe('perceptionProvider');
    expect(typeof AIPorts.PerceptionProvider.description).toBe('string');
  });

  it('has exactly 2 port tokens', () => {
    expect(Object.keys(AIPorts)).toHaveLength(2);
  });
});
