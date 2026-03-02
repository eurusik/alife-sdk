import { describe, it, expect } from 'vitest';
import { LogChannel } from './LogChannel';

describe('LogChannel', () => {
  it('contains 22 predefined channels', () => {
    expect(Object.keys(LogChannel)).toHaveLength(22);
  });

  it('all values are unique strings', () => {
    const values = Object.values(LogChannel);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) expect(typeof v).toBe('string');
  });

  it('includes all expected subsystems', () => {
    const expected = [
      'alife', 'squad', 'spawn', 'surge', 'time', 'ai', 'movement',
      'perception', 'npc_brain', 'combat', 'cover', 'faction', 'state',
      'save', 'trade', 'anomaly', 'inventory', 'input', 'audio',
      'quest', 'scene', 'goap',
    ];
    for (const ch of expected) {
      expect(Object.values(LogChannel)).toContain(ch);
    }
  });
});
