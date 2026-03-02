// states sub-path barrel
// Foundation layer for Phaser-free NPC online state handlers.

export type { IStateConfig, IMovementConfig, ICombatConfig, IMonsterConfig, ITimingConfig } from './IStateConfig';
export { createDefaultStateConfig } from './IStateConfig';

export * from './IStateTransitionMap';

export type {
  ILoopholeState,
  IChargePhase,
  IStalkPhase,
  ILeapPhase,
  IPsiPhase,
  INPCOnlineState,
} from './INPCOnlineState';

export { createDefaultNPCOnlineState } from './NPCOnlineState';

export type {
  INPCPerception,
  INPCHealth,
  ICoverAccess,
  IDangerAccess,
  IRestrictedZoneAccess,
  ISquadAccess,
  IConditionAccess,
  ISuspicionAccess,
  IShootPayload,
  IMeleeHitPayload,
  INPCContext,
} from './INPCContext';

export type { IPackAccess, IPackTarget, PackAlertLevel } from './pack/IPackAccess';
export { PACK_ALERT_ORDER } from './pack/IPackAccess';

export type { IOnlineStateHandler } from './IOnlineStateHandler';

export { StateHandlerMap } from './StateHandlerMap';

export type { IVisibleEntity, INearbyItem } from './NPCPerception';
export { NPCPerception } from './NPCPerception';

export * from './handlers/index';

export type { IOnlineDriverHost } from './OnlineAIDriver';
export { OnlineAIDriver } from './OnlineAIDriver';

export { buildDefaultHandlerMap, buildMonsterHandlerMap, buildChornobylMonsterHandlerMap, ONLINE_STATE } from './OnlineStateRegistryBuilder';
