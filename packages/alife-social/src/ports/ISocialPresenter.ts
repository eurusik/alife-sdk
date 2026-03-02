// ports/ISocialPresenter.ts
// Port interface for rendering social bubbles and sounds.

/**
 * Host-side presenter for social interaction effects.
 *
 * The SDK computes WHAT to display — the host renders HOW.
 *
 * @example
 * ```ts
 * // Phaser implementation
 * const presenter: ISocialPresenter = {
 *   showBubble(npcId, text, durationMs) {
 *     const sprite = scene.npcSprites.get(npcId);
 *     if (sprite) new SocialBubble(scene, sprite.x, sprite.y - 40, text, durationMs);
 *   },
 * };
 * ```
 */
export interface ISocialPresenter {
  showBubble(npcId: string, text: string, durationMs: number): void;
}
