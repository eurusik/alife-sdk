/**
 * 11-fsm-tags.ts
 *
 * Extended FSM — tags, metadata, event subscriptions, and transition history.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/11-fsm-tags.ts
 *
 * What we build here:
 *   - A 4-state guard NPC FSM: IDLE → ALERT → COMBAT → RETREAT
 *   - Tags on each state for group queries ('passive', 'active', 'hostile')
 *   - Metadata on COMBAT for animation hints
 *   - Guards (canEnter / canExit) that veto certain transitions
 *   - Event subscriptions: onEnter, onExit, onChange
 *   - Transition history inspection
 *
 * No kernel, no plugins — StateMachine is a standalone primitive.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler, IAIStateDefinition } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

// NpcEntity extends IEntity with a simple per-NPC tag store.
// In a real game this would be your Phaser sprite or custom NPC class.
interface NpcEntity extends IEntity {
  getTag(key: string): unknown;
  setTag(key: string, val: unknown): void;
}

// ---------------------------------------------------------------------------
// Step 1: Minimal mock entity
//
// StateMachine works with any IEntity. In a real game this is your Phaser
// sprite or plain NPC object. Here we use a minimal plain object with a
// tag store so state handlers can read/write per-NPC data.
// ---------------------------------------------------------------------------

function createMockEntity(id: string): NpcEntity {
  const tags = new Map<string, unknown>([
    ['hp', 100],
    ['seenEnemy', false],
    ['threatGone', false],
    ['alertTimer', 0],
    ['retreatHpThreshold', 30],
  ]);

  return {
    id,
    entityType: 'npc',
    isAlive: true,
    x: 100, y: 200,
    active: true,
    setPosition(x, y) { this.x = x; this.y = y; },
    setActive(v) { this.active = v; return this; },
    setVisible(_v) { return this; },
    hasComponent(_name) { return false; },
    getComponent<T>(_name: string): T { throw new Error('no components'); },
    getTag(key: string) { return tags.get(key); },
    setTag(key: string, val: unknown) { tags.set(key, val); },
  };
}

const npc = createMockEntity('guard_001');

// ---------------------------------------------------------------------------
// Step 2: State handlers
//
// Each handler is a stateless object — all per-NPC data lives on the entity.
// The same handler instance can be shared across many FSM instances.
// ---------------------------------------------------------------------------

const idleHandler: IStateHandler = {
  enter(entity) {
    console.log(`  [IDLE.enter]  guard is now idle`);
    (entity as NpcEntity).setTag('alertTimer', 0);
  },
  update(_entity, _delta) {
    // In a real game: look around, play idle animation, etc.
  },
  exit(entity) {
    console.log(`  [IDLE.exit]   guard is leaving idle`);
    (entity as NpcEntity).setTag('seenEnemy', false);
  },
};

const alertHandler: IStateHandler = {
  enter(entity) {
    console.log(`  [ALERT.enter] guard is now alert — starting 3s timer`);
    (entity as NpcEntity).setTag('alertTimer', 3); // seconds
  },
  update(entity, delta) {
    const t = (entity as NpcEntity).getTag('alertTimer') as number;
    (entity as NpcEntity).setTag('alertTimer', t - delta);
  },
  exit(entity) {
    console.log(`  [ALERT.exit]  guard is leaving alert`);
    (entity as NpcEntity).setTag('threatGone', false);
  },
};

const combatHandler: IStateHandler = {
  enter(entity) {
    console.log(`  [COMBAT.enter] guard engages — play combat_anim`);
    (entity as NpcEntity).setTag('seenEnemy', false); // reset so we don't loop
  },
  update(_entity, _delta) {
    // In a real game: attack nearest enemy, track target, etc.
  },
  exit(entity) {
    console.log(`  [COMBAT.exit]  guard leaving combat`);
    (entity as NpcEntity).setTag('threatGone', false);
  },
};

const retreatHandler: IStateHandler = {
  enter(entity) {
    const hp = (entity as NpcEntity).getTag('hp') as number;
    console.log(`  [RETREAT.enter] guard is retreating! hp=${hp}`);
  },
  update(_entity, _delta) {
    // Move toward safe zone, call for backup, etc.
  },
  exit(_entity) {
    console.log(`  [RETREAT.exit]  guard done retreating`);
  },
};

// ---------------------------------------------------------------------------
// Step 3: Build the registry
//
// AIStateRegistry holds all state definitions. It is shareable across many
// StateMachine instances of the same NPC type.
//
// Key features used here:
//   tags             — categorical labels for group queries ('active', etc.)
//   metadata         — arbitrary data (animation keys, sound IDs, priority)
//   transitionConditions — auto-transitions checked each frame after update()
//   canEnter / canExit   — guards that can veto a transition
//   allowedTransitions   — whitelist of legal target states
// ---------------------------------------------------------------------------

const registry = new AIStateRegistry();

registry
  .register('IDLE', {
    handler: idleHandler,
    tags: ['passive'],
    transitionConditions: [
      {
        targetState: 'ALERT',
        priority: 10,
        condition: (e) => (e as any).getTag('seenEnemy') === true,
      },
    ],
  } satisfies IAIStateDefinition)

  .register('ALERT', {
    handler: alertHandler,
    tags: ['active'],
    transitionConditions: [
      // Higher priority fires first — COMBAT wins over IDLE if enemy seen
      {
        targetState: 'COMBAT',
        priority: 20,
        condition: (e) => (e as any).getTag('seenEnemy') === true,
      },
      {
        targetState: 'IDLE',
        priority: 5,
        condition: (e) => ((e as any).getTag('alertTimer') as number) <= 0,
      },
    ],
    // Guard: can't enter ALERT if HP is already critical
    canEnter: (entity, _from) => ((entity as NpcEntity).getTag('hp') as number) > 20,
  } satisfies IAIStateDefinition)

  .register('COMBAT', {
    handler: combatHandler,
    tags: ['hostile', 'active'],
    metadata: {
      animGroup: 'combat',
      musicTrack: 'combat_theme',
      priority: 10,
    },
    transitionConditions: [
      {
        targetState: 'RETREAT',
        priority: 15,
        condition: (e) => ((e as any).getTag('hp') as number) < ((e as any).getTag('retreatHpThreshold') as number),
      },
      {
        targetState: 'ALERT',
        priority: 10,
        condition: (e) => (e as any).getTag('threatGone') === true,
      },
    ],
    // Guard: can't leave COMBAT to go directly IDLE — must go through ALERT
    canExit: (_entity, toState) => toState !== 'IDLE',
  } satisfies IAIStateDefinition)

  .register('RETREAT', {
    handler: retreatHandler,
    tags: ['passive', 'fleeing'],
    // Once retreating, can only go to IDLE (to rest and recover)
    allowedTransitions: ['IDLE'],
    transitionConditions: [
      {
        targetState: 'IDLE',
        priority: 10,
        condition: (e) => ((e as any).getTag('hp') as number) >= 60,
      },
    ],
  } satisfies IAIStateDefinition);

// ---------------------------------------------------------------------------
// Step 4: Create the FSM
//
// One registry, one entity, one initial state. Calls idleHandler.enter()
// immediately on construction.
// ---------------------------------------------------------------------------

console.log('=== Creating FSM ===');
console.log('');

const fsm = new StateMachine(npc, registry, 'IDLE');

// ---------------------------------------------------------------------------
// Step 5: Subscribe to events
//
// All three subscription methods return an unsubscribe function.
//   onEnter(state, cb)  — fires after handler.enter() for a specific state
//   onExit(state, cb)   — fires after handler.exit() for a specific state
//   onChange(cb)        — fires on ANY successful transition
// ---------------------------------------------------------------------------

fsm.onEnter('COMBAT', (from) => {
  const meta = fsm.metadata;
  console.log(`  [EVENT] Entered COMBAT from ${from} — play "${meta?.['musicTrack']}"`);
});

fsm.onExit('COMBAT', (to) => {
  console.log(`  [EVENT] Exiting COMBAT → ${to} — stop combat music`);
});

const unsubChange = fsm.onChange((from, to) => {
  console.log(`  [EVENT] FSM changed: ${from} → ${to}  (duration in prev: ${Math.round(fsm.currentStateDuration)}ms)`);
});

// ---------------------------------------------------------------------------
// Step 6: Tag and metadata queries
//
// fsm.hasTag()  — true if the current state's definition includes this tag
// fsm.metadata  — the current state's metadata object (or undefined)
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Tag and metadata queries (initial state: IDLE) ===');
console.log(`  hasTag('passive') = ${fsm.hasTag('passive')}`);  // true
console.log(`  hasTag('active')  = ${fsm.hasTag('active')}`);   // false
console.log(`  hasTag('hostile') = ${fsm.hasTag('hostile')}`);  // false
console.log(`  metadata          = ${JSON.stringify(fsm.metadata)}`); // undefined
console.log('');

// ---------------------------------------------------------------------------
// Step 7: Manual transitions
//
// transition() returns { success: true } or { success: false; reason: ... }
// Reasons: 'not_allowed' | 'exit_guard' | 'enter_guard'
// ---------------------------------------------------------------------------

console.log('=== Manual transition: IDLE → ALERT ===');
console.log('');

// Trigger the seenEnemy flag and transition manually
npc.setTag('seenEnemy', true);
const r1 = fsm.transition('ALERT');
console.log(`  transition result: ${JSON.stringify(r1)}`);
console.log(`  current state: ${fsm.state}, previous: ${fsm.previous}`);
console.log(`  hasTag('active') = ${fsm.hasTag('active')}`); // true
console.log('');

// Attempt a guarded transition: COMBAT → IDLE is blocked by canExit
console.log('=== Manual transition: ALERT → COMBAT ===');
console.log('');
const r2 = fsm.transition('COMBAT');
console.log(`  transition result: ${JSON.stringify(r2)}`);
console.log(`  metadata.animGroup = ${fsm.metadata?.['animGroup']}`);
console.log('');

// Demonstrate canExit guard blocking COMBAT → IDLE
console.log('=== Blocked transition: COMBAT → IDLE (canExit guard) ===');
console.log('');
const r3 = fsm.transition('IDLE');
console.log(`  transition result: ${JSON.stringify(r3)}`);  // { success: false, reason: 'exit_guard' }
console.log(`  current state still: ${fsm.state}`);
console.log('');

// ---------------------------------------------------------------------------
// Step 8: Auto-transitions via update()
//
// update() does two things each tick:
//   1. Calls currentHandler.update(entity, delta)
//   2. Evaluates transitionConditions — highest priority first
//      If a condition fires, calls this.transition(targetState) automatically
// ---------------------------------------------------------------------------

console.log('=== Auto-transition: COMBAT → RETREAT via HP drop ===');
console.log('');

npc.setTag('hp', 20); // drop HP below retreatHpThreshold (30)
fsm.update(0.016); // one frame — RETREAT condition fires (hp 20 < threshold 30)

console.log(`  current state: ${fsm.state}`);  // RETREAT
console.log(`  hasTag('fleeing') = ${fsm.hasTag('fleeing')}`); // true
console.log('');

// Restore HP and wait for auto-transition back to IDLE
console.log('=== Auto-transition: RETREAT → IDLE via HP recovery ===');
console.log('');

npc.setTag('hp', 80); // recovered
fsm.update(0.016); // IDLE condition fires (hp 80 >= 60)

console.log(`  current state: ${fsm.state}`);  // IDLE
console.log(`  previous: ${fsm.previous}`);      // RETREAT
console.log('');

// ---------------------------------------------------------------------------
// Step 9: Transition history
//
// getHistory() returns all successful transitions in chronological order.
// Each entry has: from, to, timestamp (Date.now())
// ---------------------------------------------------------------------------

console.log('=== Transition history ===');
console.log('');

const history = fsm.getHistory();
history.forEach((ev, i) => {
  console.log(`  [${i}] ${ev.from} → ${ev.to}`);
});
console.log('');

// Unsubscribe the onChange listener — no more change log from here
unsubChange();

// One more transition — should NOT appear in the change log
fsm.transition('ALERT');
console.log(`  (after unsubscribe) state: ${fsm.state} — onChange did not fire`);
console.log('');

// clearHistory() empties the log
fsm.clearHistory();
console.log(`  history length after clearHistory(): ${fsm.getHistory().length}`); // 0

// ---------------------------------------------------------------------------
// Step 10: Cleanup
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Destroy ===');
console.log('');
fsm.destroy(); // calls alertHandler.exit(entity)

console.log('');
console.log('Done.');
