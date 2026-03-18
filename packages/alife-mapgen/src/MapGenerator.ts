// src/MapGenerator.ts
// Main orchestrator: runs the 3-pass generation pipeline.
//
// Pipeline:
//   Pass 1 (Macro):   Zone placement + road network
//   Pass 2 (Terrain): Ground fill, autotile bitmask, transition injection
//   Pass 3 (Props):   Poisson-disk prop scatter, cover points, spawns, colliders
//
// For deterministic output, the same seed always produces the same map.
//
// When candidateCount > 1, N candidates are generated (each with a different
// per-candidate seed suffix), scored by MapScorer, and the best is returned.

import { Rng } from './core/Rng.js';
import { TileRegistry } from './core/TileRegistry.js';
import { MacroPass } from './passes/MacroPass.js';
import { TerrainPass } from './passes/TerrainPass.js';
import { PropsPass } from './passes/PropsPass.js';
import { MapScorer } from './scoring/MapScorer.js';
import { validateMap } from './scoring/validators.js';
import {
  DEFAULT_MAPGEN_CONFIG,
  type MapDefinition,
  type MapGenConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// MapGenerator
// ---------------------------------------------------------------------------

export class MapGenerator {
  private readonly registry: TileRegistry;
  private readonly macroPass: MacroPass;
  private readonly scorer: MapScorer;

  constructor() {
    this.registry = new TileRegistry();
    this.macroPass = new MacroPass();
    this.scorer = new MapScorer();
  }

  /**
   * Generate a complete MapDefinition from the provided config.
   *
   * When `config.candidateCount > 1`, multiple candidates are generated and
   * the highest-scoring one is returned.
   *
   * @param config  Full or partial config (defaults filled in)
   */
  generate(config: Partial<MapGenConfig> = {}): MapDefinition {
    const cfg: MapGenConfig = { ...DEFAULT_MAPGEN_CONFIG, ...config };

    let bestMap: MapDefinition | null = null;
    let bestScore = -Infinity;

    for (let candidate = 0; candidate < cfg.candidateCount; candidate++) {
      const candidateSeed = cfg.candidateCount > 1
        ? `${cfg.seed}_c${candidate}`
        : cfg.seed;

      const map = this.generateCandidate(cfg, candidateSeed);
      const score = this.scorer.score(map);

      if (score > bestScore) {
        bestScore = score;
        bestMap = map;
      }
    }

    const finalMap = bestMap!;
    finalMap.validation = validateMap(finalMap);

    return finalMap;
  }

  /**
   * Generate a single candidate map with the given seed.
   */
  private generateCandidate(cfg: MapGenConfig, seed: string): MapDefinition {
    const rng = new Rng(seed);

    // ----- Pass 1: MACRO -----
    const macroResult = this.macroPass.run(
      cfg.width,
      cfg.height,
      cfg.tileSize,
      cfg.zoneConfig,
      rng.fork('macro'),
    );

    // ----- Pass 2: TERRAIN -----
    const terrainPass = new TerrainPass(this.registry);
    const terrainResult = terrainPass.run(
      cfg.width,
      cfg.height,
      macroResult.roadGrid,
      macroResult.zoneGrid,
      macroResult.zones,
      macroResult.templateResults,
      rng.fork('terrain'),
    );

    // ----- Pass 3: PROPS -----
    const propsPass = new PropsPass();
    const propsResult = propsPass.run(
      cfg.width,
      cfg.height,
      cfg.tileSize,
      terrainResult.typeGrid,
      macroResult.zones,
      macroResult.templateResults,
      cfg.propConfig,
      rng.fork('props'),
    );

    // ----- Assemble MapDefinition -----
    return {
      width: cfg.width,
      height: cfg.height,
      tileSize: cfg.tileSize,
      seed,
      layers: terrainResult.layers,
      zones: macroResult.zones,
      props: propsResult.props,
      colliders: propsResult.colliders,
      coverPoints: propsResult.coverPoints,
      npcSpawns: propsResult.npcSpawns,
      playerSpawn: propsResult.playerSpawn,
      lanes: macroResult.lanes,
      validation: { valid: true, errors: [], warnings: [] },
    };
  }

  /**
   * Expose the TileRegistry for callers that need to add custom tile types
   * before calling generate().
   */
  getTileRegistry(): TileRegistry {
    return this.registry;
  }

  /**
   * Generate and immediately score a single map (without multi-candidate overhead).
   * Useful for scoring breakdowns during development.
   */
  generateWithScore(config: Partial<MapGenConfig> = {}): {
    map: MapDefinition;
    score: number;
    breakdown: Record<string, number>;
  } {
    const map = this.generate({ ...config, candidateCount: 1 });
    return {
      map,
      score: this.scorer.score(map),
      breakdown: this.scorer.breakdown(map),
    };
  }
}
