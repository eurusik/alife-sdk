import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';
import type { ITradeConfig } from '../config/ALifeConfig';

/**
 * Declares trade system support in the A-Life kernel.
 *
 * Currently provides config access for the trade subsystem.
 * Phase 2 will add TradeManager here.
 */
export class TradePlugin implements IALifePlugin {
  readonly name = 'trade';

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  get config(): ITradeConfig {
    return this.kernel.currentConfig.trade;
  }
}
