/**
 * GameScene.ts
 *
 * A-Life SDK integration with Phaser 3 — minimal but complete example.
 *
 * What this scene demonstrates:
 *   1. createPhaserKernel()        — one-call kernel setup with all adapters wired
 *   2. PhaserEntityAdapter         — bridges sprite registry to the SDK
 *   3. PhaserEntityFactory         — called by the SDK when it spawns entities
 *   4. PhaserPlayerPosition        — feeds live player position to online/offline logic
 *   5. PhaserSimulationBridge      — tracks HP so offline combat has real results
 *   6. OnlineOfflineManager        — decides which NPCs are online/offline each frame
 *
 * Controls: WASD or arrow keys to move the player.
 *
 * Visuals:
 *   - White circle  = player
 *   - Blue squares  = Stalker NPCs
 *   - Red squares   = Bandit NPCs
 *   - Dim alpha     = offline NPC (SDK tick pipeline drives it)
 *   - Full alpha    = online NPC (host engine would drive it in a real game)
 *   - Cyan circle   = online proximity threshold (enter to bring NPCs online)
 *   - HP bar        = above each NPC (shrinks as offline combat takes HP)
 *   - Zone rect     = SmartTerrain boundary
 */

import Phaser from 'phaser';
import type { ALifeKernel } from '@alife-sdk/core';
import { ALifeEvents, SmartTerrain } from '@alife-sdk/core';
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

const PLAYER_SPEED = 220; // px/s
const TICK_MS      = 2_000; // 2s per tick — fast enough to see in a demo

// NPC base stats — positions are computed relative to screen size in create().
const NPC_DEFS = [
  { entityId: 'stalker_wolf', factionId: 'stalker', hp: 100, combatPower: 70, rank: 3 },
  { entityId: 'stalker_bear', factionId: 'stalker', hp: 80,  combatPower: 55, rank: 2 },
  { entityId: 'bandit_knife', factionId: 'bandit',  hp: 80,  combatPower: 40, rank: 2 },
  { entityId: 'bandit_razor', factionId: 'bandit',  hp: 90,  combatPower: 60, rank: 3 },
] as const;

// ---------------------------------------------------------------------------
// GameScene
// ---------------------------------------------------------------------------

export class GameScene extends Phaser.Scene {

  // SDK objects
  private kernel!: ALifeKernel;
  private simulation!: SimulationPlugin;
  private entityAdapter!: PhaserEntityAdapter;
  private bridge!: PhaserSimulationBridge;
  private onlineOffline!: OnlineOfflineManager;

  // HP records — shared mutable objects that bridge + display both read from
  private hpRecords = new Map<string, { currentHp: number; maxHp: number }>();

  // Phaser objects
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private hpGraphics!: Phaser.GameObjects.Graphics;
  private onlineRadiusGfx!: Phaser.GameObjects.Graphics;
  private debugText!: Phaser.GameObjects.Text;
  private tickText!: Phaser.GameObjects.Text;
  private playerLabel!: Phaser.GameObjects.Text;

  private eventLog: string[] = [];
  private tickCount = 0;
  private onlineDistance = 0; // computed from screen size in create()
  private npcSpawnPos = new Map<string, { x: number; y: number }>(); // computed in create()
  private wanderTargets = new Map<string, { x: number; y: number }>();
  // Tracks last logged task per NPC to suppress repeated identical TASK_ASSIGNED events
  private lastTaskLog = new Map<string, string>();

  constructor() {
    super({ key: 'GameScene' });
  }

  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Online detection radius scales with the smaller screen dimension.
    this.onlineDistance = Math.round(Math.min(W, H) * 0.22);

    // --- 1. Generate sprite textures (no external assets needed) ------------

    this.makeTexture('player',  24, 24, g => { g.fillStyle(0xffffff); g.fillCircle(12, 12, 11); });
    this.makeTexture('stalker', 22, 22, g => { g.fillStyle(0x3a7bd5); g.fillRect(2, 2, 18, 18); });
    this.makeTexture('bandit',  22, 22, g => { g.fillStyle(0xd53a3a); g.fillRect(2, 2, 18, 18); });

    // --- 2. Draw terrain zone rectangles ------------------------------------

    const zonesGfx = this.add.graphics();

    // Layout: Factory top-left, Bunker bottom-right.
    const tw = Math.round(W * 0.20); // terrain width
    const th = Math.round(H * 0.30); // terrain height

    // SmartTerrain "Factory" — stalkers will congregate here
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

    // SmartTerrain "Bunker" — bandits will head here
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
    this.add.text(factory.bounds.x + 4, factory.bounds.y + 4, factory.name, { fontSize: '11px', color: '#88aaff' });

    zonesGfx.lineStyle(2, 0xd53a3a, 0.6);
    zonesGfx.strokeRect(bunker.bounds.x, bunker.bounds.y, bunker.bounds.width, bunker.bounds.height);
    zonesGfx.fillStyle(0xd53a3a, 0.08);
    zonesGfx.fillRect(bunker.bounds.x, bunker.bounds.y, bunker.bounds.width, bunker.bounds.height);
    this.add.text(bunker.bounds.x + 4, bunker.bounds.y + 4, bunker.name, { fontSize: '11px', color: '#ff8888' });

    // Pre-compute NPC spawn positions relative to terrain bounds.
    this.npcSpawnPos.set('stalker_wolf', { x: fx + 20,      y: fy - 12 });
    this.npcSpawnPos.set('stalker_bear', { x: fx + 60,      y: fy - 8  });
    this.npcSpawnPos.set('bandit_knife', { x: bx + 20,      y: by - 12 });
    this.npcSpawnPos.set('bandit_razor', { x: bx + 60,      y: by - 8  });

    // --- 3. Create player ---------------------------------------------------

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

    // --- 4. Build SDK adapters ---------------------------------------------

    this.entityAdapter = new PhaserEntityAdapter();
    this.bridge        = new PhaserSimulationBridge();

    // PhaserEntityFactory: called by the SDK (via SpawnPlugin) to create entities.
    // Here we also register them immediately into our adapter and bridge.
    let npcCount = 0;
    const entityFactory = new PhaserEntityFactory({
      createNPC: (req) => {
        const id  = req.metadata?.['entityId'] as string ?? `npc_${++npcCount}`;
        const key = req.factionId === 'stalker' ? 'stalker' : 'bandit';
        const sprite = this.physics.add.sprite(req.x, req.y, key);
        sprite.name = id;
        // Double cast: Phaser.Physics.Arcade.Sprite satisfies IArcadeSprite structurally
        // but TS can't verify it without an explicit cast through unknown.
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

    // PhaserPlayerPosition: reads live player sprite coordinates every frame.
    const playerPosition = new PhaserPlayerPosition(this.player);

    // --- 5. Create the kernel via the facade --------------------------------
    //
    // createPhaserKernel() wires all plugins in the correct order:
    //   FactionsPlugin → SpawnPlugin → SimulationPlugin
    // It also creates an OnlineOfflineManager with the given distance settings.

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
              detectionProbability: 100, // always detect for demo clarity
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
          hysteresisFactor: 0.15, // 15% band prevents rapid flickering
        },
      },
    });

    this.kernel        = result.kernel;
    this.simulation    = result.simulation!;
    this.onlineOffline = result.onlineOffline;

    this.kernel.init();
    this.kernel.start();

    // --- 6. Register NPCs manually -----------------------------------------
    //
    // registerNPC() must be called AFTER kernel.init().
    // We create each sprite here, register it in the adapter and bridge,
    // then register the NPC record with the simulation.

    for (const def of NPC_DEFS) {
      const pos  = this.npcSpawnPos.get(def.entityId) ?? { x: 0, y: 0 };
      const key  = def.factionId === 'stalker' ? 'stalker' : 'bandit';
      const sprite = this.physics.add.sprite(pos.x, pos.y, key);
      sprite.name  = def.entityId;
      sprite.setAlpha(0.35); // start offline — dim

      // See factory comment above for why the double cast is needed.
      this.entityAdapter.register(def.entityId, sprite as unknown as IArcadeSprite);

      // Share the HP object — both the bridge and our HP bars read from it.
      // syncBridgeHP() copies record.currentHp into it after each tick.
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

    // --- 7. Event listeners ------------------------------------------------

    this.kernel.events.on(ALifeEvents.TICK, ({ tick }: { tick: number }) => {
      this.tickCount = tick;
      this.syncBridgeHP(); // keep bridge HP in sync after resolver mutates records
    });

    this.kernel.events.on(ALifeEvents.FACTION_CONFLICT, (e: { factionA: string; factionB: string; zoneId: string }) => {
      this.log(`⚔ ${e.factionA} vs ${e.factionB} at ${e.zoneId}`);
    });

    this.kernel.events.on(ALifeEvents.NPC_DIED, (e: { npcId: string; zoneId: string }) => {
      this.log(`☠ ${e.npcId} died at ${e.zoneId || '?'}`);
      // Dim the sprite — NPC is gone
      const sprite = this.entityAdapter.getSprite(e.npcId);
      sprite?.setVisible(false);
    });

    this.kernel.events.on(ALifeEvents.TASK_ASSIGNED, (e: { npcId: string; taskType: string; terrainId: string }) => {
      // Suppress repeated identical assignments — brain re-evaluates every tick
      const key = `${e.taskType}@${e.terrainId}`;
      if (this.lastTaskLog.get(e.npcId) === key) return;
      this.lastTaskLog.set(e.npcId, key);
      this.log(`→ ${e.npcId} → ${e.taskType} @ ${e.terrainId}`);
    });

    // Fire an immediate tick so terrain is assigned and NPC movement starts
    // from frame 1 — without this, NPCs stand still for TICK_MS milliseconds.
    this.kernel.update(TICK_MS);

    // --- 8. UI layer -------------------------------------------------------

    this.hpGraphics      = this.add.graphics().setDepth(5);
    this.onlineRadiusGfx = this.add.graphics().setDepth(4);

    this.add.text(10, 10, 'ALife SDK — Phaser Demo', { fontSize: '13px', color: '#aaaaaa' });
    this.add.text(10, 26, 'WASD / arrows to move · approach NPCs to bring them online', {
      fontSize: '11px', color: '#666666',
    });

    this.tickText  = this.add.text(10, H - 24, '', { fontSize: '11px', color: '#888888' });
    this.debugText = this.add.text(W - 240, 50, '', { fontSize: '10px', color: '#aaaaaa', wordWrap: { width: 230 } });
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

    // 2. Advance the simulation
    this.kernel.update(delta);

    // 3a. Sync offline NPC sprites toward their brain-assigned positions
    this.syncOfflineNPCPositions();

    // 3b. Online/offline transitions based on player proximity
    this.handleOnlineOffline();

    // 4. Draw HP bars and online radius circle
    this.drawOverlays();

    // 5a. Keep "You" label above the player
    this.playerLabel.setPosition(this.player.x - 8, this.player.y - 24);

    // 5b. Update debug text
    const onlineCount = [...this.simulation.getAllNPCRecords().values()]
      .filter(r => r.isOnline && r.currentHp > 0).length;
    this.tickText.setText(
      `Tick: ${this.tickCount}  |  Online NPCs: ${onlineCount}  |  Online radius: ${this.onlineDistance}px`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Evaluate which NPCs should transition online/offline and apply the changes.
   * Called every frame so transitions happen immediately when the player moves.
   */
  private handleOnlineOffline(): void {
    const records = [...this.simulation.getAllNPCRecords().values()];

    // Use sprite position — record.lastPosition is the registration position and
    // goes stale once the sprite moves to its terrain. Sprite position is truth.
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
      this.entityAdapter.getSprite(id)?.setAlpha(1.0); // brighten — host takes over
    }

    for (const id of goOffline) {
      this.simulation.setNPCOnline(id, false);
      this.entityAdapter.getSprite(id)?.setAlpha(0.35); // dim — SDK tick pipeline drives it
    }
  }

  /**
   * Sync bridge HP records from the simulation after each tick.
   *
   * OfflineCombatResolver mutates INPCRecord.currentHp directly — it does NOT
   * call bridge.applyDamage(). Copy the value back so HP bars stay accurate.
   */
  private syncBridgeHP(): void {
    for (const record of this.simulation.getAllNPCRecords().values()) {
      const hpRec = this.hpRecords.get(record.entityId);
      if (hpRec) hpRec.currentHp = record.currentHp;
    }
  }

  /**
   * Sync offline NPC sprites to the MovementSimulator's live interpolated position.
   *
   * `getPosition(id)` returns the interpolated world position during an active
   * inter-terrain journey, or null when the NPC is stationary at its terrain.
   * When stationary, we wander randomly within the assigned terrain bounds.
   */
  private syncOfflineNPCPositions(): void {
    const movement = this.simulation.getMovementSimulator();

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.isOnline || record.currentHp <= 0) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      // Live interpolated position from MovementSimulator (non-null while moving)
      const livePos = movement.getPosition(record.entityId);
      if (livePos) {
        sprite.setPosition(livePos.x, livePos.y);
        continue;
      }

      // NPC is stationary at terrain — wander randomly within terrain bounds
      const brain     = this.simulation.getNPCBrain(record.entityId);
      const terrainId = brain?.currentTerrainId;
      if (!terrainId) continue;
      const terrain = this.simulation.getAllTerrains().get(terrainId);
      if (!terrain) continue;

      // Pick a new wander target when there is none or NPC reached it
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

  /**
   * Draw HP bars above each live NPC and the online radius circle around the player.
   */
  private drawOverlays(): void {
    this.hpGraphics.clear();
    this.onlineRadiusGfx.clear();

    // Online radius circle
    this.onlineRadiusGfx.lineStyle(1, 0x00ffff, 0.25);
    this.onlineRadiusGfx.strokeCircle(this.player.x, this.player.y, this.onlineDistance);

    // HP bars
    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.currentHp <= 0) continue;
      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      const maxHp = NPC_DEFS.find(d => d.entityId === record.entityId)?.hp ?? 100;
      const frac  = Math.max(0, record.currentHp / maxHp);
      const bw    = 24;
      const bx    = sprite.x - bw / 2;
      const by    = sprite.y - 18;

      // Background
      this.hpGraphics.fillStyle(0x333333);
      this.hpGraphics.fillRect(bx, by, bw, 3);

      // Fill: green → red based on HP fraction
      const color = frac > 0.5 ? 0x44dd44 : frac > 0.25 ? 0xddaa22 : 0xdd3333;
      this.hpGraphics.fillStyle(color);
      this.hpGraphics.fillRect(bx, by, Math.round(bw * frac), 3);
    }
  }

  /** Append a message to the event log (capped at 8 lines). */
  private log(msg: string): void {
    this.eventLog.push(msg);
    if (this.eventLog.length > 8) this.eventLog.shift();
    this.debugText.setText(this.eventLog.join('\n'));
  }

  /** Helper: generate a Phaser texture programmatically using a Graphics callback. */
  private makeTexture(key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): void {
    const g = this.make.graphics({ add: false });
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
