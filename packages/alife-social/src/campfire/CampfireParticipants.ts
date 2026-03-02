// campfire/CampfireParticipants.ts
// Role assignment for campfire sessions.

import type { IRandom } from '@alife-sdk/core';
import { CampfireRole } from '../types/ISocialTypes';

/**
 * Participant entry with assigned role.
 */
export interface ICampfireParticipant {
  readonly npcId: string;
  role: CampfireRole;
}

/**
 * Manage campfire session participants and director rotation.
 */
export class CampfireParticipants {
  private participants: ICampfireParticipant[] = [];
  private directorIndex = -1;
  private _allIds: string[] = [];
  private _audienceIds: string[] = [];
  private _idsDirty = true;
  private _participantSet = new Set<string>();

  constructor(private readonly random: IRandom) {}

  /**
   * Set the participant list. Returns false if below minimum count.
   */
  setParticipants(npcIds: readonly string[], minCount: number): boolean {
    if (npcIds.length < minCount) {
      this.participants = [];
      this.directorIndex = -1;
      return false;
    }

    this.participants = npcIds.map((id) => ({ npcId: id, role: CampfireRole.AUDIENCE }));
    this._idsDirty = true;
    this._participantSet.clear();
    for (const id of npcIds) this._participantSet.add(id);
    if (this.directorIndex < 0 || this.directorIndex >= this.participants.length) {
      this.directorIndex = Math.floor(this.random.next() * this.participants.length);
    }
    return true;
  }

  /**
   * Rotate the director to the next participant.
   */
  rotateDirector(): string | null {
    if (this.participants.length === 0) return null;

    // Reset previous director
    for (const p of this.participants) {
      p.role = CampfireRole.AUDIENCE;
    }

    this.directorIndex = (this.directorIndex + 1) % this.participants.length;
    this.participants[this.directorIndex].role = CampfireRole.DIRECTOR;
    this._idsDirty = true;
    return this.participants[this.directorIndex].npcId;
  }

  /**
   * Get the current director NPC ID.
   */
  getDirectorId(): string | null {
    if (this.directorIndex < 0 || this.directorIndex >= this.participants.length) return null;
    return this.participants[this.directorIndex].npcId;
  }

  /**
   * Get all audience member IDs (everyone except the director).
   */
  getAudienceIds(): string[] {
    this.rebuildIdCaches();
    return this._audienceIds;
  }

  /**
   * Get all participant IDs.
   */
  getAllIds(): string[] {
    this.rebuildIdCaches();
    return this._allIds;
  }

  private rebuildIdCaches(): void {
    if (!this._idsDirty) return;
    const directorId = this.getDirectorId();
    this._allIds.length = 0;
    this._audienceIds.length = 0;
    for (const p of this.participants) {
      this._allIds.push(p.npcId);
      if (p.npcId !== directorId) this._audienceIds.push(p.npcId);
    }
    this._idsDirty = false;
  }

  /**
   * Check if an NPC is still a participant.
   */
  has(npcId: string): boolean {
    return this._participantSet.has(npcId);
  }

  get count(): number {
    return this.participants.length;
  }

  clear(): void {
    this.participants = [];
    this.directorIndex = -1;
    this._allIds.length = 0;
    this._audienceIds.length = 0;
    this._idsDirty = false;
    this._participantSet.clear();
  }
}

/** @deprecated Use ICampfireParticipant instead. */
export type IKampParticipant = ICampfireParticipant;
/** @deprecated Use CampfireParticipants instead. */
export const KampParticipants = CampfireParticipants;
