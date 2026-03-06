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
  GOAPAction,
  ActionStatus,
  WorldState,
} from '@alife-sdk/core';
import type { IEntity } from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';
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
const CONF_ALERT  = 0.45; // PATROL → ALERT
const CONF_COMBAT = 0.78; // ALERT  → COMBAT
const CONF_FORGET = 0.12; // *      → PATROL

// NPC definitions
const NPC_DEFS = [
  { entityId: 'stalker_wolf', factionId: 'stalker', hp: 100, combatPower: 70, rank: 3 },
  { entityId: 'stalker_bear', factionId: 'stalker', hp: 80,  combatPower: 55, rank: 2 },
  { entityId: 'bandit_knife', factionId: 'bandit',  hp: 80,  combatPower: 40, rank: 2 },
  { entityId: 'bandit_razor', factionId: 'bandit',  hp: 90,  combatPower: 60, rank: 3 },
] as const;

// ---------------------------------------------------------------------------
// GOAP actions
//
// Two plan paths depending on world state:
//   Safe   → TakePosition(1) + Attack(2)         = cost 3
//   Danger → FindCover(1)    + AttackFromCover(1) = cost 2  ← preferred
// ---------------------------------------------------------------------------

class TakePositionAction extends GOAPAction {
  readonly id   = 'TakePosition';
  readonly cost = 1;
  getPreconditions() { return new WorldState(); }
  getEffects()       { const ws = new WorldState(); ws.set('inPosition', true); return ws; }
  isValid()          { return true; }
  execute()          { return ActionStatus.SUCCESS; }
}

class AttackAction extends GOAPAction {
  readonly id   = 'Attack';
  readonly cost = 2;
  getPreconditions() { const ws = new WorldState(); ws.set('inPosition', true); return ws; }
  getEffects()       { const ws = new WorldState(); ws.set('targetEliminated', true); return ws; }
  isValid()          { return true; }
  execute()          { return ActionStatus.SUCCESS; }
}

class FindCoverAction extends GOAPAction {
  readonly id   = 'FindCover';
  readonly cost = 1;
  // Only reachable when a grenade / explosion is nearby
  getPreconditions() { const ws = new WorldState(); ws.set('underFire', true); return ws; }
  getEffects()       { const ws = new WorldState(); ws.set('inCover', true); ws.set('inPosition', true); return ws; }
  isValid()          { return true; }
  execute()          { return ActionStatus.SUCCESS; }
}

class AttackFromCoverAction extends GOAPAction {
  readonly id   = 'AttackFromCover';
  readonly cost = 1;
  getPreconditions() { const ws = new WorldState(); ws.set('inCover', true); return ws; }
  getEffects()       { const ws = new WorldState(); ws.set('targetEliminated', true); return ws; }
  isValid()          { return true; }
  execute()          { return ActionStatus.SUCCESS; }
}

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
    const ws = new WorldState();
    ws.set('hasAmmo', true);
    if (underFire) ws.set('underFire', true);
    const goal = new WorldState();
    goal.set('targetEliminated', true);
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

    this.makeTexture('player',  24, 24, g => { g.fillStyle(0xffffff); g.fillCircle(12, 12, 11); });
    this.makeTexture('stalker', 22, 22, g => { g.fillStyle(0x3a7bd5); g.fillRect(2, 2, 18, 18); });
    this.makeTexture('bandit',  22, 22, g => { g.fillStyle(0xd53a3a); g.fillRect(2, 2, 18, 18); });

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
        behaviorConfig: {
          retreatThreshold: 0.15,
          panicThreshold:   -0.8,
          searchIntervalMs: TICK_MS,
          dangerTolerance:  4,
          aggression:       0.8,
        },
        options: { type: 'human' },
      });
    }

    // --- 7. GOAP planner (shared, stateless) --------------------------------

    this.goapPlanner = new GOAPPlanner();
    this.goapPlanner.registerAction(new TakePositionAction());
    this.goapPlanner.registerAction(new AttackAction());
    this.goapPlanner.registerAction(new FindCoverAction());
    this.goapPlanner.registerAction(new AttackFromCoverAction());

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

    // --- 10. UI layer -------------------------------------------------------

    this.hpGraphics      = this.add.graphics().setDepth(5);
    this.onlineRadiusGfx = this.add.graphics().setDepth(4);
    this.dangerGfx       = this.add.graphics().setDepth(6);

    this.add.text(10, 10, 'ALife SDK — AI Showcase', { fontSize: '13px', color: '#aaaaaa' });
    this.add.text(10, 26, 'WASD/arrows: move  ·  G: throw grenade  ·  walk toward NPCs to engage them', {
      fontSize: '11px', color: '#555555',
    });

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
    const vx = (this.cursors.left.isDown  || this.wasd.left.isDown  ? -1 : 0)
             + (this.cursors.right.isDown || this.wasd.right.isDown ?  1 : 0);
    const vy = (this.cursors.up.isDown    || this.wasd.up.isDown    ? -1 : 0)
             + (this.cursors.down.isDown  || this.wasd.down.isDown  ?  1 : 0);
    this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);

    // 2. Advance simulation
    this.kernel.update(delta);

    // 3. Sync offline NPC sprite positions
    this.syncOfflineNPCPositions();

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

    // 8. Draw overlays and grenade effects
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
      const alive  = record && record.currentHp > 0;

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

      // 6. Floating state icon above sprite
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
      this.entityAdapter.getSprite(id)?.setAlpha(0.35);
    }
  }

  private syncBridgeHP(): void {
    for (const record of this.simulation.getAllNPCRecords().values()) {
      const hpRec = this.hpRecords.get(record.entityId);
      if (hpRec) hpRec.currentHp = record.currentHp;
    }
  }

  private syncOfflineNPCPositions(): void {
    const movement = this.simulation.getMovementSimulator();

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.isOnline || record.currentHp <= 0) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      const livePos = movement.getPosition(record.entityId);
      if (livePos) {
        sprite.setPosition(livePos.x, livePos.y);
        continue;
      }

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

      sprite.setPosition(
        Phaser.Math.Linear(sprite.x, wander.x, 0.02),
        Phaser.Math.Linear(sprite.y, wander.y, 0.02),
      );
    }
  }

  /** Draw HP bars above each live NPC and detection / online radius rings around the player. */
  private drawOverlays(): void {
    this.hpGraphics.clear();
    this.onlineRadiusGfx.clear();

    // Online proximity ring (cyan)
    this.onlineRadiusGfx.lineStyle(1, 0x00ffff, 0.25);
    this.onlineRadiusGfx.strokeCircle(this.player.x, this.player.y, this.onlineDistance);

    // Detection ring (yellow, dimmer) — enter this to trigger NPC memory
    this.onlineRadiusGfx.lineStyle(1, 0xffff00, 0.18);
    this.onlineRadiusGfx.strokeCircle(this.player.x, this.player.y, DETECTION_RANGE);

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.currentHp <= 0) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      const maxHp = NPC_DEFS.find(d => d.entityId === record.entityId)?.hp ?? 100;
      const frac  = Math.max(0, record.currentHp / maxHp);
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
}
