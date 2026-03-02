// plugin/SocialPlugin.ts
// A-Life Social Plugin — NPC social interaction subsystem.

import type { IALifePlugin, ALifeKernel, IRandom } from '@alife-sdk/core';
import type { ISocialConfig, ISocialConfigOverrides } from '../types/ISocialConfig';
import { createDefaultSocialConfig } from '../types/ISocialConfig';
import type { ISocialData, IBubbleRequest } from '../types/ISocialTypes';
import { ContentPool, loadSocialData } from '../content/ContentPool';
import { MeetOrchestrator } from '../meet/MeetOrchestrator';
import { RemarkDispatcher } from '../remark/RemarkDispatcher';
import { CampfireFSM } from '../campfire/CampfireFSM';
import type { IGatheringFSM } from '../campfire/IGatheringFSM';
import { SocialPorts } from '../ports/SocialPorts';
import type { ISocialPresenter } from '../ports/ISocialPresenter';
import type { INPCSocialProvider } from '../ports/INPCSocialProvider';

/**
 * Social plugin configuration.
 */
export interface ISocialPluginConfig {
  readonly social?: ISocialConfigOverrides;
  readonly data?: ISocialData;
}

export function createDefaultSocialPluginConfig(): ISocialPluginConfig {
  return { social: createDefaultSocialConfig() };
}

/**
 * A-Life Social Plugin — NPC social interaction subsystem.
 *
 * Provides:
 * - ContentPool for text management
 * - MeetOrchestrator for greeting interactions
 * - RemarkDispatcher for ambient remarks
 * - CampfireFSM for campfire storytelling sessions
 *
 * Required ports: ISocialPresenter, INPCSocialProvider.
 *
 * @example
 * ```ts
 * const socialPlugin = new SocialPlugin(random, {
 *   social: createDefaultSocialConfig(),
 *   data: socialJsonData,
 * });
 * kernel.use(socialPlugin);
 * ```
 */
export class SocialPlugin implements IALifePlugin {
  readonly name = 'social';
  readonly dependencies = [] as const;

  /** Text pool — add custom categories or load additional content at runtime. */
  readonly contentPool: ContentPool;
  /** Greeting orchestrator — drive manually with target position each game loop tick. */
  readonly meetOrchestrator: MeetOrchestrator;
  /** Ambient remark dispatcher — runs automatically each `update()` tick. */
  readonly remarkDispatcher: RemarkDispatcher;

  private kernel: ALifeKernel | null = null;
  private presenter: ISocialPresenter | null = null;
  private npcProvider: INPCSocialProvider | null = null;
  private readonly campfireSessions = new Map<string, IGatheringFSM>();
  private readonly gatheringStates: ReadonlySet<string>;
  private campfireSyncTimer = 0;
  /** Scratch Map reused across syncCampfireSessions calls to avoid per-call allocation. */
  private readonly _terrainNpcsScratch = new Map<string, string[]>();
  private readonly config: { readonly social: ISocialConfig; readonly data?: ISocialData };
  private readonly random: IRandom;
  private _boundGetTerrainId: (id: string) => string | null = () => null;

  constructor(random: IRandom, config?: Partial<ISocialPluginConfig>) {
    this.random = random;
    const merged = {
      social: config?.social
        ? createDefaultSocialConfig(config.social)
        : createDefaultSocialConfig(),
      data: config?.data,
    };
    this.config = merged;
    this.gatheringStates = new Set(merged.social.campfire.gatheringStates ?? ['camp']);

    this.contentPool = new ContentPool(random);
    if (merged.data) {
      loadSocialData(this.contentPool, merged.data);
    }

    this.meetOrchestrator = new MeetOrchestrator(
      this.contentPool, random, merged.social.meet,
    );
    this.remarkDispatcher = new RemarkDispatcher(
      this.contentPool, random, merged.social.remark,
    );
  }

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.presenter = this.kernel?.portRegistry.tryGet(SocialPorts.SocialPresenter) ?? null;
    this.npcProvider = this.kernel?.portRegistry.tryGet(SocialPorts.NPCSocialProvider) ?? null;
    this._boundGetTerrainId = (id: string) => this.npcProvider?.getNPCTerrainId(id) ?? null;
  }

  update(deltaMs: number): void {
    if (!this.npcProvider || !this.presenter) return;

    const npcs = this.npcProvider.getOnlineNPCs();

    // Remarks
    const remarks = this.remarkDispatcher.update(deltaMs, npcs, this._boundGetTerrainId);
    this.presentBubbles(remarks);

    // Campfire sync
    this.campfireSyncTimer += deltaMs;
    if (this.campfireSyncTimer >= this.config.social.campfire.syncIntervalMs) {
      this.campfireSyncTimer -= this.config.social.campfire.syncIntervalMs;
      this.syncCampfireSessions(npcs, this._boundGetTerrainId);
    }

    // Campfire updates
    for (const fsm of this.campfireSessions.values()) {
      const bubbles = fsm.update(deltaMs);
      this.presentBubbles(bubbles);
    }
  }

  destroy(): void {
    this.contentPool.clear();
    this.meetOrchestrator.clear();
    this.remarkDispatcher.clear();
    for (const fsm of this.campfireSessions.values()) {
      fsm.clear();
    }
    this.campfireSessions.clear();
    this.kernel = null;
    this.presenter = null;
    this.npcProvider = null;
  }

  serialize(): Record<string, unknown> {
    return {
      campfireTerrains: Array.from(this.campfireSessions.keys()),
      meetCooldowns: this.meetOrchestrator.serialize(),
      remarkCooldowns: this.remarkDispatcher.serialize(),
    };
  }

  restore(state: Record<string, unknown>): void {
    // Campfire sessions are transient — they reconstruct from live NPC positions

    const meetCooldowns = state.meetCooldowns as Array<[string, number]> | undefined;
    if (Array.isArray(meetCooldowns)) {
      this.meetOrchestrator.restore(meetCooldowns);
    }

    const remarkCooldowns = state.remarkCooldowns as Array<[string, number]> | undefined;
    if (Array.isArray(remarkCooldowns)) {
      this.remarkDispatcher.restore(remarkCooldowns);
    }
  }

  private presentBubbles(bubbles: IBubbleRequest[]): void {
    if (!this.presenter) return;
    for (const bubble of bubbles) {
      this.presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
    }
  }

  private syncCampfireSessions(
    npcs: readonly import('../types/ISocialTypes').ISocialNPC[],
    getTerrainId: (npcId: string) => string | null,
  ): void {
    // Group gathering NPCs by terrain (reuse scratch Map to avoid allocation)
    const terrainNpcs = this._terrainNpcsScratch;
    terrainNpcs.clear();
    for (const npc of npcs) {
      if (!this.gatheringStates.has(npc.state)) continue;
      const terrainId = getTerrainId(npc.id);
      if (!terrainId) continue;
      const list = terrainNpcs.get(terrainId);
      if (list) {
        list.push(npc.id);
      } else {
        terrainNpcs.set(terrainId, [npc.id]);
      }
    }

    // Create/update sessions
    for (const [terrainId, npcIds] of terrainNpcs) {
      if (npcIds.length < this.config.social.campfire.minParticipants) {
        this.campfireSessions.get(terrainId)?.clear();
        this.campfireSessions.delete(terrainId);
        continue;
      }

      let fsm = this.campfireSessions.get(terrainId);
      if (!fsm) {
        const factory = this.config.social.createGatheringFSM
          ?? ((id: string) => new CampfireFSM(id, this.contentPool, this.random, this.config.social.campfire));
        fsm = factory(terrainId);
        this.campfireSessions.set(terrainId, fsm);
      }
      fsm.setParticipants(npcIds);
    }

    // Remove sessions for terrains with no gathering NPCs
    const toRemove: string[] = [];
    for (const terrainId of this.campfireSessions.keys()) {
      if (!terrainNpcs.has(terrainId)) {
        toRemove.push(terrainId);
      }
    }
    for (const terrainId of toRemove) {
      this.campfireSessions.get(terrainId)?.clear();
      this.campfireSessions.delete(terrainId);
    }
  }
}
