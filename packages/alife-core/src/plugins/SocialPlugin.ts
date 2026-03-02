import type { IALifePlugin } from './IALifePlugin';
import type { ALifeKernel } from '../core/ALifeKernel';

/**
 * Declares NPC social system support in the A-Life kernel.
 *
 * Phase 2 will add SocialManager, MeetBehavior, and KampSocialFSM here.
 * Social events (`social:npc_bubble`, `social:npc_meet_player`, etc.) are
 * already typed in ALifeEvents.
 */
export class SocialPlugin implements IALifePlugin {
  readonly name = 'social';

  install(_kernel: ALifeKernel): void {
    // Social events are already typed in ALifeEvents.
  }
}
