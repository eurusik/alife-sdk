import Phaser from 'phaser';
import { DangerManager, DangerType } from '@alife-sdk/core';

const GRENADE_MIN_THROW_DISTANCE = 80;
const GRENADE_MAX_THROW_DISTANCE = 240;
const GRENADE_THROW_COOLDOWN_MS = 700;
const GRENADE_FUSE_MS = 320;
const GRENADE_DANGER_RADIUS = 120;
const GRENADE_DANGER_MS = 1_400;
const GRENADE_PRE_DANGER_RADIUS_MIN = 72;
const GRENADE_PRE_DANGER_RADIUS_MAX = 112;
const GRENADE_PRE_DANGER_THREAT_MIN = 0.08;
const GRENADE_PRE_DANGER_THREAT_MAX = 0.42;

interface ThrownGrenade {
  id: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  flightMs: number;
  fuseMs: number;
  ageMs: number;
}

interface GrenadeExplosionFx {
  x: number;
  y: number;
  ttl: number;
  maxTtl: number;
}

interface IGrenadeSystemDeps {
  scene: Phaser.Scene;
  dangerManager: DangerManager;
  gfx: Phaser.GameObjects.Graphics;
  onExplodeDamage: (x: number, y: number, radius: number) => void;
  onLog: (msg: string) => void;
}

/**
 * Encapsulates grenade lifecycle:
 * throw -> fuse (pre-threat) -> explosion (full threat + damage)
 *
 * Keep this system isolated so GameScene remains a thin orchestrator.
 */
export class GrenadeSystem {
  private readonly scene: Phaser.Scene;
  private readonly dangerManager: DangerManager;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly onExplodeDamage: (x: number, y: number, radius: number) => void;
  private readonly onLog: (msg: string) => void;

  private readonly thrownGrenades: ThrownGrenade[] = [];
  private readonly grenadeExplosions: GrenadeExplosionFx[] = [];
  private grenadeReadyAt = 0;
  private grenadeCount = 0;

  constructor(deps: IGrenadeSystemDeps) {
    this.scene = deps.scene;
    this.dangerManager = deps.dangerManager;
    this.gfx = deps.gfx;
    this.onExplodeDamage = deps.onExplodeDamage;
    this.onLog = deps.onLog;
  }

  throwTowardPointer(playerX: number, playerY: number, playerDead: boolean): void {
    if (playerDead) return;

    const now = this.scene.time.now;
    if (now < this.grenadeReadyAt) return;
    this.grenadeReadyAt = now + GRENADE_THROW_COOLDOWN_MS;

    const pointer = this.scene.input.activePointer;
    let dx = pointer.worldX - playerX;
    let dy = pointer.worldY - playerY;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
      dx = 1;
      dy = 0;
      dist = 1;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    const throwDistance = Phaser.Math.Clamp(dist, GRENADE_MIN_THROW_DISTANCE, GRENADE_MAX_THROW_DISTANCE);
    const targetX = Phaser.Math.Clamp(playerX + nx * throwDistance, 24, this.scene.scale.width - 24);
    const targetY = Phaser.Math.Clamp(playerY + ny * throwDistance, 24, this.scene.scale.height - 24);
    const flightMs = Phaser.Math.Clamp(180 + throwDistance * 0.8, 240, 420);

    const id = `grenade_${++this.grenadeCount}`;
    this.thrownGrenades.push({
      id,
      startX: playerX,
      startY: playerY,
      targetX,
      targetY,
      flightMs,
      fuseMs: GRENADE_FUSE_MS,
      ageMs: 0,
    });
    this.onLog(`🧨 grenade out -> (${Math.round(targetX)}, ${Math.round(targetY)})`);
  }

  update(delta: number): void {
    this.gfx.clear();

    // 1) Thrown grenades (arc + fuse)
    for (let i = this.thrownGrenades.length - 1; i >= 0; i--) {
      const grenade = this.thrownGrenades[i];
      grenade.ageMs += delta;

      const throwProgress = Math.min(1, grenade.ageMs / grenade.flightMs);
      if (throwProgress < 1) {
        const eased = 1 - (1 - throwProgress) * (1 - throwProgress);
        const x = Phaser.Math.Linear(grenade.startX, grenade.targetX, eased);
        const yFlat = Phaser.Math.Linear(grenade.startY, grenade.targetY, eased);
        const y = yFlat - Math.sin(Math.PI * eased) * 26;

        this.gfx.fillStyle(0xff9d4a, 0.96);
        this.gfx.fillCircle(x, y, 4);
        this.gfx.lineStyle(1, 0xffe4b0, 0.6);
        this.gfx.strokeCircle(x, y, 7);
        continue;
      }

      const fuseElapsed = grenade.ageMs - grenade.flightMs;
      const fuseProgress = Math.min(1, fuseElapsed / grenade.fuseMs);
      if (fuseProgress < 1) {
        const preThreat = Phaser.Math.Linear(
          GRENADE_PRE_DANGER_THREAT_MIN,
          GRENADE_PRE_DANGER_THREAT_MAX,
          fuseProgress,
        );
        const preRadius = Phaser.Math.Linear(
          GRENADE_PRE_DANGER_RADIUS_MIN,
          GRENADE_PRE_DANGER_RADIUS_MAX,
          fuseProgress,
        );
        this.dangerManager.addDanger({
          id: grenade.id,
          type: DangerType.GRENADE,
          position: { x: grenade.targetX, y: grenade.targetY },
          radius: preRadius,
          threatScore: preThreat,
          // Refreshed each frame while fuse is active.
          remainingMs: 120,
        });

        const blinkOn = Math.floor(fuseElapsed / 90) % 2 === 0;
        this.gfx.fillStyle(0xff8a2f, blinkOn ? 0.9 : 0.45);
        this.gfx.fillCircle(grenade.targetX, grenade.targetY, 5);
        this.gfx.lineStyle(2, 0xffc878, blinkOn ? 0.95 : 0.45);
        this.gfx.strokeCircle(grenade.targetX, grenade.targetY, 11 + fuseProgress * 6);
        continue;
      }

      this.thrownGrenades.splice(i, 1);
      this.dangerManager.addDanger({
        id: grenade.id,
        type: DangerType.GRENADE,
        position: { x: grenade.targetX, y: grenade.targetY },
        radius: GRENADE_DANGER_RADIUS,
        threatScore: 0.95,
        remainingMs: GRENADE_DANGER_MS,
      });
      this.onExplodeDamage(grenade.targetX, grenade.targetY, GRENADE_DANGER_RADIUS);
      this.grenadeExplosions.push({
        x: grenade.targetX,
        y: grenade.targetY,
        ttl: 680,
        maxTtl: 680,
      });
      this.scene.cameras.main.shake(110, 0.0025, false);
      this.onLog(`💥 grenade exploded @ (${Math.round(grenade.targetX)}, ${Math.round(grenade.targetY)})`);
    }

    // 2) Explosion shockwaves
    for (let i = this.grenadeExplosions.length - 1; i >= 0; i--) {
      const explosion = this.grenadeExplosions[i];
      explosion.ttl -= delta;
      if (explosion.ttl <= 0) {
        this.grenadeExplosions.splice(i, 1);
        continue;
      }

      const progress = 1 - explosion.ttl / explosion.maxTtl;
      const alpha = 1 - progress;
      const blastRadius = 24 + GRENADE_DANGER_RADIUS * progress;

      this.gfx.fillStyle(0xff5a2c, 0.22 * alpha);
      this.gfx.fillCircle(explosion.x, explosion.y, blastRadius * 0.66);
      this.gfx.lineStyle(3, 0xff7c33, 0.9 * alpha);
      this.gfx.strokeCircle(explosion.x, explosion.y, blastRadius);
      this.gfx.lineStyle(1, 0xffdfb2, 0.95 * alpha);
      this.gfx.strokeCircle(explosion.x, explosion.y, blastRadius + 10);
      this.gfx.fillStyle(0xffc07a, 0.6 * alpha);
      this.gfx.fillCircle(explosion.x, explosion.y, 12 + (1 - progress) * 8);
    }

    // 3) Faint persistent danger ring while grenade danger is active
    for (const danger of this.dangerManager.serialize()) {
      if (danger.type !== DangerType.GRENADE) continue;
      const life = Phaser.Math.Clamp(danger.remainingMs / GRENADE_DANGER_MS, 0, 1);
      this.gfx.lineStyle(1, 0xff6c35, 0.24 * life);
      this.gfx.strokeCircle(danger.position.x, danger.position.y, danger.radius);
    }
  }
}
