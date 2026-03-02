import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';

/**
 * Declares squad system support in the A-Life kernel.
 *
 * Phase 2 will add SquadManager and SquadTactics here.
 * Squad events (`squad:formed`, `squad:command_issued`, etc.) are already
 * typed in ALifeEvents — this plugin enables their semantic use.
 */
export class SquadPlugin implements IALifePlugin {
  readonly name = 'squad';

  install(_kernel: ALifeKernel): void {
    // No registries. Squad events are already typed in ALifeEvents.
  }
}
