// combat/MonsterAbilityData.ts
// Value objects for monster ability state tracking.
// These are mutable phase-state objects consumed by the host's state machine.

/**
 * Monster ability type identifiers.
 * Used to determine which ability phase data to create.
 */
export const MonsterAbility = {
  CHARGE: 'charge',
  STALK: 'stalk',
  LEAP: 'leap',
  PSI_ATTACK: 'psi_attack',
} as const;

export type MonsterAbility = (typeof MonsterAbility)[keyof typeof MonsterAbility] | (string & {});

// -----------------------------------------------------------------------
// Linear Charge — windup → charge toward target → impact
// -----------------------------------------------------------------------

export type LinearChargePhase = 'windup' | 'charging' | 'impact';

export interface ILinearChargeData {
  phase: LinearChargePhase;
  timer: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
}

export function createLinearChargeData(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  windupMs: number,
): ILinearChargeData {
  return {
    phase: 'windup',
    timer: windupMs,
    startX,
    startY,
    targetX,
    targetY,
  };
}

// -----------------------------------------------------------------------
// Approach — move invisibly toward target → uncloak
// -----------------------------------------------------------------------

export type ApproachPhase = 'approach' | 'uncloak';

export interface IApproachData {
  phase: ApproachPhase;
  targetX: number;
  targetY: number;
}

export function createApproachData(targetX: number, targetY: number): IApproachData {
  return { phase: 'approach', targetX, targetY };
}

// -----------------------------------------------------------------------
// Leap (Snork)
// -----------------------------------------------------------------------

export type LeapPhase = 'windup' | 'airborne' | 'land';

export interface ILeapData {
  phase: LeapPhase;
  timer: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
}

export function createLeapData(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  windupMs: number,
): ILeapData {
  return {
    phase: 'windup',
    timer: windupMs,
    startX,
    startY,
    targetX,
    targetY,
  };
}

// -----------------------------------------------------------------------
// Channel Ability — channel for a duration → fire/release
// -----------------------------------------------------------------------

export type ChannelAbilityPhase = 'channel' | 'fire';

export interface IChannelAbilityData {
  phase: ChannelAbilityPhase;
  timer: number;
  targetX: number;
  targetY: number;
}

export function createChannelAbilityData(
  targetX: number,
  targetY: number,
  channelMs: number,
): IChannelAbilityData {
  return { phase: 'channel', timer: channelMs, targetX, targetY };
}

// -----------------------------------------------------------------------
// Ability Transition Logic
// -----------------------------------------------------------------------

/**
 * Context for determining which monster ability to trigger.
 */
export interface IMonsterAbilityContext {
  readonly monsterType: string;
  readonly distanceToEnemy: number;
  readonly attackRange: number;
  readonly meleeCooldownRemaining: number;
  readonly hpRatio: number;
  readonly moraleValue: number;
}

/**
 * Strategy rule for monster ability activation.
 * Evaluated in order — first rule whose `shouldTrigger` returns true wins.
 */
export interface IMonsterAbilityRule {
  readonly abilityId: string;
  shouldTrigger(ctx: IMonsterAbilityContext): boolean;
}

/**
 * Default ability rules per monster type, extracted from the original switch logic.
 * Each entry is evaluated in order; the first matching rule's abilityId is returned.
 */
export const DEFAULT_ABILITY_RULES: Readonly<Record<string, readonly IMonsterAbilityRule[]>> = {
  boar: [
    { abilityId: 'charge', shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange },
  ],
  bloodsucker: [
    { abilityId: 'stalk', shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange * 2 },
  ],
  snork: [
    {
      abilityId: 'leap',
      shouldTrigger: (ctx) =>
        ctx.distanceToEnemy > ctx.attackRange && ctx.distanceToEnemy <= ctx.attackRange * 3,
    },
  ],
  controller: [
    { abilityId: 'psi_attack', shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange },
  ],
};

/**
 * Determine which ability a monster should use, if any.
 *
 * Only fires when melee cooldown has expired. Rules are evaluated in order
 * per monster type — first matching rule wins.
 *
 * @param ctx - Monster ability context (type, distance, cooldowns, etc.)
 * @param rules - Optional custom ability rules. Defaults to DEFAULT_ABILITY_RULES.
 * @returns The ability ID to use, or null if none should trigger.
 */
export function selectMonsterAbility(
  ctx: IMonsterAbilityContext,
  rules?: Readonly<Record<string, readonly IMonsterAbilityRule[]>>,
): string | null {
  if (ctx.meleeCooldownRemaining > 0) return null;

  const monsterRules = (rules ?? DEFAULT_ABILITY_RULES)[ctx.monsterType];
  if (!monsterRules) return null;

  for (const rule of monsterRules) {
    if (rule.shouldTrigger(ctx)) return rule.abilityId;
  }

  return null;
}

/**
 * Configuration for monster flee behavior.
 */
export interface IMonsterFleeConfig {
  /** HP ratio threshold below which flee is considered. Default 0.2. */
  readonly hpThreshold: number;
  /** Morale threshold below which flee is triggered. Default -0.3. */
  readonly moraleThreshold: number;
}

export const DEFAULT_MONSTER_FLEE_CONFIG: IMonsterFleeConfig = {
  hpThreshold: 0.2,
  moraleThreshold: -0.3,
};

/**
 * Check if a monster should flee based on critical state.
 * Common to all monster types.
 */
export function shouldMonsterFlee(
  hpRatio: number,
  moraleValue: number,
  config: IMonsterFleeConfig = DEFAULT_MONSTER_FLEE_CONFIG,
): boolean {
  return hpRatio < config.hpThreshold && moraleValue < config.moraleThreshold;
}
