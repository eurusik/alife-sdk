// combat sub-path barrel
export { selectBestWeapon, shouldThrowGrenade, shouldUseMedkit } from './WeaponSelector';
export type { IWeaponContext } from './WeaponSelector';
export { LoadoutBuilder, createLoadout, FactionWeaponPreference, DEFAULT_LOADOUT_RECIPES } from './LoadoutBuilder';
export type { ILoadoutRecipe } from './LoadoutBuilder';
export {
  evaluateTransitions,
  DEFAULT_COMBAT_RULES,
  createDefaultCombatTransitionConfig,
  WoundedRule,
  NoAmmoRule,
  EvadeDangerRule,
  MoraleRule,
  GrenadeOpportunityRule,
  SearchRule,
} from './CombatTransitionChain';
export type {
  ICombatContext,
  ITransitionRule,
  ICombatTransitionConfig,
  TransitionResult,
} from './CombatTransitionChain';
export {
  MonsterAbility,
  DEFAULT_ABILITY_RULES,
  DEFAULT_MONSTER_FLEE_CONFIG,
  createLinearChargeData,
  createApproachData,
  createLeapData,
  createChannelAbilityData,
  selectMonsterAbility,
  shouldMonsterFlee,
} from './MonsterAbilityData';
export type {
  ILinearChargeData,
  LinearChargePhase,
  IApproachData,
  ApproachPhase,
  ILeapData,
  LeapPhase,
  IChannelAbilityData,
  ChannelAbilityPhase,
  IMonsterAbilityContext,
  IMonsterAbilityRule,
  IMonsterFleeConfig,
} from './MonsterAbilityData';
