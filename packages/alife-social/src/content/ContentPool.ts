// content/ContentPool.ts
// Generic round-robin text pool with category keys.
// Prevents immediate repeats by tracking cursor position per pool.

import type { IRandom } from '@alife-sdk/core';
import { SocialCategory, type ISocialData } from '../types/ISocialTypes';

/**
 * Generic content pool with round-robin selection.
 *
 * Each category (greeting, remark, campfire, etc.) has its own line pool.
 * Random selection avoids repeating the same line consecutively.
 *
 * @example
 * ```ts
 * const pool = new ContentPool(random);
 * pool.addLines('greeting_friendly', ['Привіт!', 'Здоров!']);
 * const line = pool.getRandomLine('greeting_friendly');
 * ```
 */
export class ContentPool {
  private readonly pools = new Map<string, readonly string[]>();
  private readonly cursors = new Map<string, number>();

  constructor(private readonly random: IRandom) {}

  /**
   * Add lines for a given category key.
   * Replaces any existing pool for that key.
   */
  addLines(key: string, lines: readonly string[]): void {
    if (lines.length === 0) return;
    this.pools.set(key, lines);
    this.cursors.delete(key);
  }

  /**
   * Get a random line from a pool, avoiding immediate repeats.
   * Returns null if the pool doesn't exist or is empty.
   */
  getRandomLine(key: string): string | null {
    const pool = this.pools.get(key);
    if (!pool || pool.length === 0) return null;
    if (pool.length === 1) return pool[0];

    const prev = this.cursors.get(key) ?? -1;
    let idx: number;
    let attempts = 0;
    do {
      idx = Math.floor(this.random.next() * pool.length);
    } while (idx === prev && ++attempts < 10);

    this.cursors.set(key, idx);
    return pool[idx];
  }

  /**
   * Check if a pool exists and has at least one line.
   */
  hasLines(key: string): boolean {
    const pool = this.pools.get(key);
    return pool !== undefined && pool.length > 0;
  }

  /**
   * Get the gossip key for a specific faction.
   */
  static gossipKey(factionId: string): string {
    return `${SocialCategory.REMARK_GOSSIP}:${factionId}`;
  }

  /**
   * Get the number of categories with content.
   */
  get size(): number {
    return this.pools.size;
  }

  /**
   * Clear all pools.
   */
  clear(): void {
    this.pools.clear();
    this.cursors.clear();
  }
}

/**
 * Populate a ContentPool from ISocialData structure.
 */
export function loadSocialData(pool: ContentPool, data: ISocialData): void {
  pool.addLines(SocialCategory.GREETING_FRIENDLY, data.greetings.friendly);
  pool.addLines(SocialCategory.GREETING_NEUTRAL, data.greetings.neutral);
  pool.addLines(SocialCategory.GREETING_EVENING, data.greetings.evening ?? data.greetings.camp_sleepy ?? []);

  pool.addLines(SocialCategory.REMARK_ZONE, data.remarks.zone);
  pool.addLines(SocialCategory.REMARK_WEATHER, data.remarks.weather);
  for (const [factionId, lines] of Object.entries(data.remarks.gossip)) {
    pool.addLines(ContentPool.gossipKey(factionId), lines);
  }

  pool.addLines(SocialCategory.CAMPFIRE_STORY, data.campfire.stories);
  pool.addLines(SocialCategory.CAMPFIRE_JOKE, data.campfire.jokes);
  pool.addLines(SocialCategory.CAMPFIRE_LAUGHTER, data.campfire.reactions.laughter);
  pool.addLines(SocialCategory.CAMPFIRE_STORY_REACT, data.campfire.reactions.story_react);
  pool.addLines(SocialCategory.CAMPFIRE_EATING, data.campfire.reactions.eating);

  if (data.custom) {
    for (const [category, lines] of Object.entries(data.custom)) {
      pool.addLines(category, lines);
    }
  }
}
