// animation sub-path barrel
export {
  getDirection,
  getAnimationKey,
  getAnimationRequest,
  DirectionCache,
  CompassIndex,
  AnimLayer,
  DEFAULT_STATE_ANIM_MAP,
  DEFAULT_WEAPON_SUFFIXES,
} from './AnimationSelector';
export type { IAnimationRequest, IAnimDescriptor, IAnimationInput } from './AnimationSelector';

export {
  AnimationController,
} from './AnimationController';
export type {
  IAnimationDriver,
  IAnimPlayOptions,
  ILayerPriorityMap,
  IAnimationControllerConfig,
} from './AnimationController';
