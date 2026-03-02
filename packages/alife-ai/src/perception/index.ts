// perception sub-path barrel
export {
  isInFOV,
  filterVisibleEntities,
  filterHearingEntities,
  filterHostileEntities,
  filterFriendlyEntities,
  distanceSq,
  findClosest,
  scanForEnemies,
} from './PerceptionQuery';

export { NPCSensors, filterFreshIntel } from './NPCSensors';
export type {
  IPerceptibleEntity,
  IDetectionEvent,
  INPCSensorsConfig,
} from './NPCSensors';
