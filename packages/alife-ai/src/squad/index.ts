// squad sub-path barrel
export {
  evaluateSituation,
  SquadCommand,
  canApplyCommand,
  PROTECTED_STATES,
} from './SquadTactics';
export type { ISquadSituation, ISquadCommandEvaluator } from './SquadTactics';

export { SquadSharedTargetTable, createDefaultSquadSharedTargetConfig } from './SquadSharedTarget';
export type { ISharedTargetInfo, ISquadSharedTargetConfig } from './SquadSharedTarget';
