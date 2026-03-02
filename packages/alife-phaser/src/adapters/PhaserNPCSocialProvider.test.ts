import { describe, it, expect } from 'vitest';
import { PhaserNPCSocialProvider } from './PhaserNPCSocialProvider';

describe('PhaserNPCSocialProvider', () => {
  const mockNPCs = [
    { id: 'npc_1', position: { x: 10, y: 20 }, factionId: 'loners', state: 'idle' },
    { id: 'npc_2', position: { x: 30, y: 40 }, factionId: 'military', state: 'patrol' },
  ];

  function createProvider() {
    return new PhaserNPCSocialProvider({
      getOnlineNPCs: () => mockNPCs,
      areFactionsFriendly: (a, b) => a === b,
      areFactionsHostile: (a, b) => a !== b && a !== 'loners',
      getNPCTerrainId: (id) => (id === 'npc_1' ? 'terrain_bar' : null),
    });
  }

  it('delegates getOnlineNPCs', () => {
    const provider = createProvider();
    const npcs = provider.getOnlineNPCs();
    expect(npcs).toHaveLength(2);
    expect(npcs[0].id).toBe('npc_1');
  });

  it('delegates areFactionsFriendly', () => {
    const provider = createProvider();
    expect(provider.areFactionsFriendly('loners', 'loners')).toBe(true);
    expect(provider.areFactionsFriendly('loners', 'military')).toBe(false);
  });

  it('delegates areFactionsHostile', () => {
    const provider = createProvider();
    expect(provider.areFactionsHostile('military', 'loners')).toBe(true);
    expect(provider.areFactionsHostile('loners', 'military')).toBe(false);
  });

  it('delegates getNPCTerrainId', () => {
    const provider = createProvider();
    expect(provider.getNPCTerrainId('npc_1')).toBe('terrain_bar');
    expect(provider.getNPCTerrainId('npc_2')).toBeNull();
  });
});
