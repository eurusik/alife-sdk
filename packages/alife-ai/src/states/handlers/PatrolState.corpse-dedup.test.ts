// states/handlers/PatrolState.corpse-dedup.test.ts
// Unit tests for the corpse-suspicion deduplication fix in PatrolState.
//
// The fix: INPCOnlineState.seenCorpseIds (Set<string> | undefined) tracks which
// corpse IDs have already contributed suspicion during the current PATROL entry.
// enter() clears the Set (sets it to undefined) so re-entries start fresh.
//
// Invariants tested:
//   1. First frame with a corpse → suspicion.add IS called
//   2. Second frame, same corpse ID → suspicion.add is NOT called (deduped)
//   3. Different corpse ID in a subsequent frame → suspicion.add IS called
//   4. Re-entering PATROL via enter() → same corpse triggers suspicion again
//   5. seenCorpseIds is undefined before the first corpse is seen (lazy init)
//   6. Multiple corpses in one frame → each triggers exactly one suspicion.add

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';
import { PatrolState } from './PatrolState';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type Corpse = { id: string; x: number; y: number };

interface MockCtxOptions {
  x?: number;
  y?: number;
  /** Corpses returned by perception.getVisibleCorpses(). Default: []. */
  corpses?: Corpse[];
  /** Target waypoint — non-zero so update() doesn't immediately transition. */
  waypointX?: number;
  waypointY?: number;
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const addCalls: Array<[string, number, number | undefined, number | undefined]> = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();

  // Place a waypoint far away so patrol movement logic runs, not an idle transition
  state.coverPointX = overrides.waypointX ?? 1000;
  state.coverPointY = overrides.waypointY ?? 1000;

  let corpses: Corpse[] = overrides.corpses ?? [];

  const ctx: INPCContext = {
    npcId:    'npc-patrol-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'PATROL',
    perception: {
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
      getVisibleCorpses: () => corpses,
    },
    health: null,
    setVelocity:        (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
    halt:               ()       => { calls.push('halt'); },
    setRotation:        (r)      => { calls.push(`rot:${r}`); },
    setAlpha:           (a)      => { calls.push(`alpha:${a}`); },
    teleport:           (x, y)   => { calls.push(`teleport:${x},${y}`); },
    disablePhysics:     ()       => { calls.push('disablePhysics'); },
    transition:         (s)      => { calls.push(`transition:${s}`); },
    emitShoot:          ()       => {},
    emitMeleeHit:       ()       => {},
    emitVocalization:   (t)      => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: ()       => {},
    cover: null, danger: null, restrictedZones: null,
    squad: null, pack: null, conditions: null,
    suspicion: {
      getLevel:             () => 0,
      hasReachedAlert:      () => false,
      getLastKnownPosition: () => null,
      clearPosition:        () => {},
      clear:                () => {},
      add: (stimulus, amount, x?, y?) => {
        addCalls.push([stimulus, amount, x, y]);
      },
    },
    now:    () => 0,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    /** All recorded suspicion.add() invocations as [stimulus, amount, x, y]. */
    addCalls,
    state,
    setCorpses: (c: Corpse[]) => { corpses = c; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PatrolState — corpse suspicion deduplication', () => {
  let cfg: IStateConfig;
  let handler: PatrolState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new PatrolState(cfg);
  });

  // ── 1. First frame with a corpse → suspicion.add IS called ────────────────

  describe('first-frame corpse', () => {
    it('calls suspicion.add once when a corpse is seen for the first time', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls).toHaveLength(1);
    });

    it('uses BODY_FOUND stimulus when calling suspicion.add', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls[0][0]).toBe('body_found');
    });

    it('passes the corpse world position to suspicion.add', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 333, y: 444 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls[0][2]).toBe(333);
      expect(addCalls[0][3]).toBe(444);
    });

    it('passes cfg.corpseFoundSuspicion as the amount', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls[0][1]).toBe(cfg.corpseFoundSuspicion);
    });
  });

  // ── 2. Second frame, same corpse → suspicion.add is NOT called ────────────

  describe('same-corpse deduplication across frames', () => {
    it('does not call suspicion.add on the second update with the same corpse', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16); // first frame — registered
      const countAfterFirstFrame = addCalls.length;
      handler.update(ctx, 16); // second frame — should be deduplicated
      expect(addCalls.length).toBe(countAfterFirstFrame);
    });

    it('does not call suspicion.add across many subsequent frames for the same corpse', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      for (let i = 0; i < 10; i++) {
        handler.update(ctx, 16);
      }
      // Only the very first update should have fired suspicion.add
      expect(addCalls).toHaveLength(1);
    });

    it('records the corpse id in seenCorpseIds after first frame', () => {
      const { ctx, state } = makeMockCtx({
        corpses: [{ id: 'corpse-42', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.seenCorpseIds?.has('corpse-42')).toBe(true);
    });
  });

  // ── 3. Different corpse ID → suspicion.add IS called ─────────────────────

  describe('different corpse triggers additional suspicion', () => {
    it('calls suspicion.add for a second distinct corpse even after the first was processed', () => {
      const corpse1: Corpse = { id: 'corpse-A', x: 100, y: 100 };
      const corpse2: Corpse = { id: 'corpse-B', x: 300, y: 300 };
      const { ctx, addCalls, setCorpses } = makeMockCtx({ corpses: [corpse1] });

      handler.enter(ctx);
      handler.update(ctx, 16); // frame 1 — corpse-A registered
      setCorpses([corpse2]);
      handler.update(ctx, 16); // frame 2 — corpse-B is new
      expect(addCalls).toHaveLength(2);
    });

    it('adds corpse-B with its own world position, not corpse-A position', () => {
      const corpse1: Corpse = { id: 'corpse-A', x: 111, y: 111 };
      const corpse2: Corpse = { id: 'corpse-B', x: 999, y: 888 };
      const { ctx, addCalls, setCorpses } = makeMockCtx({ corpses: [corpse1] });

      handler.enter(ctx);
      handler.update(ctx, 16);
      setCorpses([corpse2]);
      handler.update(ctx, 16);
      expect(addCalls[1][2]).toBe(999);
      expect(addCalls[1][3]).toBe(888);
    });

    it('does not re-fire suspicion for corpse-A when corpse-B arrives in the same frame', () => {
      const corpse1: Corpse = { id: 'corpse-A', x: 100, y: 100 };
      const corpse2: Corpse = { id: 'corpse-B', x: 300, y: 300 };
      const { ctx, addCalls, setCorpses } = makeMockCtx({ corpses: [corpse1] });

      handler.enter(ctx);
      handler.update(ctx, 16); // corpse-A added
      setCorpses([corpse1, corpse2]); // both visible
      handler.update(ctx, 16); // only corpse-B should fire
      expect(addCalls).toHaveLength(2);
      expect(addCalls[1][2]).toBe(corpse2.x);
    });
  });

  // ── 4. Re-entering PATROL — same corpse triggers suspicion again ──────────

  describe('re-entry via enter() resets deduplication', () => {
    it('calls suspicion.add again for a previously-seen corpse after enter() is called', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });

      // First PATROL entry
      handler.enter(ctx);
      handler.update(ctx, 16); // corpse-1 registered
      expect(addCalls).toHaveLength(1);

      // Simulate leaving and re-entering PATROL (e.g. PATROL→ALERT→PATROL cycle)
      handler.exit(ctx);
      handler.enter(ctx); // seenCorpseIds must be cleared here
      handler.update(ctx, 16); // corpse-1 is new again
      expect(addCalls).toHaveLength(2);
    });

    it('seenCorpseIds is undefined immediately after enter()', () => {
      const { ctx, state } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });

      handler.enter(ctx);
      handler.update(ctx, 16); // populates seenCorpseIds

      // Re-enter — Set should be cleared
      handler.exit(ctx);
      handler.enter(ctx);
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('fires suspicion.add the correct total number of times across two PATROL entries', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });

      handler.enter(ctx);
      handler.update(ctx, 16); // +1
      handler.update(ctx, 16); // deduped
      handler.update(ctx, 16); // deduped

      handler.exit(ctx);
      handler.enter(ctx);
      handler.update(ctx, 16); // +1 after reset
      handler.update(ctx, 16); // deduped

      // Total: exactly 2 calls (once per PATROL entry)
      expect(addCalls).toHaveLength(2);
    });
  });

  // ── 5. seenCorpseIds is undefined initially (lazy init) ───────────────────

  describe('seenCorpseIds lazy initialisation', () => {
    it('seenCorpseIds is undefined on a fresh INPCOnlineState before any PATROL entry', () => {
      const state = createDefaultNPCOnlineState();
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('seenCorpseIds remains undefined after enter() when no corpses have been seen yet', () => {
      const { ctx, state } = makeMockCtx({ corpses: [] });
      handler.enter(ctx);
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('seenCorpseIds is undefined after enter() even when a previous PATROL entry populated it', () => {
      const { ctx, state } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16); // creates and populates seenCorpseIds
      expect(state.seenCorpseIds).toBeDefined();

      handler.exit(ctx);
      handler.enter(ctx); // must clear it back to undefined
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('seenCorpseIds is created (not undefined) after first corpse is seen in update()', () => {
      const { ctx, state } = makeMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      expect(state.seenCorpseIds).toBeUndefined(); // before any update
      handler.update(ctx, 16);
      expect(state.seenCorpseIds).toBeInstanceOf(Set);
    });

    it('seenCorpseIds stays undefined across multiple updates when no corpses are visible', () => {
      const { ctx, state } = makeMockCtx({ corpses: [] });
      handler.enter(ctx);
      handler.update(ctx, 16);
      handler.update(ctx, 16);
      handler.update(ctx, 16);
      expect(state.seenCorpseIds).toBeUndefined();
    });
  });

  // ── 6. Multiple corpses in one frame — each processed exactly once ─────────

  describe('multiple corpses in a single frame', () => {
    it('calls suspicion.add once per unique corpse when multiple corpses are visible simultaneously', () => {
      const corpses: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, addCalls } = makeMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls).toHaveLength(3);
    });

    it('does not double-fire for any corpse when the same multi-corpse list is seen again next frame', () => {
      const corpses: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, addCalls } = makeMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16); // all 3 registered
      handler.update(ctx, 16); // all 3 deduped
      handler.update(ctx, 16); // all 3 deduped
      expect(addCalls).toHaveLength(3);
    });

    it('all three corpse IDs are stored in seenCorpseIds after one frame', () => {
      const corpses: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, state } = makeMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.seenCorpseIds?.has('c1')).toBe(true);
      expect(state.seenCorpseIds?.has('c2')).toBe(true);
      expect(state.seenCorpseIds?.has('c3')).toBe(true);
    });

    it('fires suspicion.add for the correct positions of each corpse in multi-corpse frame', () => {
      const corpses: Corpse[] = [
        { id: 'cA', x: 111, y: 222 },
        { id: 'cB', x: 333, y: 444 },
      ];
      const { ctx, addCalls } = makeMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16);
      const positions = addCalls.map(([, , x, y]) => ({ x, y }));
      expect(positions).toContainEqual({ x: 111, y: 222 });
      expect(positions).toContainEqual({ x: 333, y: 444 });
    });

    it('after re-entry, a 4th new corpse added alongside existing 3 fires only once for the new one', () => {
      const initial: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, addCalls, setCorpses } = makeMockCtx({ corpses: initial });
      handler.enter(ctx);
      handler.update(ctx, 16); // 3 fires

      // Re-enter: all IDs are cleared
      handler.exit(ctx);
      handler.enter(ctx);

      // Now 4 corpses visible: original 3 + a new one
      setCorpses([...initial, { id: 'c4', x: 400, y: 400 }]);
      handler.update(ctx, 16); // 4 fires (reset → all are new)
      expect(addCalls).toHaveLength(7); // 3 + 4
    });
  });

  // ── Additional guards: suspicion null / getVisibleCorpses absent ──────────

  describe('opt-in guards', () => {
    it('does not throw when ctx.suspicion is null', () => {
      const { ctx } = makeMockCtx({
        corpses: [{ id: 'c1', x: 100, y: 100 }],
      });
      (ctx as unknown as Record<string, unknown>).suspicion = null;
      handler.enter(ctx);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });

    it('does not throw when perception.getVisibleCorpses is absent', () => {
      const { ctx } = makeMockCtx();
      (ctx as unknown as Record<string, unknown>).perception = {
        getVisibleEnemies: () => [],
        getVisibleAllies:  () => [],
        getNearbyItems:    () => [],
        hasVisibleEnemy:   () => false,
        // getVisibleCorpses intentionally omitted
      };
      handler.enter(ctx);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });

    it('does not call suspicion.add when ctx.suspicion is null, even with visible corpses', () => {
      const { ctx, addCalls } = makeMockCtx({
        corpses: [{ id: 'c1', x: 100, y: 100 }],
      });
      (ctx as unknown as Record<string, unknown>).suspicion = null;
      handler.enter(ctx);
      handler.update(ctx, 16);
      // addCalls array belongs to the mock suspicion which is now replaced — confirm
      // no unexpected add reached the original mock (it was replaced; test is about no-throw)
      expect(addCalls).toHaveLength(0);
    });

    it('does not populate seenCorpseIds when ctx.suspicion is null', () => {
      const { ctx, state } = makeMockCtx({
        corpses: [{ id: 'c1', x: 100, y: 100 }],
      });
      (ctx as unknown as Record<string, unknown>).suspicion = null;
      handler.enter(ctx);
      handler.update(ctx, 16);
      // seenCorpseIds block is guarded by ctx.suspicion — Set must stay undefined
      expect(state.seenCorpseIds).toBeUndefined();
    });
  });
});
