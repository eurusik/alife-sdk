import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import { MonsterRegistry } from '../registry/MonsterRegistry';

/**
 * Adds monster type registration to the A-Life kernel.
 *
 * Install this plugin when your game has monster entities (non-human hostile
 * creatures with lair territories and special abilities).
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * alife.use(new MonstersPlugin());
 *
 * const mp = alife.getPlugin<MonstersPlugin>('monsters');
 * mp.monsters.register('dog', { name: 'Blind Dog', hp: 100, ... });
 * ```
 */
export class MonstersPlugin implements IALifePlugin {
  readonly name = 'monsters';
  readonly monsters = new MonsterRegistry();

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.monsters.freeze();
    this.kernel.logger.info('plugin', `MonstersPlugin: ${this.monsters.size} types registered`);
  }
}
