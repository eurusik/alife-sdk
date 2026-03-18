/**
 * 06-behavior-tree.ts
 *
 * Behavior Tree — composable code-first AI execution logic.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/06-behavior-tree.ts
 *
 * What we build here:
 *   - A Blackboard to hold shared NPC state
 *   - A combat tree: attack if armed and can see target, else take cover
 *   - A patrol tree: move to next waypoint, wait, repeat
 *   - A root Selector that picks the first branch that succeeds
 *   - Decorators: Inverter, Cooldown, Repeater
 *   - Parallel: simultaneous multi-goal execution
 *
 * No kernel, no plugins — BehaviorTree is a standalone primitive.
 * Behavior Trees work best with FSM: FSM decides WHAT goal to pursue,
 * BT decides HOW to execute it step by step.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  Blackboard,
  Sequence,
  Selector,
  Parallel,
  Task,
  Condition,
  Inverter,
  Cooldown,
  Repeater,
} from '@alife-sdk/core/ai';
import type { TaskStatus } from '@alife-sdk/core/ai';

// ---------------------------------------------------------------------------
// Step 1: Define the Blackboard schema
//
// Blackboard<T> is a typed key-value store passed to every BT node each tick.
// All nodes share the same Blackboard, so they can communicate through it.
//
// The type parameter enforces which keys are valid at compile time.
// ---------------------------------------------------------------------------

type NpcBB = {
  // Perception
  canSeeTarget: boolean;

  // Inventory
  ammo:         number;
  hasMedkit:    boolean;

  // Position / movement
  inCover:      boolean;
  waypointIdx:  number;
  waypointCount: number;

  // Health
  hp:           number;
  maxHp:        number;
};

const bb = new Blackboard<NpcBB>({
  canSeeTarget:  false,
  ammo:          5,
  hasMedkit:     true,
  inCover:       false,
  waypointIdx:   0,
  waypointCount: 3,
  hp:            100,
  maxHp:         100,
});

// ---------------------------------------------------------------------------
// Step 2: Leaf nodes — Task and Condition
//
// Task:      runs an action callback, returns 'success' | 'failure' | 'running'
// Condition: wraps a boolean predicate, returns 'success' if true, 'failure' if false
// ---------------------------------------------------------------------------

// --- Perception conditions ---
const canSeeTarget  = new Condition<NpcBB>((b) => !!b.get('canSeeTarget'));
const hasAmmo       = new Condition<NpcBB>((b) => b.getOr('ammo', 0) > 0);
const isArmed       = new Condition<NpcBB>((b) => b.getOr('ammo', 0) > 0);
const isNotInCover  = new Inverter(new Condition<NpcBB>((b) => !!b.get('inCover')));
const isHealthy     = new Condition<NpcBB>((b) => {
  return b.getOr('hp', 0) / b.getOr('maxHp', 100) >= 0.5;
});

// --- Action tasks ---
const shootAtTarget = new Task<NpcBB>((b) => {
  const ammo = b.getOr('ammo', 0) - 1;
  b.set('ammo', ammo);
  console.log(`    [Task] Shoot! Ammo remaining: ${ammo}`);
  return 'success';
});

const moveToCover = new Task<NpcBB>((b) => {
  console.log(`    [Task] Moving to cover...`);
  b.set('inCover', true);
  return 'running'; // still in motion this tick
});

const useMedkit = new Task<NpcBB>((b) => {
  if (!b.get('hasMedkit')) return 'failure';
  b.set('hp', b.getOr('maxHp', 100));
  b.set('hasMedkit', false);
  console.log(`    [Task] Used medkit — HP restored to ${b.get('hp')}`);
  return 'success';
});

const reloadWeapon = new Task<NpcBB>((b) => {
  b.set('ammo', 10);
  console.log(`    [Task] Reloaded — ammo: ${b.get('ammo')}`);
  return 'success';
});

const moveToWaypoint = new Task<NpcBB>((b) => {
  const idx = b.getOr('waypointIdx', 0);
  console.log(`    [Task] Moving to waypoint ${idx}...`);
  return 'running';
});

const waitAtWaypoint = new Task<NpcBB>((b) => {
  const idx = b.getOr('waypointIdx', 0);
  console.log(`    [Task] Waiting at waypoint ${idx}`);
  return 'success';
});

const advanceWaypoint = new Task<NpcBB>((b) => {
  const next = (b.getOr('waypointIdx', 0) + 1) % b.getOr('waypointCount', 1);
  b.set('waypointIdx', next);
  console.log(`    [Task] Advanced to waypoint ${next}`);
  return 'success';
});

// ---------------------------------------------------------------------------
// Step 3: Composites — Sequence, Selector, Parallel
//
// Sequence (AND gate):
//   Ticks children left-to-right.
//   Fails on first failure. Returns 'running' if a child is still running.
//   Succeeds only when ALL children succeed.
//
// Selector (OR gate):
//   Ticks children left-to-right.
//   Succeeds on first success. Returns 'running' if a child is still running.
//   Fails only when ALL children fail.
//
// Parallel:
//   Ticks ALL children every tick.
//   'require-all': succeed when all succeed, fail when any fail.
//   'require-one': succeed when any succeed, fail when all fail.
// ---------------------------------------------------------------------------

// --- Combat branch ---
// "If I can see a target AND I have ammo → shoot (with 1s cooldown between shots)"
const attackBranch = new Sequence<NpcBB>([
  canSeeTarget,
  hasAmmo,
  new Cooldown(shootAtTarget, 1000), // at most one shot per 1000ms
]);

// --- Fallback: take cover ---
// "If I'm not already in cover → move to cover"
const takeCoverBranch = new Sequence<NpcBB>([
  isNotInCover,
  moveToCover,
]);

// --- Reload branch ---
// "If out of ammo → reload"
const reloadBranch = new Sequence<NpcBB>([
  new Inverter(isArmed), // Inverter: succeeds when child FAILS (i.e. no ammo)
  reloadWeapon,
]);

// --- Heal branch ---
// "If HP < 50% AND have medkit → use it"
const healBranch = new Sequence<NpcBB>([
  new Inverter(isHealthy),
  useMedkit,
]);

// --- Patrol branch ---
// "Move to waypoint → wait → advance to next — repeat 3 times"
const patrolOnce = new Sequence<NpcBB>([
  moveToWaypoint,
  waitAtWaypoint,
  advanceWaypoint,
]);

// ---------------------------------------------------------------------------
// Step 4: Decorators
//
// Inverter:      flips success ↔ failure (running passes through)
// AlwaysSucceed: makes the child always return 'success'
// Cooldown:      blocks the child while a timer is active
// Repeater:      ticks the child N times before returning 'success'
// ---------------------------------------------------------------------------

// Repeat the patrol loop 3 times, then succeed (so the Selector moves on)
const patrolBranch = new Repeater(patrolOnce, 3);

// ---------------------------------------------------------------------------
// Step 5: Root tree
//
// A Selector tries each branch in priority order:
//   1. Heal if wounded
//   2. Reload if out of ammo
//   3. Attack if can see target and armed
//   4. Take cover if threatened but not in cover
//   5. Patrol as a fallback
// ---------------------------------------------------------------------------

const rootTree = new Selector<NpcBB>([
  healBranch,
  reloadBranch,
  attackBranch,
  takeCoverBranch,
  patrolBranch,
]);

// ---------------------------------------------------------------------------
// Step 6: Tick the tree
//
// Call rootTree.tick(bb) once per game frame.
// The tree returns 'success' | 'failure' | 'running' each tick.
//
// We simulate several ticks with different blackboard states to show
// how the tree reacts.
// ---------------------------------------------------------------------------

function tick(label: string): TaskStatus {
  const result = rootTree.tick(bb);
  console.log(`  [${label}] → ${result}`);
  return result;
}

// ---- Scenario 1: target visible, armed ----
console.log('=== Scenario 1: target visible, has ammo ===');
bb.set('canSeeTarget', true);
bb.set('ammo', 5);
bb.set('hp', 100);
bb.set('inCover', false);
console.log('Tick 1:');
tick('shoot');

// Cooldown is active — should NOT shoot again immediately
console.log('Tick 2 (cooldown active, attack fails → take cover):');
tick('take cover');

// ---- Scenario 2: out of ammo ----
console.log('');
console.log('=== Scenario 2: out of ammo ===');
bb.set('ammo', 0);
bb.set('inCover', false);
console.log('Tick 3:');
tick('reload');

// ---- Scenario 3: wounded, has medkit ----
console.log('');
console.log('=== Scenario 3: low HP, has medkit ===');
bb.set('canSeeTarget', false);
bb.set('ammo', 5);
bb.set('hp', 40);
bb.set('hasMedkit', true);
console.log('Tick 4:');
tick('heal');

// ---- Scenario 4: patrol fallback ----
console.log('');
console.log('=== Scenario 4: no target, full health, already in cover — patrol ===');
bb.set('canSeeTarget', false);
bb.set('hp', 100);
bb.set('ammo', 5);
bb.set('inCover', true);  // already in cover → takeCoverBranch skipped
bb.set('waypointIdx', 0);

console.log('Ticks 5-7 (one patrol cycle):');
tick('patrol move');
tick('patrol move');
tick('patrol move');

// ---------------------------------------------------------------------------
// Step 7: Parallel example
//
// Parallel ticks ALL children every tick.
// Useful when an NPC needs to do multiple things simultaneously:
// e.g. keep scanning for enemies WHILE patrolling.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Parallel: scan + patrol simultaneously ===');
console.log('');

type ScoutBB = { scanCooldown: number; patrolDone: boolean };

const scanTask = new Task<ScoutBB>((b) => {
  const cd = b.getOr('scanCooldown', 0) - 16;
  b.set('scanCooldown', Math.max(0, cd));
  if (cd <= 0) {
    console.log(`    [Parallel] Scan complete — area clear`);
    b.set('scanCooldown', 500);
    return 'success';
  }
  return 'running';
});

const patrolTask = new Task<ScoutBB>((b) => {
  const done = b.get('patrolDone');
  if (!done) {
    console.log(`    [Parallel] Patrolling...`);
    b.set('patrolDone', true);
    return 'running';
  }
  console.log(`    [Parallel] Patrol done`);
  return 'success';
});

// 'require-all': both scan AND patrol must succeed for the Parallel to succeed
const scoutTree = new Parallel<ScoutBB>([scanTask, patrolTask], 'require-all');

const scoutBB = new Blackboard<ScoutBB>({ scanCooldown: 0, patrolDone: false });

console.log('Scout tick 1:');
console.log(`  result: ${scoutTree.tick(scoutBB)}`);

console.log('Scout tick 2:');
console.log(`  result: ${scoutTree.tick(scoutBB)}`);

console.log('');
console.log('Done.');
