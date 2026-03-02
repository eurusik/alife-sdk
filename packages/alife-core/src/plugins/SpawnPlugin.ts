import type { ALifeKernel } from '../core/ALifeKernel';
import type { IALifePlugin } from './IALifePlugin';
import { SpawnRegistry } from '../spawn/SpawnRegistry';
import type { ISpawnRegistryState } from '../spawn/SpawnRegistry';

export class SpawnPlugin implements IALifePlugin {
  readonly name = 'spawn';
  readonly spawns: SpawnRegistry;

  constructor(defaultCooldownMs: number = 30_000) {
    this.spawns = new SpawnRegistry(defaultCooldownMs);
  }

  install(_kernel: ALifeKernel): void {
    // SpawnPlugin requires no kernel reference.
  }

  init(): void {
    // SpawnRegistry is ready — no additional init needed.
  }

  update(deltaMs: number): void {
    this.spawns.update(deltaMs);
  }

  serialize(): Record<string, unknown> {
    return this.spawns.serialize() as unknown as Record<string, unknown>;
  }

  restore(state: Record<string, unknown>): void {
    this.spawns.restore(state as unknown as ISpawnRegistryState);
  }

  destroy(): void {
    // SpawnRegistry has no subscriptions to clean up.
  }
}
