// types sub-path barrel
export type { INPCRecord, INPCBehaviorConfig, INPCJobContext } from './INPCRecord';
export { getRankMultiplier, RANK_MULTIPLIERS, isNPCRecordAlive, createDefaultBehaviorConfig } from './INPCRecord';
export type {
  ISimulationConfig,
  IBrainConfig,
  ITerrainStateConfig,
  ITerrainSelectorConfig,
  IJobScoringConfig,
  IOfflineCombatConfig,
  ISurgeConfig,
  IGoodwillConfig,
} from './ISimulationConfig';
export { createDefaultSimulationConfig } from './ISimulationConfig';
