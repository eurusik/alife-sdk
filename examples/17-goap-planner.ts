/**
 * 17-goap-planner.ts
 *
 * GOAPPlanner — A* goal-oriented action planning for dynamic NPC strategies.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/17-goap-planner.ts
 *
 * GOAP (Goal-Oriented Action Planning) lets an NPC figure out HOW to achieve
 * a goal by searching through available actions — like A* pathfinding, but
 * through "action space" instead of a map. Instead of hardcoding "if wounded,
 * find medkit, then heal, then attack", you define small reusable actions with
 * preconditions and effects, and the planner assembles them into a plan
 * automatically. This means NPCs adapt intelligently when the world changes:
 * wounded mid-mission? The planner replans from the new state and inserts a
 * healing detour on its own. Game devs care because it scales — dozens of
 * actions compose into thousands of possible behaviors without any if-else spaghetti.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { GOAPPlanner, ActionStatus, WorldState } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

// ---------------------------------------------------------------------------
// Minimal mock entity
//
// GOAPAction.execute() and isValid() receive an IEntity so the action can
// read HP, position, inventory, etc. from the game object. For this example
// we don't need any of that — we just pass a stub that satisfies the interface.
// In a real game, this would be your Phaser game object or ECS entity.
// ---------------------------------------------------------------------------

const mockEntity: IEntity = {
  id:         'merc_01',
  entityType: 'human',
  isAlive:    true,
  metadata:   undefined,
  x: 0,
  y: 0,
  active: true,
  setPosition(_x: number, _y: number) {},
  setActive(_v: boolean) { return this; },
  setVisible(_v: boolean) { return this; },
  hasComponent(_name: string) { return false; },
  getComponent<T>(_name: string): T { throw new Error('no components on mock'); },
};

// ---------------------------------------------------------------------------
// Step 1: Define the world state keys
//
// A WorldState is just a key-value map. Keys are strings; values are
// boolean | number | string. We use booleans here — the simplest case.
//
// Think of each key as a fact about the world:
//   hasMedkit        = "I am carrying a medkit right now"
//   isHealthy        = "My HP is high enough to fight"
//   hasAmmo          = "I have loose ammo to load"
//   isLoaded         = "My weapon is loaded and ready"
//   inPosition       = "I am in a good firing position"
//   targetEliminated = "The mission objective is done"
//
// The planner reads these facts to decide which actions are available and
// which one to try next.
// ---------------------------------------------------------------------------

// (No code needed here — we'll set keys directly on WorldState instances below.)

// ---------------------------------------------------------------------------
// Step 2: Define GOAP actions
//
// Each action is a class that extends GOAPAction and declares:
//   id                 — a readable name used in plan logs
//   cost               — lower cost = planner prefers this action
//   getPreconditions() — facts that must be true BEFORE this action can run
//   getEffects()       — facts this action makes true when it SUCCEEDS
//   isValid()          — runtime guard (e.g. "is there actually a medkit nearby?")
//   execute()          — called every game tick; returns RUNNING/SUCCESS/FAILURE
//
// We simulate execution with a simple tick counter so the example runs in
// Node.js without any game engine. In a real game, execute() would call
// entity movement, animation, etc.
// ---------------------------------------------------------------------------

// ----- FindMedkit -----
// The NPC scans the area for a medkit and picks it up.
// No preconditions — the NPC can always try to find one.
// After success: hasMedkit = true.

// ----- HealSelf -----
// The NPC uses the medkit they're carrying to restore HP.
// Precondition: must already have a medkit (hasMedkit = true).
// After success: isHealthy = true, hasMedkit = false (consumed).

// ----- FindAmmo -----
// The NPC searches a nearby body or ammo cache for bullets.
// No preconditions — can always look for ammo.
// After success: hasAmmo = true.

// ----- Reload -----
// The NPC loads the ammo they found into their weapon.
// Precondition: must have ammo to load (hasAmmo = true).
// After success: isLoaded = true, hasAmmo = false (ammo is now in the gun).

// ----- TakePosition -----
// The NPC moves to a good firing position (e.g. behind cover with line of sight).
// No preconditions — movement is always possible.
// After success: inPosition = true.
// Cost 3 — moving costs more time than using items.

// ----- Attack -----
// The NPC engages and eliminates the target. This is the GOAL action.
// All three preconditions must be true: healthy, loaded, in position.
// After success: targetEliminated = true — mission complete!

// ---------------------------------------------------------------------------
// Step 3: Create the planner and register actions
//
// The planner is stateless — it just holds the list of available actions.
// You can share one planner instance across all NPCs of the same type, since
// it doesn't store per-NPC state. Each call to plan() is independent.
// ---------------------------------------------------------------------------

const planner = new GOAPPlanner();

// Register every action the NPC can theoretically perform.
// The planner will figure out which ones to actually use based on the current
// world state and goal. Order doesn't matter — A* explores by cost.
planner.registerAction({
  id: 'FindMedkit',
  cost: 2,   // costs more than HealSelf alone — finding takes time
  preconditions: {},
  effects:       { hasMedkit: true },
});
planner.registerAction({
  id: 'HealSelf',
  cost: 1,   // cheap — just using an item already in hand
  preconditions: { hasMedkit: true },
  effects:       { isHealthy: true, hasMedkit: false },
});
planner.registerAction({
  id: 'FindAmmo',
  cost: 2,
  preconditions: {},
  effects:       { hasAmmo: true },
});
planner.registerAction({
  id: 'Reload',
  cost: 1,
  preconditions: { hasAmmo: true },
  effects:       { isLoaded: true, hasAmmo: false },
});
planner.registerAction({
  id: 'TakePosition',
  cost: 3,   // moving costs more time than using items
  preconditions: {},
  effects:       { inPosition: true },
});
planner.registerAction({
  id: 'Attack',
  cost: 1,
  preconditions: { isHealthy: true, isLoaded: true, inPosition: true },
  effects:       { targetEliminated: true },
});

// The goal never changes for this NPC: eliminate the target.
// We define it once and reuse it across all scenarios and replanning.
const goal = WorldState.from({ targetEliminated: true });

// ---------------------------------------------------------------------------
// Scenario 1: Healthy, armed NPC
//
// The NPC is already healthy and their weapon is loaded.
// They only need to get into position and attack.
// Expected plan: TakePosition → Attack  (short, 2 steps)
//
// This is the "happy path" — minimal actions because preconditions for
// Attack are almost fully met. Only inPosition is missing.
// ---------------------------------------------------------------------------

console.log('  The mercenary is in peak condition: full health, weapon hot.');
console.log('  They just need to find a firing angle and pull the trigger.');
console.log('');

const state1 = WorldState.from({
  isHealthy:  true,   // already treated any wounds before the mission
  isLoaded:   true,   // weapon was loaded at base
  inPosition: false,  // still needs to move into position
});

const plan1 = planner.plan(state1, goal);

if (plan1 === null) {
  console.log('  [!] No plan found — something went wrong.');
} else {
  console.log(`  Plan (${plan1.length} steps): ${plan1.map(a => a.id).join(' → ')}`);
  console.log('');
  console.log('  Executing...');

  // Simulate executing the plan action by action.
  // In a real game, you'd call execute() in your update loop each frame.
  for (const action of plan1) {
    let status = ActionStatus.RUNNING;
    let ticks  = 0;
    while (status === ActionStatus.RUNNING) {
      status = action.execute(mockEntity, 16);
      ticks++;
    }
    console.log(`    [${action.id}] → ${status} (${ticks} tick${ticks > 1 ? 's' : ''})`);
  }
}

console.log('');

// ---------------------------------------------------------------------------
// Scenario 2: Wounded NPC with no ammo
//
// The NPC took damage and used all their ammo in a previous firefight.
// They need to: find medkit → heal → find ammo → reload → get position → attack.
// Expected plan: FindMedkit → HealSelf → FindAmmo → Reload → TakePosition → Attack
//
// This is where GOAP shines: the planner automatically chains 6 actions
// together, no manual scripting needed. The A* search finds the lowest-cost
// ordering that satisfies all preconditions in sequence.
// ---------------------------------------------------------------------------

console.log('  The mercenary is bleeding out and their AK is dry.');
console.log('  They need to handle both problems before engaging.');
console.log('');

const state2 = WorldState.from({
  // Notice: isHealthy, isLoaded, inPosition are all ABSENT (not false, just unset).
  // An absent key means "we don't have that condition yet" — the planner will
  // look for actions that can produce these effects.
});

const plan2 = planner.plan(state2, goal);

if (plan2 === null) {
  console.log('  [!] No plan found — something went wrong.');
} else {
  console.log(`  Plan (${plan2.length} steps): ${plan2.map(a => a.id).join(' → ')}`);
  console.log('');
  console.log('  Each action has a cost. The planner chose this sequence because');
  console.log('  it has the lowest total cost among all valid orderings.');
  const totalCost = plan2.reduce((sum, a) => sum + a.cost, 0);
  console.log(`  Total plan cost: ${totalCost}`);
}

console.log('');

// ---------------------------------------------------------------------------
// Scenario 3: No plan possible
//
// We give the planner a goal that no registered action can satisfy.
// The goal requires `targetEliminated = true`, but Attack requires `inPosition`
// — and suppose we've stripped out TakePosition and Reload by giving a world
// state where no action can bridge the gap.
//
// Here we test with an explicit impossible requirement: a fact that no action
// produces. The planner will return null, indicating "I can't get there from here."
//
// This matters in game dev: you should always check for null and fall back to
// some default behavior (e.g. wander, request support, or just idle).
// ---------------------------------------------------------------------------

console.log('  What if the goal requires a condition nothing can satisfy?');
console.log('  We ask the planner for { miracleHappened: true } — a key that');
console.log('  no registered action can produce.');
console.log('');

const impossibleGoal = WorldState.from({ miracleHappened: true });
const plan3 = planner.plan(state2, impossibleGoal);

if (plan3 === null) {
  console.log('  plan === null  ✓  No plan found — goal is unreachable.');
  console.log('  In production: fall back to idle, call for backup, or abandon objective.');
} else {
  console.log(`  [!] Unexpected plan found: ${plan3.map(a => a.id).join(' → ')}`);
}

console.log('');

// ---------------------------------------------------------------------------
// Scenario 4: Replanning mid-execution
//
// This is GOAP's killer feature. The NPC starts with a short plan (healthy,
// armed — just needs position and attack). Partway through executing it,
// they get shot: isHealthy flips to false. The old plan is now invalid
// because Attack requires isHealthy = true.
//
// Instead of crashing or doing nothing, we simply call plan() again with
// the NEW world state and get a different, correct plan automatically.
// ---------------------------------------------------------------------------

console.log('  The mercenary starts with a clean plan — healthy and loaded.');
console.log('  Mid-mission they take a burst to the chest. Time to replan.');
console.log('');

// --- Initial plan ---
let liveState = WorldState.from({
  isHealthy: true,
  isLoaded:  true,
});

const initialPlan = planner.plan(liveState, goal);
if (!initialPlan) { throw new Error('Expected a plan for scenario 4 initial state'); }

console.log(`  Initial plan: ${initialPlan.map((a) => a.id).join(' → ')}`);
console.log('');

// --- Simulate executing the first action ---
const firstAction = initialPlan[0];
console.log(`  Executing: [${firstAction.id}]...`);
const firstResult = firstAction.execute(mockEntity, 16);
console.log(`  Result: ${firstResult}`);

// If the action succeeded, its effects are noted — the new world state is
// set explicitly below once the interrupting event (being shot) occurs.
// WorldState is always replaced wholesale; it never mutates in place.

// --- Simulate being shot mid-plan ---
// The world changed: the NPC took damage and is no longer healthy.
// We update the live world state to reflect reality.
console.log('');
console.log('  ** INCOMING FIRE — NPC takes a hit! **');
console.log('  World state updated: isHealthy = false');
console.log('');

// Update world state — isHealthy is now false (wounded).
// isLoaded is still true (weapon wasn't lost).
liveState = WorldState.from({
  isHealthy: false,  // got shot!
  isLoaded:  true,
  inPosition: true,  // they did reach position before being hit
});

// --- Replan from the new state ---
// This is the magic: same goal, same planner, new world state → new plan.
const newPlan = planner.plan(liveState, goal);

if (newPlan === null) {
  console.log('  [!] No replan found — unexpected.');
} else {
  console.log(`  Replan (${newPlan.length} steps): ${newPlan.map((a) => a.id).join(' → ')}`);
  console.log('');
  console.log('  Notice: the planner inserted FindMedkit → HealSelf at the front');
  console.log('  because isHealthy is now false. The rest of the plan adjusted');
  console.log('  automatically — no manual scripting required.');

  // Note: inPosition=true is already in liveState, so TakePosition is not needed.
  // The planner is smart enough to skip actions whose effects are already satisfied.
  if (!newPlan.some((a) => a.id === 'TakePosition')) {
    console.log('  And because inPosition=true already, TakePosition was skipped — clever!');
  }
}

console.log('');

// ---------------------------------------------------------------------------
// Summary
//
// A concise recap of every API touched in this example, so a developer can
// scan this file and know exactly what to look up in the SDK docs.
// ---------------------------------------------------------------------------

console.log('  GOAPPlanner in 5 lines of concept:');
console.log('');
console.log('    1. Describe the world as key-value facts (WorldState).');
console.log('    2. Define actions with preconditions + effects + cost.');
console.log('    3. Call planner.plan(currentState, goal).');
console.log('    4. Execute the returned action list, calling execute() each tick.');
console.log('    5. When world state changes, replan — the planner adapts automatically.');
console.log('');
console.log('  Key APIs used:');
console.log('    WorldState.from({ key: value })  — build state from plain record (preferred)');
console.log('    WorldState.set(key, value)        — set a single fact imperatively');
console.log('    WorldState.get(key)               — read a fact');
console.log('    WorldState.satisfies(goal)        — check if all goal facts are met');
console.log('    planner.registerAction({ id, cost, preconditions, effects })');
console.log('                                      — plain-object action (preferred, no subclassing)');
console.log('    GOAPAction (abstract class)       — extend only for complex multi-frame logic');
console.log('    ActionStatus.RUNNING/SUCCESS/FAILURE — tick-by-tick execution status');
console.log('    new GOAPPlanner()                 — create the planner');
console.log('    planner.plan(state, goal)         — returns GOAPAction[] or null');
console.log('    plan.map(a => a.id).join(" → ")  — readable plan logging');
console.log('');
console.log('Done.');
