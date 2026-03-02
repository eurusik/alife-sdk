import { describe, it, expect } from 'vitest';
import { createDefaultOnlineOfflineConfig } from './IOnlineOfflineConfig';

describe('createDefaultOnlineOfflineConfig', () => {
  it('returns defaults with no overrides', () => {
    const config = createDefaultOnlineOfflineConfig();
    expect(config.switchDistance).toBe(700);
    expect(config.hysteresisFactor).toBe(0.15);
  });

  it('overrides switchDistance', () => {
    const config = createDefaultOnlineOfflineConfig({ switchDistance: 500 });
    expect(config.switchDistance).toBe(500);
    expect(config.hysteresisFactor).toBe(0.15);
  });

  it('overrides hysteresisFactor', () => {
    const config = createDefaultOnlineOfflineConfig({ hysteresisFactor: 0.3 });
    expect(config.switchDistance).toBe(700);
    expect(config.hysteresisFactor).toBe(0.3);
  });

  it('overrides both values', () => {
    const config = createDefaultOnlineOfflineConfig({
      switchDistance: 1000,
      hysteresisFactor: 0.2,
    });
    expect(config.switchDistance).toBe(1000);
    expect(config.hysteresisFactor).toBe(0.2);
  });
});
