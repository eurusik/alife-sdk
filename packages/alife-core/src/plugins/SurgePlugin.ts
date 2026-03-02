import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import type { ISurgeConfig } from '../config/ALifeConfig';

/**
 * Declares surge system support in the A-Life kernel.
 *
 * Currently provides config access for the surge subsystem.
 * Phase 2 will add the full SurgeManager state machine here
 * (INACTIVE → WARNING → ACTIVE → AFTERMATH).
 *
 * Surge events (`surge:warning`, `surge:started`, etc.) are already typed
 * in ALifeEvents — this plugin enables their semantic use.
 */
export class SurgePlugin implements IALifePlugin {
  readonly name = 'surge';

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  get config(): ISurgeConfig {
    return this.kernel.currentConfig.surge;
  }
}
