import { createDefaultSimulationConfig } from './ISimulationConfig';

describe('createDefaultSimulationConfig', () => {
  it('returns complete config with no overrides', () => {
    const config = createDefaultSimulationConfig();

    expect(config.terrainState).toBeDefined();
    expect(config.brain).toBeDefined();
    expect(config.terrainSelector).toBeDefined();
    expect(config.jobScoring).toBeDefined();
    expect(config.offlineCombat).toBeDefined();
    expect(config.surge).toBeDefined();
    expect(config.goodwill).toBeDefined();
  });

  it('has correct terrainState defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.terrainState.combatDecayMs).toBe(30_000);
    expect(config.terrainState.alertDecayMs).toBe(15_000);
  });

  it('has correct brain defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.brain.searchIntervalMs).toBe(5_000);
    expect(config.brain.schemeCheckIntervalMs).toBe(3_000);
    expect(config.brain.moraleFleeThreshold).toBe(-0.5);
    expect(config.brain.reEvaluateIntervalMs).toBe(30_000);
    expect(config.brain.dangerTolerance).toBe(3);
  });

  it('has correct terrainSelector defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.terrainSelector.surgeMultiplier).toBe(3.0);
    expect(config.terrainSelector.squadLeaderBonus).toBe(20);
    expect(config.terrainSelector.moraleDangerPenalty).toBe(15);
  });

  it('has correct jobScoring defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.jobScoring.rankBonus).toBe(5);
    expect(config.jobScoring.distancePenalty).toBe(0.01);
  });

  it('has correct offlineCombat defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.offlineCombat.maxResolutionsPerTick).toBe(10);
    expect(config.offlineCombat.detectionProbability).toBe(70);
    expect(config.offlineCombat.victoryBase).toBe(0.5);
    expect(config.offlineCombat.powerJitterMin).toBe(0.5);
    expect(config.offlineCombat.powerJitterMax).toBe(1.5);
    expect(config.offlineCombat.victoryProbMin).toBe(0.05);
    expect(config.offlineCombat.victoryProbMax).toBe(0.95);
    expect(config.offlineCombat.maxSizeAdvantage).toBe(2.0);
  });

  it('has correct surge defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.surge.intervalMinMs).toBeLessThan(config.surge.intervalMaxMs);
    expect(config.surge.warningDurationMs).toBe(30_000);
    expect(config.surge.activeDurationMs).toBe(30_000);
    expect(config.surge.damagePerTick).toBe(25);
  });

  it('has correct goodwill defaults', () => {
    const config = createDefaultSimulationConfig();
    expect(config.goodwill.killPenalty).toBe(-20);
    expect(config.goodwill.killEnemyBonus).toBe(5);
    expect(config.goodwill.tradeBonus).toBe(3);
    expect(config.goodwill.questBonus).toBe(15);
    expect(config.goodwill.decayRatePerHour).toBe(0.5);
  });

  it('merges partial terrainState overrides', () => {
    const config = createDefaultSimulationConfig({
      terrainState: { combatDecayMs: 60_000 },
    });
    expect(config.terrainState.combatDecayMs).toBe(60_000);
    expect(config.terrainState.alertDecayMs).toBe(15_000); // preserved
  });

  it('merges partial brain overrides', () => {
    const config = createDefaultSimulationConfig({
      brain: { dangerTolerance: 5 },
    });
    expect(config.brain.dangerTolerance).toBe(5);
    expect(config.brain.searchIntervalMs).toBe(5_000); // preserved
  });

  it('merges partial offlineCombat overrides', () => {
    const config = createDefaultSimulationConfig({
      offlineCombat: { detectionProbability: 90 },
    });
    expect(config.offlineCombat.detectionProbability).toBe(90);
    expect(config.offlineCombat.victoryBase).toBe(0.5); // preserved
  });

  it('merges partial goodwill overrides', () => {
    const config = createDefaultSimulationConfig({
      goodwill: { killPenalty: -50 },
    });
    expect(config.goodwill.killPenalty).toBe(-50);
    expect(config.goodwill.tradeBonus).toBe(3); // preserved
  });

  it('merges multiple sections simultaneously', () => {
    const config = createDefaultSimulationConfig({
      brain: { dangerTolerance: 10 },
      surge: { damagePerTick: 50 },
    });
    expect(config.brain.dangerTolerance).toBe(10);
    expect(config.surge.damagePerTick).toBe(50);
    expect(config.terrainState.combatDecayMs).toBe(30_000); // untouched
  });
});
