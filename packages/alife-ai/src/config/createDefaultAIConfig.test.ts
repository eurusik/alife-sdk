import { createDefaultAIConfig } from './createDefaultAIConfig';

describe('createDefaultAIConfig', () => {
  it('returns a complete config with no overrides', () => {
    const config = createDefaultAIConfig();

    expect(config.cover).toBeDefined();
    expect(config.navigation).toBeDefined();
    expect(config.weapon).toBeDefined();
    expect(config.squad).toBeDefined();
    expect(config.monsterAbility).toBeDefined();
    expect(config.perception).toBeDefined();
    expect(config.goap).toBeDefined();
  });

  it('has sensible cover defaults', () => {
    const config = createDefaultAIConfig();
    expect(config.cover.searchRadius).toBe(400);
    expect(config.cover.pointRadius).toBe(24);
    expect(config.cover.loopholeMaxPerCover).toBe(3);
  });

  it('has sensible navigation defaults', () => {
    const config = createDefaultAIConfig();
    expect(config.navigation.arrivalThreshold).toBe(8);
    expect(config.navigation.smoothPointsPerSegment).toBe(8);
  });

  it('has weapon definitions for all categories', () => {
    const config = createDefaultAIConfig();
    expect(Object.keys(config.weapon.weapons)).toHaveLength(6);
    expect(config.weapon.shotgunEffectiveMax).toBe(150);
    expect(config.weapon.rifleEffectiveMin).toBe(100);
    expect(config.weapon.sniperEffectiveMin).toBe(300);
  });

  it('has GOAP defaults', () => {
    const config = createDefaultAIConfig();
    expect(config.goap.replanIntervalMs).toBe(5000);
    expect(config.goap.eliteRankThreshold).toBe(5);
  });

  it('merges partial cover overrides', () => {
    const config = createDefaultAIConfig({
      cover: { searchRadius: 500 },
    });
    expect(config.cover.searchRadius).toBe(500);
    expect(config.cover.pointRadius).toBe(24); // default preserved
  });

  it('merges partial navigation overrides', () => {
    const config = createDefaultAIConfig({
      navigation: { arrivalThreshold: 12 },
    });
    expect(config.navigation.arrivalThreshold).toBe(12);
    expect(config.navigation.smoothPointsPerSegment).toBe(8); // default preserved
  });

  it('merges partial weapon overrides', () => {
    const config = createDefaultAIConfig({
      weapon: { shotgunEffectiveMax: 200 },
    });
    expect(config.weapon.shotgunEffectiveMax).toBe(200);
    expect(config.weapon.rifleEffectiveMin).toBe(100); // default preserved
  });

  it('merges partial squad overrides', () => {
    const config = createDefaultAIConfig({
      squad: { outnumberRatio: 2.0 },
    });
    expect(config.squad.outnumberRatio).toBe(2.0);
    expect(config.squad.nearbyRadius).toBe(200);
  });

  it('merges partial monsterAbility overrides', () => {
    const config = createDefaultAIConfig({
      monsterAbility: { chargeWindupMs: 800 },
    });
    expect(config.monsterAbility.chargeWindupMs).toBe(800);
    expect(config.monsterAbility.leapAirtimeMs).toBe(350);
  });

  it('merges partial perception overrides', () => {
    const config = createDefaultAIConfig({
      perception: { visionRange: 500 },
    });
    expect(config.perception.visionRange).toBe(500);
    expect(config.perception.hearingRange).toBe(500);
  });

  it('merges partial goap overrides', () => {
    const config = createDefaultAIConfig({
      goap: { maxPlanDepth: 20 },
    });
    expect(config.goap.maxPlanDepth).toBe(20);
    expect(config.goap.replanIntervalMs).toBe(5000);
  });
});
