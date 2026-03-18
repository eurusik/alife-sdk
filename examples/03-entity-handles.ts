/**
 * 03-entity-handles.ts
 *
 * Entity Handles — versioned references that protect against use-after-free.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/03-entity-handles.ts
 *
 * The problem:
 *   In a long-running simulation, entities die and their IDs or slots get
 *   reused. If you store a raw string ID and the original entity is gone,
 *   you silently operate on the WRONG entity. This is a classic
 *   use-after-free bug.
 *
 * The solution:
 *   EntityHandle encodes both a SLOT INDEX and a GENERATION COUNTER in a
 *   single number. When a slot is freed and reused, the generation bumps.
 *   Old handles become stale automatically — resolve() returns null instead
 *   of the new occupant's data.
 *
 * What we build here:
 *   - A squad that tracks members via handles
 *   - Simulated combat where NPC health drops and some die
 *   - Demonstrate that handles to dead NPCs return null after free
 *   - Demonstrate slot reuse: old handle stays stale even when a new
 *     NPC takes the same slot
 *
 * No kernel, no plugins — EntityHandleManager is a standalone primitive.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  EntityHandleManager,
  NULL_HANDLE,
  isValidHandle,
  handleToString,
} from '@alife-sdk/core/entity';
import type { EntityHandle } from '@alife-sdk/core/entity';

// ---------------------------------------------------------------------------
// Step 1: NPC registry
//
// In a real game this is your entity store (Phaser, Pixi, plain Map).
// Here we use a simple Map from entity ID to NPC data.
// ---------------------------------------------------------------------------

interface NpcData {
  id:   string;
  name: string;
  hp:   number;
  dead: boolean;
}

const world = new Map<string, NpcData>([
  ['npc_001', { id: 'npc_001', name: 'Wolf',   hp: 100, dead: false }],
  ['npc_002', { id: 'npc_002', name: 'Strelok', hp: 80,  dead: false }],
  ['npc_003', { id: 'npc_003', name: 'Duty',   hp: 120, dead: false }],
]);

// ---------------------------------------------------------------------------
// Step 2: EntityHandleManager
//
// The manager allocates versioned handles. Each handle is a compact number
// encoding a 20-bit slot index + 28-bit generation counter.
//
// API:
//   alloc(id)        → EntityHandle  (allocate a slot for this entity id)
//   free(handle)     → void          (release slot; bumps generation)
//   resolve(handle)  → TId | null    (null if stale or freed)
//   isAlive(handle)  → boolean
//   size             → number of live slots
// ---------------------------------------------------------------------------

const manager = new EntityHandleManager<string>(); // TId = string (entity ID)

// ---------------------------------------------------------------------------
// Step 3: Squad — uses handles to track members
//
// A squad stores handles, not raw IDs. When a member dies, we free their
// handle. Any other system that cached the same handle will get null from
// resolve() — no silent bugs.
// ---------------------------------------------------------------------------

class Squad {
  private readonly members = new Map<string, EntityHandle>(); // role → handle

  add(role: string, entityId: string): EntityHandle {
    const handle = manager.alloc(entityId);
    this.members.set(role, handle);
    console.log(`  [Squad] Added "${role}" → ${handleToString(handle)} (entityId: ${entityId})`);
    return handle;
  }

  remove(role: string): void {
    const handle = this.members.get(role);
    if (handle === undefined) return;
    manager.free(handle);
    this.members.delete(role);
    console.log(`  [Squad] Removed "${role}" — handle freed`);
  }

  getEntityId(role: string): string | null {
    const handle = this.members.get(role);
    if (handle === undefined) return null;
    return manager.resolve(handle);
  }

  isAlive(role: string): boolean {
    const handle = this.members.get(role);
    if (handle === undefined) return false;
    return manager.isAlive(handle);
  }

  report(): void {
    console.log(`  [Squad] Members (${this.members.size}):`);
    for (const [role, handle] of this.members) {
      const entityId = manager.resolve(handle);
      const npc = entityId ? world.get(entityId) : null;
      console.log(
        `    ${role}: handle=${handleToString(handle)}  ` +
        `entityId=${entityId ?? 'STALE'}  ` +
        `alive=${manager.isAlive(handle)}  ` +
        `hp=${npc?.hp ?? 'N/A'}`,
      );
    }
  }
}

const squad = new Squad();

// ---------------------------------------------------------------------------
// Step 4: Build the squad
// ---------------------------------------------------------------------------

console.log('=== Building squad ===');
console.log('');

// Save the handle returned by add() — external system caches it
const leaderHandleBefore: EntityHandle = squad.add('leader', 'npc_001');
squad.add('flanker', 'npc_002');
squad.add('support', 'npc_003');

console.log('');
squad.report();

// External system (e.g. combat tracker) saved this handle at registration time
console.log(`\n  External system cached leader handle: ${handleToString(leaderHandleBefore)}`);

// ---------------------------------------------------------------------------
// Step 5: Simulate combat — the leader dies
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Combat: leader takes fatal damage ===');
console.log('');

const leaderNpc = world.get('npc_001')!;
leaderNpc.hp = 0;
leaderNpc.dead = true;
console.log(`  npc_001 (Wolf) has died — removing from squad`);

// Remove the leader from the squad — this frees the handle
squad.remove('leader');

console.log('');
squad.report();

// ---------------------------------------------------------------------------
// Step 6: Stale handle detection
//
// The external system cached leaderHandleBefore before the leader died.
// After free(), it should resolve to null.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Stale handle detection ===');
console.log('');

const resolvedAfterFree = manager.resolve(leaderHandleBefore);
console.log(`  resolve(leaderHandleBefore) = ${resolvedAfterFree}`);   // null
console.log(`  isAlive(leaderHandleBefore) = ${manager.isAlive(leaderHandleBefore)}`); // false
console.log(`  isValidHandle(NULL_HANDLE)  = ${isValidHandle(NULL_HANDLE)}`);

// ---------------------------------------------------------------------------
// Step 7: Slot reuse — new entity takes the freed slot
//
// When a new NPC is allocated, they may reuse a freed slot. The generation
// counter bumps so old handles point to nothing even if the slot index is
// the same.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Slot reuse — new NPC takes leader slot ===');
console.log('');

// A new NPC joins the world
world.set('npc_004', { id: 'npc_004', name: 'Rookie', hp: 60, dead: false });
squad.add('leader', 'npc_004'); // may reuse freed slot

const newLeaderHandle = squad.getEntityId('leader');
console.log(`  New leader entityId: ${newLeaderHandle}`); // npc_004

// The old cached handle is STILL stale — different generation
const resolvedOld = manager.resolve(leaderHandleBefore);
console.log(`  Old cached handle resolves to: ${resolvedOld ?? 'null (stale)'}`); // null

console.log('');
squad.report();

// ---------------------------------------------------------------------------
// Step 8: manager.size tracks live slots
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Manager state ===');
console.log('');

// free() on a stale handle is always safe — it's a no-op.
// Useful when external systems clean up handles they cached, regardless of
// whether the slot was already freed by the squad.
manager.free(leaderHandleBefore);

console.log(`  Live handles in manager: ${manager.size}`);
// 3 live slots: leader=npc_004, flanker=npc_002, support=npc_003

// ---------------------------------------------------------------------------
// Step 9: NULL_HANDLE
//
// NULL_HANDLE (value 0) is a sentinel for "no entity". Always invalid.
// Use it to initialize optional handle fields.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== NULL_HANDLE sentinel ===');
console.log('');

const noHandle: EntityHandle = NULL_HANDLE;
console.log(`  NULL_HANDLE value:          ${noHandle}`);
console.log(`  isValidHandle(NULL_HANDLE): ${isValidHandle(NULL_HANDLE)}`);    // false
console.log(`  resolve(NULL_HANDLE):       ${manager.resolve(NULL_HANDLE)}`);  // null

console.log('');
console.log('Done.');
