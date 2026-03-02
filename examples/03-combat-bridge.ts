/**
 * 03-combat-bridge.ts
 *
 * Realistic offline combat — implementing ISimulationBridge.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/03-combat-bridge.ts
 *
 * The problem with examples 01 and 02:
 *   They use createNoOpBridge() which returns 0 effective damage — NPCs
 *   fight forever without their HP ever changing.
 *
 * In a real game engine the bridge delegates to your component system:
 *   getEffectiveDamage → HealthComponent.computeDamage(amount, armourType)
 *   adjustMorale       → ALifeComponent.morale += delta
 *   isAlive            → HealthComponent.isAlive()
 *
 * Here we implement the same interface with a plain Map so the simulation
 * has a real target to fight against: damage lands, HP drops, NPCs die.
 *
 * What we build:
 *   - InMemoryBridge — a minimal ISimulationBridge backed by a Map<id, state>
 *   - 4 NPCs across two factions (2 stalkers, 2 bandits) on the same terrain
 *   - A simulation loop that runs until one faction is wiped out or 20 ticks
 *   - NPC_DIED events printed live so you can follow the battle
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ALifeKernel, Ports, FactionBuilder, ALifeEvents } from '@alife-sdk/core';
import type {
  IEntityAdapter,
  IEntityFactory,
  IPlayerPositionProvider,
  Vec2,
} from '@alife-sdk/core';
import { FactionsPlugin } from '@alife-sdk/core';
import { SimulationPlugin, SimulationPorts } from '@alife-sdk/simulation';
import type { ISimulationBridge } from '@alife-sdk/simulation';
import { SmartTerrain } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Step 1: InMemoryBridge — realistic ISimulationBridge without a game engine
//
// In a real Phaser/Pixi game this delegates to your health and morale
// components. Here we track state in a plain Map so the numbers are real.
//
// Key insight: the OfflineCombatResolver already mutates record.currentHp
// directly. The bridge's job is:
//   getEffectiveDamage → apply armour/immunity multipliers (we use 1:1 here)
//   adjustMorale       → track morale so panics can fire
//   isAlive            → the resolver uses currentHp directly, but the bridge
//                        isAlive() is queried for death checks
// ---------------------------------------------------------------------------

interface NPCState {
  hp: number;
  morale: number;
}

class InMemoryBridge implements ISimulationBridge {
  private readonly state = new Map<string, NPCState>();

  /** Register an NPC before the simulation starts. */
  register(entityId: string, hp: number): void {
    this.state.set(entityId, { hp, morale: 0 });
  }

  /** Read current HP (mirrors record.currentHp after combat mutates it). */
  sync(entityId: string, currentHp: number): void {
    const s = this.state.get(entityId);
    if (s) s.hp = currentHp;
  }

  getMorale(entityId: string): number {
    return this.state.get(entityId)?.morale ?? 0;
  }

  // -- ISimulationBridge ---

  isAlive(entityId: string): boolean {
    const s = this.state.get(entityId);
    // An NPC is alive if its HP is above zero.
    return s != null && s.hp > 0;
  }

  /**
   * Return effective damage after armour.
   * This example uses full pass-through (armourMultiplier = 1.0).
   * A real implementation would look up the entity's armour type and
   * return `rawDamage * armour.resistanceFor(damageTypeId)`.
   */
  getEffectiveDamage(_entityId: string, rawDamage: number, _damageTypeId: string): number {
    return rawDamage; // no armour reduction — every hit lands full
  }

  /**
   * Apply typed damage. The OfflineCombatResolver does NOT call this —
   * it writes record.currentHp directly. Implement it so callers outside
   * the resolver (e.g. surge damage, hazards) can also use the bridge.
   */
  applyDamage(entityId: string, amount: number, _damageTypeId: string): boolean {
    const s = this.state.get(entityId);
    if (!s || s.hp <= 0) return false;
    s.hp -= amount;
    return s.hp <= 0; // returns true if this hit killed the entity
  }

  adjustMorale(entityId: string, delta: number, _reason: string): void {
    const s = this.state.get(entityId);
    if (!s) return;
    s.morale = Math.max(-1, Math.min(1, s.morale + delta));
    // Uncomment to trace morale changes tick by tick:
    // console.log(`    [morale] ${entityId} ${delta > 0 ? '+' : ''}${delta.toFixed(2)} (${_reason}) → ${s.morale.toFixed(2)}`);
  }
}

// ---------------------------------------------------------------------------
// Step 2: Minimal port stubs (same as examples 01/02)
// ---------------------------------------------------------------------------

const stubEntityAdapter: IEntityAdapter = {
  getPosition:       (_id)         => null,
  isAlive:           (_id)         => true,
  hasComponent:      (_id, _name)  => false,
  getComponentValue: (_id, _name)  => null,
  setPosition:       (_id, _pos)   => {},
  setActive:         (_id, _v)     => {},
  setVisible:        (_id, _v)     => {},
  setVelocity:       (_id, _v)     => {},
  getVelocity:       (_id)         => ({ x: 0, y: 0 }),
  setRotation:       (_id, _v)     => {},
  teleport:          (_id, _pos)   => {},
  disablePhysics:    (_id)         => {},
  setAlpha:          (_id, _v)     => {},
  playAnimation:     (_id, _key)   => {},
  hasAnimation:      (_id, _key)   => false,
};

let _counter = 0;
const stubEntityFactory: IEntityFactory = {
  createNPC:     (_req) => `npc_${++_counter}`,
  createMonster: (_req) => `monster_${++_counter}`,
  destroyEntity: (_id)  => {},
};

const stubPlayerPosition: IPlayerPositionProvider = {
  // Player is far away — all NPCs stay offline, driven by the tick pipeline.
  getPlayerPosition: (): Vec2 => ({ x: 9999, y: 9999 }),
};

// ---------------------------------------------------------------------------
// Step 3: Build the kernel with the InMemoryBridge
// ---------------------------------------------------------------------------

const bridge = new InMemoryBridge();

const kernel = new ALifeKernel();
kernel.provide(Ports.EntityAdapter,  stubEntityAdapter);
kernel.provide(Ports.EntityFactory,  stubEntityFactory);
kernel.provide(Ports.PlayerPosition, stubPlayerPosition);
kernel.provide(SimulationPorts.SimulationBridge, bridge); // ← real bridge, not noOp

// ---------------------------------------------------------------------------
// Step 4: Two hostile factions
// ---------------------------------------------------------------------------

const factionsPlugin = new FactionsPlugin();

factionsPlugin.factions.register(
  'stalker',
  new FactionBuilder('stalker').displayName('Stalker').relation('bandit', -80).build(),
);
factionsPlugin.factions.register(
  'bandit',
  new FactionBuilder('bandit').displayName('Bandit').relation('stalker', -80).build(),
);

// ---------------------------------------------------------------------------
// Step 5: Simulation plugin
//
// We increase detectionProbability to 100 so combat fires every tick
// (easier to observe in a short example). The default in production is lower
// to simulate the fog-of-war effect in large maps.
// ---------------------------------------------------------------------------

const sim = new SimulationPlugin({
  tickIntervalMs: 5_000,
  combat: {
    detectionProbability:  100,  // always detect enemies this tick (0–100)
    maxResolutionsPerTick: 4,    // up to 4 faction-pair exchanges per tick
    victoryBase:           0.55, // slight attacker advantage
    victoryProbMin:        0.1,
    victoryProbMax:        0.9,
    maxSizeAdvantage:      1.5,
    powerJitterMin:        0.8,  // damage varies ±20% around the base value
    powerJitterMax:        1.2,
    moraleHitPenalty:      -0.05,
    moraleKillBonus:        0.10,
    moraleAllyDeathPenalty:-0.08,
    combatLockMs:          3_000,
    damageTypeId:          'physical',
  },
});

// One terrain — both factions share it so combat triggers immediately.
const warZone = new SmartTerrain({
  id:       'war_zone',
  name:     'War Zone',
  bounds:   { x: 0, y: 0, width: 200, height: 200 },
  capacity: 10,
  jobs: [
    { type: 'guard', slots: 10, position: { x: 100, y: 100 } },
  ],
});

sim.addTerrain(warZone);

kernel.use(factionsPlugin);
kernel.use(sim);

kernel.init();
kernel.start();

// ---------------------------------------------------------------------------
// Step 6: Register NPCs
//
// All four start near the terrain so they assign quickly.
// Register them in the bridge too so isAlive() works correctly.
// ---------------------------------------------------------------------------

type NPCSpec = {
  entityId:    string;
  factionId:   string;
  position:    Vec2;
  combatPower: number;
  rank:        number;
  currentHp:   number;
};

const npcs: NPCSpec[] = [
  { entityId: 'stalker_wolf',  factionId: 'stalker', position: { x:  50, y:  50 }, combatPower: 70, rank: 3, currentHp: 100 },
  { entityId: 'stalker_bear',  factionId: 'stalker', position: { x:  80, y:  50 }, combatPower: 60, rank: 2, currentHp: 80  },
  { entityId: 'bandit_knife',  factionId: 'bandit',  position: { x: 150, y: 150 }, combatPower: 40, rank: 2, currentHp: 80  },
  { entityId: 'bandit_razor',  factionId: 'bandit',  position: { x: 130, y: 150 }, combatPower: 55, rank: 3, currentHp: 90  },
];

for (const spec of npcs) {
  bridge.register(spec.entityId, spec.currentHp);
  sim.registerNPC({
    ...spec,
    behaviorConfig: {
      retreatThreshold: 0.15,   // low — NPCs fight almost to the death
      panicThreshold:   -0.9,
      searchIntervalMs: 5_000,
      dangerTolerance:  5,
      aggression:       0.9,    // high — always prefer patrol/attack jobs
    },
    options: { type: 'human' },
  });
}

console.log('Registered NPCs:');
for (const spec of npcs) {
  console.log(`  ${spec.entityId} (${spec.factionId}) — HP ${spec.currentHp} power ${spec.combatPower} rank ${spec.rank}`);
}
console.log('');

// ---------------------------------------------------------------------------
// Step 7: Event listeners
// ---------------------------------------------------------------------------

kernel.events.on(ALifeEvents.TICK, ({ tick }) => {
  console.log(`\n[TICK ${tick}]`);
});

kernel.events.on(ALifeEvents.FACTION_CONFLICT, ({ factionA, factionB, zoneId }) => {
  console.log(`  CONFLICT ${factionA} vs ${factionB} at "${zoneId}"`);
});

// NPC_DIED fires exactly once per death — NPCBrain.onDeath() is idempotent.
// killedBy is the entity ID of the attacker (empty if death was non-combat).
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy, zoneId }) => {
  const killer = killedBy ? ` killed by "${killedBy}"` : '';
  console.log(`  *** NPC_DIED: "${npcId}"${killer} at "${zoneId || 'unknown'}" ***`);
});

// ---------------------------------------------------------------------------
// Step 8: Simulation loop
//
// After each tick we sync bridge HP from the records (so isAlive() is
// consistent with the actual HP the resolver wrote), then print a HP table.
// We stop early if one side is completely dead.
// ---------------------------------------------------------------------------

const MAX_TICKS = 20;

console.log('--- Battle begins ---');

for (let step = 0; step < MAX_TICKS; step++) {
  kernel.update(5_001);

  // Sync bridge HP from records.
  // The OfflineCombatResolver mutates record.currentHp directly — it does NOT
  // call bridge.applyDamage(). So after each tick we copy the HP back into our
  // bridge state so bridge.isAlive() returns the correct answer next tick.
  for (const spec of npcs) {
    const record = sim.getNPCRecord(spec.entityId);
    if (record) bridge.sync(spec.entityId, record.currentHp);
  }

  // Print HP table.
  for (const spec of npcs) {
    const record = sim.getNPCRecord(spec.entityId);
    if (!record) {
      console.log(`  ${spec.entityId.padEnd(14)} — REMOVED from simulation`);
      continue;
    }
    const hp = record.currentHp;
    const bar = hp > 0
      ? '█'.repeat(Math.ceil(hp / 10)) + '░'.repeat(10 - Math.ceil(hp / 10))
      : '──────────';
    console.log(`  ${spec.entityId.padEnd(14)} HP ${String(Math.max(0, hp)).padStart(3)} [${bar}] (${spec.factionId})`);
  }

  // Early exit: check if one faction has no surviving NPCs.
  const stalkerAlive = npcs.filter(s => s.factionId === 'stalker').some(s => {
    const r = sim.getNPCRecord(s.entityId);
    return r != null && r.currentHp > 0;
  });
  const banditAlive = npcs.filter(s => s.factionId === 'bandit').some(s => {
    const r = sim.getNPCRecord(s.entityId);
    return r != null && r.currentHp > 0;
  });

  if (!stalkerAlive || !banditAlive) {
    console.log('');
    if (!stalkerAlive && !banditAlive) {
      console.log(`  *** DRAW — both factions wiped out in the same tick ***`);
    } else {
      console.log(`  *** ${!stalkerAlive ? 'BANDITS' : 'STALKERS'} WIN — battle over after ${step + 1} tick(s) ***`);
    }
    break;
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Final HP ---');
for (const spec of npcs) {
  const record = sim.getNPCRecord(spec.entityId);
  const hp = record?.currentHp ?? 0;
  console.log(`  ${spec.entityId}: ${Math.max(0, hp)} HP`);
}

kernel.destroy();
console.log('');
console.log('Kernel destroyed. Done.');
