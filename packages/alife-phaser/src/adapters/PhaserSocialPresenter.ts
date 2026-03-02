// adapters/PhaserSocialPresenter.ts
// ISocialPresenter backed by user-provided callbacks.

import type { ISocialPresenter } from '@alife-sdk/social';

/**
 * Callback-based ISocialPresenter implementation.
 *
 * Social presentation is game-specific (text containers, bubble sprites,
 * audio systems), so this adapter delegates to user-provided callbacks.
 *
 * @example
 * ```ts
 * const presenter = new PhaserSocialPresenter({
 *   showBubble: (npcId, text, durationMs) => {
 *     const sprite = entityAdapter.getSprite(npcId);
 *     if (sprite) showSpeechBubble(sprite, text, durationMs);
 *   },
 * });
 * ```
 */
export class PhaserSocialPresenter implements ISocialPresenter {
  private readonly onShowBubble: (npcId: string, text: string, durationMs: number) => void;

  constructor(handlers: {
    showBubble: (npcId: string, text: string, durationMs: number) => void;
  }) {
    this.onShowBubble = handlers.showBubble;
  }

  showBubble(npcId: string, text: string, durationMs: number): void {
    this.onShowBubble(npcId, text, durationMs);
  }
}
