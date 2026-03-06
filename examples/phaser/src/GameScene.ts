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
 *   G             — throw grenade at player position (triggers DangerManager + replanning)
 *
 * Debug overlay (right panel):
 *   Per-NPC: FSM state · memory confidence · danger level · current GOAP plan
 */

import Phaser from 'phaser';
import type { ALifeKernel } from '@alife-sdk/core';
import {
  ALifeEvents,
  SmartTerrain,
  AIStateRegistry,
  StateMachine,
  MemoryBank,
  MemoryChannel,
  DangerManager,
  DangerType,
  GOAPPlanner,
  WorldState,
} from '@alife-sdk/core';
import type { IEntity } from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';
import {
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserPlayerPosition,
  PhaserSimulationBridge,
  OnlineOfflineManager,
  createPhaserKernel,
} from '@alife-sdk/phaser';
import type { IArcadeSprite } from '@alife-sdk/phaser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_SPEED    = 220; // px/s
const TICK_MS         = 2_000;
const DETECTION_RANGE = 180; // px — NPC can "see" player within this radius

// FSM transition thresholds (memory confidence 0..1)
const CONF_ALERT  = 0.35; // PATROL → ALERT   (~115px from NPC)
const CONF_COMBAT = 0.60; // ALERT  → COMBAT  (~72px from NPC)
const CONF_FORGET = 0.10; // *      → PATROL

// NPC definitions
const NPC_DEFS = [
  { entityId: 'stalker_wolf', factionId: 'stalker', hp: 100, combatPower: 70, rank: 3 },
  { entityId: 'stalker_bear', factionId: 'stalker', hp: 80,  combatPower: 55, rank: 2 },
  { entityId: 'bandit_knife', factionId: 'bandit',  hp: 80,  combatPower: 40, rank: 2 },
  { entityId: 'bandit_razor', factionId: 'bandit',  hp: 90,  combatPower: 60, rank: 3 },
] as const;

// ---------------------------------------------------------------------------
// Minimal IEntity wrapper — position is synced from sprite each frame
// ---------------------------------------------------------------------------

class NpcEntity implements IEntity {
  readonly entityType = 'npc';
  active  = true;
  isAlive = true;
  x = 0;
  y = 0;

  constructor(public readonly id: string) {}

  setPosition(x: number, y: number): void { this.x = x; this.y = y; }
  setActive(v: boolean): this             { this.active = v; return this; }
  setVisible(_v: boolean): this           { return this; }
  hasComponent(_: string): boolean        { return false; }
  getComponent<T>(_: string): T           { throw new Error('no components'); }
}

// ---------------------------------------------------------------------------
// Per-NPC AI bundle
// ---------------------------------------------------------------------------

interface NpcAI {
  entity:      NpcEntity;
  memory:      MemoryBank;
  fsm:         StateMachine;
  currentPlan: string[]; // GOAP action IDs, updated each time COMBAT is entered or grenade arrives
  dangerLevel: number;   // sum of threat scores at NPC position
}

// ---------------------------------------------------------------------------
// FSM builder
//
// Uses closures so each NPC's handlers capture its own memory, dangerManager,
// planner, and plan array — no global lookups.
// ---------------------------------------------------------------------------

function buildNpcFSM(
  entity:     NpcEntity,
  memory:     MemoryBank,
  dangerMgr:  DangerManager,
  planner:    GOAPPlanner,
  bundle:     Pick<NpcAI, 'currentPlan'>,
): StateMachine {

  /** Run GOAP and store the resulting plan in bundle.currentPlan. */
  function replan(underFire: boolean): void {
    const ws   = WorldState.from({ hasAmmo: true, ...(underFire ? { underFire: true } : {}) });
    const goal = WorldState.from({ targetEliminated: true });
    const plan = planner.plan(ws, goal);
    bundle.currentPlan = plan ? plan.map(a => a.id) : [];
  }

  const registry = new AIStateRegistry();

  registry
    .register('PATROL', {
      handler: {
        enter: () => {},
        update: (_e, deltaSec) => { memory.update(deltaSec); },
        exit:  () => {},
      },
      transitionConditions: [
        {
          targetState: 'ALERT',
          priority: 10,
          condition: () => {
            const best = memory.getMostConfident();
            return best !== undefined && best.confidence > CONF_ALERT;
          },
        },
      ],
    })
    .register('ALERT', {
      handler: {
        enter: () => {},
        update: (_e, deltaSec) => { memory.update(deltaSec); },
        exit:  () => {},
      },
      transitionConditions: [
        {
          targetState: 'COMBAT',
          priority: 20,
          condition: () => {
            const best = memory.getMostConfident();
            return best !== undefined && best.confidence > CONF_COMBAT;
          },
        },
        {
          targetState: 'PATROL',
          priority: 5,
          condition: () => {
            const best = memory.getMostConfident();
            return best === undefined || best.confidence < CONF_FORGET;
          },
        },
      ],
    })
    .register('COMBAT', {
      handler: {
        enter: () => {
          // Plan immediately on entering combat
          const underFire = dangerMgr.isDangerous({ x: entity.x, y: entity.y });
          replan(underFire);
        },
        update: (_e, deltaSec) => { memory.update(deltaSec); },
        exit:  () => { bundle.currentPlan = []; },
      },
      transitionConditions: [
        {
          targetState: 'PATROL',
          priority: 5,
          condition: () => {
            const best = memory.getMostConfident();
            return best === undefined || best.confidence < CONF_FORGET;
          },
        },
      ],
    });

  return new StateMachine(entity, registry, 'PATROL');
}

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
  private grenadeFlashes: Array<{ x: number; y: number; ttl: number; maxTtl: number }> = [];
  private grenadeCount = 0;

  // Phaser objects
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private hpGraphics!: Phaser.GameObjects.Graphics;
  private onlineRadiusGfx!: Phaser.GameObjects.Graphics;
  private dangerGfx!: Phaser.GameObjects.Graphics;
  private aiOverlay!: Phaser.GameObjects.Text;
  private eventLogText!: Phaser.GameObjects.Text;
  private tickText!: Phaser.GameObjects.Text;
  private playerLabel!: Phaser.GameObjects.Text;
  private npcStateLabels = new Map<string, Phaser.GameObjects.Text>();

  private eventLog: string[] = [];
  private tickCount   = 0;
  private onlineDistance = 0;
  private npcSpawnPos    = new Map<string, { x: number; y: number }>();
  private wanderTargets  = new Map<string, { x: number; y: number }>();
  private lastTaskLog    = new Map<string, string>();

  // Combat
  private playerHp        = 100;
  private playerMaxHp     = 100;
  private playerDead      = false;
  private playerDeadText!: Phaser.GameObjects.Text;
  private npcBullets!:     Phaser.Physics.Arcade.Group;
  private playerBullets!:  Phaser.Physics.Arcade.Group;
  private npcLastShot        = new Map<string, number>();
  private lastPlayerShot     = 0;
  private locallyDeadNpcs    = new Set<string>();
  private playerDamageDealt  = new Map<string, number>(); // cumulative player dmg per NPC

  constructor() {
    super({ key: 'GameScene' });
  }

  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    this.onlineDistance = Math.round(Math.min(W, H) * 0.22);

    // --- 1. Textures --------------------------------------------------------

    this.makeTexture('player',        24, 24, g => { g.fillStyle(0xffffff); g.fillCircle(12, 12, 11); });
    this.makeTexture('stalker',       22, 22, g => { g.fillStyle(0x3a7bd5); g.fillRect(2, 2, 18, 18); });
    this.makeTexture('bandit',        22, 22, g => { g.fillStyle(0xd53a3a); g.fillRect(2, 2, 18, 18); });
    this.makeTexture('npc_bullet',    6,  6,  g => { g.fillStyle(0xff3333); g.fillCircle(3, 3, 3); });
    this.makeTexture('player_bullet', 6,  6,  g => { g.fillStyle(0x00ffee); g.fillCircle(3, 3, 3); });

    // --- 2. Terrain zones ---------------------------------------------------

    const zonesGfx = this.add.graphics();

    const tw = Math.round(W * 0.20);
    const th = Math.round(H * 0.30);

    const fx = Math.round(W * 0.12), fy = Math.round(H * 0.12);
    const factory = new SmartTerrain({
      id: 'factory', name: 'Abandoned Factory',
      bounds: { x: fx, y: fy, width: tw, height: th },
      capacity: 6,
      jobs: [
        { type: 'patrol', slots: 3 },
        { type: 'guard', slots: 3, position: { x: fx + tw / 2, y: fy + th / 2 } },
      ],
    });

    const bx = Math.round(W * 0.68), by = Math.round(H * 0.58);
    const bunker = new SmartTerrain({
      id: 'bunker', name: 'Underground Bunker',
      bounds: { x: bx, y: by, width: tw, height: th },
      capacity: 6,
      jobs: [
        { type: 'patrol', slots: 3 },
        { type: 'guard', slots: 3, position: { x: bx + tw / 2, y: by + th / 2 } },
      ],
    });

    zonesGfx.lineStyle(2, 0x3a7bd5, 0.6);
    zonesGfx.strokeRect(factory.bounds.x, factory.bounds.y, factory.bounds.width, factory.bounds.height);
    zonesGfx.fillStyle(0x3a7bd5, 0.08);
    zonesGfx.fillRect(factory.bounds.x, factory.bounds.y, factory.bounds.width, factory.bounds.height);
    this.add.text(factory.bounds.x + 4, factory.bounds.y + 4, 'Abandoned Factory', { fontSize: '11px', color: '#88aaff' });

    zonesGfx.lineStyle(2, 0xd53a3a, 0.6);
    zonesGfx.strokeRect(bunker.bounds.x, bunker.bounds.y, bunker.bounds.width, bunker.bounds.height);
    zonesGfx.fillStyle(0xd53a3a, 0.08);
    zonesGfx.fillRect(bunker.bounds.x, bunker.bounds.y, bunker.bounds.width, bunker.bounds.height);
    this.add.text(bunker.bounds.x + 4, bunker.bounds.y + 4, 'Underground Bunker', { fontSize: '11px', color: '#ff8888' });

    this.npcSpawnPos.set('stalker_wolf', { x: fx + 20, y: fy - 12 });
    this.npcSpawnPos.set('stalker_bear', { x: fx + 60, y: fy - 8  });
    this.npcSpawnPos.set('bandit_knife', { x: bx + 20, y: by - 12 });
    this.npcSpawnPos.set('bandit_razor', { x: bx + 60, y: by - 8  });

    // --- 3. Player ----------------------------------------------------------

    this.player = this.physics.add.sprite(Math.round(W * 0.06), Math.round(H * 0.5), 'player');
    this.player.setCollideWorldBounds(true);
    this.playerLabel = this.add.text(0, 0, 'You', { fontSize: '10px', color: '#ffffff' }).setDepth(10);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.grenadeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G);

    // --- 4. SDK adapters ----------------------------------------------------

    this.entityAdapter = new PhaserEntityAdapter();
    this.bridge        = new PhaserSimulationBridge();

    let npcCount = 0;
    const entityFactory = new PhaserEntityFactory({
      createNPC: (req) => {
        const id  = req.metadata?.['entityId'] as string ?? `npc_${++npcCount}`;
        const key = req.factionId === 'stalker' ? 'stalker' : 'bandit';
        const sprite = this.physics.add.sprite(req.x, req.y, key);
        sprite.name = id;
        this.entityAdapter.register(id, sprite as unknown as IArcadeSprite);
        this.bridge.register(id, { currentHp: 100, maxHp: 100 });
        return id;
      },
      createMonster: (req) => `monster_${++npcCount}_${req.monsterTypeId}`,
      destroyEntity: (id) => {
        this.entityAdapter.getSprite(id)?.destroy();
        this.entityAdapter.unregister(id);
        this.bridge.unregister(id);
      },
    });

    const playerPosition = new PhaserPlayerPosition(this.player);

    // --- 5. Kernel ----------------------------------------------------------

    const result = createPhaserKernel({
      ports: {
        entityAdapter:    this.entityAdapter,
        playerPosition,
        entityFactory,
        simulationBridge: this.bridge,
      },
      data: {
        factions: [
          { id: 'stalker', relations: { bandit: -80 } },
          { id: 'bandit',  relations: { stalker: -80 } },
        ],
        terrains: [factory, bunker],
      },
      plugins: {
        simulation: {
          tickIntervalMs: TICK_MS,
          simulation: {
            offlineCombat: {
              detectionProbability: 100,
              maxResolutionsPerTick: 4,
              damageTypeId: 'physical',
            },
          },
        },
      },
      config: {
        preset: 'simulation',
        onlineOffline: {
          switchDistance:   this.onlineDistance,
          hysteresisFactor: 0.15,
        },
      },
    });

    this.kernel        = result.kernel;
    this.simulation    = result.simulation!;
    this.onlineOffline = result.onlineOffline;

    this.kernel.init();
    this.kernel.start();

    // --- 6. Register NPCs ---------------------------------------------------

    for (const def of NPC_DEFS) {
      const pos    = this.npcSpawnPos.get(def.entityId) ?? { x: 0, y: 0 };
      const key    = def.factionId === 'stalker' ? 'stalker' : 'bandit';
      const sprite = this.physics.add.sprite(pos.x, pos.y, key);
      sprite.name  = def.entityId;
      sprite.setAlpha(0.35);

      this.entityAdapter.register(def.entityId, sprite as unknown as IArcadeSprite);

      const hpRecord = { currentHp: def.hp, maxHp: def.hp };
      this.hpRecords.set(def.entityId, hpRecord);
      this.bridge.register(def.entityId, hpRecord);

      this.simulation.registerNPC({
        entityId:    def.entityId,
        factionId:   def.factionId,
        position:    pos,
        rank:        def.rank,
        combatPower: def.combatPower,
        currentHp:   def.hp,
        behaviorConfig: createDefaultBehaviorConfig({ aggression: 0.8, retreatThreshold: 0.15, panicThreshold: -0.8, searchIntervalMs: TICK_MS, dangerTolerance: 4 }),
        options: { type: 'human' },
      });
    }

    // --- 7. GOAP planner (shared, stateless) --------------------------------

    this.goapPlanner = new GOAPPlanner();
    this.goapPlanner.registerAction({
      id:            'TakePosition',
      cost:          3,
      preconditions: { inPosition: false },
      effects:       { inPosition: true },
    });
    this.goapPlanner.registerAction({
      id:            'Attack',
      cost:          2,
      preconditions: { inPosition: true },
      effects:       { targetEliminated: true },
    });
    this.goapPlanner.registerAction({
      id:            'FindCover',
      cost:          1,
      preconditions: { underFire: true },
      effects:       { inCover: true },
    });
    this.goapPlanner.registerAction({
      id:            'AttackFromCover',
      cost:          1,
      preconditions: { inCover: true },
      effects:       { targetEliminated: true },
    });

    // --- 8. Per-NPC AI bundles ----------------------------------------------

    for (const def of NPC_DEFS) {
      const entity = new NpcEntity(def.entityId);
      const memory = new MemoryBank({ timeFn: () => Date.now() });

      const bundle: NpcAI = {
        entity,
        memory,
        fsm: null!,       // filled on next line
        currentPlan: [],
        dangerLevel: 0,
      };
      bundle.fsm = buildNpcFSM(entity, memory, this.dangerManager, this.goapPlanner, bundle);

      this.npcAI.set(def.entityId, bundle);

      // Per-NPC floating state icon (above sprite)
      const label = this.add.text(0, 0, '', { fontSize: '11px', color: '#ffff44' }).setDepth(10);
      this.npcStateLabels.set(def.entityId, label);
    }

    // --- 9. Events ----------------------------------------------------------

    this.kernel.events.on(ALifeEvents.TICK, ({ tick }: { tick: number }) => {
      this.tickCount = tick;
      this.syncBridgeHP();
    });

    this.kernel.events.on(ALifeEvents.FACTION_CONFLICT, (e: { factionA: string; factionB: string; zoneId: string }) => {
      this.log(`⚔ ${e.factionA} vs ${e.factionB} @ ${e.zoneId}`);
    });

    this.kernel.events.on(ALifeEvents.NPC_DIED, (e: { npcId: string; zoneId: string }) => {
      this.log(`☠ ${e.npcId} died`);
      this.entityAdapter.getSprite(e.npcId)?.setVisible(false);
      const ai = this.npcAI.get(e.npcId);
      if (ai) ai.entity.isAlive = false;
    });

    this.kernel.events.on(ALifeEvents.TASK_ASSIGNED, (e: { npcId: string; taskType: string; terrainId: string }) => {
      const key = `${e.taskType}@${e.terrainId}`;
      if (this.lastTaskLog.get(e.npcId) === key) return;
      this.lastTaskLog.set(e.npcId, key);
      this.log(`→ ${e.npcId} assigned ${e.taskType}`);
    });

    this.kernel.update(TICK_MS);

    // --- 10. Bullet groups + combat collisions ------------------------------

    this.npcBullets    = this.physics.add.group({ runChildUpdate: false });
    this.playerBullets = this.physics.add.group({ runChildUpdate: false });

    // NPC bullet → player
    this.physics.add.overlap(this.npcBullets, this.player, (_player, bullet) => {
      (bullet as Phaser.Physics.Arcade.Sprite).destroy();
      if (this.playerDead) return;
      this.playerHp = Math.max(0, this.playerHp - 10);
      if (this.playerHp === 0) this.killPlayer();
    });

    // Player bullet → NPC: handled manually in update() via checkPlayerBulletHits()
    // (IArcadeSprite wrapper is incompatible with physics.add.overlap)

    // Mouse click → player shoots
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.shootPlayerBullet(pointer.worldX, pointer.worldY);
    });

    // --- 11. UI layer -------------------------------------------------------

    this.hpGraphics      = this.add.graphics().setDepth(5);
    this.onlineRadiusGfx = this.add.graphics().setDepth(4);
    this.dangerGfx       = this.add.graphics().setDepth(6);

    this.add.text(10, 10, 'ALife SDK — AI Showcase', { fontSize: '13px', color: '#aaaaaa' });
    this.add.text(10, 26, 'WASD/arrows: move  ·  G: grenade  ·  Click: shoot  ·  walk toward NPCs to engage them', {
      fontSize: '11px', color: '#555555',
    });

    this.playerDeadText = this.add.text(W / 2, H / 2, 'YOU DIED\nClick to respawn', {
      fontSize: '32px', color: '#ff0000', align: 'center',
    }).setOrigin(0.5).setDepth(10).setVisible(false);

    this.tickText = this.add.text(10, H - 36, '', { fontSize: '11px', color: '#888888' });
    this.eventLogText = this.add.text(10, H - 20, '', { fontSize: '10px', color: '#555555' });

    // AI debug panel — right side
    const panelX = W - 310;
    const panelBg = this.add.graphics().setDepth(7);
    panelBg.fillStyle(0x000000, 0.7);
    panelBg.fillRect(panelX - 8, 44, 318, 210);
    panelBg.lineStyle(1, 0x333333, 0.8);
    panelBg.strokeRect(panelX - 8, 44, 318, 210);

    this.add.text(panelX, 50, 'AI DEBUG', { fontSize: '10px', color: '#444444' }).setDepth(8);

    this.aiOverlay = this.add.text(panelX, 64, '', {
      fontSize: '10px',
      color: '#aaaaaa',
      wordWrap: { width: 304 },
      lineSpacing: 4,
    }).setDepth(8);
  }

  // ---------------------------------------------------------------------------
  // update() — called every frame by Phaser
  // ---------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    // 1. Player movement
    if (!this.playerDead) {
      const vx = (this.cursors.left.isDown  || this.wasd.left.isDown  ? -1 : 0)
               + (this.cursors.right.isDown || this.wasd.right.isDown ?  1 : 0);
      const vy = (this.cursors.up.isDown    || this.wasd.up.isDown    ? -1 : 0)
               + (this.cursors.down.isDown  || this.wasd.down.isDown  ?  1 : 0);
      this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
    }

    // 2. Advance simulation
    this.kernel.update(delta);

    // 3. Sync offline NPC sprite positions
    this.syncOfflineNPCPositions(delta);

    // 4. Online/offline transitions
    this.handleOnlineOffline();

    // 5. Decay danger TTLs
    this.dangerManager.update(delta);

    // 6. Grenade
    if (Phaser.Input.Keyboard.JustDown(this.grenadeKey)) {
      this.throwGrenade();
    }

    // 7. Per-NPC AI update
    this.updateNpcAI(delta);

    // 8. Player bullet → NPC hit detection (manual, IArcadeSprite-safe)
    this.checkPlayerBulletHits();

    // 9. Draw overlays and grenade effects
    this.drawOverlays();
    this.drawGrenadeFlashes(delta);

    // 9. Player label
    this.playerLabel.setPosition(this.player.x - 8, this.player.y - 26);

    // 10. Status bar
    const onlineCount = [...this.simulation.getAllNPCRecords().values()]
      .filter(r => r.isOnline && r.currentHp > 0).length;
    this.tickText.setText(
      `Tick: ${this.tickCount}  |  Online: ${onlineCount}  |  Detection ring: ${DETECTION_RANGE}px (yellow)  |  Online ring: ${this.onlineDistance}px (cyan)`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private — AI layer
  // ---------------------------------------------------------------------------

  /** Spawn a grenade danger zone at the player's feet. */
  private throwGrenade(): void {
    const id  = `grenade_${++this.grenadeCount}`;
    const ttl = 3_500;
    this.dangerManager.addDanger({
      id,
      type: DangerType.GRENADE,
      position:    { x: this.player.x, y: this.player.y },
      radius:      120,
      threatScore: 0.9,
      remainingMs: ttl,
    });
    this.grenadeFlashes.push({ x: this.player.x, y: this.player.y, ttl, maxTtl: ttl });
    this.log(`💥 grenade at (${Math.round(this.player.x)}, ${Math.round(this.player.y)})`);
  }

  /**
   * Per-frame AI update for all NPCs.
   *
   * For each live NPC:
   *   1. Sync entity position from sprite.
   *   2. If player is within DETECTION_RANGE, add a VISUAL memory record.
   *   3. Tick the FSM (runs handler.update + evaluates auto-transitions).
   *   4. Update danger level at NPC position.
   *   5. Replan if grenade arrived while already in COMBAT.
   *   6. Update floating state label and debug panel row.
   */
  private updateNpcAI(delta: number): void {
    const deltaSec = delta / 1000;
    const rows: string[] = [];

    for (const [id, ai] of this.npcAI) {
      const record = this.simulation.getAllNPCRecords().get(id);
      const alive  = record && record.currentHp > 0 && !this.locallyDeadNpcs.has(id);

      if (!alive) {
        rows.push(`[${id.slice(0, 12).padEnd(12)}] DEAD`);
        this.npcStateLabels.get(id)?.setText('');
        continue;
      }

      const sprite = this.entityAdapter.getSprite(id);
      if (!sprite) continue;

      // 1. Sync position
      ai.entity.x = sprite.x;
      ai.entity.y = sprite.y;

      // 2. Player detection — closer means higher starting confidence
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, sprite.x, sprite.y);
      if (dist < DETECTION_RANGE) {
        const conf = Math.max(0.25, 1 - dist / DETECTION_RANGE);
        ai.memory.remember({
          sourceId:   'player',
          channel:    MemoryChannel.VISUAL,
          position:   { x: this.player.x, y: this.player.y },
          confidence: conf,
        });
      }

      // 3. Tick FSM — delta in seconds matches IStateHandler contract
      ai.fsm.update(deltaSec);

      // 4. Danger level at NPC position
      ai.dangerLevel = this.dangerManager.getThreatAt({ x: sprite.x, y: sprite.y });

      // 5. Replan if a grenade arrived while NPC is in COMBAT
      if (ai.fsm.state === 'COMBAT' && ai.dangerLevel > 0.3 && !ai.currentPlan.includes('FindCover')) {
        const ws = new WorldState();
        ws.set('hasAmmo', true);
        ws.set('underFire', true);
        const goal = new WorldState();
        goal.set('targetEliminated', true);
        const plan = this.goapPlanner.plan(ws, goal);
        if (plan) ai.currentPlan = plan.map(a => a.id);
      }

      // 6. Move online NPCs toward last known player position
      const arcadeSprite = sprite as unknown as Phaser.Physics.Arcade.Sprite;
      if (!arcadeSprite.body) continue; // body disabled (NPC killed by player this frame)
      const lastKnown = ai.memory.getMostConfident();
      if (record.isOnline && lastKnown) {
        const isCombat = ai.fsm.state === 'COMBAT';
        const speed    = isCombat ? 70 : 45;
        const stopDist = isCombat ? 90 : 20; // COMBAT: hang back and shoot
        const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, lastKnown.position.x, lastKnown.position.y);
        const dx = lastKnown.position.x - sprite.x;
        const dy = lastKnown.position.y - sprite.y;
        const distToTarget = Math.sqrt(dx * dx + dy * dy);
        if (distToTarget > stopDist) {
          arcadeSprite.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        } else {
          arcadeSprite.setVelocity(0, 0);
          if (isCombat && !this.playerDead) {
            this.fireNpcBullet(id, this.player.x, this.player.y, sprite.x, sprite.y);
          }
        }
      } else if (record.isOnline && ai.fsm.state === 'PATROL') {
        // Return to spawn position while still online
        const spawn = this.npcSpawnPos.get(id);
        if (spawn) {
          const dx = spawn.x - sprite.x;
          const dy = spawn.y - sprite.y;
          const distToSpawn = Math.sqrt(dx * dx + dy * dy);
          if (distToSpawn > 20) {
            const angle = Phaser.Math.Angle.Between(sprite.x, sprite.y, spawn.x, spawn.y);
            arcadeSprite.setVelocity(Math.cos(angle) * 60, Math.sin(angle) * 60);
          } else {
            arcadeSprite.setVelocity(0, 0);
          }
        } else {
          arcadeSprite.setVelocity(0, 0);
        }
      } else if (record.isOnline) {
        // Online but memory cleared and not PATROL — stop drifting
        arcadeSprite.setVelocity(0, 0);
      }

      // 7. Floating state icon above sprite
      const icon = ai.fsm.state === 'COMBAT' ? '[C]' : ai.fsm.state === 'ALERT' ? '[A]' : '';
      this.npcStateLabels.get(id)?.setPosition(sprite.x - 4, sprite.y - 32).setText(icon);

      // Debug panel row
      const conf    = ai.memory.getMostConfident()?.confidence ?? 0;
      const dLvl    = ai.dangerLevel > 0.5 ? 'HIGH' : ai.dangerLevel > 0.1 ? 'MED' : 'LOW';
      const plan    = ai.currentPlan.length ? ai.currentPlan.join('→') : '—';
      const shortId = id.slice(0, 12).padEnd(12);
      const stateLabel = ai.fsm.state.padEnd(6);
      rows.push(
        `[${shortId}] ${stateLabel} | mem:${conf.toFixed(2)} | ${dLvl}\n  plan: ${plan}`,
      );
    }

    this.aiOverlay.setText(rows.join('\n'));
  }

  /** Draw expanding red ring at each active grenade position. */
  private drawGrenadeFlashes(delta: number): void {
    this.dangerGfx.clear();

    for (let i = this.grenadeFlashes.length - 1; i >= 0; i--) {
      const flash = this.grenadeFlashes[i];
      flash.ttl -= delta;

      if (flash.ttl <= 0) {
        this.grenadeFlashes.splice(i, 1);
        continue;
      }

      const progress = 1 - flash.ttl / flash.maxTtl; // 0 → 1 over lifetime
      const alpha    = flash.ttl / flash.maxTtl;
      const radius   = 20 + 100 * progress;           // expands from 20 → 120 px

      this.dangerGfx.lineStyle(2, 0xff4400, alpha * 0.9);
      this.dangerGfx.strokeCircle(flash.x, flash.y, radius);
      this.dangerGfx.fillStyle(0xff2200, alpha * 0.12);
      this.dangerGfx.fillCircle(flash.x, flash.y, radius);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Simulation layer (unchanged from reference example)
  // ---------------------------------------------------------------------------

  private handleOnlineOffline(): void {
    const records       = [...this.simulation.getAllNPCRecords().values()];
    const onlineRecords = records.map(r => {
      const sprite = this.entityAdapter.getSprite(r.entityId);
      return {
        entityId: r.entityId,
        x:        sprite?.x ?? r.lastPosition.x,
        y:        sprite?.y ?? r.lastPosition.y,
        isOnline: r.isOnline,
        isAlive:  r.currentHp > 0,
      };
    });

    const { goOnline, goOffline } = this.onlineOffline.evaluate(
      this.player.x, this.player.y, onlineRecords,
    );

    for (const id of goOnline) {
      this.simulation.setNPCOnline(id, true);
      this.entityAdapter.getSprite(id)?.setAlpha(1.0);
    }
    for (const id of goOffline) {
      this.simulation.setNPCOnline(id, false);
      const offSprite = this.entityAdapter.getSprite(id) as unknown as Phaser.Physics.Arcade.Sprite;
      offSprite?.setAlpha(0.35);
      offSprite?.setVelocity(0, 0); // stop physics momentum so offline lerp takes over cleanly
      // After a chase, walk straight back to spawn at constant OFFLINE_SPEED
      const aiBundle = this.npcAI.get(id);
      const spawn    = this.npcSpawnPos.get(id);
      if (aiBundle && spawn && (aiBundle.fsm.state === 'ALERT' || aiBundle.fsm.state === 'COMBAT')) {
        this.wanderTargets.set(id, { x: spawn.x, y: spawn.y });
      } else {
        this.wanderTargets.delete(id);
      }
    }
  }

  private syncBridgeHP(): void {
    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (this.locallyDeadNpcs.has(record.entityId)) continue;
      const hpRec = this.hpRecords.get(record.entityId);
      if (hpRec) {
        // Subtract accumulated player damage so ticks don't reset partial hits
        const playerDmg = this.playerDamageDealt.get(record.entityId) ?? 0;
        hpRec.currentHp = Math.max(0, record.currentHp - playerDmg);
      }
    }
  }

  private syncOfflineNPCPositions(delta: number): void {
    const dt = delta / 1000;
    const OFFLINE_SPEED = 55; // px/s — constant, prevents rubber-band snap from lerp

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.isOnline || record.currentHp <= 0 || this.locallyDeadNpcs.has(record.entityId)) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      // Do NOT use movement.getPosition() — it returns a stale simulation
      // position that diverges from the Phaser sprite when the NPC was
      // moved online via physics. Using it causes teleportation.
      // Always lerp smoothly from the sprite's current position.

      const brain     = this.simulation.getNPCBrain(record.entityId);
      const terrainId = brain?.currentTerrainId;
      if (!terrainId) continue;

      const terrain = this.simulation.getAllTerrains().get(terrainId);
      if (!terrain) continue;

      let wander = this.wanderTargets.get(record.entityId);
      if (!wander || (Math.abs(sprite.x - wander.x) < 4 && Math.abs(sprite.y - wander.y) < 4)) {
        const { x, y, width, height } = terrain.bounds;
        wander = { x: x + Math.random() * width, y: y + Math.random() * height };
        this.wanderTargets.set(record.entityId, wander);
      }

      const dx   = wander.x - sprite.x;
      const dy   = wander.y - sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        const move = Math.min(OFFLINE_SPEED * dt, dist);
        sprite.setPosition(
          sprite.x + (dx / dist) * move,
          sprite.y + (dy / dist) * move,
        );
      }
    }
  }

  /** Draw HP bars above each live NPC and detection / online radius rings around the player. */
  private drawOverlays(): void {
    this.hpGraphics.clear();
    this.onlineRadiusGfx.clear();

    // Player HP bar (top-left, below title)
    const barW = 120, barH = 8, bx = 10, by = 44;
    const hpFrac  = this.playerHp / this.playerMaxHp;
    const hpColor = hpFrac > 0.5 ? 0x44ff44 : hpFrac > 0.25 ? 0xffaa00 : 0xff3333;
    this.hpGraphics.fillStyle(0x222222);
    this.hpGraphics.fillRect(bx, by, barW, barH);
    this.hpGraphics.fillStyle(hpColor);
    this.hpGraphics.fillRect(bx, by, Math.round(barW * hpFrac), barH);

    // Online proximity ring (cyan)
    this.onlineRadiusGfx.lineStyle(1, 0x00ffff, 0.20);
    this.onlineRadiusGfx.strokeCircle(this.player.x, this.player.y, this.onlineDistance);

    // ALERT ring (yellow) — enter this → NPC goes ALERT
    const alertRadius = Math.round(DETECTION_RANGE * (1 - CONF_ALERT));
    this.onlineRadiusGfx.lineStyle(1, 0xffff00, 0.40);
    this.onlineRadiusGfx.strokeCircle(this.player.x, this.player.y, alertRadius);

    // COMBAT ring (orange) — enter this → NPC goes COMBAT
    const combatRadius = Math.round(DETECTION_RANGE * (1 - CONF_COMBAT));
    this.onlineRadiusGfx.lineStyle(1, 0xff6600, 0.50);
    this.onlineRadiusGfx.strokeCircle(this.player.x, this.player.y, combatRadius);

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.currentHp <= 0 || this.locallyDeadNpcs.has(record.entityId)) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      const maxHp  = NPC_DEFS.find(d => d.entityId === record.entityId)?.hp ?? 100;
      const hpRec  = this.hpRecords.get(record.entityId);
      const frac   = Math.max(0, (hpRec?.currentHp ?? record.currentHp) / maxHp);
      const bw    = 24;
      const bx    = sprite.x - bw / 2;
      const by    = sprite.y - 18;

      this.hpGraphics.fillStyle(0x333333);
      this.hpGraphics.fillRect(bx, by, bw, 3);

      const color = frac > 0.5 ? 0x44dd44 : frac > 0.25 ? 0xddaa22 : 0xdd3333;
      this.hpGraphics.fillStyle(color);
      this.hpGraphics.fillRect(bx, by, Math.round(bw * frac), 3);
    }
  }

  private log(msg: string): void {
    this.eventLog.push(msg);
    if (this.eventLog.length > 4) this.eventLog.shift();
    this.eventLogText?.setText(this.eventLog.join('  ·  '));
  }

  private makeTexture(key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): void {
    const g = this.make.graphics({} as never) as Phaser.GameObjects.Graphics;
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
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
    const W = this.scale.width;
    const H = this.scale.height;
    this.playerHp   = this.playerMaxHp;
    this.playerDead = false;
    this.player.setPosition(Math.round(W * 0.06), Math.round(H * 0.5));
    this.player.setAlpha(1.0);
    this.playerDeadText.setVisible(false);
  }

  private damageNpc(id: string, dmg: number): void {
    if (this.locallyDeadNpcs.has(id)) return;
    const totalDmg = (this.playerDamageDealt.get(id) ?? 0) + dmg;
    this.playerDamageDealt.set(id, totalDmg);

    const record = this.simulation.getAllNPCRecords().get(id);
    const simHp  = record?.currentHp ?? 0;
    const effectiveHp = Math.max(0, simHp - totalDmg);

    const hpRec = this.hpRecords.get(id);
    if (hpRec) hpRec.currentHp = effectiveHp;

    if (effectiveHp === 0) {
      this.locallyDeadNpcs.add(id);
      const sprite = this.entityAdapter.getSprite(id) as unknown as Phaser.Physics.Arcade.Sprite | undefined;
      if (sprite) {
        sprite.setVisible(false);
        const body = sprite.body as Phaser.Physics.Arcade.Body | null | undefined;
        if (body) { body.enable = false; body.setVelocity(0, 0); }
      }
      this.npcStateLabels.get(id)?.setVisible(false);
    }
  }

  private checkPlayerBulletHits(): void {
    const bullets = this.playerBullets.getChildren() as Phaser.Physics.Arcade.Sprite[];
    for (const [id] of this.npcAI) {
      if (this.locallyDeadNpcs.has(id)) continue;
      const record = this.simulation.getAllNPCRecords().get(id);
      if (!record?.isOnline) continue; // can only shoot online NPCs
      const sprite = this.entityAdapter.getSprite(id);
      if (!sprite) continue;
      for (const bullet of bullets) {
        if (!bullet.active) continue;
        const dist = Phaser.Math.Distance.Between(bullet.x, bullet.y, sprite.x, sprite.y);
        if (dist < 14) {
          bullet.destroy();
          this.damageNpc(id, 25);
          break;
        }
      }
    }
  }

  private shootPlayerBullet(targetX: number, targetY: number): void {
    if (this.playerDead) return;
    const now = Date.now();
    if (now - this.lastPlayerShot < 300) return;
    this.lastPlayerShot = now;

    const b = this.physics.add.sprite(this.player.x, this.player.y, 'player_bullet').setDepth(5);
    this.playerBullets.add(b);
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, targetX, targetY);
    (b as unknown as Phaser.Physics.Arcade.Sprite).setVelocity(
      Math.cos(angle) * 500,
      Math.sin(angle) * 500,
    );
    this.time.delayedCall(2000, () => { if (b.active) b.destroy(); });
  }

  private fireNpcBullet(npcId: string, targetX: number, targetY: number, spriteX: number, spriteY: number): void {
    const now  = Date.now();
    const last = this.npcLastShot.get(npcId) ?? 0;
    if (now - last < 1500) return;
    this.npcLastShot.set(npcId, now);

    const spread = (Math.random() - 0.5) * 0.25;
    const angle  = Phaser.Math.Angle.Between(spriteX, spriteY, targetX, targetY) + spread;
    const b = this.physics.add.sprite(spriteX, spriteY, 'npc_bullet').setDepth(5);
    this.npcBullets.add(b);
    (b as unknown as Phaser.Physics.Arcade.Sprite).setVelocity(
      Math.cos(angle) * 300,
      Math.sin(angle) * 300,
    );
    this.time.delayedCall(2000, () => { if (b.active) b.destroy(); });
  }
}
