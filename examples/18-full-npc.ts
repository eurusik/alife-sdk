/**
 * 18-full-npc.ts
 *
 * Capstone example — all core AI primitives working together in one NPC.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
 *
 * What we build here:
 *   - A S.T.A.L.K.E.R.-style "Veteran Stalker" named Kozak
 *   - StateMachine (3 states: PATROL → ALERT → COMBAT) drives top-level behaviour
 *   - MemoryBank tracks enemies Kozak has seen or heard, with confidence decay
 *   - DangerManager tracks active hazards (grenades, gunfire) in the area
 *   - GOAPPlanner decides the combat strategy each time Kozak enters COMBAT
 *   - BehaviorTree + Blackboard executes the current plan step tick by tick
 *
 * Architecture in brief:
 *   FSM.PATROL  → simple waypoint loop, transitions to ALERT when memory detects sound
 *   FSM.ALERT   → uses MemoryBank to search last known position, bumps to COMBAT
 *   FSM.COMBAT  → checks DangerManager, runs GOAPPlanner, ticks BehaviorTree
 *
 * This example is intentionally sequential (no real game loop) so the full
 * 10-tick story can be read from top to bottom without understanding a
 * game engine runtime.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler, IAIStateDefinition } from '@alife-sdk/core/ai';
import { MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';
import { DangerManager, DangerType } from '@alife-sdk/core/ai';
import { GOAPPlanner, ActionStatus, WorldState } from '@alife-sdk/core/ai';
import { Blackboard, Selector, Sequence, Condition, Task } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

// ---------------------------------------------------------------------------
// Kozak entity
//
// All five AI systems operate on the same entity object — no duplication of
// state. The extra fields (hp, ammo, hasMedkit, targetEliminated, waypointIdx)
// are Kozak's own game-level data; IEntity provides the identity contract the
// SDK uses (id, entityType, isAlive, etc.).
//
// In a real game this would be a Phaser sprite or an ECS entity with components.
// Here it is a plain object — nothing in the SDK cares about the container.
// ---------------------------------------------------------------------------

interface KozakEntity extends IEntity {
  hp: number;
  ammo: number;
  hasMedkit: boolean;
  targetEliminated: boolean;
  waypointIdx: number;
}

// Create Kozak as a plain object satisfying both KozakEntity and IEntity.
const kozak: KozakEntity = {
  id:               'kozak_veteran',
  entityType:       'npc',
  isAlive:          true,
  x: 50, y: 50,
  active:           true,
  hp:               100,
  ammo:             12,
  hasMedkit:        true,
  targetEliminated: false,
  waypointIdx:      0,
  setPosition(x, y) { this.x = x; this.y = y; },
  setActive(v)      { this.active = v; return this; },
  setVisible(_v)    { return this; },
  hasComponent(_n)  { return false; },
  getComponent<T>(_n: string): T { throw new Error('no components'); },
};

// ---------------------------------------------------------------------------
// MemoryBank — episodic memory with channel-based confidence decay
//
// Kozak remembers enemies per source: a sound fades in ~7 s, a visual sighting
// in ~17 s. We inject a manual clock so the simulation tick controls time.
//
// Why a manual clock? In Node.js examples we want deterministic behaviour:
// the same script always produces the same output regardless of wall time.
// In a real game you would pass () => game.time.now or () => performance.now().
// ---------------------------------------------------------------------------

let gameClock = 0;                      // game time in seconds, advanced each tick

const memory = new MemoryBank({
  timeFn: () => gameClock,
  maxRecords: 20,
  channelDecayRates: {
    [MemoryChannel.SOUND]:  0.15,       // sound is fleeting — 0.4 confidence lasts ~2.7 s
    [MemoryChannel.VISUAL]: 0.06,       // visual lingers — 0.9 confidence lasts ~14 s
    [MemoryChannel.HIT]:    0.02,       // getting hit is hard to forget
  },
});

// ---------------------------------------------------------------------------
// DangerManager — active hazard tracking
//
// Kozak checks this every COMBAT tick. If his position is dangerous he
// repositions before attacking. A DangerManager with threshold 0.4 means
// Kozak — a veteran — tolerates light gunfire but dives away from grenades.
// (A rookie might use the default 0.1 threshold and flee at the first shot.)
// ---------------------------------------------------------------------------

const dangers = new DangerManager(0.4);   // veteran threshold — not easily spooked

// ---------------------------------------------------------------------------
// GOAP actions — the possible moves in Kozak's combat "action space"
//
// Each action is a small reusable object. The planner assembles them into a
// sequence that achieves the goal (targetEliminated = true) at lowest cost.
// We keep them simple here: no multi-tick execution — each action reports
// SUCCESS immediately so the example stays short and readable.
// ---------------------------------------------------------------------------

// FindCover — always available; gets Kozak to safety first ----------------

// HealSelf — only available when carrying a medkit -----------------------

// FindMedkit — scavenge the area when Kozak has no medkit ----------------

// Attack — the goal action; requires health, cover, and a loaded weapon --

// Planner — stateless; shared across all Kozak-type NPCs -----------------
const planner = new GOAPPlanner();
planner.registerAction({
  id: 'FindCover',
  cost: 2,   // not free — costs time to move to cover
  preconditions: {},
  effects:       { inCover: true },
});
planner.registerAction({
  id: 'HealSelf',
  cost: 1,   // cheap: just pop the medkit
  preconditions: { hasMedkit: true },
  effects:       { isHealthy: true },
});
planner.registerAction({
  id: 'FindMedkit',
  cost: 3,   // higher cost — takes time to search
  preconditions: {},
  effects:       { hasMedkit: true },
});
planner.registerAction({
  id: 'Attack',
  cost: 1,   // final step is cheap once all conditions are met
  preconditions: { isHealthy: true, inCover: true },
  effects:       { targetEliminated: true },
});

// Goal stays the same for every GOAP call: eliminate the target.
const combatGoal = WorldState.from({ targetEliminated: true });

// ---------------------------------------------------------------------------
// BehaviorTree + Blackboard — executes one step of the current GOAP plan
//
// The tree answers: "given what I can currently perceive, should I shoot or
// take cover right now?" This is intentionally simpler than the GOAP plan —
// the tree handles moment-to-moment execution; GOAP handles strategy.
//
// Blackboard keys:
//   canSeeEnemy — Kozak has line-of-sight on the target this tick
//   ammo        — rounds in the current magazine
//   inCover     — Kozak is currently behind cover
// ---------------------------------------------------------------------------

type CombatBB = {
  canSeeEnemy: boolean;
  ammo:        number;
  inCover:     boolean;
};

const bb = new Blackboard<CombatBB>({
  canSeeEnemy: false,
  ammo:        12,
  inCover:     false,
});

// shootBranch: only fire if Kozak can see the enemy AND has ammo.
// Sequence = AND gate: both conditions must hold or the branch fails.
const shootBranch = new Sequence<CombatBB>([
  new Condition<CombatBB>((b) => !!b.get('canSeeEnemy')),
  new Condition<CombatBB>((b) => (b.get('ammo') ?? 0) > 0),
  new Task<CombatBB>((b) => {
    const remaining = (b.get('ammo') ?? 1) - 1;
    b.set('ammo', remaining);
    console.log(`  [BT] Kozak fires! Ammo remaining: ${remaining}`);
    return 'success';
  }),
]);

// coverTask: fallback when Kozak can't shoot — move to cover.
const coverTask = new Task<CombatBB>((b) => {
  b.set('inCover', true);
  console.log(`  [BT] Kozak moves to cover`);
  return 'success';
});

// Selector = OR gate: try shootBranch first, fall through to coverTask.
// This mirrors the GOAP precondition: Attack requires inCover, so the BT
// also prefers cover when it can't shoot.
const combatTree = new Selector<CombatBB>([
  shootBranch,
  coverTask,
]);

// ---------------------------------------------------------------------------
// FSM state handlers
//
// Each handler is stateless — per-NPC data lives on kozak or in the
// memory/danger/BT shared objects above. In a large game you would
// instantiate separate memory/danger objects per NPC; here one NPC shares
// them with the reader for simplicity.
// ---------------------------------------------------------------------------

// Patrol waypoints — three positions Kozak walks between.
const WAYPOINTS = [
  { x: 50,  y: 50  },
  { x: 120, y: 50  },
  { x: 120, y: 120 },
];

const patrolHandler: IStateHandler = {
  enter(entity) {
    const e = entity as KozakEntity; // widen once; IEntity doesn't expose NPC-specific fields
    if (!e.isAlive) return;
    console.log(`  [PATROL.enter] Kozak begins patrol`);
    e.waypointIdx = 0;
    // Clear memory on return to patrol — the threat has been neutralised.
    // This prevents the PATROL→ALERT transition from firing again immediately
    // because of the still-live bandit_north record from the previous fight.
    // NOTE: if you add states between COMBAT and PATROL, override this in
    // that state's enter() too — patrol.enter() is the only place that clears it.
    memory.clear();
  },

  update(entity, _delta) {
    const e  = entity as KozakEntity;
    if (!e.isAlive) return;
    const wp = WAYPOINTS[e.waypointIdx % WAYPOINTS.length];
    e.setPosition(wp.x, wp.y);
    console.log(`  [PATROL.update] Kozak at waypoint ${e.waypointIdx} (${wp.x}, ${wp.y})`);
    // Advance to next waypoint each tick (simplified — no movement interpolation).
    e.waypointIdx = (e.waypointIdx + 1) % WAYPOINTS.length;
  },

  exit(_entity) {
    console.log(`  [PATROL.exit] Kozak leaves patrol`);
  },
};

const alertHandler: IStateHandler = {
  enter(entity) {
    const e = entity as KozakEntity;
    if (!e.isAlive) return;
    console.log(`  [ALERT.enter] Kozak heard something — going alert`);
    // Decay memory every frame while alert so confidence naturally drops if
    // Kozak stops getting new information.
    memory.update(0); // synchronise the bank timestamp on entry
    e.targetEliminated = false;
  },

  update(_entity, _delta) {
    // Ask MemoryBank: what's the most credible threat right now?
    const topThreat = memory.getMostConfident();
    if (topThreat) {
      console.log(
        `  [ALERT.update] Searching for ${topThreat.sourceId} ` +
        `— last seen at (${topThreat.position.x}, ${topThreat.position.y}) ` +
        `conf=${topThreat.confidence.toFixed(2)}`
      );
    } else {
      console.log(`  [ALERT.update] No threats in memory — scanning area`);
    }
  },

  exit(_entity) {
    console.log(`  [ALERT.exit] Kozak upgrades threat assessment`);
  },
};

const combatHandler: IStateHandler = {
  enter(entity) {
    const e = entity as KozakEntity;
    if (!e.isAlive) return;
    console.log(`  [COMBAT.enter] Kozak engages`);
    // Move Kozak to the combat area — near the bandit's last known position.
    // In a real game the NavMesh pathfinder would route him here; we set it
    // directly so the danger-zone check works correctly in tick 6.
    e.setPosition(130, 110);
    // Sync the BT blackboard with the entity's inventory on combat entry.
    bb.set('ammo', e.ammo);
    bb.set('inCover', false);
    bb.set('canSeeEnemy', true);    // assume line of sight on entry
  },

  update(entity, _delta) {
    const e = entity as KozakEntity;

    // 1. Check DangerManager — is Kozak's current position safe?
    //    This runs before the GOAP plan so a grenade interrupts all other logic.
    const kozakPos = { x: e.x, y: e.y };
    if (dangers.isDangerous(kozakPos)) {
      const safeDir = dangers.getSafeDirection(kozakPos);
      console.log(
        `  [COMBAT.update] Kozak repositions! ` +
        `Threat=${dangers.getThreatAt(kozakPos).toFixed(2)} ` +
        `safe dir=(${safeDir.x.toFixed(2)}, ${safeDir.y.toFixed(2)})`
      );
      // In a real game: move entity by safeDir * speed * delta.
      // We simulate the reposition by moving a few units in the safe direction.
      e.setPosition(e.x + safeDir.x * 20, e.y + safeDir.y * 20);
      bb.set('canSeeEnemy', false); // can't aim while diving away from a grenade
      bb.set('inCover', false);     // left cover to dodge
      return;                       // skip GOAP and BT this tick — survival first
    }

    // 2. Run GOAPPlanner to get the current strategy.
    //    Build world state from entity + blackboard so the planner has
    //    accurate information. Re-plan each tick so Kozak adapts if he
    //    uses his medkit or loses cover.
    //    NOTE: re-planning every tick is fine for a single NPC in an example.
    //    In a real game with many NPCs, cache the plan and replan every 3-5 s
    //    or when world state changes materially — see GOAP.md "Performance notes".
    const worldState = WorldState.from({
      isHealthy:  e.hp >= 50,         // "healthy" means above half HP
      hasMedkit:  e.hasMedkit,
      inCover:    bb.get('inCover') ?? false,
    });

    const plan = planner.plan(worldState, combatGoal);
    if (!plan || plan.length === 0) {
      console.log(`  [COMBAT.update] Kozak: no plan — holding position`);
      return;
    }

    console.log(`  [COMBAT.update] GOAP plan: ${plan.map(a => a.id).join(' → ')}`);

    // 3. Tick BehaviorTree to execute the first plan step.
    //    GOAP provides strategy ("what to do next") — plan[0] is the current action.
    //    BT provides tactics ("how exactly to do it this frame").
    //    The contract: BT fires the weapon; we check plan[0].id === 'Attack' to
    //    confirm the strategy also says "attack now" before marking target eliminated.
    //    If BT succeeds on any other plan step (e.g. FindCover), we just continue.
    const btResult = combatTree.tick(bb);
    console.log(`  [COMBAT.update] BT result: ${btResult}`);

    // Sync entity state back from blackboard after BT runs.
    e.ammo = bb.get('ammo') ?? e.ammo;

    // Mark target eliminated once the BT successfully fires and the GOAP
    // plan has Attack as the next step — goal achieved.
    if (btResult === 'success' && plan[0].id === 'Attack') {
      console.log(`  [COMBAT.update] Target eliminated — Kozak stands down`);
      e.targetEliminated = true;
    }
  },

  exit(entity) {
    const e = entity as KozakEntity;
    console.log(`  [COMBAT.exit] Kozak disengages`);
    // Reset combat flags so a future COMBAT entry starts fresh.
    e.targetEliminated = false;
  },
};

// ---------------------------------------------------------------------------
// Build the FSM registry
//
// Transition conditions are the "wiring" between states. They are evaluated
// every time fsm.update() is called, highest priority first.
// ---------------------------------------------------------------------------

const registry = new AIStateRegistry();

registry
  .register('PATROL', {
    handler: patrolHandler,
    tags: ['passive'],
    transitionConditions: [
      {
        // Sound memory with confidence > 0.3 is enough to make Kozak alert.
        // A veteran goes alert at sounds that a rookie might ignore —
        // adjust this threshold to tune NPC awareness per faction.
        targetState: 'ALERT',
        priority: 10,
        condition: (_e) => {
          const top = memory.getMostConfident();
          return top !== undefined && top.confidence > 0.3;
        },
      },
    ],
  } satisfies IAIStateDefinition)

  .register('ALERT', {
    handler: alertHandler,
    tags: ['active'],
    transitionConditions: [
      {
        // High-confidence memory (> 0.7) means Kozak is sure — time to fight.
        targetState: 'COMBAT',
        priority: 20,
        condition: (_e) => {
          const top = memory.getMostConfident();
          return top !== undefined && top.confidence > 0.7;
        },
      },
      {
        // Memory completely empty → false alarm, back to patrol.
        targetState: 'PATROL',
        priority: 5,
        condition: (_e) => memory.size === 0,
      },
    ],
  } satisfies IAIStateDefinition)

  .register('COMBAT', {
    handler: combatHandler,
    tags: ['hostile', 'active'],
    transitionConditions: [
      {
        // Threat neutralised → mission complete, resume patrol.
        targetState: 'PATROL',
        priority: 10,
        condition: (e) => (e as KozakEntity).targetEliminated,
      },
    ],
  } satisfies IAIStateDefinition);

// ---------------------------------------------------------------------------
// Create the FSM
//
// The FSM owns the entity and registry. Construction immediately calls
// patrolHandler.enter(kozak) — Kozak starts on patrol.
// ---------------------------------------------------------------------------

const fsm = new StateMachine(kozak, registry, 'PATROL');

// Log every state change so the reader can follow the story in the output.
fsm.onChange((from, to) => {
  console.log(`  [FSM] ${from} → ${to}`);
});

// ---------------------------------------------------------------------------
// Simulation loop — 10 ticks, 1 second each
//
// Tick 1-2: PATROL — no threats, Kozak walks waypoints
// Tick 3:   PATROL — bandit sound heard (conf=0.4); decays to ~0.25 → stays PATROL
// Tick 4:   PATROL — visual confirmation (conf=0.95) → PATROL → ALERT this tick
// Tick 5:   ALERT  — conf=0.83 > threshold 0.7 → ALERT → COMBAT this tick
// Tick 6:   COMBAT — grenade lands; DangerManager threat=0.90 > 0.4; Kozak dives
// Tick 7:   COMBAT — Kozak still repositioning; grenade still live (1000ms left)
// Tick 8:   COMBAT — grenade expires (3000ms TTL); Kozak re-acquires and fires;
//                    targetEliminated=true → COMBAT → PATROL this tick
// Tick 9-10: PATROL — threat eliminated, memory cleared, Kozak resumes patrol
// ---------------------------------------------------------------------------

const DELTA = 1.0; // each tick is 1 second of game time

console.log('=== Kozak simulation — 10 ticks ===');
console.log('');

for (let tick = 1; tick <= 10; tick++) {
  gameClock += DELTA;           // advance the game clock so MemoryBank timestamps work
  console.log(`--- Tick ${tick} (t=${gameClock}s, state=${fsm.state}) ---`);

  // ---- Per-tick world events ----

  if (tick === 3) {
    // A bandit was heard in the bushes to the northeast.
    // Confidence 0.4 is above the PATROL→ALERT threshold (0.3).
    console.log(`  [World] Gunshot heard from the northeast`);
    memory.remember({
      sourceId:   'bandit_north',
      channel:    MemoryChannel.SOUND,
      position:   { x: 140, y: 30 },
      confidence: 0.4,
    });
  }

  if (tick === 4) {
    // Kozak peeks around a crate and spots the bandit directly.
    // Bump confidence to 0.95 — well above the ALERT→COMBAT threshold (0.7)
    // and high enough to survive one memory.update() decay tick (0.06/s) and
    // still read > 0.7 when fsm.update() evaluates the transition conditions.
    console.log(`  [World] Kozak spots the bandit — visual confirmation`);
    memory.remember({
      sourceId:   'bandit_north',
      channel:    MemoryChannel.VISUAL,
      position:   { x: 138, y: 32 },
      confidence: 0.95,
    });
  }

  if (tick === 6) {
    // Enemy throws a grenade toward Kozak's combat position at ~(130, 110).
    // TTL 3000 ms = 3 ticks at 1000 ms each → auto-expires after tick 8.
    // threatScore 0.9 far exceeds Kozak's veteran threshold (0.4) so he dives.
    console.log(`  [World] Grenade lands near Kozak!`);
    dangers.addDanger({
      id:          'grenade_01',
      type:        DangerType.GRENADE,
      position:    { x: 125, y: 105 },   // close to Kozak's combat position
      radius:      50,
      threatScore: 0.9,
      remainingMs: 3_000,
    });
  }

  if (tick === 8) {
    // Grenade has exploded (TTL expired after 3 ticks × 1000 ms).
    // DangerManager already pruned it via update(). Kozak re-acquires line
    // of sight and finds cover in the rubble left by the blast.
    console.log(`  [World] Grenade detonated — area clear, Kozak re-acquires target`);
    bb.set('canSeeEnemy', true);
    bb.set('inCover', true);     // blast debris provides new cover
  }

  // ---- Decay memory and danger TTLs every tick ----

  // memory.update() reduces confidence by channelDecayRate × delta per record.
  // Records below minConfidence (default 0.05) are auto-pruned.
  memory.update(DELTA);

  // dangers.update() subtracts deltaMs from each danger's remainingMs.
  // Expired dangers are removed automatically — no manual cleanup needed.
  dangers.update(DELTA * 1_000);  // DangerManager uses milliseconds

  // ---- Run one FSM tick ----
  // update() calls currentHandler.update(), then evaluates auto-transitions.
  fsm.update(DELTA);

  console.log('');
}

// ---------------------------------------------------------------------------
// Final state inspection
// ---------------------------------------------------------------------------

console.log('=== Simulation complete ===');
console.log(`  Final FSM state    : ${fsm.state}`);
console.log(`  Transition history :`);
fsm.getHistory().forEach((ev, i) => {
  console.log(`    [${i}] ${ev.from} → ${ev.to}`);
});

// Clean up — calls patrolHandler.exit() on the current active state.
fsm.destroy();
console.log('');
console.log('Done.');
