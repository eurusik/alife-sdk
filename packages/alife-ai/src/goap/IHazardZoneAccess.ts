/**
 * Port interface (seam) for spatial hazard zone avoidance used by EvadeHazardAction.
 *
 * Implement on a host-side adapter that translates from the game's concrete
 * zone representation into the two queries this action needs.
 */
export interface IHazardZoneAccess {
  /** True if (x,y) is within hazard detection radius. */
  isNearHazard(x: number, y: number): boolean;
  /** Normalized escape direction (unit vec) away from nearest hazard, null if already clear. */
  getEscapeDirection(x: number, y: number): { readonly x: number; readonly y: number } | null;
}
