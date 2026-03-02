// adapters/PhaserEntityAdapter.ts
// IEntityAdapter implementation backed by a sprite registry.
// Uses duck-typed IArcadeSprite — works with any Phaser.Physics.Arcade.Sprite.

import type { Vec2, ILogger } from '@alife-sdk/core';
import type { IEntityAdapter } from '@alife-sdk/core';
import type { IArcadeSprite } from '../types/IPhaserTypes';

/** All per-entity state stored in a single record. */
interface IEntityRecord {
  sprite: IArcadeSprite;
  alive: boolean;
  components: Map<string, unknown>;
  metadata: Map<string, unknown>;
}

/**
 * Phaser-compatible IEntityAdapter backed by a sprite registry.
 *
 * The host game registers sprites when entities are created and unregisters
 * them on destruction. All IEntityAdapter operations resolve to the
 * registered sprite via entityId lookup.
 *
 * Pass an optional {@link ILogger} to receive warnings when mutation methods
 * are called for unregistered entities (useful during development).
 *
 * @example
 * ```ts
 * const adapter = new PhaserEntityAdapter(kernel.logger);
 * adapter.register('npc_1', phaserSprite);
 * adapter.setPosition('npc_1', { x: 100, y: 200 });
 * adapter.unregister('npc_1');
 * ```
 */
export class PhaserEntityAdapter implements IEntityAdapter {
  private readonly entities = new Map<string, IEntityRecord>();
  private readonly logger: ILogger | null;

  constructor(logger?: ILogger) {
    this.logger = logger ?? null;
  }

  // ---------------------------------------------------------------------------
  // Registry management
  // ---------------------------------------------------------------------------

  register(entityId: string, sprite: IArcadeSprite): void {
    this.entities.set(entityId, {
      sprite,
      alive: true,
      components: new Map(),
      metadata: new Map(),
    });
  }

  unregister(entityId: string): void {
    this.entities.delete(entityId);
  }

  has(entityId: string): boolean {
    return this.entities.has(entityId);
  }

  getSprite(entityId: string): IArcadeSprite | undefined {
    return this.entities.get(entityId)?.sprite;
  }

  get size(): number {
    return this.entities.size;
  }

  setAlive(entityId: string, alive: boolean): void {
    const record = this.entities.get(entityId);
    if (record) record.alive = alive;
  }

  setComponentData<T>(entityId: string, componentName: string, data: T): void {
    const record = this.entities.get(entityId);
    if (!record) return;
    record.components.set(componentName, data);
  }

  // ---------------------------------------------------------------------------
  // IEntityQuery
  // ---------------------------------------------------------------------------

  getPosition(entityId: string): Vec2 | null {
    const record = this.entities.get(entityId);
    if (!record) return null;
    return { x: record.sprite.x, y: record.sprite.y };
  }

  isAlive(entityId: string): boolean {
    return this.entities.get(entityId)?.alive === true;
  }

  hasComponent(entityId: string, componentName: string): boolean {
    return this.entities.get(entityId)?.components.has(componentName) === true;
  }

  getComponentValue<T>(entityId: string, componentName: string): T | null {
    return (this.entities.get(entityId)?.components.get(componentName) as T) ?? null;
  }

  getMetadata(entityId: string, key: string): unknown {
    return this.entities.get(entityId)?.metadata.get(key);
  }

  // ---------------------------------------------------------------------------
  // IEntityMutation
  // ---------------------------------------------------------------------------

  setPosition(entityId: string, position: Vec2): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('setPosition', entityId); return; }
    const { x, y } = position;
    record.sprite.setPosition(x, y);
  }

  setActive(entityId: string, active: boolean): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('setActive', entityId); return; }
    record.sprite.setActive(active);
  }

  setVisible(entityId: string, visible: boolean): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('setVisible', entityId); return; }
    record.sprite.setVisible(visible);
  }

  setMetadata(entityId: string, key: string, value: unknown): void {
    const record = this.entities.get(entityId);
    if (!record) return;
    record.metadata.set(key, value);
  }

  setVelocity(entityId: string, velocity: Vec2): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('setVelocity', entityId); return; }
    const { x, y } = velocity;
    record.sprite.setVelocity(x, y);
  }

  getVelocity(entityId: string): Vec2 {
    const record = this.entities.get(entityId);
    if (!record?.sprite.body) return { x: 0, y: 0 };
    return { x: record.sprite.body.velocity.x, y: record.sprite.body.velocity.y };
  }

  setRotation(entityId: string, radians: number): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('setRotation', entityId); return; }
    record.sprite.setRotation(radians);
  }

  teleport(entityId: string, position: Vec2): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('teleport', entityId); return; }
    const { x, y } = position;
    record.sprite.setPosition(x, y);
    // Reset velocity on teleport to prevent physics drift
    if (record.sprite.body) {
      record.sprite.setVelocity(0, 0);
    }
  }

  disablePhysics(entityId: string): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('disablePhysics', entityId); return; }
    if (record.sprite.body) {
      record.sprite.body.enable = false;
    }
  }

  // ---------------------------------------------------------------------------
  // IEntityRendering
  // ---------------------------------------------------------------------------

  setAlpha(entityId: string, alpha: number): void {
    const record = this.entities.get(entityId);
    if (!record) { this.warnMissing('setAlpha', entityId); return; }
    record.sprite.setAlpha(alpha);
  }

  playAnimation(entityId: string, key: string, ignoreIfPlaying = true): void {
    const record = this.entities.get(entityId);
    if (!record?.sprite.anims) { this.warnMissing('playAnimation', entityId); return; }
    record.sprite.anims.play(key, ignoreIfPlaying);
  }

  hasAnimation(entityId: string, key: string): boolean {
    const record = this.entities.get(entityId);
    if (!record?.sprite.anims) return false;
    // Duck-type check: anims may have exists() or we fall back to name comparison
    const anims = record.sprite.anims as { exists?: (k: string) => boolean };
    if (typeof anims.exists === 'function') {
      return anims.exists(key);
    }
    return record.sprite.anims.getName() === key;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private warnMissing(method: string, entityId: string): void {
    this.logger?.warn('PhaserEntityAdapter', `${method}: sprite not found for "${entityId}". Did you call register()?`);
  }
}
