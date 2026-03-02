import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import { DamageTypeRegistry } from '../registry/DamageTypeRegistry';
import { AIStateRegistry } from '../registry/AIStateRegistry';
import { BehaviorSchemeRegistry } from '../registry/BehaviorSchemeRegistry';
import { TaskTypeRegistry } from '../registry/TaskTypeRegistry';

/**
 * Groups the four combat-related registries that change together:
 * damage types, AI states, behavior schemes, and task types.
 *
 * These registries share the Common Closure Principle — a change in
 * combat design (e.g. adding a new damage type) typically touches
 * AI states and behavior schemes in the same commit.
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * alife.use(new CombatSchemaPlugin());
 *
 * const cs = alife.getPlugin<CombatSchemaPlugin>('combatSchema');
 * cs.damageTypes.register('fire', { name: 'Вогонь', ... });
 * cs.aiStates.register('combat', { name: 'Бій', ... });
 * ```
 */
export class CombatSchemaPlugin implements IALifePlugin {
  readonly name = 'combatSchema';
  readonly damageTypes = new DamageTypeRegistry();
  readonly aiStates = new AIStateRegistry();
  readonly behaviorSchemes = new BehaviorSchemeRegistry();
  readonly taskTypes = new TaskTypeRegistry();

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.damageTypes.freeze();
    this.aiStates.freeze();
    this.behaviorSchemes.freeze();
    this.taskTypes.freeze();

    const total = this.damageTypes.size + this.aiStates.size
      + this.behaviorSchemes.size + this.taskTypes.size;
    this.kernel.logger.info('plugin', `CombatSchemaPlugin: ${total} schema entries registered`);
  }
}
