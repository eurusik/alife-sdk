import { describe, it, expect } from 'vitest';
import { DEFAULT_DEVTOOLS_CONFIG } from './DevToolsInspector';

describe('DEFAULT_DEVTOOLS_CONFIG', () => {
  it('has all flags defaulting to true', () => {
    expect(DEFAULT_DEVTOOLS_CONFIG.includePlugins).toBe(true);
    expect(DEFAULT_DEVTOOLS_CONFIG.includeSpatialGrid).toBe(true);
    expect(DEFAULT_DEVTOOLS_CONFIG.includePorts).toBe(true);
  });

  it('has exactly 3 properties', () => {
    expect(Object.keys(DEFAULT_DEVTOOLS_CONFIG)).toHaveLength(3);
  });
});
