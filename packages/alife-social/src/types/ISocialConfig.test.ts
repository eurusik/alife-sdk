import { createDefaultSocialConfig } from './ISocialConfig';

describe('createDefaultSocialConfig', () => {
  it('returns complete config with no overrides', () => {
    const config = createDefaultSocialConfig();

    expect(config.meet).toBeDefined();
    expect(config.remark).toBeDefined();
    expect(config.campfire).toBeDefined();
  });

  it('has sensible meet defaults', () => {
    const config = createDefaultSocialConfig();
    expect(config.meet.meetDistance).toBe(150);
    expect(config.meet.meetCooldownMs).toBe(60_000);
    expect(config.meet.meetCheckIntervalMs).toBe(500);
  });

  it('has sensible remark defaults', () => {
    const config = createDefaultSocialConfig();
    expect(config.remark.remarkCooldownMinMs).toBe(30_000);
    expect(config.remark.remarkCooldownMaxMs).toBe(60_000);
    expect(config.remark.remarkChance).toBe(0.3);
    expect(config.remark.weightZone).toBe(0.4);
    expect(config.remark.weightWeatherCumulative).toBe(0.7);
  });

  it('has sensible campfire defaults', () => {
    const config = createDefaultSocialConfig();
    expect(config.campfire.minParticipants).toBe(2);
    expect(config.campfire.eatingChance).toBe(0.6);
    expect(config.campfire.weightStory).toBe(0.35);
    expect(config.campfire.weightJokeCumulative).toBe(0.65);
  });

  it('merges partial meet overrides', () => {
    const config = createDefaultSocialConfig({
      meet: { meetDistance: 200 },
    });
    expect(config.meet.meetDistance).toBe(200);
    expect(config.meet.meetCooldownMs).toBe(60_000); // preserved
  });

  it('merges partial remark overrides', () => {
    const config = createDefaultSocialConfig({
      remark: { remarkChance: 0.5 },
    });
    expect(config.remark.remarkChance).toBe(0.5);
    expect(config.remark.remarkCooldownMinMs).toBe(30_000); // preserved
  });

  it('merges partial campfire overrides', () => {
    const config = createDefaultSocialConfig({
      campfire: { minParticipants: 3 },
    });
    expect(config.campfire.minParticipants).toBe(3);
    expect(config.campfire.syncIntervalMs).toBe(3_000); // preserved
  });

});
