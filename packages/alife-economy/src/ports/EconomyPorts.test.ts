import { describe, it, expect } from 'vitest';
import { EconomyPorts } from './EconomyPorts';

describe('EconomyPorts', () => {
  it('exports TerrainLock token', () => {
    expect(EconomyPorts.TerrainLock).toBeDefined();
    expect(EconomyPorts.TerrainLock.id).toBe('terrainLock');
    expect(typeof EconomyPorts.TerrainLock.description).toBe('string');
  });

  it('exports CoLocationSource token', () => {
    expect(EconomyPorts.CoLocationSource).toBeDefined();
    expect(EconomyPorts.CoLocationSource.id).toBe('economy.coLocation');
    expect(typeof EconomyPorts.CoLocationSource.description).toBe('string');
  });

  it('exports ItemCatalogue token', () => {
    expect(EconomyPorts.ItemCatalogue).toBeDefined();
    expect(EconomyPorts.ItemCatalogue.id).toBe('economy.itemCatalogue');
    expect(typeof EconomyPorts.ItemCatalogue.description).toBe('string');
  });

  it('has exactly 3 port tokens', () => {
    expect(Object.keys(EconomyPorts)).toHaveLength(3);
  });
});
