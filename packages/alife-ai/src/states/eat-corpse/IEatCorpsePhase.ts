// states/eat-corpse/IEatCorpsePhase.ts
// Per-NPC mutable phase data for the EAT_CORPSE state.
// Follows the same pattern as IChargePhase, IStalkPhase, etc.

/**
 * Mutable phase data stored in `INPCOnlineState.eatCorpsePhase`.
 *
 * Lazy-initialised by `EatCorpseState.enter()` via the `??=` operator;
 * zero-cost for NPCs that never enter EAT_CORPSE.
 */
export interface IEatCorpsePhase {
  /** Whether the eat sequence is currently active. */
  active: boolean;
  /** Stable entity ID of the target corpse. */
  corpseId: string;
  /** World X of the target corpse (set once in enter). */
  corpseX: number;
  /** World Y of the target corpse (set once in enter). */
  corpseY: number;
  /** HP reward to apply on completion (copied from ICorpseRecord.healAmount). */
  healAmount: number;
  /** ctx.now() when the eating phase began (0 while still approaching). */
  eatStartMs: number;
  /** True once the NPC has arrived at the corpse and started eating. */
  eating: boolean;
}
