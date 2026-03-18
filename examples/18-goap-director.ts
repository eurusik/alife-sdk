/**
 * 18-goap-director.ts
 *
 * Teaching example: GOAPDirector step by step.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/18-goap-director.ts
 *
 * What we build here:
 *   - Phase 1: Minimal GOAPDirector — 1 NPC, 2 actions, plan executes
 *   - Phase 2: Action handler return values — running / success / failure
 *   - Phase 3: Interrupts — morale panic preempts action execution
 *   - Phase 4: Dynamic replanning — world state changes → different plan
 *   - Phase 5: state.custom — sharing data between action handlers
 *
 * Architecture:
 *   GOAPDirector is a built-in IOnlineStateHandler that bridges GOAPPlanner
 *   with the FSM. Register it as the COMBAT handler. When an NPC enters
 *   COMBAT the director replans, then executes actions one by one via your
 *   IGOAPActionHandler implementations. The planner decides WHAT to do;
 *   the handlers execute HOW.
 *
 * Key design:
 *   - GOAPPlanner lives in @alife-sdk/core (A* search over WorldState)
 *   - GOAPDirector lives in @alife-sdk/ai (FSM integration layer)
 *   - Action handlers are stateless — per-NPC data goes in ctx.state.custom
 *   - Interrupts are checked every tick before action execution
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// OnlineAIDriver — per-NPC FSM coordinator.
// NPCPerception — host-side snapshot; call sync() each frame before update().
// createDefaultNPCOnlineState — factory for the mutable per-NPC data bag.
// buildDefaultHandlerMap — 14-state set for human NPCs.
// ONLINE_STATE — canonical state ID constants (e.g. ONLINE_STATE.IDLE, ONLINE_STATE.COMBAT).
import type {
  IOnlineDriverHost,
  INPCHealth,
  ICoverAccess,
  IDangerAccess,
  IRestrictedZoneAccess,
  ISquadAccess,
  IPackAccess,
  IConditionAccess,
  ISuspicionAccess,
  IShootPayload,
  IMeleeHitPayload,
  IPathfindingAccess,
} from '@alife-sdk/ai/states';
import {
  OnlineAIDriver,
  NPCPerception,
  createDefaultNPCOnlineState,
  buildDefaultHandlerMap,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';

// GOAPDirector — the built-in state handler that bridges GOAP planning with FSM.
// IGOAPActionHandler — the interface your action handlers must implement.
import { GOAPDirector } from '@alife-sdk/ai/goap';
import type { IGOAPActionHandler } from '@alife-sdk/ai/goap';

// GOAPPlanner — A*-based planner that finds optimal action sequences.
// WorldState — key-value map of planning properties (boolean | number | string).
import { GOAPPlanner, WorldState } from '@alife-sdk/core/ai';

// ---------------------------------------------------------------------------
// SimpleNPCHost — minimal IOnlineDriverHost for Node.js
//
// Identical to example 15. In a Phaser game you replace this with
// PhaserNPCContext which delegates to the game engine's physics body,
// health component, and animation system.
// ---------------------------------------------------------------------------

class SimpleNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  readonly npcId: string;
  readonly factionId: string;
  readonly entityType: string;

  x: number;
  y: number;

  cover:           ICoverAccess          | null = null;
  danger:          IDangerAccess         | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;
  squad:           ISquadAccess          | null = null;
  pack:            IPackAccess           | null = null;
  conditions:      IConditionAccess      | null = null;
  suspicion:       ISuspicionAccess      | null = null;
  pathfinding:     IPathfindingAccess    | null = null;

  readonly shoots:        IShootPayload[] = [];
  readonly vocalizations: string[]         = [];

  private _hp    = 100;
  private _maxHp = 100;
  private _nowMs = 0;

  constructor(id: string, faction: string, type: string, x = 100, y = 100) {
    this.npcId      = id;
    this.factionId  = faction;
    this.entityType = type;
    this.x          = x;
    this.y          = y;
  }

  get health(): INPCHealth {
    return {
      hp:        this._hp,
      maxHp:     this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  setVelocity(vx: number, vy: number): void { this.x += vx * 0.016; this.y += vy * 0.016; }
  halt(): void { /* stop physics body */ }
  setRotation(_r: number): void { /* set sprite rotation */ }
  setAlpha(_a: number): void { /* set sprite alpha */ }
  teleport(px: number, py: number): void { this.x = px; this.y = py; }
  disablePhysics(): void { /* disable body on death */ }

  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void { /* apply damage */ }
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void { /* PSI VFX */ }

  now(): number { return this._nowMs; }
  random(): number { return 0.5; }

  tick(driver: OnlineAIDriver, deltaMs: number): void {
    this._nowMs += deltaMs;
    driver.update(deltaMs);
  }

  setHp(hp: number): void { this._hp = Math.max(0, hp); }
}

// ---------------------------------------------------------------------------
// Phase 1: Minimal GOAPDirector
//
// GOAPDirector is a built-in state handler that bridges GOAPPlanner with
// the FSM. Register it as the COMBAT handler — when an NPC enters COMBAT,
// the director:
//   1. Builds a WorldState snapshot from the NPC's current situation
//   2. Calls planner.plan(worldState, goal) to get an action sequence
//   3. Executes each action via your IGOAPActionHandler enter/update/exit
//   4. Advances to the next action on 'success', replans on 'failure'
//
// This is the core integration pattern — 4 lines:
//   const director = new GOAPDirector(planner, config);
//   const handlers = buildDefaultHandlerMap()
//     .register(ONLINE_STATE.COMBAT, director);
//   const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);
// ---------------------------------------------------------------------------

console.log('=== Phase 1: Minimal GOAPDirector ===');
console.log('');

// Step 1: Create a GOAPPlanner and register actions.
// Each action has preconditions (what must be true to start) and effects
// (what becomes true after completion). The planner uses A* to find the
// cheapest action sequence from current state to goal.
const planner = new GOAPPlanner();

// TakeCover: requires enemy visible, produces "inCover = true".
// Cost 2 — moderately expensive; NPC prefers this before attacking.
planner.registerAction({
  id: 'TakeCover',
  cost: 2,
  preconditions: { enemyVisible: true },
  effects:       { inCover: true },
});

// Attack: requires enemy visible AND in cover, produces "targetEliminated = true".
// Cost 1 — cheap once preconditions are met (in cover + enemy visible).
planner.registerAction({
  id: 'Attack',
  cost: 1,
  preconditions: { enemyVisible: true, inCover: true },
  effects:       { targetEliminated: true },
});

// Step 2: Define action handlers.
// IGOAPActionHandler has three methods: enter, update, exit.
// Handlers are stateless singletons — per-NPC data goes in ctx.state.custom.
// For Phase 1, both handlers just log and return 'success' immediately.
const phase1Handlers: Record<string, IGOAPActionHandler> = {
  TakeCover: {
    enter()                        { console.log('  [TakeCover] entering — moving to cover'); },
    update(_ctx, _dt)              { console.log('  [TakeCover] done → success'); return 'success'; },
    exit()                         { /* cleanup */ },
  },
  Attack: {
    enter()                        { console.log('  [Attack] entering — engaging enemy'); },
    update(_ctx, _dt)              { console.log('  [Attack] firing...'); return 'running'; },
    exit()                         { /* cleanup */ },
  },
};

// Step 3: Create the GOAPDirector.
// The config tells the director how to read the NPC's world and what goal
// to pursue. buildWorldState is called on every replan (each COMBAT entry).
const director1 = new GOAPDirector(planner, {
  // buildWorldState: snapshot the NPC's situation for the planner.
  // The planner matches this against action preconditions to find valid plans.
  buildWorldState: (_ctx) => WorldState.from({
    enemyVisible: true,   // enemy is in our perception
    inCover:      false,   // we're not behind cover yet
  }),

  // goal: the desired end state. The planner searches for the cheapest
  // action sequence that makes the world state satisfy this goal.
  goal: WorldState.from({ targetEliminated: true }),

  // actionHandlers: map GOAP action IDs to runtime handlers.
  // When the planner produces [TakeCover, Attack], the director calls
  // TakeCover.enter → TakeCover.update (until 'success') → Attack.enter → ...
  actionHandlers: phase1Handlers,
});

// Step 4: Register the director as the COMBAT handler.
// buildDefaultHandlerMap() gives us IDLE, ALERT, SEARCH, FLEE, etc.
// We replace the built-in CombatState with our GOAPDirector.
const host1 = new SimpleNPCHost('stalker_01', 'loner', 'human');

// .register() replaces whatever handler was at COMBAT with our director.
const handlers1 = buildDefaultHandlerMap().register(ONLINE_STATE.COMBAT, director1);
const driver1   = new OnlineAIDriver(host1, handlers1, ONLINE_STATE.IDLE);

console.log(`  GOAPDirector registered as COMBAT handler.`);
console.log(`  NPC starts in IDLE, sees enemy → ALERT → COMBAT → director replans.`);
console.log('');
console.log(`  State: ${driver1.currentStateId}`);

// Simulate: enemy appears → IDLE → ALERT → COMBAT.
host1.perception.sync([{ id: 'bandit_01', x: 300, y: 100, factionId: 'bandit' }], [], []);
host1.tick(driver1, 16);
console.log(`  Enemy spotted → ${driver1.currentStateId}`);

host1.tick(driver1, 16);
console.log(`  Enemy confirmed → ${driver1.currentStateId}`);

// Now in COMBAT — the director replanned and started executing.
// Tick a few times to see actions run.
host1.tick(driver1, 16);
host1.tick(driver1, 16);

driver1.destroy();
console.log('');

// ---------------------------------------------------------------------------
// Phase 2: Action handler return values
//
// Each tick, the director calls handler.update(ctx, deltaMs).
// The return value controls the flow:
//
//   'running' — action is still in progress, tick again next frame
//   'success' — action completed, director advances to the next action
//   'failure' — action failed, director replans from scratch
//
// This is the core lifecycle. TakeCover below counts 3 ticks then
// returns 'success'. Attack stays 'running' (it's the terminal action —
// keep firing until the enemy dies or an interrupt triggers).
// ---------------------------------------------------------------------------

console.log('=== Phase 2: Action handler return values ===');
console.log('');

// TakeCover counts ticks via ctx.state.custom, returns 'success' after 3.
// Attack stays 'running' indefinitely (terminal action).
const phase2Handlers: Record<string, IGOAPActionHandler> = {
  TakeCover: {
    enter(ctx) {
      // Initialize a tick counter in custom state.
      // The __goap prefix is reserved for GOAPDirector internals;
      // game code should use its own prefix.
      ctx.state.custom = { ...(ctx.state.custom ?? {}), coverTicks: 0 };
      console.log('  [TakeCover] entering — moving to cover');
    },
    update(ctx, _dt) {
      // Read and increment the counter.
      const custom = ctx.state.custom ?? {};
      const ticks  = ((custom['coverTicks'] as number) ?? 0) + 1;
      ctx.state.custom = { ...custom, coverTicks: ticks };

      console.log(`  [TakeCover] tick ${ticks}/3`);

      // 'success' after 3 ticks → director calls exit() then advances.
      if (ticks >= 3) {
        console.log('  [TakeCover] → success (director advances to next action)');
        return 'success';
      }
      // 'running' → director will call update() again next tick.
      return 'running';
    },
    exit() { console.log('  [TakeCover] exiting'); },
  },

  Attack: {
    enter()            { console.log('  [Attack] entering — engaging enemy'); },
    update(_ctx, _dt)  { console.log('  [Attack] firing...'); return 'running'; },
    exit()             { console.log('  [Attack] exiting'); },
  },
};

const director2 = new GOAPDirector(planner, {
  buildWorldState: () => WorldState.from({ enemyVisible: true, inCover: false }),
  goal: WorldState.from({ targetEliminated: true }),
  actionHandlers: phase2Handlers,
});

const host2 = new SimpleNPCHost('stalker_02', 'loner', 'human');
const handlers2 = buildDefaultHandlerMap().register(ONLINE_STATE.COMBAT, director2);

// Start directly in COMBAT so we can focus on the action lifecycle.
const driver2 = new OnlineAIDriver(host2, handlers2, ONLINE_STATE.COMBAT);
// Keep enemy visible so COMBAT doesn't transition to SEARCH.
host2.perception.sync([{ id: 'bandit_02', x: 300, y: 100, factionId: 'bandit' }], [], []);

console.log(`  Plan: TakeCover → Attack`);
console.log('');

// Tick 6 times: 3 for TakeCover (running, running, success) + 3 for Attack (running).
for (let i = 0; i < 6; i++) {
  host2.tick(driver2, 16);
}

driver2.destroy();
console.log('');

// ---------------------------------------------------------------------------
// Phase 3: Interrupts
//
// Interrupts are checked EVERY tick, BEFORE the active action handler
// runs. If any interrupt condition returns true, the director:
//   1. Calls exit() on the current action handler
//   2. Transitions to the interrupt's targetState (e.g. FLEE)
//   3. The current plan is abandoned
//
// When the NPC eventually returns to COMBAT, the director replans from
// scratch (enter() is called again, which triggers a fresh plan).
//
// Interrupts are evaluated in array order — first match wins.
// Use this for: morale panic, grenade dodge, low HP retreat.
// ---------------------------------------------------------------------------

console.log('=== Phase 3: Interrupts ===');
console.log('');

const director3 = new GOAPDirector(planner, {
  buildWorldState: () => WorldState.from({ enemyVisible: true, inCover: false }),
  goal: WorldState.from({ targetEliminated: true }),
  actionHandlers: {
    TakeCover: {
      enter()            { console.log('  [TakeCover] entering'); },
      update(_ctx, _dt)  { console.log('  [TakeCover] running...'); return 'running'; },
      exit()             { console.log('  [TakeCover] INTERRUPTED — exiting early'); },
    },
    Attack: {
      enter()            { console.log('  [Attack] entering'); },
      update(_ctx, _dt)  { return 'running'; },
      exit()             { /* cleanup */ },
    },
  },

  // Interrupt: when moraleState is PANICKED, abort the current action
  // and transition to FLEE. The built-in FleeState handles the escape.
  interrupts: [
    {
      condition: (ctx) => ctx.state.moraleState === 'PANICKED',
      targetState: ONLINE_STATE.FLEE,
    },
  ],
});

const host3 = new SimpleNPCHost('bandit_01', 'bandit', 'human');
const handlers3 = buildDefaultHandlerMap().register(ONLINE_STATE.COMBAT, director3);
const driver3   = new OnlineAIDriver(host3, handlers3, ONLINE_STATE.COMBAT);
host3.perception.sync([{ id: 'player', x: 200, y: 100, factionId: 'loner' }], [], []);

// Tick once — TakeCover starts executing normally.
host3.tick(driver3, 16);
console.log(`  State: ${driver3.currentStateId}`);  // COMBAT

// Simulate morale collapse (squad wiped, heavy fire).
// moraleState is set by the game layer — the AI reads it.
host3.state.morale      = -1.0;
host3.state.moraleState = 'PANICKED';
host3.state.lastKnownEnemyX = 200;
host3.state.lastKnownEnemyY = 100;

// Next tick: interrupt fires BEFORE the action handler runs.
// Director calls TakeCover.exit(), then transitions to FLEE.
host3.tick(driver3, 16);
console.log(`  Morale collapsed → ${driver3.currentStateId}`);  // FLEE

console.log('  (When NPC returns to COMBAT later, director replans from scratch)');

driver3.destroy();
console.log('');

// ---------------------------------------------------------------------------
// Phase 4: Dynamic replanning
//
// The director replans every time the NPC enters COMBAT (via enter()).
// Because buildWorldState() reads the NPC's CURRENT situation each time,
// a different world state produces a different plan.
//
// This is how GOAP adapts to changing conditions:
//   - Full HP, no cover → plan: [TakeCover, Attack]
//   - Low HP, has medkit → plan: [HealSelf, TakeCover, Attack]
//   - Already in cover   → plan: [Attack]  (TakeCover precondition already met)
//
// The planner always finds the cheapest path. Changing the world state
// changes which actions' preconditions are satisfied, so the plan changes.
// ---------------------------------------------------------------------------

console.log('=== Phase 4: Dynamic replanning ===');
console.log('');

// Add a HealSelf action — only available when HP is low and has medkit.
const plannerV2 = new GOAPPlanner();

plannerV2.registerAction({
  id: 'HealSelf',
  cost: 1,
  preconditions: { lowHp: true, hasMedkit: true },
  effects:       { lowHp: false },  // healing removes the lowHp flag
});

plannerV2.registerAction({
  id: 'TakeCover',
  cost: 2,
  preconditions: { enemyVisible: true },
  effects:       { inCover: true },
});

plannerV2.registerAction({
  id: 'Attack',
  cost: 1,
  preconditions: { enemyVisible: true, inCover: true, lowHp: false },
  effects:       { targetEliminated: true },
});

// Track which plan the director builds each time.
let lastPlanLog = '';

const phase4Handlers: Record<string, IGOAPActionHandler> = {
  HealSelf: {
    enter()            { console.log('  [HealSelf] using medkit...'); },
    update(_ctx, _dt)  { console.log('  [HealSelf] healed → success'); return 'success'; },
    exit()             { /* cleanup */ },
  },
  TakeCover: {
    enter()            { console.log('  [TakeCover] moving to cover...'); },
    update(_ctx, _dt)  { console.log('  [TakeCover] in cover → success'); return 'success'; },
    exit()             { /* cleanup */ },
  },
  Attack: {
    enter()            { console.log('  [Attack] engaging...'); },
    update(_ctx, _dt)  { console.log('  [Attack] firing...'); return 'running'; },
    exit()             { /* cleanup */ },
  },
};

// Scenario A: Full HP — no need to heal.
// Expected plan: TakeCover → Attack
console.log('  --- Scenario A: Full HP ---');

const host4a = new SimpleNPCHost('stalker_03', 'loner', 'human');
host4a.perception.sync([{ id: 'bandit_03', x: 300, y: 100, factionId: 'bandit' }], [], []);

const director4a = new GOAPDirector(plannerV2, {
  // buildWorldState reads the host's HP each time it's called.
  buildWorldState: (ctx) => {
    const isLowHp = ctx.health.hpPercent < 0.3;
    const ws = WorldState.from({
      enemyVisible: true,
      inCover:      false,
      lowHp:        isLowHp,
      hasMedkit:    true,
    });
    // Log the plan for teaching purposes.
    const plan = plannerV2.plan(ws, WorldState.from({ targetEliminated: true }));
    lastPlanLog = plan ? plan.map(a => a.id).join(' → ') : '(no plan)';
    console.log(`  [GOAP] world: lowHp=${isLowHp} → plan: ${lastPlanLog}`);
    return ws;
  },
  goal: WorldState.from({ targetEliminated: true }),
  actionHandlers: phase4Handlers,
});

const handlers4a = buildDefaultHandlerMap().register(ONLINE_STATE.COMBAT, director4a);
const driver4a   = new OnlineAIDriver(host4a, handlers4a, ONLINE_STATE.COMBAT);

// Tick: full HP → plan is TakeCover → Attack.
host4a.tick(driver4a, 16);  // TakeCover enters + returns success
host4a.tick(driver4a, 16);  // Attack enters

driver4a.destroy();
console.log('');

// Scenario B: Low HP — heal first, then fight.
// Expected plan: HealSelf → TakeCover → Attack
console.log('  --- Scenario B: Low HP (20%) — heal first ---');

const host4b = new SimpleNPCHost('stalker_04', 'loner', 'human');
host4b.setHp(20);  // 20% HP — triggers the lowHp flag
host4b.perception.sync([{ id: 'bandit_04', x: 300, y: 100, factionId: 'bandit' }], [], []);

const director4b = new GOAPDirector(plannerV2, {
  buildWorldState: (ctx) => {
    const isLowHp = ctx.health.hpPercent < 0.3;
    const ws = WorldState.from({
      enemyVisible: true,
      inCover:      false,
      lowHp:        isLowHp,
      hasMedkit:    true,
    });
    const plan = plannerV2.plan(ws, WorldState.from({ targetEliminated: true }));
    lastPlanLog = plan ? plan.map(a => a.id).join(' → ') : '(no plan)';
    console.log(`  [GOAP] world: lowHp=${isLowHp} → plan: ${lastPlanLog}`);
    return ws;
  },
  goal: WorldState.from({ targetEliminated: true }),
  actionHandlers: phase4Handlers,
});

const handlers4b = buildDefaultHandlerMap().register(ONLINE_STATE.COMBAT, director4b);
const driver4b   = new OnlineAIDriver(host4b, handlers4b, ONLINE_STATE.COMBAT);

// Tick: low HP → plan is HealSelf → TakeCover → Attack.
host4b.tick(driver4b, 16);  // HealSelf enters + returns success
host4b.tick(driver4b, 16);  // TakeCover enters + returns success
host4b.tick(driver4b, 16);  // Attack enters

driver4b.destroy();
console.log('');

// ---------------------------------------------------------------------------
// Phase 5: state.custom — sharing data between handlers
//
// Action handlers are stateless singletons. Per-NPC state lives in
// ctx.state.custom — a Record<string, unknown> owned by the game layer.
//
// Use it to pass data between handlers within the same plan:
//   - TakeCover writes the cover position it chose
//   - Attack reads it to calculate firing angles
//
// Key conventions:
//   - __goap prefix is RESERVED for GOAPDirector internals (__goapPlan, etc.)
//   - Use your own prefix for game data (e.g. coverPos, ammoCount)
//   - Always spread when writing: ctx.state.custom = { ...ctx.state.custom, key: val }
//     This avoids clobbering the director's internal keys.
//   - Never snapshot ctx.state.custom into a local variable — always read
//     fresh from ctx.state.custom each tick (the director may replace it).
// ---------------------------------------------------------------------------

console.log('=== Phase 5: state.custom ===');
console.log('');

const phase5Handlers: Record<string, IGOAPActionHandler> = {
  TakeCover: {
    enter(ctx) {
      // Write to custom: store the cover position we chose.
      // Always spread to preserve existing keys (including __goap* keys).
      const coverX = 80;
      const coverY = 60;
      ctx.state.custom = { ...(ctx.state.custom ?? {}), coverX, coverY };
      console.log(`  [TakeCover] chose cover at (${coverX}, ${coverY}) — written to state.custom`);
    },
    update(_ctx, _dt) { return 'success'; },
    exit() { /* cleanup */ },
  },

  Attack: {
    enter(ctx) {
      // Read from custom: retrieve the cover position the previous handler stored.
      // Always read fresh from ctx.state.custom (never cache it).
      const custom = ctx.state.custom ?? {};
      const coverX = custom['coverX'] as number | undefined;
      const coverY = custom['coverY'] as number | undefined;
      console.log(`  [Attack] reading cover position from state.custom: (${coverX}, ${coverY})`);
      console.log(`  [Attack] adjusting firing angle based on cover position`);
    },
    update(_ctx, _dt) {
      console.log('  [Attack] firing from cover...');
      return 'running';
    },
    exit() { /* cleanup */ },
  },
};

const director5 = new GOAPDirector(planner, {
  buildWorldState: () => WorldState.from({ enemyVisible: true, inCover: false }),
  goal: WorldState.from({ targetEliminated: true }),
  actionHandlers: phase5Handlers,
});

const host5 = new SimpleNPCHost('stalker_05', 'loner', 'human');
host5.perception.sync([{ id: 'bandit_05', x: 300, y: 100, factionId: 'bandit' }], [], []);

const handlers5 = buildDefaultHandlerMap().register(ONLINE_STATE.COMBAT, director5);
const driver5   = new OnlineAIDriver(host5, handlers5, ONLINE_STATE.COMBAT);

// Tick: TakeCover writes to custom, Attack reads from it.
host5.tick(driver5, 16);  // TakeCover: enter + success → Attack: enter
host5.tick(driver5, 16);  // Attack: update (firing)

// Show what's in state.custom — the director's __goap keys + our game keys.
const custom = host5.state.custom ?? {};
const gameKeys  = Object.keys(custom).filter(k => !k.startsWith('__goap'));
const goapKeys  = Object.keys(custom).filter(k => k.startsWith('__goap'));
console.log('');
console.log(`  state.custom game keys:  ${gameKeys.join(', ')}`);
console.log(`  state.custom __goap keys: ${goapKeys.join(', ')}`);
console.log('  (Never read/write __goap keys — they belong to the director)');

driver5.destroy();
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. GOAPDirector is registered as the COMBAT handler via .register()');
console.log('  2. It replans on every COMBAT entry (including after interrupts)');
console.log('  3. Action handlers return \'running\'/\'success\'/\'failure\'');
console.log('  4. \'success\' → next action, \'failure\' → replan');
console.log('  5. Interrupts are checked before each action tick');
console.log('  6. ctx.state.custom stores game-specific data across handlers');
console.log('  7. The director stores its own state in __goap-prefixed keys');
