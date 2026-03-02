// meet/MeetEligibility.ts
// Specification pattern — composable boolean predicates for meet eligibility.
// All functions are pure with no side effects.

import type { Vec2 } from '@alife-sdk/core';
import type { ISocialNPC } from '../types/ISocialTypes';
import type { IMeetConfig } from '../types/ISocialConfig';

/**
 * Context for meet eligibility checks.
 */
export interface IMeetEligibilityContext {
  readonly targetPos: Vec2;
  readonly cooldowns: ReadonlyMap<string, number>;
  readonly currentTime: number;
  readonly isHostile: (factionA: string, factionB: string) => boolean;
  readonly targetFactionId: string;
}

/**
 * Check if two NPCs (or NPC + player position) can initiate a greeting.
 *
 * All predicates must pass:
 * 1. Distance ≤ meetDistance (squared check, no sqrt)
 * 2. Per-NPC cooldown expired
 * 3. Factions are not hostile
 * 4. NPC is alive (state !== 'dead')
 *
 * @param npc - The NPC candidate
 * @param context - Target position, cooldowns, time, hostility check, target faction
 * @param config - Meet configuration
 */
export function isMeetEligible(
  npc: ISocialNPC,
  context: IMeetEligibilityContext,
  config: IMeetConfig,
): boolean {
  const { targetPos, cooldowns, currentTime, isHostile, targetFactionId } = context;

  // State gate — dead NPCs can't greet
  if (npc.state === 'dead') return false;

  // Distance (squared, no sqrt)
  const dx = npc.position.x - targetPos.x;
  const dy = npc.position.y - targetPos.y;
  const distSq = dx * dx + dy * dy;
  const meetDistSq = config.meetDistance * config.meetDistance;
  if (distSq > meetDistSq) return false;

  // Cooldown — stored value is the expiry timestamp (currentTime + cooldownMs)
  const expiry = cooldowns.get(npc.id);
  if (expiry !== undefined && currentTime < expiry) return false;

  // Faction hostility
  if (isHostile(npc.factionId, targetFactionId)) return false;

  return true;
}

/**
 * Default greeting state map — NPC states that override the faction-based greeting.
 * `camp` and `sleep` both map to `greeting_evening`.
 */
export const DEFAULT_GREETING_STATE_MAP: Readonly<Record<string, string>> = {
  camp: 'greeting_evening',
  sleep: 'greeting_evening',
};

/**
 * Select the appropriate greeting category based on NPC state and faction.
 *
 * Priority:
 * 1. State override from stateGreetingMap → mapped category
 * 2. Allied faction → GREETING_FRIENDLY
 * 3. Default → GREETING_NEUTRAL
 *
 * @param stateGreetingMap - Optional custom state→category mapping. Defaults to DEFAULT_GREETING_STATE_MAP.
 */
export function selectGreetingCategory(
  npcState: string,
  npcFactionId: string,
  targetFactionId: string,
  isAlly: (factionA: string, factionB: string) => boolean,
  stateGreetingMap?: Readonly<Record<string, string>>,
): string {
  const map = stateGreetingMap ?? DEFAULT_GREETING_STATE_MAP;
  const stateOverride = map[npcState];
  if (stateOverride) return stateOverride;
  if (npcFactionId === targetFactionId || isAlly(npcFactionId, targetFactionId)) {
    return 'greeting_friendly';
  }
  return 'greeting_neutral';
}
