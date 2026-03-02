import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import { AnomalyTypeRegistry } from '../registry/AnomalyTypeRegistry';

/**
 * Adds anomaly type registration to the A-Life kernel.
 *
 * Install this plugin when your game has environmental hazard zones
 * (anomalies) that deal damage and spawn artefacts.
 *
 * @example
 * ```ts
 * const alife = new ALifeKernel(ports);
 * alife.use(new AnomaliesPlugin());
 *
 * const ap = alife.getPlugin<AnomaliesPlugin>('anomalies');
 * ap.anomalyTypes.register('fire_vortex', { name: 'Fire Vortex', ... });
 * ```
 */
export class AnomaliesPlugin implements IALifePlugin {
  readonly name = 'anomalies';
  readonly anomalyTypes = new AnomalyTypeRegistry();

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.anomalyTypes.freeze();
    this.kernel.logger.info('plugin', `AnomaliesPlugin: ${this.anomalyTypes.size} types registered`);
  }
}
