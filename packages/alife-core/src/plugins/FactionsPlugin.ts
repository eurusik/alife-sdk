import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import { FactionRegistry } from '../registry/FactionRegistry';

/**
 * Owns faction definitions and inter-faction relations.
 *
 * Install this plugin when your game has multiple factions with
 * configurable hostility / alliance relationships.
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * alife.use(new FactionsPlugin());
 *
 * const fp = alife.getPlugin<FactionsPlugin>('factions');
 * fp.factions.register('loners', { name: 'Одинаки', ... });
 * ```
 */
export class FactionsPlugin implements IALifePlugin {
  readonly name = 'factions';
  readonly factions = new FactionRegistry();

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.factions.freeze();
    this.kernel.logger.info('plugin', `FactionsPlugin: ${this.factions.size} factions registered`);
  }
}
