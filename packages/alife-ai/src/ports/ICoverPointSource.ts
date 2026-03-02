// ports/ICoverPointSource.ts
// Optional port — host can provide custom cover point data.


/**
 * Minimal cover point data from the host.
 * The AI plugin converts these to full ICoverPoint objects.
 */
export interface ICoverPointData {
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
}

/**
 * Port interface for providing cover point data to the AI system.
 *
 * The host implements this to feed cover point positions from its
 * tilemap, level editor, or procedural generation system.
 *
 * This is an optional port — if not provided, cover points must
 * be registered manually via `CoverRegistry.addPoint()`.
 */
export interface ICoverPointSource {
  getPoints(bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  }): readonly ICoverPointData[];
}
