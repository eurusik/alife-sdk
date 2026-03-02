// plugin/AIPlugin.ts
// A-Life AI plugin — registers the tactical AI subsystem with the kernel.

import type { IALifePlugin, ALifeKernel, IRandom } from '@alife-sdk/core';
import type { IOnlineAIConfig } from '../types/IOnlineAIConfig';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import type { ICoverAccess } from '../states/INPCContext';
import { CoverRegistry } from '../cover/CoverRegistry';
import { CoverLockRegistry } from '../cover/CoverLockRegistry';
import { CoverAccessAdapter } from '../cover/CoverAccessAdapter';
import type { ICoverLockConfig } from '../cover/ICoverLockConfig';
import { RestrictedZoneManager, type RestrictionType } from '../navigation/RestrictedZoneManager';
import { AIPorts } from '../ports/AIPorts';

/**
 * Configuration for the AI plugin.
 */
export interface IAIPluginConfig {
  readonly ai: IOnlineAIConfig;
  /** Optional cover lock config overrides. Set to false to disable locking entirely. */
  readonly coverLock?: Partial<ICoverLockConfig> | false;
}

export function createDefaultAIPluginConfig(): IAIPluginConfig {
  return { ai: createDefaultAIConfig() };
}

/**
 * A-Life AI Plugin — tactical AI subsystem.
 *
 * Provides:
 * - CoverRegistry for tactical cover management
 * - RestrictedZoneManager for movement constraints
 * - All pure-function utilities (weapon selection, transitions, animation)
 *
 * Optional port: ICoverPointSource for auto-populating cover points.
 *
 * @example
 * ```ts
 * const aiPlugin = new AIPlugin(random, config);
 * kernel.use(aiPlugin);
 *
 * // After init:
 * const cover = aiPlugin.coverRegistry;
 * const zones = aiPlugin.restrictedZones;
 * ```
 */
export class AIPlugin implements IALifePlugin {
  readonly name = 'ai';
  readonly dependencies = [] as const;

  readonly coverRegistry: CoverRegistry;
  readonly coverLockRegistry: CoverLockRegistry | null;
  readonly restrictedZones: RestrictedZoneManager;

  private kernel: ALifeKernel | null = null;
  private readonly config: IAIPluginConfig;

  /**
   * @param random     - Deterministic random source.
   * @param config     - Plugin configuration overrides.
   * @param timeFn     - Time source for cover lock TTL (ms). Required when
   *                     cover locking is enabled (default). Pass `() => Date.now()`
   *                     for real-time locking or integrate with your game clock.
   */
  constructor(random: IRandom, config?: Partial<IAIPluginConfig>, timeFn?: () => number) {
    const merged: IAIPluginConfig = {
      ai: createDefaultAIConfig(config?.ai),
      coverLock: config?.coverLock,
    };

    this.config = merged;

    // Create lock registry unless explicitly disabled.
    const lockCfg = merged.coverLock;
    if (lockCfg !== false) {
      const fn = timeFn ?? (() => Date.now());
      this.coverLockRegistry = new CoverLockRegistry(fn, lockCfg);
    } else {
      this.coverLockRegistry = null;
    }

    this.coverRegistry = new CoverRegistry(
      merged.ai.cover,
      random,
      this.coverLockRegistry ?? undefined,
    );
    this.restrictedZones = new RestrictedZoneManager(
      merged.ai.navigation.restrictedZoneSafeMargin,
    );
  }

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    // Auto-populate cover points if the host provided a source.
    const source = this.kernel?.portRegistry.tryGet(AIPorts.CoverPointSource);
    if (source) {
      const points = source.getPoints({
        minX: -Infinity,
        minY: -Infinity,
        maxX: Infinity,
        maxY: Infinity,
      });
      this.coverRegistry.addPoints(points);
    }
  }

  destroy(): void {
    this.coverRegistry.clear();
    this.coverLockRegistry?.clear();
    this.restrictedZones.clear();
    this.kernel = null;
  }

  serialize(): Record<string, unknown> {
    // Cover locks are intentionally NOT serialized — they are ephemeral TTL
    // reservations that expire within seconds. Persisting stale locks across
    // save/load cycles would permanently block cover points with no recovery
    // path. NPCs will re-acquire locks naturally on their next TakeCover/Retreat
    // state entry after loading.
    const zones = this.restrictedZones.getAllZones().map((z) => ({
      id: z.id,
      type: z.type,
      x: z.x,
      y: z.y,
      radius: z.radius,
      active: z.active,
      metadata: z.metadata,
    }));

    return { zones };
  }

  restore(state: Record<string, unknown>): void {
    this.restrictedZones.clear();

    const zones = state.zones as Array<Record<string, unknown>> | undefined;

    if (zones) {
      for (const z of zones) {
        this.restrictedZones.addZone({
          id: z.id as string,
          type: z.type as RestrictionType,
          x: z.x as number,
          y: z.y as number,
          radius: z.radius as number,
          active: z.active as boolean,
          metadata: z.metadata as string | undefined,
        });
      }
    }
  }

  /**
   * Create a per-NPC `ICoverAccess` adapter backed by this plugin's registries.
   *
   * The returned adapter is stateful — it tracks the last cover point found so
   * that `lockLastFound()` can acquire a TTL lock without the caller managing
   * point IDs. Create one adapter per NPC entity; do not share across entities.
   *
   * @param npcId - Stable NPC identifier (used for occupancy filtering and locking).
   */
  createCoverAccess(npcId: string): ICoverAccess {
    return new CoverAccessAdapter(this.coverRegistry, this.coverLockRegistry, npcId);
  }

  /** Get the AI configuration. */
  getConfig(): IOnlineAIConfig {
    return this.config.ai;
  }
}
