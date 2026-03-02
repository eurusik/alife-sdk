/**
 * Integration tests: VocalizationTracker — multi-NPC cooldown pipeline.
 *
 * Tests the vocalization tracker in realistic usage scenarios with multiple
 * NPCs, custom configs, various vocalization types, and time-advancement
 * patterns that mirror the game loop.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VocalizationType,
  VocalizationTracker,
  createDefaultVocalizationConfig,
} from '../sound/VocalizationTypes';
import type { IVocalizationConfig } from '../sound/VocalizationTypes';

// ---------------------------------------------------------------------------
// Test helpers — no mocks, no vi.fn()
// ---------------------------------------------------------------------------

/** Build a VocalizationConfig with short predictable cooldowns for testing. */
function makeShortCooldownConfig(): IVocalizationConfig {
  const base = createDefaultVocalizationConfig();
  return {
    cooldowns: {
      ...base.cooldowns,
      // Override to short, round numbers for deterministic tests.
      [VocalizationType.COMBAT]: 1_000,
      [VocalizationType.ALERT]: 500,
      [VocalizationType.IDLE]: 2_000,
      [VocalizationType.WOUNDED]: 800,
      [VocalizationType.FLEE]: 600,
      [VocalizationType.SPOTTED_ENEMY]: 400,
      [VocalizationType.REMARK]: 300,
      [VocalizationType.KAMP_SOCIAL]: 200,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: simulate a simple NPC sound system that wraps a per-NPC tracker.
// ---------------------------------------------------------------------------

class NPCVocalizationSystem {
  // One tracker per NPC, keyed by npcId.
  private readonly trackers = new Map<string, VocalizationTracker>();
  private readonly config: IVocalizationConfig;

  // Records of successfully played vocalizations: [npcId, type, timeMs]
  readonly log: Array<[string, VocalizationType, number]> = [];

  constructor(config: IVocalizationConfig) {
    this.config = config;
  }

  private getTracker(npcId: string): VocalizationTracker {
    let t = this.trackers.get(npcId);
    if (t === undefined) {
      t = new VocalizationTracker(this.config);
      this.trackers.set(npcId, t);
    }
    return t;
  }

  /** Attempt to play a vocalization. Returns true if not blocked by cooldown. */
  tryPlay(npcId: string, type: VocalizationType, nowMs: number): boolean {
    const tracker = this.getTracker(npcId);
    if (!tracker.canPlay(type, nowMs)) return false;
    tracker.markPlayed(type, nowMs);
    this.log.push([npcId, type, nowMs]);
    return true;
  }

  /** Expose canPlay for direct assertions. */
  canPlay(npcId: string, type: VocalizationType, nowMs: number): boolean {
    return this.getTracker(npcId).canPlay(type, nowMs);
  }

  /** Reset the tracker for a specific NPC (e.g. on respawn). */
  resetNPC(npcId: string): void {
    this.getTracker(npcId).reset();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VocalizationTracker integration — multi-NPC cooldown pipeline', () => {
  const cfg = makeShortCooldownConfig();
  let system: NPCVocalizationSystem;

  beforeEach(() => {
    system = new NPCVocalizationSystem(cfg);
  });

  // -------------------------------------------------------------------------
  // 1. Fresh tracker: canPlay returns true when no cooldown recorded
  // -------------------------------------------------------------------------
  it('1. canPlay returns true for any type on a fresh tracker (no cooldown yet)', () => {
    // No markPlayed calls — every vocalization type should be immediately playable.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, 0)).toBe(true);
    expect(system.canPlay('npc_1', VocalizationType.ALERT, 0)).toBe(true);
    expect(system.canPlay('npc_1', VocalizationType.IDLE, 0)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. After markPlayed — same type blocked within cooldown window
  // -------------------------------------------------------------------------
  it('2. after markPlayed, canPlay returns false within the cooldown window', () => {
    const t0 = 5_000;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0); // records t0

    // 1ms after play — still inside the 1000ms COMBAT cooldown.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + 1)).toBe(false);
    // Halfway through — still blocked.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + 499)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Different vocalization types have independent cooldowns
  // -------------------------------------------------------------------------
  it('3. different vocalization types have independent cooldowns', () => {
    const t0 = 0;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0); // COMBAT cooldown = 1000ms

    // ALERT (500ms cooldown) is an independent slot — not affected.
    expect(system.canPlay('npc_1', VocalizationType.ALERT, t0)).toBe(true);
    // IDLE (2000ms cooldown) also independent.
    expect(system.canPlay('npc_1', VocalizationType.IDLE, t0)).toBe(true);

    system.tryPlay('npc_1', VocalizationType.ALERT, t0); // record ALERT at t0

    // COMBAT cooldown is still running; ALERT is now blocked; IDLE still free.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + 250)).toBe(false);
    expect(system.canPlay('npc_1', VocalizationType.ALERT, t0 + 250)).toBe(false);
    expect(system.canPlay('npc_1', VocalizationType.IDLE, t0 + 250)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. update(deltaMs) pattern — advancing game time reduces effective cooldown
  //    After the full cooldown has elapsed, the type becomes playable again.
  // -------------------------------------------------------------------------
  it('4. advancing time past the full cooldown allows the type to be played again', () => {
    const combatCooldown = cfg.cooldowns[VocalizationType.COMBAT]; // 1000ms
    const t0 = 10_000;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0);

    // Just before cooldown ends — blocked.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + combatCooldown - 1)).toBe(false);

    // Exactly at cooldown boundary — allowed (>= cooldown).
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + combatCooldown)).toBe(true);

    // One tick beyond — also allowed.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + combatCooldown + 16)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Two NPCs have completely independent cooldown tracking
  // -------------------------------------------------------------------------
  it('5. two NPCs track cooldowns independently', () => {
    const t0 = 0;
    // npc_1 plays SPOTTED_ENEMY.
    system.tryPlay('npc_1', VocalizationType.SPOTTED_ENEMY, t0);

    // npc_2 has its own tracker and has NOT played anything — should be free.
    expect(system.canPlay('npc_2', VocalizationType.SPOTTED_ENEMY, t0)).toBe(true);
    expect(system.canPlay('npc_2', VocalizationType.SPOTTED_ENEMY, t0 + 50)).toBe(true);

    // npc_1 is still in cooldown.
    expect(system.canPlay('npc_1', VocalizationType.SPOTTED_ENEMY, t0 + 100)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. Second markPlayed of same type resets / extends the timer
  // -------------------------------------------------------------------------
  it('6. a second markPlayed of same type resets the cooldown timer', () => {
    const t0 = 0;
    // First play at t0.
    system.tryPlay('npc_1', VocalizationType.REMARK, t0); // cooldown 300ms

    // At t=250ms, the original cooldown would almost be done.
    // But first we play it again AFTER cooldown expires.
    const t1 = t0 + 300; // exactly at first cooldown expiry
    expect(system.canPlay('npc_1', VocalizationType.REMARK, t1)).toBe(true);
    system.tryPlay('npc_1', VocalizationType.REMARK, t1); // second play resets timer

    // At t1 + 100 — now inside second cooldown window again.
    expect(system.canPlay('npc_1', VocalizationType.REMARK, t1 + 100)).toBe(false);

    // At t1 + 300 — second cooldown has elapsed.
    expect(system.canPlay('npc_1', VocalizationType.REMARK, t1 + 300)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. reset() clears all cooldowns — NPC can vocalize all types again
  // -------------------------------------------------------------------------
  it('7. reset() clears all type cooldowns for the NPC immediately', () => {
    const t0 = 0;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0);
    system.tryPlay('npc_1', VocalizationType.ALERT, t0);
    system.tryPlay('npc_1', VocalizationType.IDLE, t0);

    // All blocked right after playing.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + 10)).toBe(false);
    expect(system.canPlay('npc_1', VocalizationType.ALERT, t0 + 10)).toBe(false);
    expect(system.canPlay('npc_1', VocalizationType.IDLE, t0 + 10)).toBe(false);

    // Reset the NPC tracker.
    system.resetNPC('npc_1');

    // All three types are immediately available again.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + 10)).toBe(true);
    expect(system.canPlay('npc_1', VocalizationType.ALERT, t0 + 10)).toBe(true);
    expect(system.canPlay('npc_1', VocalizationType.IDLE, t0 + 10)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. DEATH type has cooldown = 0 — always playable even right after play
  // -------------------------------------------------------------------------
  it('8. DEATH has zero cooldown — always playable immediately after markPlayed', () => {
    const t0 = 1_000;
    system.tryPlay('npc_1', VocalizationType.DEATH, t0);

    // Should still be playable at the exact same timestamp.
    expect(system.canPlay('npc_1', VocalizationType.DEATH, t0)).toBe(true);
    // And at any subsequent time.
    expect(system.canPlay('npc_1', VocalizationType.DEATH, t0 + 1)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 9. Vocalization is logged (event-like emission) when successfully played
  // -------------------------------------------------------------------------
  it('9. successful tryPlay records an entry in the system log (event emission)', () => {
    const t0 = 2_000;
    const played = system.tryPlay('npc_1', VocalizationType.ALERT, t0);

    expect(played).toBe(true);
    expect(system.log.length).toBe(1);
    expect(system.log[0]).toEqual(['npc_1', VocalizationType.ALERT, t0]);
  });

  // -------------------------------------------------------------------------
  // 10. Blocked vocalization does NOT appear in the log
  // -------------------------------------------------------------------------
  it('10. blocked tryPlay (within cooldown) does NOT record a log entry', () => {
    const t0 = 0;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0);

    // Second attempt within cooldown window.
    const played = system.tryPlay('npc_1', VocalizationType.COMBAT, t0 + 100);

    expect(played).toBe(false);
    // Log should still contain only the first play.
    expect(system.log.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 11. Cooldown at 50% elapsed — type is still blocked
  // -------------------------------------------------------------------------
  it('11. at 50% of cooldown elapsed, the type is still blocked', () => {
    const combatCooldown = cfg.cooldowns[VocalizationType.COMBAT]; // 1000ms
    const t0 = 0;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0);

    // Exactly halfway through cooldown.
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + combatCooldown / 2)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 12. Cooldown at 101% elapsed — type is allowed
  // -------------------------------------------------------------------------
  it('12. at 101% of cooldown elapsed, the type is allowed again', () => {
    const combatCooldown = cfg.cooldowns[VocalizationType.COMBAT]; // 1000ms
    const t0 = 0;
    system.tryPlay('npc_1', VocalizationType.COMBAT, t0);

    const elapsed101Percent = Math.ceil(combatCooldown * 1.01);
    expect(system.canPlay('npc_1', VocalizationType.COMBAT, t0 + elapsed101Percent)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 13. Multiple NPCs all play the same type — only each NPC's own cooldown applies
  // -------------------------------------------------------------------------
  it('13. multiple NPCs each have isolated per-type cooldowns', () => {
    const t0 = 0;
    const npcs = ['npc_a', 'npc_b', 'npc_c'];

    // All three NPCs play WOUNDED at t0.
    for (const id of npcs) {
      expect(system.tryPlay(id, VocalizationType.WOUNDED, t0)).toBe(true);
    }

    // All are in cooldown at t0 + 1.
    for (const id of npcs) {
      expect(system.canPlay(id, VocalizationType.WOUNDED, t0 + 1)).toBe(false);
    }

    // npc_a resets; npc_b and npc_c remain blocked.
    system.resetNPC('npc_a');
    expect(system.canPlay('npc_a', VocalizationType.WOUNDED, t0 + 1)).toBe(true);
    expect(system.canPlay('npc_b', VocalizationType.WOUNDED, t0 + 1)).toBe(false);
    expect(system.canPlay('npc_c', VocalizationType.WOUNDED, t0 + 1)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 14. Full round-trip: play → block → expire → play again produces 2 log entries
  // -------------------------------------------------------------------------
  it('14. full round-trip: play -> blocked -> expired -> play again produces 2 log entries', () => {
    const cooldown = cfg.cooldowns[VocalizationType.FLEE]; // 600ms
    const t0 = 0;

    // First play.
    expect(system.tryPlay('npc_1', VocalizationType.FLEE, t0)).toBe(true);

    // Blocked attempt.
    expect(system.tryPlay('npc_1', VocalizationType.FLEE, t0 + 300)).toBe(false);

    // After cooldown expires.
    expect(system.tryPlay('npc_1', VocalizationType.FLEE, t0 + cooldown)).toBe(true);

    expect(system.log.length).toBe(2);
    expect(system.log[0]).toEqual(['npc_1', VocalizationType.FLEE, t0]);
    expect(system.log[1]).toEqual(['npc_1', VocalizationType.FLEE, t0 + cooldown]);
  });
});
