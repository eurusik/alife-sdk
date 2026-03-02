import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import { NPCTypeRegistry } from '../registry/NPCTypeRegistry';

/**
 * Owns NPC type definitions (human archetypes, ranks, equipment profiles).
 *
 * Install this plugin when your game spawns human NPCs with
 * data-driven type configurations.
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * alife.use(new NPCTypesPlugin());
 *
 * const np = alife.getPlugin<NPCTypesPlugin>('npcTypes');
 * np.npcTypes.register('stalker', { name: 'Сталкер', hp: 100, ... });
 * ```
 */
export class NPCTypesPlugin implements IALifePlugin {
  readonly name = 'npcTypes';
  readonly npcTypes = new NPCTypeRegistry();

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.npcTypes.freeze();
    this.kernel.logger.info('plugin', `NPCTypesPlugin: ${this.npcTypes.size} NPC types registered`);
  }
}
