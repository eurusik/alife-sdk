import { createDefaultConfig } from './ALifeConfig';

describe('createDefaultConfig', () => {
  it('returns complete config', () => {
    const config = createDefaultConfig();

    expect(config.tick).toBeDefined();
    expect(config.simulation).toBeDefined();
    expect(config.time).toBeDefined();
    expect(config.combat).toBeDefined();
    expect(config.morale).toBeDefined();
    expect(config.spawn).toBeDefined();
    expect(config.memory).toBeDefined();
    expect(config.surge).toBeDefined();
    expect(config.monster).toBeDefined();
    expect(config.trade).toBeDefined();
  });

  it('has correct tick defaults', () => {
    const config = createDefaultConfig();
    expect(config.tick.intervalMs).toBe(5_000);
    expect(config.tick.maxBrainUpdatesPerTick).toBe(20);
    expect(config.tick.maxCombatResolutionsPerTick).toBe(10);
    expect(config.tick.budgetWarningMs).toBe(50);
    expect(config.tick.redundancyCleanupInterval).toBe(3);
  });

  it('has correct simulation defaults', () => {
    const config = createDefaultConfig();
    expect(config.simulation.onlineRadius).toBe(600);
    expect(config.simulation.offlineRadius).toBe(800);
    expect(config.simulation.spatialGridCellSize).toBe(200);
  });

  it('offline radius > online radius (hysteresis)', () => {
    const config = createDefaultConfig();
    expect(config.simulation.offlineRadius).toBeGreaterThan(config.simulation.onlineRadius);
  });

  it('has correct time defaults', () => {
    const config = createDefaultConfig();
    expect(config.time.timeFactor).toBe(10);
    expect(config.time.startHour).toBe(8);
    expect(config.time.dayStartHour).toBe(6);
    expect(config.time.dayEndHour).toBe(21);
  });

  it('day starts before day ends', () => {
    const config = createDefaultConfig();
    expect(config.time.dayStartHour).toBeLessThan(config.time.dayEndHour);
  });

  it('has correct morale defaults', () => {
    const config = createDefaultConfig();
    expect(config.morale.hitPenalty).toBe(-0.15);
    expect(config.morale.shakenThreshold).toBe(-0.3);
    expect(config.morale.panicThreshold).toBe(-0.7);
    expect(config.morale.enemyKilledBonus).toBe(0.2);
  });

  it('panic threshold < shaken threshold', () => {
    const config = createDefaultConfig();
    expect(config.morale.panicThreshold).toBeLessThan(config.morale.shakenThreshold);
  });

  it('has correct monster defaults', () => {
    const config = createDefaultConfig();
    expect(config.monster.chargeWindupMs).toBe(600);
    expect(config.monster.chargeDamageMult).toBe(2);
    expect(config.monster.stalkAlphaInvisible).toBe(0.08);
    expect(config.monster.psiChannelMs).toBe(2_000);
  });

  it('has correct trade defaults', () => {
    const config = createDefaultConfig();
    expect(config.trade.allyDiscount).toBe(0.8);
    expect(config.trade.restockIntervalMs).toBe(300_000);
  });
});
