// campfire/CampfireFSM.ts
// 5-state campfire director FSM with staggered audience reactions.

import type { IRandom } from '@alife-sdk/core';
import { CampfireState, SocialCategory, BUBBLE_MIN_DURATION_MS, BUBBLE_MS_PER_CHAR, type IBubbleRequest } from '../types/ISocialTypes';
import type { ICampfireConfig } from '../types/ISocialConfig';
import { ContentPool } from '../content/ContentPool';
import { CampfireParticipants } from './CampfireParticipants';
import type { IGatheringFSM } from './IGatheringFSM';

function bubbleDuration(text: string): number {
  return Math.max(BUBBLE_MIN_DURATION_MS, text.length * BUBBLE_MS_PER_CHAR);
}

/**
 * CampfireFSM — 5-state campfire director FSM.
 *
 * States: IDLE → STORY/JOKE/EATING → REACTING → IDLE (loop)
 *
 * The director rotates each cycle. Audience reactions are staggered
 * to prevent all bubbles from appearing simultaneously.
 *
 * @example
 * ```ts
 * const fsm = new CampfireFSM('terrain_camp_1', pool, random, config);
 * fsm.setParticipants(['npc1', 'npc2', 'npc3']);
 * // Each frame:
 * const bubbles = fsm.update(deltaMs);
 * ```
 */
export class CampfireFSM implements IGatheringFSM {
  readonly terrainId: string;

  private state: CampfireState = CampfireState.IDLE;
  private stateTimer = 0;
  private stateDuration = 0;
  private wasJoke = false;
  private readonly participants: CampfireParticipants;
  private readonly reactionTimers = new Map<string, number>();
  private readonly firedReactions = new Set<string>();
  private readonly _reactionBubbles: IBubbleRequest[] = [];
  private _pendingReactionCount = 0;

  constructor(
    terrainId: string,
    private readonly contentPool: ContentPool,
    private readonly random: IRandom,
    private readonly config: ICampfireConfig,
  ) {
    this.terrainId = terrainId;
    this.participants = new CampfireParticipants(random);
    this.stateDuration = this.randomRange(config.idleDurationMinMs, config.idleDurationMaxMs);
  }

  /**
   * Set the participant list. Returns false if below minimum.
   */
  setParticipants(npcIds: readonly string[]): boolean {
    return this.participants.setParticipants(npcIds, this.config.minParticipants);
  }

  /**
   * Update the FSM. Returns bubble requests for this frame.
   */
  update(deltaMs: number): IBubbleRequest[] {
    if (this.participants.count < this.config.minParticipants) return [];

    this.stateTimer += deltaMs;

    // Check if director left mid-scene
    if (this.state === CampfireState.STORY || this.state === CampfireState.JOKE) {
      const directorId = this.participants.getDirectorId();
      if (directorId && !this.participants.has(directorId)) {
        return this.enterIdle();
      }
    }

    if (this.stateTimer >= this.stateDuration) {
      return this.transition();
    }

    if (this.state === CampfireState.REACTING) {
      return this.tickReactions(deltaMs);
    }

    return [];
  }

  /**
   * Get the current FSM state.
   */
  getState(): CampfireState {
    return this.state;
  }

  /**
   * Get the current director NPC ID.
   */
  getDirectorId(): string | null {
    return this.participants.getDirectorId();
  }

  get participantCount(): number {
    return this.participants.count;
  }

  clear(): void {
    this.participants.clear();
    this.reactionTimers.clear();
    this.firedReactions.clear();
    this.state = CampfireState.IDLE;
    this.stateTimer = 0;
  }

  private transition(): IBubbleRequest[] {
    switch (this.state) {
      case CampfireState.IDLE:
        return this.enterActivity();
      case CampfireState.STORY:
      case CampfireState.JOKE:
        return this.enterReacting();
      case CampfireState.REACTING:
      case CampfireState.EATING:
        return this.enterIdle();
      default:
        return this.enterIdle();
    }
  }

  private enterIdle(): IBubbleRequest[] {
    this.state = CampfireState.IDLE;
    this.stateTimer = 0;
    this.stateDuration = this.randomRange(this.config.idleDurationMinMs, this.config.idleDurationMaxMs);
    this.reactionTimers.clear();
    this.firedReactions.clear();
    return [];
  }

  private enterActivity(): IBubbleRequest[] {
    const r = this.random.next();

    if (r < this.config.weightStory) {
      return this.enterStory();
    }
    if (r < this.config.weightJokeCumulative) {
      return this.enterJoke();
    }
    return this.enterEating();
  }

  private enterStory(): IBubbleRequest[] {
    this.state = CampfireState.STORY;
    this.wasJoke = false;
    this.stateTimer = 0;
    this.stateDuration = this.randomRange(this.config.storyDurationMinMs, this.config.storyDurationMaxMs);

    const directorId = this.participants.rotateDirector();
    if (!directorId) return this.enterIdle();

    const text = this.contentPool.getRandomLine(SocialCategory.CAMPFIRE_STORY);
    if (!text) return this.enterIdle();

    return [{
      npcId: directorId,
      text,
      durationMs: bubbleDuration(text),
      category: SocialCategory.CAMPFIRE_STORY,
    }];
  }

  private enterJoke(): IBubbleRequest[] {
    this.state = CampfireState.JOKE;
    this.wasJoke = true;
    this.stateTimer = 0;
    this.stateDuration = this.randomRange(this.config.jokeDurationMinMs, this.config.jokeDurationMaxMs);

    const directorId = this.participants.rotateDirector();
    if (!directorId) return this.enterIdle();

    const text = this.contentPool.getRandomLine(SocialCategory.CAMPFIRE_JOKE);
    if (!text) return this.enterIdle();

    return [{
      npcId: directorId,
      text,
      durationMs: bubbleDuration(text),
      category: SocialCategory.CAMPFIRE_JOKE,
    }];
  }

  private enterEating(): IBubbleRequest[] {
    this.state = CampfireState.EATING;
    this.stateTimer = 0;
    this.stateDuration = this.randomRange(this.config.eatingDurationMinMs, this.config.eatingDurationMaxMs);

    const bubbles: IBubbleRequest[] = [];
    for (const npcId of this.participants.getAllIds()) {
      if (this.random.next() >= this.config.eatingChance) continue;

      const text = this.contentPool.getRandomLine(SocialCategory.CAMPFIRE_EATING);
      if (!text) continue;

      bubbles.push({
        npcId,
        text,
        durationMs: bubbleDuration(text),
        category: SocialCategory.CAMPFIRE_EATING,
      });
    }
    return bubbles;
  }

  private enterReacting(): IBubbleRequest[] {
    this.state = CampfireState.REACTING;
    this.stateTimer = 0;
    this.stateDuration = this.randomRange(this.config.reactionDurationMinMs, this.config.reactionDurationMaxMs);

    // Set up staggered reaction timers
    this.reactionTimers.clear();
    this.firedReactions.clear();
    let stagger = 0;
    for (const npcId of this.participants.getAudienceIds()) {
      this.reactionTimers.set(npcId, stagger);
      stagger += this.config.reactionStaggerMs;
    }
    this._pendingReactionCount = this.reactionTimers.size;

    return [];
  }

  private tickReactions(_deltaMs: number): IBubbleRequest[] {
    if (this._pendingReactionCount === 0) return this._reactionBubbles;

    this._reactionBubbles.length = 0;
    const category = this.wasJoke
      ? SocialCategory.CAMPFIRE_LAUGHTER
      : SocialCategory.CAMPFIRE_STORY_REACT;

    for (const [npcId, delay] of this.reactionTimers) {
      if (this.firedReactions.has(npcId)) continue;
      if (this.stateTimer < delay) continue;

      const text = this.contentPool.getRandomLine(category);
      if (text) {
        this._reactionBubbles.push({
          npcId,
          text,
          durationMs: bubbleDuration(text),
          category,
        });
      }
      this.firedReactions.add(npcId);
      this._pendingReactionCount--;
    }

    return this._reactionBubbles;
  }

  private randomRange(min: number, max: number): number {
    return min + this.random.next() * (max - min);
  }
}

/** @deprecated Use CampfireFSM instead. */
export const KampFSM = CampfireFSM;
