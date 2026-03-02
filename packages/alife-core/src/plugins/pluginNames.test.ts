import { PluginNames, Plugins } from './pluginNames';
import { createPluginToken } from './PluginToken';

describe('PluginNames', () => {
  it('contains all expected plugin names', () => {
    expect(PluginNames.FACTIONS).toBe('factions');
    expect(PluginNames.NPC_TYPES).toBe('npcTypes');
    expect(PluginNames.COMBAT_SCHEMA).toBe('combatSchema');
    expect(PluginNames.SPAWN).toBe('spawn');
    expect(PluginNames.MONSTERS).toBe('monsters');
    expect(PluginNames.ANOMALIES).toBe('anomalies');
    expect(PluginNames.SURGE).toBe('surge');
    expect(PluginNames.SQUAD).toBe('squad');
    expect(PluginNames.SOCIAL).toBe('social');
    expect(PluginNames.TRADE).toBe('trade');
  });

  it('has 10 entries', () => {
    expect(Object.keys(PluginNames)).toHaveLength(10);
  });

  it('all values are unique', () => {
    const values = Object.values(PluginNames);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('Plugins (typed tokens)', () => {
  it('has a typed token for every PluginName', () => {
    for (const key of Object.keys(PluginNames) as (keyof typeof PluginNames)[]) {
      const token = Plugins[key];
      expect(token).toBeDefined();
      expect(token.name).toBe(PluginNames[key]);
    }
  });

  it('has 10 tokens', () => {
    expect(Object.keys(Plugins)).toHaveLength(10);
  });

  it('all token names are unique', () => {
    const names = Object.values(Plugins).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('createPluginToken', () => {
  it('creates a token with the given name', () => {
    const token = createPluginToken<never>('myPlugin');
    expect(token.name).toBe('myPlugin');
  });
});
