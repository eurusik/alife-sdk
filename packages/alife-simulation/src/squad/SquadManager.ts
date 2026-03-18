/**
 * Squad lifecycle manager for the offline A-Life simulation.
 *
 * Maintains squads, the npcId -> squadId reverse index, and
 * delegates morale cascade events to Squad instances.
 *
 * Pure data/logic -- no framework dependencies, no singletons.
 * Everything is injected via constructor.
 */

import { EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { Squad } from './Squad';
import type { ISquadConfig, ISquadGoalState, MoraleLookup } from './Squad';

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface ISquadManagerState {
  readonly squads: ReadonlyArray<{
    readonly id: string;
    readonly factionId: string;
    readonly memberIds: readonly string[];
    readonly leaderId: string | null;
    readonly goal: ISquadGoalState | null;
  }>;
}

// ---------------------------------------------------------------------------
// SquadManager
// ---------------------------------------------------------------------------

export class SquadManager {
  private readonly config: ISquadConfig;
  private readonly events: EventBus<ALifeEventPayloads>;
  private readonly moraleLookup: MoraleLookup | null;

  /** All active squads keyed by squadId. */
  private readonly squads = new Map<string, Squad>();

  /** Reverse index: npcId -> squadId for O(1) lookups. */
  private readonly npcToSquad = new Map<string, string>();

  /** Monotonic counter for unique squad ID generation. */
  private squadCounter = 0;

  constructor(
    config: ISquadConfig,
    events: EventBus<ALifeEventPayloads>,
    moraleLookup?: MoraleLookup | null,
  ) {
    this.config = config;
    this.events = events;
    this.moraleLookup = moraleLookup ?? null;
  }

  // =========================================================================
  // Squad lifecycle
  // =========================================================================

  /**
   * Create a new squad for the given faction.
   * Generates a unique ID `squad_{factionId}_{counter}`, assigns members,
   * and emits SQUAD_FORMED.
   */
  createSquad(factionId: string, memberIds: string[] = []): Squad {
    const squadId = `squad_${factionId}_${++this.squadCounter}`;
    const squad = new Squad(
      squadId,
      factionId,
      this.config,
      this.events,
      this.moraleLookup,
    );

    this.squads.set(squadId, squad);

    for (const npcId of memberIds) {
      this.assignToSquad(npcId, squadId);
    }

    this.events.emit(ALifeEvents.SQUAD_FORMED, {
      squadId,
      factionId,
      memberIds: squad.getMembers(),
    });

    return squad;
  }

  /** Disband a squad: clear reverse index entries, destroy, and emit event. */
  disbandSquad(squadId: string): void {
    const squad = this.squads.get(squadId);
    if (!squad) return;

    for (const npcId of squad.getMembers()) {
      this.npcToSquad.delete(npcId);
    }

    squad.destroy();
    this.squads.delete(squadId);
    this.events.emit(ALifeEvents.SQUAD_DISBANDED, { squadId });
  }

  // =========================================================================
  // NPC assignment
  // =========================================================================

  /** Assign an NPC to an existing squad. Removes from previous squad first. */
  assignToSquad(npcId: string, squadId: string): boolean {
    const squad = this.squads.get(squadId);
    if (!squad) return false;

    this.removeFromSquad(npcId);

    const added = squad.addMember(npcId);
    if (added) {
      this.npcToSquad.set(npcId, squadId);
    }
    return added;
  }

  /** Remove an NPC from its squad. Auto-disbands empty squads. */
  removeFromSquad(npcId: string): void {
    const squadId = this.npcToSquad.get(npcId);
    if (!squadId) return;

    const squad = this.squads.get(squadId);
    if (squad) {
      squad.removeMember(npcId);

      if (squad.getMemberCount() === 0) {
        squad.destroy();
        this.squads.delete(squadId);
        this.events.emit(ALifeEvents.SQUAD_DISBANDED, { squadId });
      }
    }

    this.npcToSquad.delete(npcId);
  }

  /**
   * Find the first non-full same-faction squad, or create a new one.
   * Every NPC gets squad-grouped from registration.
   */
  autoAssign(npcId: string, factionId: string): Squad {
    this.removeFromSquad(npcId);

    for (const squad of this.squads.values()) {
      if (squad.factionId === factionId && !squad.isFull()) {
        const added = squad.addMember(npcId);
        if (added) {
          this.npcToSquad.set(npcId, squad.id);
          return squad;
        }
      }
    }

    return this.createSquad(factionId, [npcId]);
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getSquadForNPC(npcId: string): Squad | null {
    const squadId = this.npcToSquad.get(npcId);
    if (!squadId) return null;
    return this.squads.get(squadId) ?? null;
  }

  getSquadId(npcId: string): string | null {
    return this.npcToSquad.get(npcId) ?? null;
  }

  getSquadsByFaction(factionId: string): Squad[] {
    const result: Squad[] = [];
    for (const squad of this.squads.values()) {
      if (squad.factionId === factionId) {
        result.push(squad);
      }
    }
    return result;
  }

  getAllSquads(): Squad[] {
    return [...this.squads.values()];
  }

  // =========================================================================
  // Morale events
  // =========================================================================

  /** Delegate death to Squad, clean up reverse index, auto-disband if empty. */
  onNPCDeath(npcId: string): void {
    const squad = this.getSquadForNPC(npcId);
    if (!squad) return;

    squad.onMemberDeath(npcId);
    this.npcToSquad.delete(npcId);

    if (squad.getMemberCount() === 0) {
      squad.destroy();
      this.squads.delete(squad.id);
      this.events.emit(ALifeEvents.SQUAD_DISBANDED, { squadId: squad.id });
    }
  }

  /** Delegate kill bonus to Squad. */
  onNPCKill(npcId: string): void {
    this.getSquadForNPC(npcId)?.onMemberKill(npcId);
  }

  /**
   * Cascade morale delta from source to all squad peers.
   * Leader source uses `moraleCascadeLeaderFactor`, regular uses `moraleCascadeFactor`.
   */
  cascadeMorale(squadId: string, sourceNpcId: string, delta: number): void {
    const squad = this.squads.get(squadId);
    if (!squad || !this.moraleLookup) return;

    const isLeader = squad.getLeader() === sourceNpcId;
    const factor = isLeader
      ? this.config.moraleCascadeLeaderFactor
      : this.config.moraleCascadeFactor;
    const cascadeDelta = delta * factor;

    for (const peerId of squad.getMembers()) {
      if (peerId === sourceNpcId) continue;
      this.moraleLookup(peerId)?.adjustMorale(cascadeDelta);
    }
  }

  // =========================================================================
  // Serialization
  // =========================================================================

  serialize(): ISquadManagerState {
    const squads: ISquadManagerState['squads'][number][] = [];

    for (const squad of this.squads.values()) {
      const goal = squad.currentGoal;
      squads.push({
        id: squad.id,
        factionId: squad.factionId,
        memberIds: squad.getMembers(),
        leaderId: squad.getLeader(),
        goal: goal ? {
          type: goal.type,
          terrainId: goal.terrainId ?? null,
          priority: goal.priority ?? 0,
          meta: goal.meta ? { ...goal.meta } : null,
        } : null,
      });
    }

    return { squads };
  }

  restore(state: ISquadManagerState): void {
    this.destroy();

    for (const entry of state.squads) {
      // Parse counter from id to keep squadCounter monotonic.
      const parts = entry.id.split('_');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > this.squadCounter) {
        this.squadCounter = num;
      }

      const squad = new Squad(
        entry.id,
        entry.factionId,
        this.config,
        this.events,
        this.moraleLookup,
      );

      this.squads.set(entry.id, squad);

      for (const npcId of entry.memberIds) {
        squad.restoreMember(npcId);
        this.npcToSquad.set(npcId, entry.id);
      }

      if (entry.leaderId !== null && squad.hasMember(entry.leaderId)) {
        squad.setLeader(entry.leaderId);
      }

      if (entry.goal !== null) {
        squad.restoreGoal(entry.goal);
      }
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  destroy(): void {
    for (const squad of this.squads.values()) {
      squad.destroy();
    }
    this.squads.clear();
    this.npcToSquad.clear();
    this.squadCounter = 0;
  }
}
