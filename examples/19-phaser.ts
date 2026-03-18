/**
 * 19-phaser.ts
 *
 * Reference template: integrating @alife-sdk/phaser into a Phaser 3 scene.
 *
 * ⚠️  NOT a runnable Node.js script — this requires a live Phaser 3 context
 *     (browser + WebGL/Canvas). Treat this file as a copy-paste starting point.
 *
 * What this shows:
 *   - createPhaserKernel — one-call facade that wires all SDK plugins
 *   - PhaserEntityAdapter  — sprite registry bridging Phaser sprites to IEntityAdapter
 *   - PhaserEntityFactory  — callback-based IEntityFactory (create/destroy NPCs)
 *   - PhaserPlayerPosition — reads live player position from a sprite
 *   - PhaserSimulationBridge — HP registry + immunity/morale callbacks
 *   - PhaserSocialPresenter  — callback-based ISocialPresenter (speech bubbles)
 *   - PhaserNPCSocialProvider — callback-based INPCSocialProvider (faction queries)
 *   - PhaserNPCContext + IPhaserNPCHost — per-NPC bridge to OnlineAIDriver
 *   - OnlineOfflineManager — hysteresis-based NPC streaming (online ↔ offline)
 *
 * Architecture overview:
 *
 *   Phaser Scene
 *     ↓
 *   createPhaserKernel()      ← one-call setup
 *     ├─ PhaserEntityAdapter  ← sprite registry
 *     ├─ PhaserEntityFactory  ← spawn/destroy callbacks
 *     ├─ PhaserPlayerPosition ← live player coords
 *     ├─ PhaserSimulationBridge ← HP + damage
 *     └─ plugins: Factions, Spawn, Simulation, AI, Social
 *
 *   Per NPC (online):
 *     PhaserNPCContext (IPhaserNPCHost) → OnlineAIDriver → state handlers
 *
 *   Each frame:
 *     scene.update(time, delta)
 *       → OnlineOfflineManager.evaluate()  ← stream NPCs in/out
 *       → kernel.update(delta)             ← advance simulation
 *       → driver.update(delta) per NPC     ← run AI FSMs
 *       → socialPlugin.meetOrchestrator.update(ctx)  ← greet player
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  createPhaserKernel,
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserPlayerPosition,
  PhaserSimulationBridge,
  PhaserSocialPresenter,
  PhaserNPCSocialProvider,
  PhaserNPCContext,
} from '@alife-sdk/phaser';

import type {
  IPhaserNPCHost,
  IPhaserNPCSystemBundle,
  IOnlineRecord,
} from '@alife-sdk/phaser';

import {
  OnlineAIDriver,
  buildDefaultHandlerMap,
  createDefaultNPCOnlineState,
} from '@alife-sdk/ai';

import type { SocialPlugin } from '@alife-sdk/social';

import { SocialPorts } from '@alife-sdk/social';

// ---------------------------------------------------------------------------
// Step 1 — Adapters
//
// Adapters bridge Phaser 3 sprites/systems to the framework-agnostic SDK ports.
// Create them once in create() and hold references on the scene class.
// ---------------------------------------------------------------------------

// PhaserEntityAdapter — sprite registry.
// The SDK calls IEntityAdapter methods (setPosition, setVelocity, playAnimation, …)
// on entity IDs. This adapter resolves IDs to registered Phaser sprites.
//
// NOTE: kernel.logger is created inside createPhaserKernel (Step 3).
// Since adapters must exist before the kernel, pass logger later via a wrapper
// or simply omit it — warnings are a dev convenience, not required for functionality.
const entityAdapter = new PhaserEntityAdapter();

// PhaserPlayerPosition — reads live position from any object with x/y.
// Pass the player sprite directly; the reference is read every frame.
//
// If the player sprite changes (respawn, vehicle), call provider.setSource(newSprite).
const playerSprite = { x: 400, y: 300 } as { x: number; y: number }; // real Phaser sprite
const playerPosition = new PhaserPlayerPosition(playerSprite);

// PhaserSimulationBridge — HP registry + damage pipeline.
// The SDK calls applyDamage() when hazards / combat deal damage.
// The host registers HP records when NPCs spawn and unregisters on destroy.
const bridge = new PhaserSimulationBridge(/* kernel.logger */);

// Optional: plug in faction-specific damage resistances.
bridge.setImmunityLookup((entityId: string, damageTypeId: string) => {
  // Return [0, 1]: 0 = full damage, 1 = immune.
  // Example: military NPCs resist radiation.
  if (damageTypeId === 'radiation') return 0.5;
  return 0;
});

// Optional: sync damage morale penalty back to the AI brain.
bridge.setMoraleCallback((entityId: string, delta: number, reason: string) => {
  // drivers.get(entityId)?.context.state.adjustMorale?.(delta);
  console.log(`[morale] ${entityId} ${delta > 0 ? '+' : ''}${delta} (${reason})`);
});

// Driver registry — one entry per currently online NPC.
// Declared here so destroyEntity (below) can clean up drivers on entity removal.
const drivers = new Map<string, OnlineAIDriver>();

// NPC metadata store — holds per-NPC data that is NOT in IOnlineRecord.
// IOnlineRecord only carries position + alive flag for the streaming algorithm.
// Game-specific data (factionId, HP config, level) lives here.
const npcMeta = new Map<string, { factionId: string; maxHp: number }>();

// PhaserEntityFactory — spawn / destroy callbacks.
// Entity creation is game-specific (texture keys, groups, physics setup),
// so the factory delegates to user-provided callbacks.
const factory = new PhaserEntityFactory({
  createNPC: (req: any) => {
    // req: { npcTypeId, x, y, factionId, level, metadata }
    // const sprite = scene.physics.add.sprite(req.x, req.y, req.npcTypeId);
    const entityId = `npc_${req.npcTypeId}_${Date.now()}`;
    // Store game-specific data not tracked by IOnlineRecord:
    npcMeta.set(entityId, { factionId: req.factionId ?? 'loner', maxHp: 100 });
    // Register the new sprite immediately so the adapter can resolve it:
    // entityAdapter.register(entityId, sprite);
    // bridge.register(entityId, { currentHp: 100, maxHp: 100 });
    return entityId;
  },
  createMonster: (req: any) => {
    // req: { monsterTypeId, x, y, level, metadata }
    const entityId = `monster_${req.monsterTypeId}_${Date.now()}`;
    npcMeta.set(entityId, { factionId: 'monster', maxHp: 200 });
    // entityAdapter.register(entityId, sprite);
    // bridge.register(entityId, { currentHp: 200, maxHp: 200 });
    return entityId;
  },
  destroyEntity: (entityId: string) => {
    // Clean up sprite, HP record, AI driver, and metadata:
    // drivers.get(entityId)?.context; // do cleanup if needed
    // entityAdapter.getSprite(entityId)?.destroy();
    entityAdapter.unregister(entityId);
    bridge.unregister(entityId);
    npcMeta.delete(entityId);
  },
});

// ---------------------------------------------------------------------------
// Step 2 — Social adapters
//
// Social needs two additional adapters, registered as ports before kernel.init().
// ---------------------------------------------------------------------------

// PhaserSocialPresenter — renders speech bubbles.
// The SDK computes WHAT text to show; you decide HOW to render it.
const socialPresenter = new PhaserSocialPresenter({
  showBubble: (npcId: string, text: string, durationMs: number) => {
    const sprite = entityAdapter.getSprite(npcId);
    if (!sprite) return;
    // Example: create a floating text object above the sprite.
    // scene.add.text(sprite.x, sprite.y - 40, text, { fontSize: '12px' })
    //   .setDepth(10)
    //   .setLifetime(durationMs);
    console.log(`[bubble] ${npcId}: "${text}" (${durationMs}ms)`);
  },
});

// PhaserNPCSocialProvider — answers the social system's NPC queries.
// Typically reads from the online NPC list + faction manager.
const socialProvider = new PhaserNPCSocialProvider({
  getOnlineNPCs: () => {
    // Return all currently online NPCs.
    // Example: map from your online-NPC Set:
    // return Array.from(onlineNPCs.values()).map(npc => ({
    //   id: npc.entityId,
    //   position: { x: npc.x, y: npc.y },
    //   factionId: npc.factionId,
    //   state: npc.aiState,          // 'idle' | 'patrol' | 'camp' | ...
    // }));
    return [];
  },
  areFactionsFriendly: (a: string, b: string) => {
    // Example: delegate to kernel's factions plugin:
    // return kernel.factions.getRelation(a, b) > 0;
    return a === b;
  },
  areFactionsHostile: (a: string, b: string) => {
    // return kernel.factions.getRelation(a, b) < -30;
    return false;
  },
  getNPCTerrainId: (npcId: string) => {
    // Return the terrain ID where the NPC's brain is currently assigned.
    // Example: simulationPlugin.getNPCBrain(npcId)?.currentTerrainId ?? null
    return null;
  },
});

// ---------------------------------------------------------------------------
// Step 3 — createPhaserKernel
//
// One-call facade that wires all adapters and registers all plugins.
// Returns { kernel, simulation, onlineOffline }.
//
// Presets:
//   'minimal'    — only factions + spawn (no simulation, AI, or social)
//   'simulation' — + SimulationPlugin (default)
//   'full'       — + AIPlugin + SocialPlugin
// ---------------------------------------------------------------------------

const { kernel, simulation, onlineOffline } = createPhaserKernel({
  ports: {
    entityAdapter,
    playerPosition,
    entityFactory: factory,
    simulationBridge: bridge,
    // random: new SeededRandom(12345),  // optional: for deterministic replays
  },
  data: {
    factions: [
      { id: 'loner',    displayName: 'Loner',    relations: { bandit: -80, military: -20 } },
      { id: 'bandit',   displayName: 'Bandit',   relations: { loner: -80, military: -60 } },
      { id: 'military', displayName: 'Military', relations: { loner: -20, bandit: -60 } },
    ],
    terrains: [
      // SmartTerrain definitions — linked to SimulationPlugin NPC spawn/routing.
      // { id: 'bar', x: 1200, y: 800, radius: 300, maxNPCs: 6, npcTypes: ['stalker'] },
    ],
  },
  plugins: {
    simulation: {
      // Override default SimulationPlugin config:
      // npcUpdateIntervalMs: 10_000,
    },
    ai: {
      // Override default AIPlugin config:
      // humanCombat: { combatRange: 300 },
    },
    social: {
      // Override default SocialPlugin config:
      // social: { meet: { meetDistance: 300, meetCooldownMs: 10_000 } },
    },
  },
  config: {
    preset: 'full',
    kernel: { clock: { startHour: 12, timeFactor: 60 } },
    onlineOffline: {
      // switchDistance: 800,     // px — transition boundary
      // hysteresisFactor: 0.15,  // 15% band to prevent flickering
    },
    spawnCooldownMs: 30_000,
  },
});

// Register social ports BEFORE kernel.init().
// createPhaserKernel does not register these — they are game-specific.
kernel.provide(SocialPorts.SocialPresenter,   socialPresenter);
kernel.provide(SocialPorts.NPCSocialProvider, socialProvider);

kernel.init();
kernel.start();

// Convenience reference — only present when preset: 'full'.
// Cast is safe: createPhaserKernel adds SocialPlugin for 'full' preset.
// 'social' is the plugin ID registered internally by createPhaserKernel.
const socialPlugin = kernel.getPlugin('social') as SocialPlugin | null;

// ---------------------------------------------------------------------------
// Step 4 — Per-NPC context: IPhaserNPCHost + PhaserNPCContext + OnlineAIDriver
//
// When an NPC goes online, create one PhaserNPCContext + OnlineAIDriver per NPC.
// The context bridges Phaser sprite operations to the INPCContext interface.
// The driver runs the AI FSM each frame.
// ---------------------------------------------------------------------------

// IPhaserNPCHost — implement one per NPC class (enemy, stalker, mutant, …).
// Each method maps to a sprite operation or scene service call.
class EnemyNPCHost implements IPhaserNPCHost {
  readonly npcId:     string;
  readonly factionId: string;
  readonly entityType = 'npc';    // 'npc' | 'monster' | 'player'

  // In production: store a Phaser.Physics.Arcade.Sprite reference.
  private readonly sprite: { x: number; y: number } /* Phaser sprite type */ ;

  constructor(npcId: string, factionId: string, sprite: { x: number; y: number }) {
    this.npcId     = npcId;
    this.factionId = factionId;
    this.sprite    = sprite;
  }

  // Position
  getX(): number { return this.sprite.x; }
  getY(): number { return this.sprite.y; }

  // Movement — delegate to Phaser physics body
  setVelocity(vx: number, vy: number): void {
    // (this.sprite as Phaser.Physics.Arcade.Sprite).setVelocity(vx, vy);
  }
  halt(): void {
    // (this.sprite as Phaser.Physics.Arcade.Sprite).setVelocity(0, 0);
  }
  setRotation(radians: number): void {
    // this.sprite.setRotation(radians);
  }
  setAlpha(alpha: number): void {
    // this.sprite.setAlpha(alpha);
  }
  teleport(x: number, y: number): void {
    // this.sprite.setPosition(x, y);
    // (this.sprite as Phaser.Physics.Arcade.Sprite).setVelocity(0, 0);
  }
  disablePhysics(): void {
    // (this.sprite as Phaser.Physics.Arcade.Sprite).body.enable = false;
  }

  // FSM state — only called when context is used without OnlineAIDriver
  getCurrentStateId(): string { return 'IDLE'; }
  onTransitionRequest(newStateId: string): void {
    // Fallback: not called when wrapped by OnlineAIDriver
  }

  // Event callbacks — fire game-layer effects
  onShoot(payload: any): void {
    // scene.projectileManager.spawn(payload.x, payload.y, payload.targetX, payload.targetY);
  }
  onMeleeHit(payload: any): void {
    // bridge.applyDamage(payload.targetId, payload.damage, 'melee');
  }
  onVocalization(type: string): void {
    // scene.audioManager.playVocalization(this.npcId, type);
  }
  onPsiAttackStart(x: number, y: number): void {
    // scene.vfx.createPsiEffect(x, y);
  }

  // Utilities
  now(): number    { return Date.now(); /* scene.time.now in Phaser */ }
  random(): number { return Math.random(); }
}

// bringOnline — called by OnlineOfflineManager when NPC enters online range.
// factionId is read from npcMeta (stored at createNPC/createMonster time).
function bringOnline(entityId: string): void {
  const sprite = entityAdapter.getSprite(entityId);
  if (!sprite) return;

  const factionId = npcMeta.get(entityId)?.factionId ?? 'loner';
  const host = new EnemyNPCHost(entityId, factionId, sprite as { x: number; y: number });

  // Optional: inject AI subsystems (perception, cover, health, …)
  const systems: IPhaserNPCSystemBundle = {
    // perception: new MyPerceptionSystem(entityId),
    // health:     new MyHealthAccessor(entityId, bridge),
    // cover:      new MyCoverAccessor(entityId),
  };

  const ctx    = new PhaserNPCContext(host, createDefaultNPCOnlineState(), systems);
  const driver = new OnlineAIDriver(ctx, buildDefaultHandlerMap(), 'IDLE');

  drivers.set(entityId, driver);

  // Make sprite visible and enable physics
  // sprite.setActive(true).setVisible(true);
  // (sprite as Phaser.Physics.Arcade.Sprite).body.enable = true;
}

// bringOffline — called by OnlineOfflineManager when NPC leaves online range.
function bringOffline(entityId: string): void {
  drivers.delete(entityId);
  // Hide sprite, disable physics
  // entityAdapter.setActive(entityId, false);
  // entityAdapter.setVisible(entityId, false);
}

// ---------------------------------------------------------------------------
// Step 5 — Game loop integration
//
// Call everything inside Phaser's update(time, delta):
//
//   1. OnlineOfflineManager.evaluate() — stream NPCs in/out of range
//   2. kernel.update(delta)             — advance simulation (spawn, hazards, …)
//   3. driver.update(delta) per NPC     — run AI FSMs
//   4. socialPlugin.meetOrchestrator.update(ctx) — detect player greetings
// ---------------------------------------------------------------------------

// NPC record — one per NPC in the world (online OR offline).
// The OnlineOfflineManager reads this to decide streaming transitions.
//
// isOnline must reflect current state each frame — derive it from your source
// of truth (e.g. drivers.has(entityId)) rather than storing a separate flag.
function makeRecord(entityId: string, x: number, y: number, isOnline: boolean): IOnlineRecord {
  return {
    entityId,
    x,
    y,
    isOnline,
    isAlive: true,
    // squadId: 'squad_alpha',  // optional: enables atomic squad-level switching
  };
}

// Example update loop — wire this into Phaser Scene.update(time, delta):
function updateScene(delta: number): void {
  const player = playerPosition.getPlayerPosition();

  // 1. Build the current NPC record list (position from sprites or offline storage).
  const records: IOnlineRecord[] = [
    // In production: read from all spawned NPCs:
    // makeRecord('npc_wolf', npcWolfSprite.x, npcWolfSprite.y, drivers.has('npc_wolf')),
    makeRecord('npc_wolf', 420, 300, drivers.has('npc_wolf')),
  ];

  // 2. Evaluate online/offline transitions.
  //    onlineOffline is the OnlineOfflineManager returned by createPhaserKernel.
  const { goOnline, goOffline } = onlineOffline.evaluate(
    player.x, player.y,
    records,
    // squadResolver: (id) => squadMap.get(id) — optional for squad atomicity
  );

  for (const id of goOnline)  bringOnline(id);
  for (const id of goOffline) bringOffline(id);

  // 3. Advance the kernel (simulation ticks, hazard damage, spawns).
  kernel.update(delta);

  // 4. Run AI drivers for all online NPCs.
  for (const driver of drivers.values()) {
    driver.update(delta);
  }

  // 5. Meet orchestrator — check if player is near any NPC.
  //    HOST-DRIVEN: you decide when to call this (e.g. only when player moves).
  if (socialPlugin) {
    const greetBubbles = socialPlugin.meetOrchestrator.update({
      deltaMs:         delta,
      targetX:         player.x,
      targetY:         player.y,
      currentTime:     Date.now(),
      npcs:            socialProvider.getOnlineNPCs() as any[],
      targetFactionId: 'loner',
      isHostile: (a: string, b: string) => kernel.factions.getRelation(a, b) < -30,
      isAlly:    (a: string, b: string) => kernel.factions.getRelation(a, b) > 0,
    });

    // meetOrchestrator returns bubbles directly — present them yourself.
    for (const bubble of greetBubbles) {
      socialPresenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 6 — Serialize / restore
//
// Call kernel.serialize() before scene destroy (save to localStorage / server).
// Call kernel.restoreState(state) after scene create to restore NPC cooldowns,
// faction relations, and simulation progress.
// ---------------------------------------------------------------------------

function saveGame(): string {
  return JSON.stringify(kernel.serialize());
}

function loadGame(json: string): void {
  // Create a fresh kernel + adapters (same wiring as above), then:
  // kernel.init();
  // kernel.restoreState(JSON.parse(json));
  // kernel.start();
  console.log('Restore from:', json.length, 'bytes');
}

// ---------------------------------------------------------------------------
// Step 7 — Cleanup
//
// Call kernel.destroy() in Phaser's Scene.shutdown() / Scene.destroy() hook.
// ---------------------------------------------------------------------------

function shutdownScene(): void {
  drivers.clear();
  kernel.destroy();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
//
// Minimal integration checklist:
//
//   create():
//     1. new PhaserEntityAdapter()
//     2. new PhaserPlayerPosition(playerSprite)
//     3. new PhaserSimulationBridge()
//     4. new PhaserEntityFactory({ createNPC, createMonster, destroyEntity })
//     5. new PhaserSocialPresenter({ showBubble })
//     6. new PhaserNPCSocialProvider({ getOnlineNPCs, areFactionsFriendly, areFactionsHostile, getNPCTerrainId })
//     7. createPhaserKernel({ ports, data, config: { preset: 'full' } })
//     8. kernel.provide(SocialPorts.SocialPresenter,  presenter)
//     9. kernel.provide(SocialPorts.NPCSocialProvider, provider)
//     10. kernel.init() + kernel.start()
//
//   When NPC goes online:
//     11. new EnemyNPCHost(npcId, factionId, sprite)
//     12. new PhaserNPCContext(host, createDefaultNPCOnlineState(), systems)
//     13. new OnlineAIDriver(ctx, buildDefaultHandlerMap(), 'IDLE')
//
//   update(delta):
//     14. onlineOffline.evaluate(px, py, records) → bringOnline / bringOffline
//     15. kernel.update(delta)
//     16. driver.update(delta) per NPC
//     17. socialPlugin.meetOrchestrator.update(ctx)
//
//   shutdown():
//     18. kernel.destroy()

// Suppress unused-variable warnings in this reference template
void simulation;
void saveGame;
void loadGame;
void shutdownScene;
void updateScene;
