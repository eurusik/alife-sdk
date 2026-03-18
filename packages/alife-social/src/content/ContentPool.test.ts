import { describe, it, expect } from 'vitest';
import { ContentPool, loadSocialData } from './ContentPool';
import type { ISocialData } from '../types/ISocialTypes';
import { SocialCategory } from '../types/ISocialTypes';

function makeRandom(values: number[] = [0.5]) {
  let idx = 0;
  return {
    next: () => values[idx++ % values.length],
    nextInt: (min: number, max: number) => min + Math.floor(values[idx++ % values.length] * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + values[idx++ % values.length] * (max - min),
  };
}

describe('ContentPool', () => {
  it('returns null for empty key', () => {
    const pool = new ContentPool(makeRandom());
    expect(pool.getRandomLine('nonexistent')).toBeNull();
  });

  it('returns single line from pool', () => {
    const pool = new ContentPool(makeRandom());
    pool.addLines('greet', ['Hello']);
    expect(pool.getRandomLine('greet')).toBe('Hello');
  });

  it('returns random line from pool', () => {
    const pool = new ContentPool(makeRandom([0.0, 0.99]));
    pool.addLines('greet', ['A', 'B', 'C']);
    const line = pool.getRandomLine('greet');
    expect(['A', 'B', 'C']).toContain(line);
  });

  it('avoids immediate repeat', () => {
    // With value 0.5 on 2 items → idx 1, then 0.5 again → idx 1, but prev=1, re-roll
    const pool = new ContentPool(makeRandom([0.5, 0.5, 0.1]));
    pool.addLines('greet', ['A', 'B']);
    const first = pool.getRandomLine('greet');
    const second = pool.getRandomLine('greet');
    expect(first).not.toBe(second);
  });

  it('hasLines returns true for populated pool', () => {
    const pool = new ContentPool(makeRandom());
    pool.addLines('greet', ['Hello']);
    expect(pool.hasLines('greet')).toBe(true);
  });

  it('hasLines returns false for empty pool', () => {
    const pool = new ContentPool(makeRandom());
    expect(pool.hasLines('greet')).toBe(false);
  });

  it('does not add empty array', () => {
    const pool = new ContentPool(makeRandom());
    pool.addLines('greet', []);
    expect(pool.hasLines('greet')).toBe(false);
    expect(pool.size).toBe(0);
  });

  it('replaces existing pool', () => {
    const pool = new ContentPool(makeRandom([0]));
    pool.addLines('greet', ['Old']);
    pool.addLines('greet', ['New']);
    expect(pool.getRandomLine('greet')).toBe('New');
  });

  it('tracks size', () => {
    const pool = new ContentPool(makeRandom());
    expect(pool.size).toBe(0);
    pool.addLines('a', ['1']);
    pool.addLines('b', ['2']);
    expect(pool.size).toBe(2);
  });

  it('clear empties everything', () => {
    const pool = new ContentPool(makeRandom());
    pool.addLines('a', ['1']);
    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.hasLines('a')).toBe(false);
  });

  it('gossipKey generates correct format', () => {
    expect(ContentPool.gossipKey('loner')).toBe('remark_gossip:loner');
  });

  // -------------------------------------------------------------------------
  // Retry-cap (getRandomLine loop capped at 10 attempts)
  // -------------------------------------------------------------------------

  it('normal multi-item pool returns a valid line without hanging', () => {
    // Cycling through distinct values — loop exits on the first attempt every time.
    const pool = new ContentPool(makeRandom([0.0, 0.33, 0.66]));
    pool.addLines('lines', ['Line0', 'Line1', 'Line2']);

    for (let i = 0; i < 20; i++) {
      const result = pool.getRandomLine('lines');
      expect(['Line0', 'Line1', 'Line2']).toContain(result);
    }
  });

  it('pool of size 1 returns the only line immediately (bypass loop)', () => {
    // Single-item pools take the early-return path before the retry loop.
    const pool = new ContentPool(makeRandom([0.5]));
    pool.addLines('solo', ['Only']);

    expect(pool.getRandomLine('solo')).toBe('Only');
    // Calling again must still return the same item and never hang.
    expect(pool.getRandomLine('solo')).toBe('Only');
  });

  it('pool of size 2 with fixed RNG exits within cap and returns a line', () => {
    // RNG always returns 0.5 → Math.floor(0.5 * 2) = 1 → always idx 1.
    // After the first call cursor is set to 1; all subsequent calls hit the
    // same index every roll. The loop retries up to 10 times then exits,
    // returning pool[1] rather than hanging.
    const pool = new ContentPool(makeRandom([0.5]));
    pool.addLines('pair', ['Alpha', 'Beta']);

    // First call: no previous cursor, idx 1 accepted immediately.
    const first = pool.getRandomLine('pair');
    expect(first).toBe('Beta');

    // Second call: prev = 1, every roll returns 1 again → hits cap, still
    // returns 'Beta' (idx 1). Must complete without hanging.
    const second = pool.getRandomLine('pair');
    expect(second).toBe('Beta');

    // A third call behaves the same way — cap prevents infinite loop.
    const third = pool.getRandomLine('pair');
    expect(third).toBe('Beta');
  });
});

describe('loadSocialData', () => {
  const data: ISocialData = {
    greetings: {
      friendly: ['Привіт!'],
      neutral: ['Хм...'],
      evening: ['*позіхає*'],
    },
    remarks: {
      zone: ['Тихо...'],
      weather: ['Скоро викид'],
      gossip: {
        loner: ['Чув, Freedom знову...'],
        bandit: ['Є інфа...'],
      },
    },
    campfire: {
      stories: ['Був я якось...'],
      jokes: ['Заходить сталкер...'],
      reactions: {
        laughter: ['Ха-ха!'],
        story_react: ['Та ну!'],
        eating: ['*жує*'],
      },
    },
  };

  it('loads all categories', () => {
    const pool = new ContentPool(makeRandom());
    loadSocialData(pool, data);
    expect(pool.hasLines(SocialCategory.GREETING_FRIENDLY)).toBe(true);
    expect(pool.hasLines(SocialCategory.GREETING_NEUTRAL)).toBe(true);
    expect(pool.hasLines(SocialCategory.GREETING_EVENING)).toBe(true);
    expect(pool.hasLines(SocialCategory.REMARK_ZONE)).toBe(true);
    expect(pool.hasLines(SocialCategory.REMARK_WEATHER)).toBe(true);
    expect(pool.hasLines(ContentPool.gossipKey('loner'))).toBe(true);
    expect(pool.hasLines(ContentPool.gossipKey('bandit'))).toBe(true);
    expect(pool.hasLines(SocialCategory.CAMPFIRE_STORY)).toBe(true);
    expect(pool.hasLines(SocialCategory.CAMPFIRE_JOKE)).toBe(true);
    expect(pool.hasLines(SocialCategory.CAMPFIRE_LAUGHTER)).toBe(true);
    expect(pool.hasLines(SocialCategory.CAMPFIRE_STORY_REACT)).toBe(true);
    expect(pool.hasLines(SocialCategory.CAMPFIRE_EATING)).toBe(true);
  });

  it('returns correct content', () => {
    const pool = new ContentPool(makeRandom([0]));
    loadSocialData(pool, data);
    expect(pool.getRandomLine(SocialCategory.GREETING_FRIENDLY)).toBe('Привіт!');
  });

  it('loads custom content pools from ISocialData.custom', () => {
    const dataWithCustom: ISocialData = {
      ...data,
      custom: {
        greeting_drunk: ['*бурмотить*', 'Шо...?'],
        warning_anomaly: ['Обережно, аномалія!'],
      },
    };
    const pool = new ContentPool(makeRandom([0]));
    loadSocialData(pool, dataWithCustom);
    expect(pool.hasLines('greeting_drunk')).toBe(true);
    expect(pool.hasLines('warning_anomaly')).toBe(true);
    expect(pool.getRandomLine('greeting_drunk')).toBe('*бурмотить*');
    expect(pool.getRandomLine('warning_anomaly')).toBe('Обережно, аномалія!');
    // Standard categories still loaded
    expect(pool.hasLines(SocialCategory.GREETING_FRIENDLY)).toBe(true);
  });

  it('skips custom field when not provided', () => {
    const pool = new ContentPool(makeRandom([0]));
    loadSocialData(pool, data);
    // Only standard categories loaded — no custom key
    expect(pool.hasLines('greeting_drunk')).toBe(false);
  });
});
