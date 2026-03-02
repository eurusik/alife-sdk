import { createPluginToken } from './PluginToken';
import type { FactionsPlugin } from './FactionsPlugin';
import type { NPCTypesPlugin } from './NPCTypesPlugin';
import type { CombatSchemaPlugin } from './CombatSchemaPlugin';
import type { SpawnPlugin } from './SpawnPlugin';
import type { MonstersPlugin } from './MonstersPlugin';
import type { AnomaliesPlugin } from './AnomaliesPlugin';
import type { SurgePlugin } from './SurgePlugin';
import type { SquadPlugin } from './SquadPlugin';
import type { SocialPlugin } from './SocialPlugin';
import type { TradePlugin } from './TradePlugin';

/** Well-known plugin name constants to avoid magic strings in `getPlugin()`. */
export const PluginNames = {
  FACTIONS: 'factions',
  NPC_TYPES: 'npcTypes',
  COMBAT_SCHEMA: 'combatSchema',
  SPAWN: 'spawn',
  MONSTERS: 'monsters',
  ANOMALIES: 'anomalies',
  SURGE: 'surge',
  SQUAD: 'squad',
  SOCIAL: 'social',
  TRADE: 'trade',
} as const;

/** Type-safe plugin tokens for use with `kernel.getPlugin()`. */
export const Plugins = {
  FACTIONS: createPluginToken<FactionsPlugin>(PluginNames.FACTIONS),
  NPC_TYPES: createPluginToken<NPCTypesPlugin>(PluginNames.NPC_TYPES),
  COMBAT_SCHEMA: createPluginToken<CombatSchemaPlugin>(PluginNames.COMBAT_SCHEMA),
  SPAWN: createPluginToken<SpawnPlugin>(PluginNames.SPAWN),
  MONSTERS: createPluginToken<MonstersPlugin>(PluginNames.MONSTERS),
  ANOMALIES: createPluginToken<AnomaliesPlugin>(PluginNames.ANOMALIES),
  SURGE: createPluginToken<SurgePlugin>(PluginNames.SURGE),
  SQUAD: createPluginToken<SquadPlugin>(PluginNames.SQUAD),
  SOCIAL: createPluginToken<SocialPlugin>(PluginNames.SOCIAL),
  TRADE: createPluginToken<TradePlugin>(PluginNames.TRADE),
} as const;
