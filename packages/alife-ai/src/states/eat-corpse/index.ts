// states/eat-corpse — opt-in corpse-eating behavior module.
//
// Import explicitly to opt in:
//   import { EatCorpseState, withEatCorpseGuard } from '@alife-sdk/ai/states/eat-corpse';
//
// Never imported by buildDefaultHandlerMap or buildMonsterHandlerMap.
// Zero bundle cost for projects that do not use this module.

export type { ICorpseRecord, ICorpseSource } from './ICorpseSource';
export type { IEatCorpsePhase } from './IEatCorpsePhase';
export type { IEatCorpseConfig, IEatCorpseGuardConfig } from './IEatCorpseConfig';
export { createDefaultEatCorpseConfig, createDefaultEatCorpseGuardConfig } from './IEatCorpseConfig';
export { EatCorpseState } from './EatCorpseState';
export { withEatCorpseGuard } from './EatCorpseTransitionGuard';
