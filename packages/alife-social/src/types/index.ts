// types sub-path barrel
export type {
  ISocialNPC,
  ISocialData,
  IBubbleRequest,
} from './ISocialTypes';
export {
  SocialCategory,
  CampfireState,
  KampState,
  CampfireRole,
  KampRole,
  BUBBLE_MIN_DURATION_MS,
  BUBBLE_MS_PER_CHAR,
} from './ISocialTypes';
export type { IGatheringFSM } from '../campfire/IGatheringFSM';
export type {
  IMeetConfig,
  IRemarkConfig,
  ICampfireConfig,
  ISocialConfig,
  ISocialConfigOverrides,
} from './ISocialConfig';
export { createDefaultSocialConfig, DEFAULT_REMARK_ELIGIBLE_STATES, DEFAULT_REMARK_TERRAIN_LOCK_MS } from './ISocialConfig';
