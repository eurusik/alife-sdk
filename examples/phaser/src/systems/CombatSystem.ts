import Phaser from 'phaser';
import type { SimulationPlugin } from '@alife-sdk/simulation';
import type { PhaserEntityAdapter } from '@alife-sdk/phaser';

interface ICombatSystemDeps {
  scene: Phaser.Scene;
  simulation: SimulationPlugin;
  entityAdapter: PhaserEntityAdapter;
  hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  locallyDeadNpcs: Set<string>;
  npcStateLabels: Map<string, Phaser.GameObjects.Text>;
  onPlayerHit: (dmg: number) => void;
}

interface IGrenadeDamageRequest {
  npcIds: Iterable<string>;
  x: number;
  y: number;
  radius: number;
  minDamage: number;
  maxDamage: number;
}

/**
 * Owns all online combat interactions:
 * - bullets
 * - hit detection
 * - online NPC damage/death bookkeeping
 *
 * Scene code should call this system instead of mutating combat state directly.
 */
export class CombatSystem {
  private readonly scene: Phaser.Scene;
  private readonly simulation: SimulationPlugin;
  private readonly entityAdapter: PhaserEntityAdapter;
  private readonly hpRecords: Map<string, { currentHp: number; maxHp: number }>;
  private readonly locallyDeadNpcs: Set<string>;
  private readonly npcStateLabels: Map<string, Phaser.GameObjects.Text>;
  private readonly onPlayerHit: (dmg: number) => void;

  private npcBullets!: Phaser.Physics.Arcade.Group;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private npcLastShot = new Map<string, number>();
  private lastPlayerShot = 0;

  constructor(deps: ICombatSystemDeps) {
    this.scene = deps.scene;
    this.simulation = deps.simulation;
    this.entityAdapter = deps.entityAdapter;
    this.hpRecords = deps.hpRecords;
    this.locallyDeadNpcs = deps.locallyDeadNpcs;
    this.npcStateLabels = deps.npcStateLabels;
    this.onPlayerHit = deps.onPlayerHit;
  }

  init(player: Phaser.Physics.Arcade.Sprite): void {
    this.npcBullets = this.scene.physics.add.group({ runChildUpdate: false });
    this.playerBullets = this.scene.physics.add.group({ runChildUpdate: false });

    // NPC bullet -> player damage.
    this.scene.physics.add.overlap(this.npcBullets, player, (_player, bullet) => {
      (bullet as Phaser.Physics.Arcade.Sprite).destroy();
      this.onPlayerHit(10);
    });
  }

  shootPlayerBullet(
    player: Phaser.Physics.Arcade.Sprite,
    targetX: number,
    targetY: number,
    playerDead: boolean,
  ): void {
    if (playerDead) return;
    const now = Date.now();
    if (now - this.lastPlayerShot < 300) return;
    this.lastPlayerShot = now;

    const bullet = this.scene.physics.add.sprite(player.x, player.y, 'player_bullet').setDepth(5);
    this.playerBullets.add(bullet);
    const angle = Phaser.Math.Angle.Between(player.x, player.y, targetX, targetY);
    bullet.setVelocity(Math.cos(angle) * 500, Math.sin(angle) * 500);
    this.scene.time.delayedCall(2000, () => { if (bullet.active) bullet.destroy(); });
  }

  fireNpcBullet(
    npcId: string,
    targetX: number,
    targetY: number,
    spriteX: number,
    spriteY: number,
  ): void {
    const now = Date.now();
    const last = this.npcLastShot.get(npcId) ?? 0;
    if (now - last < 1500) return;
    this.npcLastShot.set(npcId, now);

    const spread = (Math.random() - 0.5) * 0.25;
    const angle = Phaser.Math.Angle.Between(spriteX, spriteY, targetX, targetY) + spread;
    const bullet = this.scene.physics.add.sprite(spriteX, spriteY, 'npc_bullet').setDepth(5);
    this.npcBullets.add(bullet);
    bullet.setVelocity(Math.cos(angle) * 300, Math.sin(angle) * 300);
    this.scene.time.delayedCall(2500, () => { if (bullet.active) bullet.destroy(); });
  }

  checkPlayerBulletHits(npcIds: Iterable<string>): void {
    const bullets = this.playerBullets.getChildren() as Phaser.Physics.Arcade.Sprite[];
    for (const id of npcIds) {
      if (this.locallyDeadNpcs.has(id)) continue;
      const record = this.simulation.getAllNPCRecords().get(id);
      if (!record?.isOnline) continue;
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

  applyGrenadeDamage(req: IGrenadeDamageRequest): void {
    for (const id of req.npcIds) {
      if (this.locallyDeadNpcs.has(id)) continue;
      const record = this.simulation.getAllNPCRecords().get(id);
      if (!record?.isOnline) continue;
      const sprite = this.entityAdapter.getSprite(id);
      if (!sprite) continue;

      const dist = Phaser.Math.Distance.Between(req.x, req.y, sprite.x, sprite.y);
      if (dist > req.radius) continue;

      const frac = 1 - dist / req.radius;
      const dmg = Math.round(Phaser.Math.Linear(req.minDamage, req.maxDamage, frac));
      this.damageNpc(id, dmg);
    }
  }

  private damageNpc(id: string, dmg: number): void {
    if (this.locallyDeadNpcs.has(id)) return;
    const record = this.simulation.getAllNPCRecords().get(id);
    const hpRec = this.hpRecords.get(id);
    const currentHp = record?.currentHp ?? hpRec?.currentHp ?? 0;
    const effectiveHp = Math.max(0, currentHp - dmg);

    if (record) record.currentHp = effectiveHp;
    if (hpRec) hpRec.currentHp = effectiveHp;

    if (effectiveHp === 0) {
      this.locallyDeadNpcs.add(id);
      const sprite = this.entityAdapter.getSprite(id) as Phaser.Physics.Arcade.Sprite | undefined;
      if (sprite) {
        sprite.setVisible(false);
        const body = sprite.body as Phaser.Physics.Arcade.Body | null | undefined;
        if (body) {
          body.enable = false;
          body.setVelocity(0, 0);
        }
      }
      this.npcStateLabels.get(id)?.setVisible(false);
    }
  }
}
