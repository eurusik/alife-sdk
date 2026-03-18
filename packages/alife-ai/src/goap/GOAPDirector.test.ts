// goap/GOAPDirector.test.ts
// Unit tests for GOAPDirector — the built-in GOAP-to-FSM bridge.
//
// The director is a stateless IOnlineStateHandler.  It stores its runtime
// data (plan, index, active action handler ID) inside ctx.state.custom using
// private keys.  Tests drive the director via the standard enter/update/exit
// lifecycle and observe side-effects on the mock context and mock handlers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GOAPDirector } from './GOAPDirector';
import type { IGOAPDirectorConfig, IGOAPActionHandler, IGOAPInterrupt } from './GOAPDirector';
import { GOAPPlanner } from '@alife-sdk/core';
import { WorldState } from '@alife-sdk/core';
import type { INPCContext } from '../states/INPCContext';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';

// ---------------------------------------------------------------------------
// Private custom-state key constants (must mirror GOAPDirector.ts)
// ---------------------------------------------------------------------------

const GOAP_PLAN_KEY    = '__goapPlan';
const GOAP_INDEX_KEY   = '__goapIndex';
const GOAP_HANDLER_KEY = '__goapActiveHandler';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal INPCContext stub with a real state bag.
 * The `transition` method is a spy so we can assert FSM transitions.
 */
function makeCtx(overrides: Partial<INPCContext> = {}): INPCContext {
  const state = createDefaultNPCOnlineState();
  return {
    npcId: 'npc-goap',
    factionId: 'test',
    entityType: 'human',
    x: 0,
    y: 0,
    state,
    perception: null,
    health: null,
    cover: null,
    danger: null,
    restrictedZones: null,
    squad: null,
    pack: null,
    conditions: null,
    suspicion: null,
    pathfinding: null,
    setVelocity: vi.fn(),
    halt: vi.fn(),
    setRotation: vi.fn(),
    setAlpha: vi.fn(),
    teleport: vi.fn(),
    disablePhysics: vi.fn(),
    emitShoot: vi.fn(),
    emitMeleeHit: vi.fn(),
    emitVocalization: vi.fn(),
    emitPsiAttackStart: vi.fn(),
    transition: vi.fn(),
    currentStateId: 'COMBAT',
    now: () => 0,
    random: () => 0.5,
    ...overrides,
  };
}

/** Build a mock IGOAPActionHandler with vi.fn() stubs. */
function makeActionHandler(
  defaultResult: 'running' | 'success' | 'failure' = 'running',
): IGOAPActionHandler & { _updateFn: ReturnType<typeof vi.fn> } {
  const updateFn = vi.fn().mockReturnValue(defaultResult);
  return {
    enter: vi.fn(),
    update: updateFn,
    exit: vi.fn(),
    _updateFn: updateFn,
  };
}

/**
 * Build a WorldState representing the unsatisfied world (goal not yet met)
 * and a goal that requires 'targetEliminated' = true.
 *
 * The planner will be able to route from currentState → goal using an
 * action that sets 'targetEliminated' = true.
 */
function makeGoal(): WorldState {
  const goal = new WorldState();
  goal.set('targetEliminated', true);
  return goal;
}

function makeCurrentWs(satisfied = false): WorldState {
  const ws = new WorldState();
  ws.set('targetEliminated', satisfied);
  return ws;
}

/**
 * Build a minimal GOAPPlanner pre-loaded with a single action that satisfies
 * the test goal.  Returns the planner and the action stub.
 */
function makePlanner(actionId: string): { planner: GOAPPlanner } {
  const planner = new GOAPPlanner();
  planner.registerAction({
    id: actionId,
    cost: 1,
    preconditions: {},
    effects: { targetEliminated: true },
  });
  return { planner };
}

// ---------------------------------------------------------------------------
// Helpers to read director state from ctx.state.custom
// ---------------------------------------------------------------------------

function getPlan(ctx: INPCContext): Array<{ id: string }> | undefined {
  return ctx.state.custom?.[GOAP_PLAN_KEY] as Array<{ id: string }> | undefined;
}

function getIndex(ctx: INPCContext): number | undefined {
  return ctx.state.custom?.[GOAP_INDEX_KEY] as number | undefined;
}

function getActiveHandlerId(ctx: INPCContext): string | undefined {
  return ctx.state.custom?.[GOAP_HANDLER_KEY] as string | undefined;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GOAPDirector', () => {
  let planner: GOAPPlanner;
  let goal: WorldState;
  let attackHandler: IGOAPActionHandler & { _updateFn: ReturnType<typeof vi.fn> };
  let config: IGOAPDirectorConfig;
  let director: GOAPDirector;
  let ctx: INPCContext;

  beforeEach(() => {
    goal = makeGoal();
    const setup = makePlanner('Attack');
    planner = setup.planner;

    attackHandler = makeActionHandler('running');

    config = {
      buildWorldState: () => makeCurrentWs(false), // goal NOT yet satisfied
      goal,
      actionHandlers: {
        Attack: attackHandler,
      },
    };

    director = new GOAPDirector(planner, config);
    ctx = makeCtx();
  });

  // -------------------------------------------------------------------------
  // Plan storage on enter()
  // -------------------------------------------------------------------------

  it('replans on enter() and stores plan in ctx.state.custom', () => {
    director.enter(ctx);

    const plan = getPlan(ctx);
    expect(plan).toBeDefined();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan!.length).toBeGreaterThan(0);
    expect(plan![0].id).toBe('Attack');
    expect(getIndex(ctx)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // First update() dispatches action handler
  // -------------------------------------------------------------------------

  it('dispatches first action handler on first update()', () => {
    director.enter(ctx);
    director.update(ctx, 16);

    // enter() on the action handler should have been called.
    expect(attackHandler.enter).toHaveBeenCalledOnce();
    // update() on the action handler should have been called.
    expect(attackHandler.update).toHaveBeenCalledOnce();
    expect(attackHandler._updateFn.mock.calls[0][0]).toBe(ctx);
  });

  // -------------------------------------------------------------------------
  // Advance to next action on success
  // -------------------------------------------------------------------------

  it('advances to next action when handler returns success', () => {
    // Register a second action so the director has somewhere to advance to.
    planner.registerAction({
      id: 'TakeCover',
      cost: 2,
      preconditions: {},
      effects: { targetEliminated: true },
    });

    // Inject a two-action plan directly so the order is deterministic.
    const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([
      { id: 'Attack' } as never,
      { id: 'TakeCover' } as never,
    ]);

    const coverHandler = makeActionHandler('running');
    config.actionHandlers['TakeCover'] = coverHandler;

    director.enter(ctx);

    // First update: attackHandler returns 'success' → should advance to TakeCover.
    attackHandler._updateFn.mockReturnValueOnce('success');
    director.update(ctx, 16);

    // attackHandler.exit() must have been called after success.
    expect(attackHandler.exit).toHaveBeenCalledOnce();
    // Index must have advanced to 1.
    expect(getIndex(ctx)).toBe(1);

    // Second update: TakeCover should now be the active handler.
    director.update(ctx, 16);
    expect(coverHandler.enter).toHaveBeenCalledOnce();
    expect(coverHandler.update).toHaveBeenCalledOnce();

    planSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Replan on handler failure
  // -------------------------------------------------------------------------

  it('replans when handler returns failure', () => {
    director.enter(ctx);

    // First update: attack fails → triggers replan.
    attackHandler._updateFn.mockReturnValueOnce('failure');
    director.update(ctx, 16);

    // exit() on the failing handler must have been called.
    expect(attackHandler.exit).toHaveBeenCalledOnce();

    // After replan the index resets to 0 and the plan is refreshed.
    expect(getIndex(ctx)).toBe(0);
    const plan = getPlan(ctx);
    expect(plan).toBeDefined();
    expect(plan!.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Interrupts
  // -------------------------------------------------------------------------

  it('checks interrupts before action execution', () => {
    const interrupt: IGOAPInterrupt = {
      condition: vi.fn().mockReturnValue(false),
      targetState: 'FLEE',
    };

    const configWithInterrupt: IGOAPDirectorConfig = {
      ...config,
      interrupts: [interrupt],
    };
    const directorWithInterrupt = new GOAPDirector(planner, configWithInterrupt);

    directorWithInterrupt.enter(ctx);
    directorWithInterrupt.update(ctx, 16);

    expect(interrupt.condition).toHaveBeenCalledWith(ctx);
    // Condition is false → no transition, action handler update proceeds.
    expect(ctx.transition).not.toHaveBeenCalled();
    expect(attackHandler.update).toHaveBeenCalledOnce();
  });

  it('interrupt transitions to targetState when condition is true', () => {
    const interrupt: IGOAPInterrupt = {
      condition: vi.fn().mockReturnValue(true),
      targetState: 'FLEE',
    };

    const configWithInterrupt: IGOAPDirectorConfig = {
      ...config,
      interrupts: [interrupt],
    };
    const directorWithInterrupt = new GOAPDirector(planner, configWithInterrupt);

    directorWithInterrupt.enter(ctx);
    directorWithInterrupt.update(ctx, 16);

    expect(ctx.transition).toHaveBeenCalledOnce();
    expect(ctx.transition).toHaveBeenCalledWith('FLEE');
  });

  it('calls exit on active action handler when interrupted', () => {
    // Trigger the interrupt on the SECOND update so the action handler has
    // had time to enter on the first update.
    const callCount = { value: 0 };
    const interrupt: IGOAPInterrupt = {
      condition: vi.fn().mockImplementation(() => {
        callCount.value++;
        return callCount.value >= 2; // false on tick 1, true on tick 2
      }),
      targetState: 'FLEE',
    };

    const configWithInterrupt: IGOAPDirectorConfig = {
      ...config,
      interrupts: [interrupt],
    };
    const directorWithInterrupt = new GOAPDirector(planner, configWithInterrupt);

    directorWithInterrupt.enter(ctx);
    directorWithInterrupt.update(ctx, 16); // tick 1 — interrupt false, handler entered
    directorWithInterrupt.update(ctx, 16); // tick 2 — interrupt true

    expect(attackHandler.exit).toHaveBeenCalledOnce();
    expect(ctx.transition).toHaveBeenCalledWith('FLEE');
  });

  // -------------------------------------------------------------------------
  // onNoPlan callback
  // -------------------------------------------------------------------------

  it('calls onNoPlan when plan is empty', () => {
    const onNoPlan = vi.fn();

    // Make the planner return an empty plan.
    const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([]);

    const configWithNoPlan: IGOAPDirectorConfig = {
      ...config,
      onNoPlan,
    };
    const directorWithNoPlan = new GOAPDirector(planner, configWithNoPlan);

    directorWithNoPlan.enter(ctx);
    directorWithNoPlan.update(ctx, 16);

    expect(onNoPlan).toHaveBeenCalledOnce();
    expect(onNoPlan).toHaveBeenCalledWith(ctx, 16);

    planSpy.mockRestore();
  });

  it('calls onNoPlan when plan is null (planner found no solution)', () => {
    const onNoPlan = vi.fn();

    // Planner returns null when no plan exists.
    const planSpy = vi.spyOn(planner, 'plan').mockReturnValue(null);

    const configWithNoPlan: IGOAPDirectorConfig = {
      ...config,
      onNoPlan,
    };
    const directorWithNoPlan = new GOAPDirector(planner, configWithNoPlan);

    directorWithNoPlan.enter(ctx);
    directorWithNoPlan.update(ctx, 16);

    expect(onNoPlan).toHaveBeenCalledOnce();

    planSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Skipping actions without registered handlers
  // -------------------------------------------------------------------------

  it('skips actions without registered handlers', () => {
    // Inject a plan whose first action has no handler, second does.
    const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([
      { id: 'UnknownAction' } as never,
      { id: 'Attack' } as never,
    ]);

    director.enter(ctx);

    // First update: UnknownAction has no handler — skip it and return.
    // The director calls _advanceAction() then returns immediately,
    // so the Attack handler is NOT entered yet on this tick.
    director.update(ctx, 16);
    expect(getIndex(ctx)).toBe(1);
    expect(attackHandler.enter).not.toHaveBeenCalled();

    // Second update: index is now 1 → Attack handler should enter and run.
    director.update(ctx, 16);
    expect(attackHandler.enter).toHaveBeenCalledOnce();
    expect(attackHandler.update).toHaveBeenCalledOnce();

    planSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Replan when plan is exhausted
  // -------------------------------------------------------------------------

  it('replans when plan is exhausted', () => {
    const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([
      { id: 'Attack' } as never,
    ]);

    director.enter(ctx);

    // Attack succeeds on first update → plan exhausted after advance.
    attackHandler._updateFn.mockReturnValueOnce('success');
    director.update(ctx, 16);

    // After exhausting the single-action plan the director calls _replan(),
    // resetting the index back to 0 and fetching a new plan.
    // plan() should have been called twice: once on enter(), once after exhaustion.
    expect(planner.plan).toHaveBeenCalledTimes(2);
    expect(getIndex(ctx)).toBe(0);

    planSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // exit() cleans up the active action handler
  // -------------------------------------------------------------------------

  it('exit() calls exit on the currently active action handler', () => {
    director.enter(ctx);
    director.update(ctx, 16); // enters attack handler

    director.exit(ctx);

    expect(attackHandler.exit).toHaveBeenCalledOnce();
  });

  it('exit() is a no-op when no action handler is active', () => {
    director.enter(ctx);
    // No update() — no action handler entered yet.

    // Should not throw.
    expect(() => director.exit(ctx)).not.toThrow();
    expect(attackHandler.exit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Goal already satisfied → empty plan → onNoPlan
  // -------------------------------------------------------------------------

  it('does not execute actions when the goal is already satisfied at entry', () => {
    const onNoPlan = vi.fn();

    const satisfiedConfig: IGOAPDirectorConfig = {
      ...config,
      // World state already satisfies the goal — planner returns [] or null.
      buildWorldState: () => makeCurrentWs(true),
      onNoPlan,
    };
    const satisfiedDirector = new GOAPDirector(planner, satisfiedConfig);

    satisfiedDirector.enter(ctx);
    satisfiedDirector.update(ctx, 16);

    // No action should have been started.
    expect(attackHandler.enter).not.toHaveBeenCalled();
    // onNoPlan receives the fallback call.
    expect(onNoPlan).toHaveBeenCalledOnce();
  });
});
