export type PackAlertLevel = 'NONE' | 'ALERTED' | 'COMBAT' | 'PANIC';

/**
 * Escalation order used for max-wins semantics in `broadcastAlertLevel`.
 * Each level supersedes all levels to its left.
 */
export const PACK_ALERT_ORDER: ReadonlyArray<PackAlertLevel> = [
  'NONE', 'ALERTED', 'COMBAT', 'PANIC',
];

export interface IPackTarget {
  readonly id: string | null;
  readonly x: number;
  readonly y: number;
}

/**
 * Opt-in pack coordination port for monster groups (Dog, Tushkano, etc.).
 *
 * Implement on a shared pack record accessible to all group members. State
 * handlers call `broadcastTarget` / `broadcastAlertLevel` when they spot an
 * enemy or start fleeing; idle/patrol members poll `getPackAlertLevel` to
 * activate without waiting for individual perception.
 *
 * Register by assigning the accessor to `ctx.pack` in the host entity wrapper.
 *
 * ## TTL decay contract (livelock prevention)
 *
 * The host implementation is responsible for de-escalating the alert level over
 * time. Without this the pack can loop indefinitely between PATROL and ALERT
 * after a contact fades. The recommended approach is to track the last broadcast
 * timestamp per level and reset to 'NONE' after `cfg.packAlertTtlMs` elapses
 * without a refresh broadcast.
 */
export interface IPackAccess {
  /** Highest alert level currently active in the pack. */
  getPackAlertLevel(): PackAlertLevel;

  /** Last enemy position broadcast by any pack member, or null if none. */
  getPackTarget(): IPackTarget | null;

  /** Broadcast a confirmed enemy position to all pack members. */
  broadcastTarget(targetId: string | null, x: number, y: number): void;

  /**
   * Escalate the pack's shared alert level.
   *
   * **Max-wins semantics** — the level can only increase within the current TTL
   * window. See `PACK_ALERT_ORDER` for the escalation order. The host must
   * implement TTL-based decay back to 'NONE' (see class JSDoc above).
   */
  broadcastAlertLevel(level: PackAlertLevel): void;
}
