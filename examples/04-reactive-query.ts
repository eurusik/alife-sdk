/**
 * 04-reactive-query.ts
 *
 * ReactiveQuery — observe entity set changes without polling every frame.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/04-reactive-query.ts
 *
 * The problem:
 *   In a large simulation you often need to know "which NPCs are currently
 *   hostile?". The naive approach polls every tick:
 *
 *     function update() {
 *       const hostiles = allEntities.filter(e => e.isAlive && e.hostile);
 *       combatSystem.setTargets(hostiles);
 *     }
 *
 *   This runs O(n) work every tick even when nothing changed.
 *
 * The solution:
 *   ReactiveQuery maintains a stable "matched" set and fires onChange ONLY
 *   when entities ENTER or EXIT the set — not every tick of every entity.
 *   The subscriber does work proportional to the CHANGE SIZE, not the world.
 *
 * What we build here:
 *   1. A hostile entity tracker for a combat system
 *   2. An online NPC tracker (for the host engine to know who to render)
 *   3. Manual track/untrack for special cases (e.g. player entity)
 *   4. Disposal / cleanup
 *
 * No kernel, no plugins — ReactiveQuery is a standalone primitive.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ReactiveQuery } from '@alife-sdk/core';
import type { QueryChanges } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Step 1: Entity types
//
// ReactiveQuery<T> is generic — it works with any object type.
// The predicate (e: T) => boolean defines what "matches" means.
// ---------------------------------------------------------------------------

interface SimEntity {
  id:         string;
  name:       string;
  entityType: 'npc' | 'monster' | 'player';
  isAlive:    boolean;
  hostile:    boolean;
  isOnline:   boolean; // true = player nearby, needs real-time rendering
  hp:         number;
}

function makeEntity(
  id: string,
  name: string,
  type: SimEntity['entityType'],
  opts: Partial<SimEntity> = {},
): SimEntity {
  return {
    id, name, entityType: type,
    isAlive: true, hostile: false, isOnline: false, hp: 100,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Step 2: World — all entities in the simulation
// ---------------------------------------------------------------------------

const entities: SimEntity[] = [
  makeEntity('guard_01', 'Duty Guard',    'npc',     { hostile: false }),
  makeEntity('wolf_01',  'Wolf',          'monster', { hostile: true  }),
  makeEntity('bandit_01','Bandit',        'npc',     { hostile: true  }),
  makeEntity('player',   'Player',        'player',  { hostile: false, isOnline: true }),
  makeEntity('npc_02',   'Stalker',       'npc',     { hostile: false }),
];

// ---------------------------------------------------------------------------
// Step 3: Hostile entity query
//
// Tracks entities that are alive AND hostile.
// A combat system subscribes — it only does work when the set changes.
// ---------------------------------------------------------------------------

console.log('=== Setting up queries ===');
console.log('');

const hostileQuery = new ReactiveQuery<SimEntity>(
  (e) => e.isAlive && e.hostile,
);

// Combat system subscribes to changes
hostileQuery.onChange(({ added, removed, current }: QueryChanges<SimEntity>) => {
  if (added.length > 0) {
    console.log(`  [CombatSystem] New hostiles (${added.length}): ${added.map(e => e.name).join(', ')}`);
    console.log(`  [CombatSystem] Total hostile targets: ${current.length}`);
  }
  if (removed.length > 0) {
    console.log(`  [CombatSystem] Hostiles removed (${removed.length}): ${removed.map(e => e.name).join(', ')}`);
    console.log(`  [CombatSystem] Total hostile targets: ${current.length}`);
  }
});

// ---------------------------------------------------------------------------
// Step 4: Online entity query
//
// Tracks entities that are currently "online" (player nearby → needs render).
// The renderer subscribes — it spawns/despawns visual objects only on change.
// ---------------------------------------------------------------------------

const onlineQuery = new ReactiveQuery<SimEntity>(
  (e) => e.isAlive && e.isOnline,
);

onlineQuery.onChange(({ added, removed }: QueryChanges<SimEntity>) => {
  added.forEach(e => {
    console.log(`  [Renderer] SPAWN  visual for "${e.name}" (${e.id})`);
  });
  removed.forEach(e => {
    console.log(`  [Renderer] DESPAWN visual for "${e.name}" (${e.id})`);
  });
});

// ---------------------------------------------------------------------------
// Step 5: Initial update
//
// update() re-evaluates the predicate for every entity in the iterable.
// If the result differs from the previous matched set, onChange fires.
// On the very first call, all newly-matched entities appear in `added`.
// ---------------------------------------------------------------------------

console.log('--- Initial update ---');
console.log('');

hostileQuery.update(entities);
onlineQuery.update(entities);

console.log('');
console.log(`  Hostile set:  [${hostileQuery.current.map(e => e.name).join(', ')}]`);
console.log(`  Online set:   [${onlineQuery.current.map(e => e.name).join(', ')}]`);

// ---------------------------------------------------------------------------
// Step 6: No-op update
//
// When nothing changes, update() does NOT call onChange.
// This is the key performance property — O(n) predicate check, O(0) callbacks.
// ---------------------------------------------------------------------------

console.log('');
console.log('--- No-op update (nothing changed) ---');
console.log('');

let changeCount = 0;
const unsub = hostileQuery.onChange(() => changeCount++);

hostileQuery.update(entities); // same entities, same state
console.log(`  onChange fired: ${changeCount} times (expected: 0)`);

unsub(); // unsubscribe the counter listener

// ---------------------------------------------------------------------------
// Step 7: Reactive to entity state changes
//
// Mutate entities and call update() — the query reacts automatically.
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Guard becomes hostile ---');
console.log('');

const guard = entities.find(e => e.id === 'guard_01')!;
guard.hostile = true;
hostileQuery.update(entities); // guard now matches → onChange fires

console.log('');
console.log('--- Wolf dies ---');
console.log('');

const wolf = entities.find(e => e.id === 'wolf_01')!;
wolf.isAlive = false;
hostileQuery.update(entities); // wolf no longer matches → onChange fires

console.log('');
console.log(`  Hostile set: [${hostileQuery.current.map(e => e.name).join(', ')}]`);

// ---------------------------------------------------------------------------
// Step 8: Player walks near an NPC — trigger online mode
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Player approaches Stalker — Stalker goes online ---');
console.log('');

const stalker = entities.find(e => e.id === 'npc_02')!;
stalker.isOnline = true;
onlineQuery.update(entities); // stalker now matches → renderer spawns visual

console.log('');
console.log('--- Player moves away — Stalker goes offline ---');
console.log('');

stalker.isOnline = false;
onlineQuery.update(entities); // stalker leaves → renderer despawns visual

// ---------------------------------------------------------------------------
// Step 9: Manual track / untrack
//
// Bypass the predicate for special cases. Useful when an external system
// decides membership (e.g. "always track the player regardless of predicate").
// Fires onChange just like update().
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Manual track: force-add dead wolf to hostile set ---');
console.log('');

// wolf.isAlive is false → predicate returns false → would NOT match
// But we manually track it for a special "dying aggro" case
hostileQuery.track(wolf);
console.log(`  Hostile set: [${hostileQuery.current.map(e => e.name).join(', ')}]`);

console.log('');
console.log('--- Manual untrack: remove wolf ---');
console.log('');

hostileQuery.untrack(wolf);
console.log(`  Hostile set: [${hostileQuery.current.map(e => e.name).join(', ')}]`);

// ---------------------------------------------------------------------------
// Step 10: has() and size
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Query inspection ---');
console.log('');

const bandit = entities.find(e => e.id === 'bandit_01')!;
console.log(`  hostileQuery.has(bandit): ${hostileQuery.has(bandit)}`);   // true
console.log(`  hostileQuery.has(wolf):   ${hostileQuery.has(wolf)}`);     // false
console.log(`  hostileQuery.size:        ${hostileQuery.size}`);

// ---------------------------------------------------------------------------
// Step 11: dispose() — cleanup when done
//
// Clears the matched set and removes all listeners.
// After dispose(), track/untrack/update fire no callbacks.
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Dispose ---');
console.log('');

hostileQuery.dispose();
onlineQuery.dispose();

console.log(`  hostileQuery.size after dispose(): ${hostileQuery.size}`); // 0
console.log('  All listeners removed — no further callbacks will fire');

console.log('');
console.log('Done.');
