import { QuestStatus } from '../types/IEconomyTypes';
import type {
  IQuestDefinition,
  IQuestState,
} from '../types/IEconomyTypes';

/**
 * Port interface for applying terrain effects (lock/unlock).
 * The host game engine implements this to bridge quest events
 * into the terrain system.
 */
export interface ITerrainLockAdapter {
  setLocked(terrainId: string, locked: boolean): void;
}

/**
 * Serialized snapshot of a single quest objective.
 */
export interface IQuestObjectiveSnapshot {
  readonly id: string;
  readonly current: number;
  readonly completed: boolean;
}

/**
 * Serialized snapshot of a quest's state (status + objectives).
 */
export interface IQuestStateSnapshot {
  readonly id: string;
  readonly status: string;
  readonly objectives: readonly IQuestObjectiveSnapshot[];
}

/**
 * Typed event payload map for QuestEngine.on() / off().
 *
 * @example
 * ```ts
 * engine.on('quest:completed', ({ questId }) => {
 *   inventory.add(rewardMap[questId]);
 * });
 * engine.on('objective:progress', ({ questId, objectiveId, current, total }) => {
 *   ui.updateProgress(questId, objectiveId, current / total);
 * });
 * ```
 */
export type QuestEventMap = {
  /** Fired after AVAILABLE → ACTIVE. */
  'quest:started': { questId: string };
  /** Fired after ACTIVE → COMPLETED (all objectives done). */
  'quest:completed': { questId: string };
  /** Fired after ACTIVE → FAILED. */
  'quest:failed': { questId: string };
  /** Fired each time a progress-based objective counter advances. */
  'objective:progress': { questId: string; objectiveId: string; current: number; total: number };
  /** Fired when a single objective is marked completed. */
  'objective:completed': { questId: string; objectiveId: string };
};

/**
 * Quest lifecycle engine with objective tracking, terrain effects,
 * reactive events, and declarative prerequisites.
 *
 * ## Quick start
 *
 * ```ts
 * const engine = new QuestEngine(terrainAdapter);
 *
 * engine.on('quest:completed', ({ questId }) => {
 *   inventory.add(rewards[questId]);
 * });
 *
 * engine.registerQuest({ id: 'q1', name: '...', objectives: [...] });
 * engine.registerQuest({ id: 'q2', requires: ['q1'], ... }); // quest chain
 * engine.startQuest('q1');
 * engine.completeObjective('q1', 'obj_reach');
 * // → 'quest:completed' fires → q2 becomes startable
 * ```
 *
 * ## Adapter wiring — two supported patterns
 *
 * **Standalone (direct wiring):**
 * ```ts
 * const engine = new QuestEngine(terrainAdapter);
 * ```
 *
 * **Kernel-wired (via EconomyPlugin):**
 * ```ts
 * const engine = new QuestEngine(); // adapter set later by EconomyPlugin.init()
 * ```
 */
// P39: class-level constant for QuestStatus validation (avoids per-call Set allocation).
const VALID_QUEST_STATUSES: ReadonlySet<string> = new Set(Object.values(QuestStatus));

export class QuestEngine {
  private readonly definitions = new Map<string, IQuestDefinition>();
  private readonly states = new Map<string, IQuestState>();
  private terrainAdapter: ITerrainLockAdapter | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _listeners = new Map<string, Set<(data: any) => void>>();
  private _eventForwarder: ((type: string, payload: unknown) => void) | null = null;

  // P38: cached filtered quest arrays — single dirty flag, rebuilt on status mutation.
  private _cachedActive: readonly IQuestState[] = [];
  private _cachedCompleted: readonly IQuestState[] = [];
  private _cachedAvailable: readonly IQuestState[] = [];
  private _queryCacheDirty = false;

  /**
   * @param terrainAdapter - Optional terrain lock adapter for direct (standalone) wiring.
   *   When using QuestEngine with EconomyPlugin inside an ALifeKernel, omit this argument —
   *   the plugin resolves and injects the adapter via setTerrainAdapter() during init().
   */
  constructor(terrainAdapter?: ITerrainLockAdapter) {
    this.terrainAdapter = terrainAdapter ?? null;
  }

  /**
   * Set or replace the terrain lock adapter (late binding).
   *
   * Called automatically by EconomyPlugin.init() when the kernel provides a TerrainLock port.
   */
  setTerrainAdapter(adapter: ITerrainLockAdapter): void {
    this.terrainAdapter = adapter;
  }

  /**
   * Set a forwarder that receives every quest event after local listeners fire.
   *
   * Used by EconomyPlugin to bridge quest events into the kernel's EventBus so that
   * external systems (UI, analytics, social) can subscribe via `kernel.events.on(...)`.
   *
   * @example
   * ```ts
   * engine.setEventForwarder((type, payload) => kernel.events.emit(type, payload));
   * ```
   */
  setEventForwarder(cb: (type: string, payload: unknown) => void): void {
    this._eventForwarder = cb;
  }

  /**
   * Subscribe to a quest event.
   *
   * @example
   * ```ts
   * engine.on('quest:completed', ({ questId }) => giveReward(questId));
   * engine.on('objective:progress', ({ current, total }) => updateUI(current, total));
   * ```
   */
  on<K extends keyof QuestEventMap>(event: K, cb: (data: QuestEventMap[K]) => void): void {
    let set = this._listeners.get(event as string);
    if (!set) { set = new Set(); this._listeners.set(event as string, set); }
    set.add(cb);
  }

  /**
   * Unsubscribe from a quest event. Pass the same callback reference used in on().
   */
  off<K extends keyof QuestEventMap>(event: K, cb: (data: QuestEventMap[K]) => void): void {
    this._listeners.get(event as string)?.delete(cb);
  }

  /**
   * Register a quest definition. Must be called before start/complete.
   * Re-registering an existing quest is a no-op (preserves active state).
   */
  registerQuest(def: IQuestDefinition): void {
    this.definitions.set(def.id, def);
    if (!this.states.has(def.id)) {
      this.states.set(def.id, {
        id: def.id,
        status: QuestStatus.AVAILABLE,
        objectives: def.objectives.map((o) => ({ ...o })),
      });
      this._queryCacheDirty = true;
    }
  }

  /**
   * Check whether a quest can be started right now.
   *
   * Returns `true` if the quest is `AVAILABLE` **and** all `requires` prerequisites
   * are `COMPLETED`. Use this to drive UI (e.g. show/hide "Accept" buttons) without
   * having to call `startQuest()` and check the return value.
   *
   * @example
   * ```ts
   * const startable = engine.getAvailableQuests().filter(q => engine.isQuestStartable(q.id));
   * ```
   */
  isQuestStartable(questId: string): boolean {
    const state = this.states.get(questId);
    if (!state || state.status !== QuestStatus.AVAILABLE) return false;
    return this.areRequirementsMet(questId);
  }

  /**
   * Start a quest. Transitions AVAILABLE → ACTIVE.
   * Returns `false` if the quest is not available or prerequisites are unmet.
   * Applies `on_start` terrain effects and emits `quest:started`.
   */
  startQuest(questId: string): boolean {
    const state = this.states.get(questId);
    if (!state || state.status !== QuestStatus.AVAILABLE) return false;
    if (!this.areRequirementsMet(questId)) return false;

    state.status = QuestStatus.ACTIVE;
    this._queryCacheDirty = true;
    this.applyTerrainEffects(questId, 'on_start');
    this.emit('quest:started', { questId });
    return true;
  }

  /**
   * Complete a specific objective.
   * If all objectives are done, auto-completes the quest.
   * Returns `false` if the quest is not active or objective is already completed.
   * Emits `objective:completed` (and `quest:completed` on full completion).
   */
  completeObjective(questId: string, objectiveId: string): boolean {
    const state = this.states.get(questId);
    if (!state || state.status !== QuestStatus.ACTIVE) return false;

    const obj = state.objectives.find((o) => o.id === objectiveId);
    if (!obj || obj.completed) return false;

    obj.completed = true;
    this.emit('objective:completed', { questId, objectiveId });

    if (state.objectives.every((o) => o.completed)) {
      this.completeQuest(questId);
    }

    return true;
  }

  /**
   * Update progress on a kill-type (or any progress-based) objective.
   * When `current >= count`, calls `completeObjective()` automatically.
   * Emits `objective:progress` on each call (before auto-completion check).
   */
  updateObjectiveProgress(questId: string, objectiveId: string, increment = 1): boolean {
    const state = this.states.get(questId);
    if (!state || state.status !== QuestStatus.ACTIVE) return false;

    const obj = state.objectives.find((o) => o.id === objectiveId);
    if (!obj || obj.completed) return false;

    if (increment <= 0) return false;

    obj.current = Math.min(obj.current + increment, obj.count);
    this.emit('objective:progress', { questId, objectiveId, current: obj.current, total: obj.count });

    if (obj.current >= obj.count) {
      return this.completeObjective(questId, objectiveId);
    }

    return true;
  }

  /**
   * Fail a quest. Transitions ACTIVE → FAILED.
   * Applies `on_fail` terrain effects and emits `quest:failed`.
   */
  failQuest(questId: string): boolean {
    const state = this.states.get(questId);
    if (!state || state.status !== QuestStatus.ACTIVE) return false;

    state.status = QuestStatus.FAILED;
    this._queryCacheDirty = true;
    this.applyTerrainEffects(questId, 'on_fail');
    this.emit('quest:failed', { questId });
    return true;
  }

  /** Get quest state. */
  getQuestState(questId: string): IQuestState | undefined {
    return this.states.get(questId);
  }

  /** Get all active quests (cached, rebuilt on status mutation). */
  getActiveQuests(): readonly IQuestState[] {
    if (this._queryCacheDirty) this.rebuildQueryCaches();
    return this._cachedActive;
  }

  /** Get all completed quests (cached, rebuilt on status mutation). */
  getCompletedQuests(): readonly IQuestState[] {
    if (this._queryCacheDirty) this.rebuildQueryCaches();
    return this._cachedCompleted;
  }

  /** Get all available quests (cached, rebuilt on status mutation). */
  getAvailableQuests(): readonly IQuestState[] {
    if (this._queryCacheDirty) this.rebuildQueryCaches();
    return this._cachedAvailable;
  }

  /** Serialize quest states for save/load. */
  serialize(): IQuestStateSnapshot[] {
    return [...this.states.values()].map((s) => ({
      id: s.id,
      status: s.status,
      objectives: s.objectives.map((o) => ({
        id: o.id,
        current: o.current,
        completed: o.completed,
      })),
    }));
  }

  /** Restore quest states from serialized data. Definitions must be registered first. */
  restore(data: readonly IQuestStateSnapshot[]): void {
    for (const entry of data) {
      const state = this.states.get(entry.id);
      if (!state) continue;

      // P39: use module-level constant instead of allocating a new Set per call.
      if (VALID_QUEST_STATUSES.has(entry.status)) {
        state.status = entry.status as QuestStatus;
      }
      for (const objData of entry.objectives) {
        const obj = state.objectives.find((o) => o.id === objData.id);
        if (obj) {
          obj.current = objData.current;
          obj.completed = objData.completed;
        }
      }
    }
    this._queryCacheDirty = true;
  }

  /** Clear all listeners and the event forwarder. */
  destroy(): void {
    this._listeners.clear();
    this._eventForwarder = null;
  }

  private emit<K extends keyof QuestEventMap>(event: K, data: QuestEventMap[K]): void {
    this._listeners.get(event as string)?.forEach((cb) => cb(data));
    this._eventForwarder?.(event as string, data);
  }

  private rebuildQueryCaches(): void {
    const active: IQuestState[] = [];
    const completed: IQuestState[] = [];
    const available: IQuestState[] = [];

    for (const s of this.states.values()) {
      switch (s.status) {
        case QuestStatus.ACTIVE: active.push(s); break;
        case QuestStatus.COMPLETED: completed.push(s); break;
        case QuestStatus.AVAILABLE: available.push(s); break;
      }
    }

    this._cachedActive = active;
    this._cachedCompleted = completed;
    this._cachedAvailable = available;
    this._queryCacheDirty = false;
  }

  private areRequirementsMet(questId: string): boolean {
    const def = this.definitions.get(questId);
    if (!def?.requires) return true;
    return def.requires.every((req) => this.states.get(req)?.status === QuestStatus.COMPLETED);
  }

  private completeQuest(questId: string): void {
    const state = this.states.get(questId);
    if (!state) return;

    state.status = QuestStatus.COMPLETED;
    this._queryCacheDirty = true;

    // Mark all objectives completed (consistency guarantee).
    for (const obj of state.objectives) {
      obj.completed = true;
    }

    this.applyTerrainEffects(questId, 'on_complete');
    this.emit('quest:completed', { questId });
  }

  private applyTerrainEffects(questId: string, trigger: 'on_start' | 'on_complete' | 'on_fail'): void {
    if (!this.terrainAdapter) return;

    const def = this.definitions.get(questId);
    if (!def?.terrainEffects) return;

    for (const effect of def.terrainEffects) {
      if (effect.trigger === trigger) {
        this.terrainAdapter.setLocked(
          effect.terrainId,
          effect.action === 'lock',
        );
      }
    }
  }
}
