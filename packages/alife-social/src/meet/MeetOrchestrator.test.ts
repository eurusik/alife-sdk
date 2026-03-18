import { describe, it, expect, beforeEach } from 'vitest';
import { MeetOrchestrator } from './MeetOrchestrator';
import type { IMeetUpdateContext } from './MeetOrchestrator';
import { ContentPool } from '../content/ContentPool';
import type { ISocialNPC } from '../types/ISocialTypes';
import type { IMeetConfig } from '../types/ISocialConfig';

const config: IMeetConfig = {
  meetDistance: 150,
  meetCooldownMs: 60_000,
  meetCheckIntervalMs: 500,
};

function makeRandom(values: number[] = [0.5]) {
  let idx = 0;
  return {
    next: () => values[idx++ % values.length],
    nextInt: (min: number, max: number) => min + Math.floor(values[idx++ % values.length] * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + values[idx++ % values.length] * (max - min),
  };
}

function makeNPC(id: string, x: number, y: number, factionId = 'loner', state = 'idle'): ISocialNPC {
  return { id, position: { x, y }, factionId, state };
}

const notHostile = () => false;
const notAlly = () => false;

function makeCtx(overrides: Partial<IMeetUpdateContext> & { npcs: readonly ISocialNPC[] }): IMeetUpdateContext {
  return {
    deltaMs: 600,
    targetX: 0,
    targetY: 0,
    currentTime: 1000,
    isHostile: notHostile,
    isAlly: notAlly,
    targetFactionId: 'loner',
    ...overrides,
  };
}

describe('MeetOrchestrator', () => {
  let pool: ContentPool;
  let orch: MeetOrchestrator;

  beforeEach(() => {
    pool = new ContentPool(makeRandom([0]));
    pool.addLines('greeting_neutral', ['Hello']);
    pool.addLines('greeting_friendly', ['Friend!']);
    pool.addLines('greeting_evening', ['Zzz...']);
    orch = new MeetOrchestrator(pool, makeRandom(), config);
  });

  it('emits no bubbles before check interval', () => {
    const result = orch.update(makeCtx({ deltaMs: 100, npcs: [makeNPC('a', 50, 0)] }));
    expect(result).toHaveLength(0);
  });

  it('emits bubble when check fires and NPC in range', () => {
    // NPC is 'military', target is 'loner', notAlly → greeting_neutral
    const result = orch.update(makeCtx({ npcs: [makeNPC('a', 50, 0, 'military')] }));
    expect(result).toHaveLength(1);
    expect(result[0].npcId).toBe('a');
    expect(result[0].text).toBe('Hello');
  });

  it('respects cooldown', () => {
    const npcs = [makeNPC('a', 50, 0)];
    orch.update(makeCtx({ npcs }));
    // Second check — cooldown not expired
    const result2 = orch.update(makeCtx({ npcs, currentTime: 1500 }));
    expect(result2).toHaveLength(0);
  });

  it('skips NPCs out of range', () => {
    const result = orch.update(makeCtx({ npcs: [makeNPC('a', 300, 0)] }));
    expect(result).toHaveLength(0);
  });

  it('skips hostile NPCs', () => {
    const result = orch.update(makeCtx({
      npcs: [makeNPC('a', 50, 0, 'bandit')],
      isHostile: () => true,
    }));
    expect(result).toHaveLength(0);
  });

  it('selects friendly greeting for allies', () => {
    const isAlly = (a: string, b: string) => a === b;
    const result = orch.update(makeCtx({
      npcs: [makeNPC('a', 50, 0, 'loner')],
      isAlly,
    }));
    expect(result[0].text).toBe('Friend!');
  });

  it('selects evening greeting for camping NPC', () => {
    const result = orch.update(makeCtx({ npcs: [makeNPC('a', 50, 0, 'loner', 'camp')] }));
    expect(result[0].text).toBe('Zzz...');
  });

  it('clear resets state', () => {
    const npcs = [makeNPC('a', 50, 0)];
    orch.update(makeCtx({ npcs }));
    orch.clear();
    // After clear, same NPC should be greetable again
    const result = orch.update(makeCtx({ npcs }));
    expect(result).toHaveLength(1);
  });

  it('bubbleDuration includes text length', () => {
    // 57 chars × 80ms = 4560ms > 2000ms minimum
    pool.addLines('greeting_neutral', ['A very long greeting message that should increase duration']);
    const orch2 = new MeetOrchestrator(pool, makeRandom(), config);
    const result = orch2.update(makeCtx({ npcs: [makeNPC('a', 50, 0, 'military')] }));
    expect(result[0].durationMs).toBeGreaterThan(2000);
  });

  // --- IRandom constructor injection fix ---

  describe('IRandom constructor injection', () => {
    it('two orchestrators with different IRandom instances select content independently', () => {
      // First random always returns 0.0 → selects index 0 in ContentPool.
      const randomA = makeRandom([0.0]);
      // Second random always returns 0.99 → selects last index in ContentPool.
      const randomB = makeRandom([0.99]);

      // Build separate pools seeded with the two randoms.
      const poolA = new ContentPool(randomA);
      poolA.addLines('greeting_neutral', ['Line A', 'Line B']);
      const poolB = new ContentPool(randomB);
      poolB.addLines('greeting_neutral', ['Line A', 'Line B']);

      const orchA = new MeetOrchestrator(poolA, randomA, config);
      const orchB = new MeetOrchestrator(poolB, randomB, config);

      const resultA = orchA.update(makeCtx({ npcs: [makeNPC('x', 50, 0, 'military')] }));
      const resultB = orchB.update(makeCtx({ npcs: [makeNPC('y', 50, 0, 'military')] }));

      // Both must produce a bubble, and the selected texts must differ
      // only because the injected IRandom instances differ.
      expect(resultA).toHaveLength(1);
      expect(resultB).toHaveLength(1);
      expect(resultA[0].text).not.toBe(resultB[0].text);
    });
  });
});
