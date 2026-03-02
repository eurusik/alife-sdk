// meet/MeetOrchestrator.ts
// Evaluates meet eligibility and emits bubble requests.

import type { IRandom } from '@alife-sdk/core';
import type { ISocialNPC, IBubbleRequest } from '../types/ISocialTypes';
import { SocialCategory, BUBBLE_MIN_DURATION_MS, BUBBLE_MS_PER_CHAR } from '../types/ISocialTypes';
import type { IMeetConfig } from '../types/ISocialConfig';
import { ContentPool } from '../content/ContentPool';
import { isMeetEligible, selectGreetingCategory } from './MeetEligibility';

function bubbleDuration(text: string): number {
  return Math.max(BUBBLE_MIN_DURATION_MS, text.length * BUBBLE_MS_PER_CHAR);
}

/**
 * Context for a single MeetOrchestrator update tick.
 */
export interface IMeetUpdateContext {
  /** Time since last update (ms). */
  readonly deltaMs: number;
  /** Target X position (px). */
  readonly targetX: number;
  /** Target Y position (px). */
  readonly targetY: number;
  /** Current game time (ms). */
  readonly currentTime: number;
  /** Online NPCs to check for greeting eligibility. */
  readonly npcs: readonly ISocialNPC[];
  /** Returns true if factionA and factionB are hostile. */
  readonly isHostile: (factionA: string, factionB: string) => boolean;
  /** Returns true if factionA and factionB are allied. */
  readonly isAlly: (factionA: string, factionB: string) => boolean;
  /** Target's faction ID (e.g. player faction). */
  readonly targetFactionId: string;
}

/**
 * MeetOrchestrator — checks for greeting opportunities each interval.
 *
 * Runs on a timer (meetCheckIntervalMs). For each eligible NPC within
 * range of the target position, selects a greeting and emits a bubble request.
 *
 * @example
 * ```ts
 * const meet = new MeetOrchestrator(pool, random, config);
 * // Each frame:
 * const bubbles = meet.update({
 *   deltaMs, targetX: playerX, targetY: playerY,
 *   currentTime, npcs, isHostile, isAlly, targetFactionId: 'loner',
 * });
 * for (const bubble of bubbles) {
 *   presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
 * }
 * ```
 */
export class MeetOrchestrator {
  private readonly cooldowns = new Map<string, number>();
  private checkTimer = 0;

  constructor(
    private readonly contentPool: ContentPool,
    _random: IRandom,
    private readonly config: IMeetConfig,
  ) {}

  /**
   * Update the orchestrator. Returns any greeting bubbles to display.
   */
  update(ctx: IMeetUpdateContext): IBubbleRequest[] {
    this.checkTimer += ctx.deltaMs;
    if (this.checkTimer < this.config.meetCheckIntervalMs) return [];
    this.checkTimer -= this.config.meetCheckIntervalMs;

    // Prune expired cooldowns to prevent unbounded Map growth
    this.pruneExpiredCooldowns(ctx.currentTime);

    const bubbles: IBubbleRequest[] = [];

    for (const npc of ctx.npcs) {
      if (!isMeetEligible(npc, { targetPos: { x: ctx.targetX, y: ctx.targetY }, cooldowns: this.cooldowns, currentTime: ctx.currentTime, isHostile: ctx.isHostile, targetFactionId: ctx.targetFactionId }, this.config)) {
        continue;
      }

      const category = selectGreetingCategory(npc.state, npc.factionId, ctx.targetFactionId, ctx.isAlly, this.config.stateGreetingMap);
      const text = this.contentPool.getRandomLine(category);
      if (!text) continue;

      this.cooldowns.set(npc.id, ctx.currentTime + this.config.meetCooldownMs);
      bubbles.push({
        npcId: npc.id,
        text,
        durationMs: bubbleDuration(text),
        category: category as SocialCategory,
      });
    }

    return bubbles;
  }

  /**
   * Clear all cooldowns.
   */
  clear(): void {
    this.cooldowns.clear();
    this.checkTimer = 0;
  }

  /**
   * Serialize cooldown state for save/load.
   *
   * @returns Cooldown entries as `[npcId, expiryTimestamp]` pairs.
   */
  serialize(): Array<[string, number]> {
    return Array.from(this.cooldowns.entries());
  }

  /**
   * Restore cooldown state from a serialized snapshot.
   *
   * @param entries - `[npcId, expiryTimestamp]` pairs from {@link serialize}.
   */
  restore(entries: Array<[string, number]>): void {
    this.cooldowns.clear();
    for (const [npcId, expiry] of entries) {
      this.cooldowns.set(npcId, expiry);
    }
  }

  /** Remove cooldown entries whose expiry timestamp has passed. */
  private pruneExpiredCooldowns(currentTime: number): void {
    const toDelete: string[] = [];
    for (const [npcId, expiry] of this.cooldowns) {
      if (currentTime >= expiry) {
        toDelete.push(npcId);
      }
    }
    for (const npcId of toDelete) {
      this.cooldowns.delete(npcId);
    }
  }
}
