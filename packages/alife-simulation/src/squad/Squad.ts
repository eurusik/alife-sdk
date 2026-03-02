import { EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Squad Goal types
// ---------------------------------------------------------------------------

/** Open string union for squad goal types. SDK provides defaults; extend freely. */
export type SquadGoalType = 'patrol' | 'assault' | 'defend' | 'flee' | (string & {});

/** Default goal type constants. */
export const SquadGoalTypes = {
  PATROL:  'patrol',
  ASSAULT: 'assault',
  DEFEND:  'defend',
  FLEE:    'flee',
} as const;

/**
 * Persistent squad-level objective.
 *
 * Drives member brain terrain selection when terrainId is present.
 * Priority is for external comparison only (higher = more important).
 */
export interface ISquadGoal {
  readonly type: SquadGoalType;
  /** When set, member brains bias terrain selection toward this terrain. */
  readonly terrainId?: string;
  /** For external comparison. Default: 0. */
  readonly priority?: number;
  /** Arbitrary metadata for game-layer handlers. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Serialized form of a squad goal. */
export interface ISquadGoalState {
  readonly type: string;
  readonly terrainId: string | null;
  readonly priority: number;
  readonly meta: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ISquadConfig {
  readonly maxSize: number;
  readonly moraleAllyDeathPenalty: number;
  readonly moraleKillBonus: number;
  /** Morale cascade multiplier when a regular member dies. */
  readonly moraleCascadeFactor: number;
  /** Morale cascade multiplier when the squad leader dies. */
  readonly moraleCascadeLeaderFactor: number;
}

export function createDefaultSquadConfig(
  overrides?: Partial<ISquadConfig>,
): ISquadConfig {
  return {
    maxSize: 4,
    moraleAllyDeathPenalty: -0.15,
    moraleKillBonus: 0.1,
    moraleCascadeFactor: 0.5,
    moraleCascadeLeaderFactor: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Morale callback
// ---------------------------------------------------------------------------

/** Callback to apply morale changes without holding entity refs. */
export type MoraleLookup = (
  npcId: string,
) => { adjustMorale(delta: number): void } | null;

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------

/**
 * Faction-aligned group of NPCs that share morale cascade.
 *
 * Tracks membership, leadership, and propagates morale events.
 * Owned exclusively by SquadManager -- never hold a Squad reference elsewhere.
 */
export class Squad {
  readonly id: string;
  readonly factionId: string;

  private readonly members = new Set<string>();
  private leaderId: string | null = null;
  private _goal: ISquadGoal | null = null;
  private readonly config: ISquadConfig;
  private readonly events: EventBus<ALifeEventPayloads>;
  private readonly moraleLookup: MoraleLookup | null;
  private _membersArray: string[] = [];
  private _membersDirty = true;

  constructor(
    id: string,
    factionId: string,
    config: ISquadConfig,
    events: EventBus<ALifeEventPayloads>,
    moraleLookup?: MoraleLookup | null,
  ) {
    this.id = id;
    this.factionId = factionId;
    this.config = config;
    this.events = events;
    this.moraleLookup = moraleLookup ?? null;
  }

  // -------------------------------------------------------------------------
  // Goal management
  // -------------------------------------------------------------------------

  /** Current squad objective, or null if none is active. */
  get currentGoal(): ISquadGoal | null { return this._goal; }

  /** Set a persistent goal. Replaces any existing goal. Emits SQUAD_GOAL_SET. */
  setGoal(goal: ISquadGoal): void {
    this._goal = Object.freeze({
      ...goal,
      ...(goal.meta !== undefined ? { meta: structuredClone(goal.meta) } : {}),
    });
    this.events.emit(ALifeEvents.SQUAD_GOAL_SET, {
      squadId: this.id,
      goalType: goal.type,
      terrainId: goal.terrainId ?? null,
      priority: goal.priority ?? 0,
    });
  }

  /** Clear the current goal. No-op if no goal is set. Emits SQUAD_GOAL_CLEARED. */
  clearGoal(): void {
    if (this._goal === null) return;
    const prevType = this._goal.type;
    this._goal = null;
    this.events.emit(ALifeEvents.SQUAD_GOAL_CLEARED, {
      squadId: this.id,
      previousGoalType: prevType,
    });
  }

  /** Restore a goal from serialized state without emitting events. */
  restoreGoal(state: ISquadGoalState): void {
    this._goal = Object.freeze({
      type: state.type,
      ...(state.terrainId !== null ? { terrainId: state.terrainId } : {}),
      priority: state.priority,
      ...(state.meta !== null ? { meta: structuredClone(state.meta) } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  addMember(npcId: string): boolean {
    if (this.members.has(npcId) || this.members.size >= this.config.maxSize) {
      return false;
    }

    this.members.add(npcId);
    this._membersDirty = true;

    if (this.leaderId === null) {
      this.leaderId = npcId;
    }

    this.events.emit(ALifeEvents.SQUAD_MEMBER_ADDED, {
      squadId: this.id,
      npcId,
    });
    return true;
  }

  removeMember(npcId: string): void {
    if (!this.members.has(npcId)) return;

    this.members.delete(npcId);
    this._membersDirty = true;

    if (this.leaderId === npcId) {
      this.electNewLeader();
    }

    this.events.emit(ALifeEvents.SQUAD_MEMBER_REMOVED, {
      squadId: this.id,
      npcId,
    });
  }

  getMembers(): string[] {
    if (this._membersDirty) {
      this._membersArray.length = 0;
      for (const m of this.members) this._membersArray.push(m);
      this._membersDirty = false;
    }
    return [...this._membersArray];
  }

  getMemberCount(): number {
    return this.members.size;
  }

  isFull(): boolean {
    return this.members.size >= this.config.maxSize;
  }

  hasMember(npcId: string): boolean {
    return this.members.has(npcId);
  }

  /** Restore a member without emitting events. Used by SquadManager.restore(). */
  restoreMember(npcId: string): boolean {
    if (this.members.has(npcId) || this.members.size >= this.config.maxSize) {
      return false;
    }
    this.members.add(npcId);
    this._membersDirty = true;
    if (this.leaderId === null) {
      this.leaderId = npcId;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Leadership
  // -------------------------------------------------------------------------

  getLeader(): string | null {
    return this.leaderId;
  }

  setLeader(npcId: string): void {
    if (!this.members.has(npcId)) return;
    this.leaderId = npcId;
  }

  electNewLeader(): void {
    const [first] = this.members;
    this.leaderId = first ?? null;
  }

  // -------------------------------------------------------------------------
  // Morale cascade
  // -------------------------------------------------------------------------

  /**
   * Handle a squad member's death: remove them and apply flat morale penalty
   * to all survivors. Cascade factors are NOT applied here — those are for
   * online morale ripple events (cascadeMorale in SquadManager).
   */
  onMemberDeath(npcId: string): void {
    this.removeMember(npcId);

    if (!this.moraleLookup) return;

    for (const survivorId of this.members) {
      this.moraleLookup(survivorId)?.adjustMorale(this.config.moraleAllyDeathPenalty);
    }
  }

  onMemberKill(_npcId: string): void {
    if (!this.moraleLookup) return;

    for (const memberId of this.members) {
      this.moraleLookup(memberId)?.adjustMorale(this.config.moraleKillBonus);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Clear internal state. SQUAD_DISBANDED is emitted by SquadManager. */
  destroy(): void {
    this.members.clear();
    this.leaderId = null;
    this._goal = null;
  }
}
