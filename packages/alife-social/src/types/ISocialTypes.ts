// types/ISocialTypes.ts
// Value objects for the social interaction subsystem.

import type { Vec2 } from '@alife-sdk/core';

/**
 * Minimum display duration for a social bubble (ms).
 * Actual duration = max(BUBBLE_MIN_DURATION_MS, text.length * BUBBLE_MS_PER_CHAR)
 */
export const BUBBLE_MIN_DURATION_MS = 2_000;

/**
 * Additional display time per character for social bubbles (ms/char).
 * Allows longer texts to stay visible longer.
 */
export const BUBBLE_MS_PER_CHAR = 80;

/**
 * Social content categories for text pool lookup.
 */
export const SocialCategory = {
  GREETING_FRIENDLY: 'greeting_friendly',
  GREETING_NEUTRAL: 'greeting_neutral',
  GREETING_EVENING: 'greeting_evening',
  /** @deprecated Use GREETING_EVENING */
  GREETING_SLEEPY: 'greeting_evening',
  REMARK_ZONE: 'remark_zone',
  REMARK_WEATHER: 'remark_weather',
  REMARK_GOSSIP: 'remark_gossip',
  CAMPFIRE_STORY: 'campfire_story',
  CAMPFIRE_JOKE: 'campfire_joke',
  CAMPFIRE_LAUGHTER: 'campfire_laughter',
  CAMPFIRE_STORY_REACT: 'campfire_story_react',
  CAMPFIRE_EATING: 'campfire_eating',
  /** @deprecated Use CAMPFIRE_STORY */
  KAMP_STORY: 'campfire_story',
  /** @deprecated Use CAMPFIRE_JOKE */
  KAMP_JOKE: 'campfire_joke',
  /** @deprecated Use CAMPFIRE_LAUGHTER */
  KAMP_LAUGHTER: 'campfire_laughter',
  /** @deprecated Use CAMPFIRE_STORY_REACT */
  KAMP_STORY_REACT: 'campfire_story_react',
  /** @deprecated Use CAMPFIRE_EATING */
  KAMP_EATING: 'campfire_eating',
} as const;

export type SocialCategory = (typeof SocialCategory)[keyof typeof SocialCategory] | (string & {});

/**
 * Campfire FSM states.
 */
export const CampfireState = {
  IDLE: 'campfire_idle',
  STORY: 'campfire_story',
  JOKE: 'campfire_joke',
  EATING: 'campfire_eating',
  REACTING: 'campfire_reacting',
} as const;

export type CampfireState = (typeof CampfireState)[keyof typeof CampfireState];

/** @deprecated Use CampfireState instead. */
export const KampState = CampfireState;
/** @deprecated Use CampfireState instead. */
export type KampState = CampfireState;

/**
 * Campfire participant roles.
 */
export const CampfireRole = {
  DIRECTOR: 'director',
  AUDIENCE: 'audience',
} as const;

export type CampfireRole = (typeof CampfireRole)[keyof typeof CampfireRole];

/** @deprecated Use CampfireRole instead. */
export const KampRole = CampfireRole;
/** @deprecated Use CampfireRole instead. */
export type KampRole = CampfireRole;

/**
 * Minimal NPC data needed for social evaluations.
 * Host provides this via the INPCSocialProvider port.
 */
export interface ISocialNPC {
  readonly id: string;
  readonly position: Vec2;
  readonly factionId: string;
  readonly state: string;
}

/**
 * Social content data structure (matches social.json shape).
 */
export interface ISocialData {
  readonly greetings: {
    readonly friendly: readonly string[];
    readonly neutral: readonly string[];
    readonly evening: readonly string[];
    /** @deprecated Use evening */
    readonly camp_sleepy?: readonly string[];
  };
  readonly remarks: {
    readonly zone: readonly string[];
    readonly weather: readonly string[];
    readonly gossip: Readonly<Record<string, readonly string[]>>;
  };
  readonly campfire: {
    readonly stories: readonly string[];
    readonly jokes: readonly string[];
    readonly reactions: {
      readonly laughter: readonly string[];
      readonly story_react: readonly string[];
      readonly eating: readonly string[];
    };
  };
  /** Custom content pools — key is any category string, value is lines array. */
  readonly custom?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Bubble display request emitted by the social system.
 * Host implements ISocialPresenter to render these.
 */
export interface IBubbleRequest {
  readonly npcId: string;
  readonly text: string;
  readonly durationMs: number;
  readonly category: SocialCategory;
}
