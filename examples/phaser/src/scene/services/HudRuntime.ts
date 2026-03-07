import type Phaser from 'phaser';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter } from '@alife-sdk/phaser';

interface HudRuntimeParams {
  simulation: SimulationPlugin;
  entityAdapter: PhaserEntityAdapter;
  hpGraphics: Phaser.GameObjects.Graphics;
  hudGraphics: Phaser.GameObjects.Graphics;
  onlineRadiusGfx: Phaser.GameObjects.Graphics;
  hpBarRect: Phaser.Geom.Rectangle;
  playerHpText: Phaser.GameObjects.Text;
  tickText: Phaser.GameObjects.Text;
  eventLogText: Phaser.GameObjects.Text;
  layoutTicker: () => void;
  onlineDistance: number;
  detectionRange: number;
  confAlert: number;
  confCombat: number;
  npcDefs: ReadonlyArray<{ entityId: string; factionId: string; hp: number }>;
  hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  locallyDeadNpcs: Set<string>;
}

/**
 * Runtime-only HUD updates and ticker/event-log formatting.
 *
 * Keeping this out of GameScene avoids mixing rendering details with gameplay flow.
 */
export class HudRuntime {
  private readonly simulation: SimulationPlugin;
  private readonly hpGraphics: Phaser.GameObjects.Graphics;
  private readonly hudGraphics: Phaser.GameObjects.Graphics;
  private readonly onlineRadiusGfx: Phaser.GameObjects.Graphics;
  private readonly hpBarRect: Phaser.Geom.Rectangle;
  private readonly playerHpText: Phaser.GameObjects.Text;
  private readonly tickText: Phaser.GameObjects.Text;
  private readonly eventLogText: Phaser.GameObjects.Text;
  private readonly layoutTicker: () => void;
  private readonly onlineDistance: number;
  private readonly detectionRange: number;
  private readonly confAlert: number;
  private readonly confCombat: number;
  private readonly npcDefs: ReadonlyArray<{ entityId: string; factionId: string; hp: number }>;
  private readonly hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  private readonly locallyDeadNpcs: Set<string>;
  private readonly entityAdapter: PhaserEntityAdapter;
  private readonly eventLog: string[] = [];

  constructor(params: HudRuntimeParams) {
    this.simulation = params.simulation;
    this.hpGraphics = params.hpGraphics;
    this.hudGraphics = params.hudGraphics;
    this.onlineRadiusGfx = params.onlineRadiusGfx;
    this.hpBarRect = params.hpBarRect;
    this.playerHpText = params.playerHpText;
    this.tickText = params.tickText;
    this.eventLogText = params.eventLogText;
    this.layoutTicker = params.layoutTicker;
    this.onlineDistance = params.onlineDistance;
    this.detectionRange = params.detectionRange;
    this.confAlert = params.confAlert;
    this.confCombat = params.confCombat;
    this.npcDefs = params.npcDefs;
    this.hpRecords = params.hpRecords;
    this.locallyDeadNpcs = params.locallyDeadNpcs;
    this.entityAdapter = params.entityAdapter;
  }

  log(message: string): void {
    this.eventLog.push(message);
    if (this.eventLog.length > 4) this.eventLog.shift();

    const latestEvent = this.eventLog[this.eventLog.length - 1] ?? '';
    const shortenedEvent = latestEvent.length > 56 ? `${latestEvent.slice(0, 53)}...` : latestEvent;
    this.eventLogText.setText(shortenedEvent);
    this.layoutTicker();
  }

  updateStatusTick(tick: number): void {
    const onlineCount = [...this.simulation.getAllNPCRecords().values()]
      .filter(record => record.isOnline && record.currentHp > 0)
      .length;
    this.tickText.setText(
      `Tick ${tick}  ·  Online ${onlineCount}  ·  Alert ${this.detectionRange}px  ·  Switch ${this.onlineDistance}px`,
    );
    this.layoutTicker();
  }

  drawOverlays(player: Phaser.Physics.Arcade.Sprite, playerHp: number, playerMaxHp: number): void {
    this.hpGraphics.clear();
    this.hudGraphics.clear();
    this.onlineRadiusGfx.clear();

    const barW = this.hpBarRect.width;
    const barH = this.hpBarRect.height;
    const bx = this.hpBarRect.x;
    const by = this.hpBarRect.y;
    const hpFrac = playerHp / playerMaxHp;
    const hpColor = hpFrac > 0.5 ? 0x42ff7b : hpFrac > 0.25 ? 0xffc247 : 0xff5266;

    this.hudGraphics.fillStyle(0x1d2847, 0.98);
    this.hudGraphics.fillRect(bx, by, barW, barH);
    this.hudGraphics.fillStyle(hpColor, 0.18);
    this.hudGraphics.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    this.hudGraphics.fillStyle(hpColor);
    this.hudGraphics.fillRect(bx, by, Math.round(barW * hpFrac), barH);
    this.hudGraphics.lineStyle(1, 0x9af8ff, 0.55);
    this.hudGraphics.strokeRect(bx, by, barW, barH);
    this.playerHpText.setText(`${Math.round(hpFrac * 100)}%`);

    this.hpGraphics.fillStyle(0x7ae3ff, 0.18);
    this.hpGraphics.fillCircle(player.x, player.y, 22);

    this.onlineRadiusGfx.lineStyle(1, 0x00ffff, 0.2);
    this.onlineRadiusGfx.strokeCircle(player.x, player.y, this.onlineDistance);

    const alertRadius = Math.round(this.detectionRange * (1 - this.confAlert));
    this.onlineRadiusGfx.lineStyle(1, 0xffff00, 0.4);
    this.onlineRadiusGfx.strokeCircle(player.x, player.y, alertRadius);

    const combatRadius = Math.round(this.detectionRange * (1 - this.confCombat));
    this.onlineRadiusGfx.lineStyle(1, 0xff6600, 0.5);
    this.onlineRadiusGfx.strokeCircle(player.x, player.y, combatRadius);

    for (const record of this.simulation.getAllNPCRecords().values()) {
      if (record.currentHp <= 0 || this.locallyDeadNpcs.has(record.entityId)) continue;

      const sprite = this.entityAdapter.getSprite(record.entityId);
      if (!sprite) continue;

      const maxHp = this.npcDefs.find(def => def.entityId === record.entityId)?.hp ?? 100;
      const hpRec = this.hpRecords.get(record.entityId);
      const frac = Math.max(0, (hpRec?.currentHp ?? record.currentHp) / maxHp);
      const glowColor = record.factionId === 'stalker' ? 0x5aa4ff : 0xff6878;
      this.hpGraphics.fillStyle(glowColor, record.isOnline ? 0.16 : 0.08);
      this.hpGraphics.fillEllipse(sprite.x, sprite.y + 14, record.isOnline ? 30 : 24, record.isOnline ? 14 : 10);

      const bw = 24;
      const npcBarX = sprite.x - bw / 2;
      const npcBarY = sprite.y - 18;
      this.hpGraphics.fillStyle(0x333333);
      this.hpGraphics.fillRect(npcBarX, npcBarY, bw, 3);

      const color = frac > 0.5 ? 0x44dd44 : frac > 0.25 ? 0xddaa22 : 0xdd3333;
      this.hpGraphics.fillStyle(color);
      this.hpGraphics.fillRect(npcBarX, npcBarY, Math.round(bw * frac), 3);
    }
  }
}
