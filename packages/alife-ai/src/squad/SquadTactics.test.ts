import { describe, it, expect } from 'vitest';
import {
  evaluateSituation,
  SquadCommand,
  canApplyCommand,
  PROTECTED_STATES,
} from './SquadTactics';
import type { ISquadSituation } from './SquadTactics';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig().squad;

function makeSituation(overrides?: Partial<ISquadSituation>): ISquadSituation {
  return {
    squadSize: 4,
    enemyCount: 2,
    avgMorale: 0,
    leaderInCover: false,
    ...overrides,
  };
}

describe('evaluateSituation', () => {
  it('retreats on morale collapse', () => {
    const result = evaluateSituation(
      makeSituation({ avgMorale: -0.8 }),
      config,
    );
    expect(result).toBe(SquadCommand.RETREAT);
  });

  it('follows when no enemies', () => {
    const result = evaluateSituation(
      makeSituation({ enemyCount: 0 }),
      config,
    );
    expect(result).toBe(SquadCommand.FOLLOW);
  });

  it('retreats when badly outnumbered', () => {
    const result = evaluateSituation(
      makeSituation({ squadSize: 2, enemyCount: 5 }),
      config,
    );
    expect(result).toBe(SquadCommand.RETREAT);
  });

  it('holds when even fight', () => {
    const result = evaluateSituation(
      makeSituation({ squadSize: 3, enemyCount: 3 }),
      config,
    );
    expect(result).toBe(SquadCommand.HOLD);
  });

  it('attacks with numerical advantage', () => {
    const result = evaluateSituation(
      makeSituation({ squadSize: 4, enemyCount: 1 }),
      config,
    );
    expect(result).toBe(SquadCommand.ATTACK);
  });

  it('covers when leader in cover', () => {
    const result = evaluateSituation(
      makeSituation({ squadSize: 3, enemyCount: 2, leaderInCover: true }),
      config,
    );
    expect(result).toBe(SquadCommand.COVER_ME);
  });

  it('spreads out as default', () => {
    const result = evaluateSituation(
      makeSituation({ squadSize: 3, enemyCount: 2, leaderInCover: false }),
      config,
    );
    expect(result).toBe(SquadCommand.SPREAD_OUT);
  });

  it('morale collapse overrides all other factors', () => {
    const result = evaluateSituation(
      makeSituation({ avgMorale: -0.8, enemyCount: 0, squadSize: 10 }),
      config,
    );
    expect(result).toBe(SquadCommand.RETREAT);
  });

  it('no enemies overrides outnumbered', () => {
    const result = evaluateSituation(
      makeSituation({ enemyCount: 0, squadSize: 1 }),
      config,
    );
    expect(result).toBe(SquadCommand.FOLLOW);
  });
});

describe('canApplyCommand', () => {
  it('allows commands in normal states', () => {
    expect(canApplyCommand('IDLE')).toBe(true);
    expect(canApplyCommand('COMBAT')).toBe(true);
    expect(canApplyCommand('PATROL')).toBe(true);
  });

  it('blocks commands in protected states', () => {
    for (const state of PROTECTED_STATES) {
      expect(canApplyCommand(state)).toBe(false);
    }
  });
});
