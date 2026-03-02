import { describe, it, expect } from 'vitest';
import {
  VocalizationType,
  VocalizationTracker,
  createDefaultVocalizationConfig,
} from './VocalizationTypes';

const config = createDefaultVocalizationConfig();

describe('VocalizationTracker', () => {
  it('allows first play of any type', () => {
    const tracker = new VocalizationTracker(config);
    expect(tracker.canPlay(VocalizationType.COMBAT, 0)).toBe(true);
    expect(tracker.canPlay(VocalizationType.IDLE, 0)).toBe(true);
  });

  it('blocks play within cooldown', () => {
    const tracker = new VocalizationTracker(config);
    tracker.markPlayed(VocalizationType.COMBAT, 1000);
    expect(tracker.canPlay(VocalizationType.COMBAT, 2000)).toBe(false);
  });

  it('allows play after cooldown expires', () => {
    const tracker = new VocalizationTracker(config);
    tracker.markPlayed(VocalizationType.COMBAT, 1000);
    const cooldown = config.cooldowns[VocalizationType.COMBAT];
    expect(tracker.canPlay(VocalizationType.COMBAT, 1000 + cooldown)).toBe(true);
  });

  it('tracks types independently', () => {
    const tracker = new VocalizationTracker(config);
    tracker.markPlayed(VocalizationType.COMBAT, 1000);
    expect(tracker.canPlay(VocalizationType.ALERT, 1000)).toBe(true);
  });

  it('death has zero cooldown (always playable)', () => {
    const tracker = new VocalizationTracker(config);
    tracker.markPlayed(VocalizationType.DEATH, 0);
    expect(tracker.canPlay(VocalizationType.DEATH, 0)).toBe(true);
  });

  it('reset clears all cooldowns', () => {
    const tracker = new VocalizationTracker(config);
    tracker.markPlayed(VocalizationType.COMBAT, 1000);
    tracker.markPlayed(VocalizationType.ALERT, 1000);
    tracker.reset();
    expect(tracker.canPlay(VocalizationType.COMBAT, 1000)).toBe(true);
    expect(tracker.canPlay(VocalizationType.ALERT, 1000)).toBe(true);
  });
});

describe('createDefaultVocalizationConfig', () => {
  it('has cooldowns for all vocalization types', () => {
    const cfg = createDefaultVocalizationConfig();
    for (const type of Object.values(VocalizationType)) {
      expect(cfg.cooldowns[type]).toBeDefined();
      expect(typeof cfg.cooldowns[type]).toBe('number');
    }
  });

  it('death cooldown is 0', () => {
    expect(config.cooldowns[VocalizationType.DEATH]).toBe(0);
  });

  it('combat cooldown is positive', () => {
    expect(config.cooldowns[VocalizationType.COMBAT]).toBeGreaterThan(0);
  });
});
