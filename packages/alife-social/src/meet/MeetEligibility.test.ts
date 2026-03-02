import { describe, it, expect } from 'vitest';
import { isMeetEligible, selectGreetingCategory, DEFAULT_GREETING_STATE_MAP } from './MeetEligibility';
import type { IMeetEligibilityContext } from './MeetEligibility';
import type { ISocialNPC } from '../types/ISocialTypes';
import type { IMeetConfig } from '../types/ISocialConfig';

const config: IMeetConfig = {
  meetDistance: 150,
  meetCooldownMs: 60_000,
  meetCheckIntervalMs: 500,
};

function makeNPC(overrides?: Partial<ISocialNPC>): ISocialNPC {
  return {
    id: 'npc_1',
    position: { x: 100, y: 0 },
    factionId: 'loner',
    state: 'idle',
    ...overrides,
  };
}

const notHostile = () => false;
const alwaysHostile = () => true;

describe('isMeetEligible', () => {
  it('eligible when all conditions met', () => {
    expect(isMeetEligible(
      makeNPC(), { targetPos: { x: 0, y: 0 }, cooldowns: new Map(), currentTime: 0, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(true);
  });

  it('ineligible when too far', () => {
    expect(isMeetEligible(
      makeNPC({ position: { x: 200, y: 0 } }), { targetPos: { x: 0, y: 0 }, cooldowns: new Map(), currentTime: 0, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(false);
  });

  it('eligible at exact distance', () => {
    expect(isMeetEligible(
      makeNPC({ position: { x: 150, y: 0 } }), { targetPos: { x: 0, y: 0 }, cooldowns: new Map(), currentTime: 0, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(true);
  });

  it('ineligible during cooldown', () => {
    const cooldowns = new Map([['npc_1', 110_000]]); // expiry = lastMeet(50_000) + cooldown(60_000)
    expect(isMeetEligible(
      makeNPC(), { targetPos: { x: 0, y: 0 }, cooldowns, currentTime: 100_000, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(false);
  });

  it('eligible after cooldown expires', () => {
    const cooldowns = new Map([['npc_1', 0]]);
    expect(isMeetEligible(
      makeNPC(), { targetPos: { x: 0, y: 0 }, cooldowns, currentTime: 70_000, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(true);
  });

  it('ineligible when hostile', () => {
    expect(isMeetEligible(
      makeNPC({ factionId: 'bandit' }), { targetPos: { x: 0, y: 0 }, cooldowns: new Map(), currentTime: 0, isHostile: alwaysHostile, targetFactionId: 'loner' }, config,
    )).toBe(false);
  });

  it('ineligible when dead', () => {
    expect(isMeetEligible(
      makeNPC({ state: 'dead' }), { targetPos: { x: 0, y: 0 }, cooldowns: new Map(), currentTime: 0, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(false);
  });

  it('eligible with diagonal distance', () => {
    // Distance = sqrt(100² + 100²) ≈ 141 < 150
    expect(isMeetEligible(
      makeNPC({ position: { x: 100, y: 100 } }), { targetPos: { x: 0, y: 0 }, cooldowns: new Map(), currentTime: 0, isHostile: notHostile, targetFactionId: 'loner' }, config,
    )).toBe(true);
  });
});

describe('isMeetEligible — IMeetEligibilityContext object pattern', () => {
  it('accepts IMeetEligibilityContext object and returns boolean', () => {
    const context: IMeetEligibilityContext = {
      targetPos: { x: 100, y: 100 },
      cooldowns: new Map(),
      currentTime: 0,
      isHostile: () => false,
      targetFactionId: 'stalkers',
    };
    const npc = makeNPC({ position: { x: 100, y: 100 } });
    const result = isMeetEligible(npc, context, config);
    expect(typeof result).toBe('boolean');
  });

  it('IMeetEligibilityContext with non-empty cooldowns map blocks meet', () => {
    const npc = makeNPC({ id: 'npc_blocked' });
    const context: IMeetEligibilityContext = {
      targetPos: { x: 0, y: 0 },
      cooldowns: new Map([['npc_blocked', 70_000]]), // expiry = lastMeet(10_000) + cooldown(60_000)
      currentTime: 60_000,  // currentTime < expiry(70_000) → still in cooldown
      isHostile: () => false,
      targetFactionId: 'loner',
    };
    expect(isMeetEligible(npc, context, config)).toBe(false);
  });

  it('IMeetEligibilityContext with isHostile returning true blocks meet', () => {
    const npc = makeNPC({ factionId: 'bandit' });
    const context: IMeetEligibilityContext = {
      targetPos: { x: 0, y: 0 },
      cooldowns: new Map(),
      currentTime: 0,
      isHostile: (a, b) => a !== b,
      targetFactionId: 'loner',
    };
    expect(isMeetEligible(npc, context, config)).toBe(false);
  });

  it('IMeetEligibilityContext reused across multiple NPC checks', () => {
    const context: IMeetEligibilityContext = {
      targetPos: { x: 0, y: 0 },
      cooldowns: new Map(),
      currentTime: 0,
      isHostile: () => false,
      targetFactionId: 'stalkers',
    };

    const nearNpc = makeNPC({ id: 'near', position: { x: 50, y: 0 }, factionId: 'stalkers' });
    const farNpc = makeNPC({ id: 'far', position: { x: 500, y: 0 }, factionId: 'stalkers' });

    // Same context is reusable — pure function does not mutate the context.
    expect(isMeetEligible(nearNpc, context, config)).toBe(true);
    expect(isMeetEligible(farNpc, context, config)).toBe(false);
  });
});

describe('selectGreetingCategory', () => {
  const isAlly = (a: string, b: string) => a === b || (a === 'loner' && b === 'freedom');

  it('returns evening for camp state', () => {
    expect(selectGreetingCategory('camp', 'loner', 'loner', isAlly)).toBe('greeting_evening');
  });

  it('returns evening for sleep state', () => {
    expect(selectGreetingCategory('sleep', 'loner', 'loner', isAlly)).toBe('greeting_evening');
  });

  it('returns friendly for same faction', () => {
    expect(selectGreetingCategory('idle', 'loner', 'loner', isAlly)).toBe('greeting_friendly');
  });

  it('returns friendly for allied faction', () => {
    expect(selectGreetingCategory('idle', 'loner', 'freedom', isAlly)).toBe('greeting_friendly');
  });

  it('returns neutral for unrelated faction', () => {
    expect(selectGreetingCategory('idle', 'military', 'loner', isAlly)).toBe('greeting_neutral');
  });

  it('uses custom stateGreetingMap when provided', () => {
    const customMap = {
      guard: 'greeting_busy',
      wounded: 'greeting_pained',
    };
    expect(selectGreetingCategory('guard', 'loner', 'loner', isAlly, customMap)).toBe('greeting_busy');
    expect(selectGreetingCategory('wounded', 'loner', 'loner', isAlly, customMap)).toBe('greeting_pained');
    // States not in custom map fall through to faction logic
    expect(selectGreetingCategory('idle', 'loner', 'loner', isAlly, customMap)).toBe('greeting_friendly');
    // Default states (camp/sleep) not in custom map — no override
    expect(selectGreetingCategory('camp', 'loner', 'loner', isAlly, customMap)).toBe('greeting_friendly');
  });

  it('DEFAULT_GREETING_STATE_MAP matches original hardcoded behavior', () => {
    expect(DEFAULT_GREETING_STATE_MAP).toEqual({
      camp: 'greeting_evening',
      sleep: 'greeting_evening',
    });
  });
});
