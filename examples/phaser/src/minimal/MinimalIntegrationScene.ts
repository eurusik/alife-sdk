/**
 * MinimalIntegrationScene
 *
 * Purpose:
 * - show the smallest practical Phaser + ALife SDK wiring
 * - avoid showcase complexity (HUD, GOAP, grenades, combat systems)
 *
 * Use this file as the first read when integrating the SDK into your own game.
 */

import Phaser from 'phaser';
import { ALifeEvents, SmartTerrain, type ALifeKernel } from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';
import {
  OnlineOfflineManager,
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserPlayerPosition,
  PhaserSimulationBridge,
  createPhaserKernel,
} from '@alife-sdk/phaser';
import type { IArcadeSprite } from '@alife-sdk/phaser';

export class MinimalIntegrationScene extends Phaser.Scene {
  private kernel!: ALifeKernel;
  private simulation!: SimulationPlugin;
  private onlineOffline!: OnlineOfflineManager;
  private entityAdapter!: PhaserEntityAdapter;
  private bridge!: PhaserSimulationBridge;
  private onlineDistance = 180;
  private readonly npcId = 'stalker_alpha';

  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private infoText!: Phaser.GameObjects.Text;
  private unsubTick: (() => void) | null = null;
  private tick = 0;
  private handoffState = 'init';

  constructor() {
    super({ key: 'MinimalIntegrationScene' });
  }

  create(): void {
    this.makeTextures();
    this.drawBackgroundGuides();

    this.player = this.physics.add.sprite(140, 220, 'mini_player');
    this.player.setCollideWorldBounds(true);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.infoText = this.add.text(16, 16, '', {
      fontSize: '14px',
      color: '#dbe7ff',
      fontFamily: 'Trebuchet MS, sans-serif',
      lineSpacing: 4,
    }).setDepth(10);

    this.entityAdapter = new PhaserEntityAdapter();
    this.bridge = new PhaserSimulationBridge();

    const entityFactory = new PhaserEntityFactory({
      createNPC: (req) => {
        const id = (req.metadata?.['entityId'] as string) ?? `npc_${Date.now()}`;
        const key = req.factionId === 'stalker' ? 'mini_stalker' : 'mini_bandit';
        const sprite = this.physics.add.sprite(req.x, req.y, key);
        sprite.name = id;
        this.entityAdapter.register(id, sprite as unknown as IArcadeSprite);
        this.bridge.register(id, { currentHp: 100, maxHp: 100 });
        return id;
      },
      createMonster: () => `monster_${Date.now()}`,
      destroyEntity: (id) => {
        this.entityAdapter.getSprite(id)?.destroy();
        this.entityAdapter.unregister(id);
        this.bridge.unregister(id);
      },
    });

    const terrains = [
      new SmartTerrain({
        id: 'factory',
        name: 'Factory',
        bounds: { x: 340, y: 100, width: 280, height: 180 },
        capacity: 6,
        jobs: [{ type: 'patrol', slots: 4 }],
      }),
    ];

    const kernelSetup = createPhaserKernel({
      ports: {
        entityAdapter: this.entityAdapter,
        playerPosition: new PhaserPlayerPosition(this.player),
        entityFactory,
        simulationBridge: this.bridge,
      },
      data: {
        factions: [
          { id: 'stalker', relations: { bandit: -80 } },
          { id: 'bandit', relations: { stalker: -80 } },
        ],
        terrains,
      },
      config: {
        preset: 'simulation',
        onlineOffline: {
          switchDistance: this.onlineDistance,
          hysteresisFactor: 0.15,
        },
      },
    });

    this.kernel = kernelSetup.kernel;
    this.simulation = kernelSetup.simulation!;
    this.onlineOffline = kernelSetup.onlineOffline;

    this.kernel.init();
    this.kernel.start();
    this.unsubTick = this.kernel.events.on(ALifeEvents.TICK, ({ tick }) => {
      this.tick = tick;
    });

    // Minimal NPC registration:
    const npcPos = { x: 420, y: 220 };
    const npcSprite = this.physics.add.sprite(npcPos.x, npcPos.y, 'mini_stalker');
    npcSprite.name = this.npcId;
    npcSprite.setAlpha(0.35);
    this.entityAdapter.register(this.npcId, npcSprite as unknown as IArcadeSprite);
    this.bridge.register(this.npcId, { currentHp: 100, maxHp: 100 });

    this.simulation.registerNPC({
      entityId: this.npcId,
      factionId: 'stalker',
      position: npcPos,
      currentHp: 100,
      rank: 2,
      combatPower: 40,
      behaviorConfig: createDefaultBehaviorConfig({
        aggression: 0.6,
        retreatThreshold: 0.2,
        panicThreshold: -0.7,
        searchIntervalMs: 2000,
      }),
      options: { type: 'human' },
    });
    this.simulation.setNPCOnline(this.npcId, false);

    // Force one immediate simulation pass so NPC appears with initial state.
    this.kernel.update(1000);
    this.evaluateOnlineOffline();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubTick?.();
      this.unsubTick = null;
      this.kernel?.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const speed = 210;
    const vx = (this.cursors.left.isDown ? -1 : 0) + (this.cursors.right.isDown ? 1 : 0);
    const vy = (this.cursors.up.isDown ? -1 : 0) + (this.cursors.down.isDown ? 1 : 0);
    this.player.setVelocity(vx * speed, vy * speed);

    // Core integration loop:
    this.kernel.update(delta);
    this.evaluateOnlineOffline();

    const record = this.simulation.getNPCRecord(this.npcId);
    const sprite = this.entityAdapter.getSprite(this.npcId);
    const dist = sprite ? Math.round(Phaser.Math.Distance.Between(this.player.x, this.player.y, sprite.x, sprite.y)) : -1;
    const online = record?.isOnline ? 'online' : 'offline';
    this.infoText.setText(
      [
        'ALife SDK Minimal Integration',
        'Arrows: move player near/far NPC',
        `NPC ${this.npcId}: ${online} | dist=${dist}px | switch=${this.onlineDistance}px`,
        `handoff: ${this.handoffState} | tick: ${this.tick}`,
        'Shows: kernel + simulation + adapters + online/offline manager.',
      ].join('\n'),
    );
  }

  private evaluateOnlineOffline(): void {
    const records = [...this.simulation.getAllNPCRecords().values()].map((record) => {
      const sprite = this.entityAdapter.getSprite(record.entityId);
      return {
        entityId: record.entityId,
        x: sprite?.x ?? record.lastPosition.x,
        y: sprite?.y ?? record.lastPosition.y,
        isOnline: record.isOnline,
        isAlive: record.currentHp > 0,
      };
    });
    const { goOnline, goOffline } = this.onlineOffline.evaluate(this.player.x, this.player.y, records);

    for (const id of goOnline) {
      this.simulation.setNPCOnline(id, true);
      this.entityAdapter.getSprite(id)?.setAlpha(1.0);
      this.handoffState = `${id} -> online`;
    }
    for (const id of goOffline) {
      const sprite = this.entityAdapter.getSprite(id);
      if (sprite) {
        const record = this.simulation.getNPCRecord(id);
        if (record) record.lastPosition = { x: sprite.x, y: sprite.y };
      }
      this.simulation.setNPCOnline(id, false);
      this.entityAdapter.getSprite(id)?.setAlpha(0.35);
      this.handoffState = `${id} -> offline`;
    }
  }

  private drawBackgroundGuides(): void {
    const g = this.add.graphics();
    g.fillStyle(0x141f4d, 1);
    g.fillRect(0, 0, this.scale.width, this.scale.height);
    g.lineStyle(2, 0x4f7cff, 0.5);
    g.strokeRect(340, 100, 280, 180);
    g.fillStyle(0x4f7cff, 0.14);
    g.fillRect(340, 100, 280, 180);
    this.add.text(350, 106, 'Factory terrain', {
      fontSize: '14px',
      color: '#b9ccff',
      fontFamily: 'Trebuchet MS, sans-serif',
    });
  }

  private makeTextures(): void {
    const draw = (key: string, w: number, h: number, cb: (g: Phaser.GameObjects.Graphics) => void): void => {
      const gfx = this.make.graphics({} as never) as Phaser.GameObjects.Graphics;
      cb(gfx);
      gfx.generateTexture(key, w, h);
      gfx.destroy();
    };

    draw('mini_player', 20, 20, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(10, 10, 8);
    });
    draw('mini_stalker', 18, 18, (g) => {
      g.fillStyle(0x3b82f6, 1);
      g.fillRect(3, 3, 12, 12);
    });
    draw('mini_bandit', 18, 18, (g) => {
      g.fillStyle(0xef4444, 1);
      g.fillRect(3, 3, 12, 12);
    });
  }
}
