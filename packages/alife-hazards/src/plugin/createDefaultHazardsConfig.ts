import type { IHazardsPluginConfig } from './HazardsPlugin';

/**
 * Creates a default {@link IHazardsPluginConfig} with sensible defaults for
 * all optional fields.
 *
 * `artefactFactory` is the only required field and must be supplied via
 * `overrides`. All other fields fall back to their defaults:
 * - `zones` — empty (no zones pre-registered)
 * - `artefactSelector` — omitted (plugin uses `WeightedArtefactSelector` internally)
 * - `spatialGridCellSize` — 200 px
 *
 * @example
 * ```ts
 * const config = createDefaultHazardsConfig({
 *   artefactFactory: { create(ev) { scene.spawnPickup(ev); } },
 *   zones: anomaliesJson,
 * });
 * const hazards = new HazardsPlugin(random, config);
 * ```
 */
export function createDefaultHazardsConfig(
  overrides: Partial<IHazardsPluginConfig> & Pick<IHazardsPluginConfig, 'artefactFactory'>,
): IHazardsPluginConfig {
  return {
    zones: [],
    spatialGridCellSize: 200,
    ...overrides,
  };
}
