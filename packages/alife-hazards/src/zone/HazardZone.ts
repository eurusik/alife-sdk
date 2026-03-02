// zone/HazardZone.ts
import type { IHazardEntity } from '../ports/IHazardEntity';

export type HazardZoneType = 'fire' | 'radiation' | 'chemical' | 'psi' | (string & {});

export interface IHazardZoneConfig {
  readonly id: string;
  readonly type: HazardZoneType;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damagePerSecond: number;
  readonly damageTickIntervalMs?: number;   // default 500
  readonly artefactChance: number;          // [0, 1]
  readonly artefactSpawnCycleMs?: number;   // default 60_000
  readonly maxArtefacts: number;
  /**
   * Optional predicate — only entities for which this returns `true` receive damage.
   * If omitted, all entities inside the zone are affected.
   *
   * @example
   * // PSI zone that only hurts humans
   * entityFilter: (e) => e.id.startsWith('npc_') || e.id === 'player'
   */
  readonly entityFilter?: (entity: IHazardEntity) => boolean;
  /**
   * Absolute elapsed-time timestamp (ms) at which this zone auto-expires.
   * Measured from the first `manager.tick()` call (accumulated deltaMs).
   * When `elapsedMs >= expiresAtMs` the zone is removed and `hazard:zone_expired` is emitted.
   * If omitted, the zone lives indefinitely.
   *
   * @example
   * // Zone that lasts 10 seconds after the manager starts ticking
   * expiresAtMs: 10_000
   */
  readonly expiresAtMs?: number;
}

export class HazardZone {
  readonly config: Readonly<IHazardZoneConfig>;
  readonly damageTickIntervalMs: number;
  readonly artefactSpawnCycleMs: number;

  private _artefactCount = 0;
  private _damageTimer = 0;
  private _artefactTimer = 0;

  constructor(config: IHazardZoneConfig) {
    if (config.radius <= 0) throw new Error(`HazardZone '${config.id}': radius must be > 0, got ${config.radius}`);
    if (config.damagePerSecond < 0) throw new Error(`HazardZone '${config.id}': damagePerSecond must be >= 0, got ${config.damagePerSecond}`);
    if (config.artefactChance < 0 || config.artefactChance > 1)
      throw new Error(`HazardZone '${config.id}': artefactChance must be in [0, 1], got ${config.artefactChance}`);
    if (config.maxArtefacts < 0) throw new Error(`HazardZone '${config.id}': maxArtefacts must be >= 0, got ${config.maxArtefacts}`);
    this.config = Object.freeze({ ...config });
    this.damageTickIntervalMs = config.damageTickIntervalMs ?? 500;
    this.artefactSpawnCycleMs = config.artefactSpawnCycleMs ?? 60_000;
  }

  advance(deltaMs: number): void {
    this._damageTimer += deltaMs;
    this._artefactTimer += deltaMs;
  }

  isDamageTickReady(): boolean {
    return this._damageTimer >= this.damageTickIntervalMs;
  }

  consumeDamageTick(): void {
    this._damageTimer -= this.damageTickIntervalMs;
  }

  isArtefactSpawnReady(): boolean {
    return this._artefactTimer >= this.artefactSpawnCycleMs;
  }

  consumeArtefactCycle(): void {
    this._artefactTimer -= this.artefactSpawnCycleMs;
  }

  containsPoint(x: number, y: number): boolean {
    const dx = x - this.config.x;
    const dy = y - this.config.y;
    return dx * dx + dy * dy <= this.config.radius * this.config.radius;
  }

  getDamagePerTick(): number {
    return (this.config.damagePerSecond * this.damageTickIntervalMs) / 1000;
  }

  get artefactCount(): number { return this._artefactCount; }
  get isAtCapacity(): boolean { return this._artefactCount >= this.config.maxArtefacts; }
  notifyArtefactAdded(): void { this._artefactCount++; }
  notifyArtefactRemoved(): void { this._artefactCount = Math.max(0, this._artefactCount - 1); }

  /** Serialize timer and artefact count state. Zone config is NOT included — it comes from user code. */
  serialize(): IHazardZoneState {
    return {
      zoneId: this.config.id,
      damageTimer: this._damageTimer,
      artefactTimer: this._artefactTimer,
      artefactCount: this._artefactCount,
    };
  }

  /** Restore timer and artefact count state from a snapshot. */
  restore(state: IHazardZoneState): void {
    this._damageTimer = state.damageTimer;
    this._artefactTimer = state.artefactTimer;
    this._artefactCount = state.artefactCount;
  }
}

// ---------------------------------------------------------------------------
// Serialization state
// ---------------------------------------------------------------------------

export interface IHazardZoneState {
  readonly zoneId: string;
  readonly damageTimer: number;
  readonly artefactTimer: number;
  readonly artefactCount: number;
}
