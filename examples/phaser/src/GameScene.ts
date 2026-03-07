/**
 * GameScene.ts
 *
 * A-Life SDK — Phaser 3 AI showcase.
 *
 * Layers all five A-Life AI systems on top of the offline simulation:
 *   1. StateMachine    — per-NPC state: PATROL → ALERT → COMBAT
 *   2. MemoryBank      — NPCs remember where they last saw the player; fades over time
 *   3. DangerManager   — shared threat registry; player throws grenades with G
 *   4. GOAPPlanner     — picks the cheapest combat action sequence each time COMBAT starts
 *
 * Simulation layer (unchanged):
 *   - createPhaserKernel() / PhaserEntityAdapter / PhaserSimulationBridge
 *   - OnlineOfflineManager — proximity streaming (walk near NPCs to bring them online)
 *   - Offline combat resolver drives HP while NPCs are out of range
 *
 * Controls:
 *   WASD / arrows — move player
 *   G             — throw grenade toward cursor (fuse + explosion -> DangerManager)
 *
 * Debug overlay (right panel):
 *   Per-NPC: FSM state · memory confidence · danger level · current GOAP plan
 */

import Phaser from 'phaser';
import type { ALifeKernel } from '@alife-sdk/core';
import {
  DangerManager,
  GOAPPlanner,
} from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter, PhaserSimulationBridge, OnlineOfflineManager } from '@alife-sdk/phaser';
import { CombatSystem } from './systems/CombatSystem';
import { GrenadeSystem } from './systems/GrenadeSystem';
import { NpcAiSystem } from './systems/NpcAiSystem';
import {
  DETECTION_RANGE,
  CONF_ALERT,
  CONF_COMBAT,
  GOAP_COVER_MOVE_SPEED,
  GOAP_COVER_THREAT_THRESHOLD,
  GRENADE_MAX_DAMAGE,
  GRENADE_MIN_DAMAGE,
  HUD_FONT,
  NPC_DEFS,
  PLAYER_SPEED,
  TICK_MS,
} from './scene/demoConfig';
import { createHudLayer } from './scene/hudLayer';
import { NpcAI } from './scene/npcAiModel';
import { registerNpcData } from './scene/registerNpcData';
import { setupGoapPlanner } from './scene/setupGoapPlanner';
import { setupInput } from './scene/setupInput';
import { setupKernel } from './scene/setupKernel';
import { setupNpcAiBundles } from './scene/setupNpcAiBundles';
import { setupSceneEvents } from './scene/setupSceneEvents';
import { setupCombat } from './scene/setupCombat';
import { setupTextures } from './scene/setupTextures';
import { createWorldLayer } from './scene/worldLayer';
import { SimulationOwnershipService } from './scene/services/SimulationOwnershipService';
import { HudRuntime } from './scene/services/HudRuntime';

// ---------------------------------------------------------------------------
// GameScene
// ---------------------------------------------------------------------------

export class GameScene extends Phaser.Scene {

  // Simulation layer (SDK)
  private kernel!: ALifeKernel;
  private simulation!: SimulationPlugin;
  private entityAdapter!: PhaserEntityAdapter;
  private bridge!: PhaserSimulationBridge;
  private onlineOffline!: OnlineOfflineManager;
  private hpRecords = new Map<string, { currentHp: number; maxHp: number }>();

  // AI layer
  private dangerManager = new DangerManager();
  private goapPlanner!: GOAPPlanner;
  private npcAI = new Map<string, NpcAI>();
  private grenadeKey!: Phaser.Input.Keyboard.Key;
  private combatSystem!: CombatSystem;
  private grenadeSystem!: GrenadeSystem;
  private npcAiSystem!: NpcAiSystem;

  // Phaser objects
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private helpKey!: Phaser.Input.Keyboard.Key;
  private hpGraphics!: Phaser.GameObjects.Graphics;
  private hudGraphics!: Phaser.GameObjects.Graphics;
  private onlineRadiusGfx!: Phaser.GameObjects.Graphics;
  private aiOverlay!: Phaser.GameObjects.Text;
  private eventLogText!: Phaser.GameObjects.Text;
  private tickText!: Phaser.GameObjects.Text;
  private playerLabel!: Phaser.GameObjects.Text;
  private playerHpText!: Phaser.GameObjects.Text;
  private helpUi: Phaser.GameObjects.GameObject[] = [];
  private npcStateLabels = new Map<string, Phaser.GameObjects.Text>();
  private topBarRect!: Phaser.Geom.Rectangle;
  private hpBarRect!: Phaser.Geom.Rectangle;
  private playerSpawn = { x: 0, y: 0 };

  private tickCount   = 0;
  private onlineDistance = 0;
  private npcSpawnPos    = new Map<string, { x: number; y: number }>();
  private lastTaskLog    = new Map<string, string>();
  private ownershipService!: SimulationOwnershipService;
  private hudRuntime!: HudRuntime;

  // Combat
  private playerHp        = 100;
  private playerMaxHp     = 100;
  private playerDead      = false;
  private playerDeadText!: Phaser.GameObjects.Text;
  private locallyDeadNpcs    = new Set<string>();

  constructor() {
    super({ key: 'GameScene' });
  }

  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const playWidth = Math.min(Math.round(W * 0.72), 1320);
    const compactHud = W <= 1780 || playWidth <= 1300;
    const topBarTargetW = compactHud ? 410 : 470;
    const topBarW = Math.round(
      Phaser.Math.Clamp(topBarTargetW, 360, W - 24),
    );
    const topBarH = compactHud ? 74 : 82;
    this.topBarRect = new Phaser.Geom.Rectangle(12, 10, topBarW, topBarH);
    const hpAreaW = compactHud ? 120 : 180;
    const hpBarW = compactHud ? 108 : 132;
    const hpBarX = this.topBarRect.right - hpBarW - 18;
    const hpBarY = this.topBarRect.y + (compactHud ? 36 : 38);
    this.hpBarRect = new Phaser.Geom.Rectangle(hpBarX, hpBarY, hpBarW, 8);

    this.onlineDistance = Math.round(Math.min(W, H) * 0.22);

    // --- 1. Textures --------------------------------------------------------
    setupTextures(this);

    const world = createWorldLayer(this, { width: W, height: H });
    const factory = world.factory;
    const bunker = world.bunker;
    this.npcSpawnPos = world.npcSpawnPos;

    // --- 3. Player ----------------------------------------------------------
    this.playerSpawn = world.playerSpawn;
    this.player = this.physics.add.sprite(this.playerSpawn.x, this.playerSpawn.y, 'player');
    this.player.setCollideWorldBounds(true);
    this.playerLabel = this.add.text(0, 0, 'YOU', {
      fontSize: '12px',
      fontFamily: HUD_FONT,
      fontStyle: 'bold',
      color: '#f5f8ff',
    }).setDepth(10);
    const input = setupInput(this);
    this.cursors = input.cursors;
    this.wasd = input.wasd;
    this.grenadeKey = input.grenadeKey;
    this.helpKey = input.helpKey;

    // --- 4. SDK kernel + adapters ------------------------------------------
    const kernelSetup = setupKernel({
      scene: this,
      player: this.player,
      terrains: [factory, bunker],
      onlineDistance: this.onlineDistance,
      tickMs: TICK_MS,
    });
    this.kernel = kernelSetup.kernel;
    this.simulation = kernelSetup.simulation;
    this.onlineOffline = kernelSetup.onlineOffline;
    this.entityAdapter = kernelSetup.entityAdapter;
    this.bridge = kernelSetup.bridge;

    // --- 6. Register NPCs ---------------------------------------------------
    registerNpcData({
      scene: this,
      simulation: this.simulation,
      entityAdapter: this.entityAdapter,
      bridge: this.bridge,
      hpRecords: this.hpRecords,
      npcSpawnPos: this.npcSpawnPos,
      npcDefs: NPC_DEFS,
      tickMs: TICK_MS,
    });

    // --- 7. GOAP planner (shared, stateless) --------------------------------

    this.goapPlanner = setupGoapPlanner();

    // --- 8. Per-NPC AI bundles ----------------------------------------------
    setupNpcAiBundles({
      scene: this,
      npcDefs: NPC_DEFS,
      dangerManager: this.dangerManager,
      goapPlanner: this.goapPlanner,
      npcAI: this.npcAI,
      npcStateLabels: this.npcStateLabels,
    });

    // --- 10. Combat system --------------------------------------------------
    this.combatSystem = setupCombat({
      scene: this,
      simulation: this.simulation,
      entityAdapter: this.entityAdapter,
      hpRecords: this.hpRecords,
      locallyDeadNpcs: this.locallyDeadNpcs,
      npcStateLabels: this.npcStateLabels,
      player: this.player,
      isPlayerDead: () => this.playerDead,
      onPlayerHit: (damage) => {
        if (this.playerDead) return;
        this.playerHp = Math.max(0, this.playerHp - damage);
        if (this.playerHp === 0) this.killPlayer();
      },
    });

    // --- 11. UI layer -------------------------------------------------------

    const hud = createHudLayer({
      scene: this,
      viewport: { width: W, height: H },
      compactHud,
      topBarRect: this.topBarRect,
      hpBarRect: this.hpBarRect,
      factoryBounds: factory.bounds,
      bunkerBounds: bunker.bounds,
    });
    this.hpGraphics = hud.hpGraphics;
    this.hudGraphics = hud.hudGraphics;
    this.onlineRadiusGfx = hud.onlineRadiusGfx;
    this.aiOverlay = hud.aiOverlay;
    this.eventLogText = hud.eventLogText;
    this.tickText = hud.tickText;
    this.playerDeadText = hud.playerDeadText;
    this.playerHpText = hud.playerHpText;
    this.helpUi = hud.helpUi;

    this.grenadeSystem = new GrenadeSystem({
      scene: this,
      dangerManager: this.dangerManager,
      gfx: hud.dangerGfx,
      onExplodeDamage: (x, y, radius) => this.combatSystem.applyGrenadeDamage({
        npcIds: this.npcAI.keys(),
        x,
        y,
        radius,
        minDamage: GRENADE_MIN_DAMAGE,
        maxDamage: GRENADE_MAX_DAMAGE,
      }),
      onLog: (msg) => this.hudRuntime?.log(msg),
    });
    this.npcAiSystem = new NpcAiSystem({
      dangerManager: this.dangerManager,
      goapPlanner: this.goapPlanner,
      simulation: this.simulation,
      entityAdapter: this.entityAdapter,
      npcAI: this.npcAI,
      npcStateLabels: this.npcStateLabels,
      locallyDeadNpcs: this.locallyDeadNpcs,
      npcSpawnPos: this.npcSpawnPos,
      aiOverlay: this.aiOverlay,
      getPlayerState: () => ({ x: this.player.x, y: this.player.y, isDead: this.playerDead }),
      fireNpcBullet: (npcId, targetX, targetY, spriteX, spriteY) => {
        this.combatSystem.fireNpcBullet(npcId, targetX, targetY, spriteX, spriteY);
      },
      detectionRange: DETECTION_RANGE,
      coverThreatThreshold: GOAP_COVER_THREAT_THRESHOLD,
      coverMoveSpeed: GOAP_COVER_MOVE_SPEED,
    });

    this.ownershipService = new SimulationOwnershipService({
      simulation: this.simulation,
      entityAdapter: this.entityAdapter,
      onlineOffline: this.onlineOffline,
      npcAI: this.npcAI,
      npcSpawnPos: this.npcSpawnPos,
      hpRecords: this.hpRecords,
      locallyDeadNpcs: this.locallyDeadNpcs,
    });
    this.hudRuntime = new HudRuntime({
      simulation: this.simulation,
      entityAdapter: this.entityAdapter,
      hpGraphics: this.hpGraphics,
      hudGraphics: this.hudGraphics,
      onlineRadiusGfx: this.onlineRadiusGfx,
      hpBarRect: this.hpBarRect,
      playerHpText: this.playerHpText,
      tickText: this.tickText,
      eventLogText: this.eventLogText,
      layoutTicker: hud.layoutTicker,
      onlineDistance: this.onlineDistance,
      detectionRange: DETECTION_RANGE,
      confAlert: CONF_ALERT,
      confCombat: CONF_COMBAT,
      npcDefs: NPC_DEFS,
      hpRecords: this.hpRecords,
      locallyDeadNpcs: this.locallyDeadNpcs,
    });

    setupSceneEvents({
      kernel: this.kernel,
      onTick: (tick) => {
        this.tickCount = tick;
        this.ownershipService.syncBridgeHP();
      },
      onFactionConflict: ({ factionA, factionB, zoneId }) => {
        this.hudRuntime.log(`⚔ ${factionA} vs ${factionB} @ ${zoneId}`);
      },
      onNpcDied: ({ npcId }) => {
        this.hudRuntime.log(`☠ ${npcId} died`);
        this.entityAdapter.getSprite(npcId)?.setVisible(false);
        const ai = this.npcAI.get(npcId);
        if (ai) ai.entity.isAlive = false;
      },
      onTaskAssigned: ({ npcId, taskType, terrainId }) => {
        const key = `${taskType}@${terrainId}`;
        if (this.lastTaskLog.get(npcId) === key) return;
        this.lastTaskLog.set(npcId, key);
        this.hudRuntime.log(`→ ${npcId} assigned ${taskType}`);
      },
    });

    this.kernel.update(TICK_MS);
    this.hudRuntime.updateStatusTick(this.tickCount);
  }

  // ---------------------------------------------------------------------------
  // update() — called every frame by Phaser
  // ---------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.helpKey)) {
      const nextVisible = !this.helpUi[0]?.visible;
      for (const node of this.helpUi) node.setVisible(nextVisible);
    }

    // 1. Player movement
    if (!this.playerDead) {
      const vx = (this.cursors.left.isDown  || this.wasd.left.isDown  ? -1 : 0)
               + (this.cursors.right.isDown || this.wasd.right.isDown ?  1 : 0);
      const vy = (this.cursors.up.isDown    || this.wasd.up.isDown    ? -1 : 0)
               + (this.cursors.down.isDown  || this.wasd.down.isDown  ?  1 : 0);
      this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
    }

    // 2. Advance simulation first so all later decisions consume fresh SDK state.
    this.kernel.update(delta);

    // 3. Only offline NPCs are visually nudged here.
    // Online NPC movement is owned by the online AI branch below.
    this.ownershipService.syncOfflineNPCPositions(delta);

    // 4. Ownership swap (offline sim <-> online combat) happens before AI step.
    this.ownershipService.handleOnlineOffline(this.player.x, this.player.y);

    // 5. Threat decay before grenade updates keeps danger model frame-consistent.
    this.dangerManager.update(delta);

    // 6. Grenade
    if (Phaser.Input.Keyboard.JustDown(this.grenadeKey)) {
      this.grenadeSystem.throwTowardPointer(this.player.x, this.player.y, this.playerDead);
    }

    // 7. Grenade system updates both visuals and threat entries.
    this.grenadeSystem.update(delta);

    // 8. AI runs after threat/ownership updates, so GOAP sees current danger state.
    this.npcAiSystem.update(delta);

    // 9. Player bullet → NPC hit detection (manual, IArcadeSprite-safe)
    this.combatSystem.checkPlayerBulletHits(this.npcAI.keys());

    // 10. Render overlays last to avoid frame-order visual desync.
    this.hudRuntime.drawOverlays(this.player, this.playerHp, this.playerMaxHp);

    // 11. Player label
    this.playerLabel.setPosition(this.player.x - 8, this.player.y - 26);

    // 12. Status bar
    this.hudRuntime.updateStatusTick(this.tickCount);
  }

  // ---------------------------------------------------------------------------
  // Combat helpers
  // ---------------------------------------------------------------------------

  private killPlayer(): void {
    this.playerDead = true;
    this.playerDeadText.setVisible(true);
    (this.player as unknown as Phaser.Physics.Arcade.Sprite).setVelocity(0, 0);
    this.player.setAlpha(0.3);
    this.input.once('pointerdown', () => this.respawnPlayer());
  }

  private respawnPlayer(): void {
    this.playerHp   = this.playerMaxHp;
    this.playerDead = false;
    this.player.setPosition(this.playerSpawn.x, this.playerSpawn.y);
    this.player.setAlpha(1.0);
    this.playerDeadText.setVisible(false);
  }

}
