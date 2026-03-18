/**
 * Personal NPC-to-NPC goodwill registry and fight tracker.
 *
 * Faction relations represent collective disposition between groups.
 * This registry adds a **personal overlay**: NPC "A" might despise NPC "B"
 * even if their factions are neutral, because "B" killed A's ally.
 *
 * Two subsystems:
 *   1. **Personal Goodwill** -- persistent `Map<"from->to", number>`, serializable.
 *   2. **Fight Registry**    -- transient `Map<"attacker->to", IFightRecord>`,
 *      auto-forgotten after `fightRememberTimeMs`. NOT serialized.
 *
 * Combined attitude = clamp(factionRelation + personalGoodwill, min, max).
 *
 * Pure data structure: no EventBus, no singletons, no rendering deps.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tunable parameters for the NPC relation system. */
export interface INPCRelationConfig {
  /** Goodwill delta when a witness's ally is killed (-30). */
  readonly killAllyDelta: number;
  /** Goodwill delta for a neutral kill (-5). */
  readonly killNeutralDelta: number;
  /** Goodwill delta when the witness's attacker is killed (+15). */
  readonly killEnemyDelta: number;
  /** Per-hit goodwill penalty from target toward attacker (-5). */
  readonly attackHitDelta: number;
  /** Duration (ms) before a fight record is purged (60_000). */
  readonly fightRememberTimeMs: number;
  /** Lower bound for goodwill values (-100). */
  readonly goodwillMin: number;
  /** Upper bound for goodwill values (+100). */
  readonly goodwillMax: number;
}

/** Create a config with production-tuned defaults. */
export function createDefaultRelationConfig(
  overrides?: Partial<INPCRelationConfig>,
): INPCRelationConfig {
  return {
    killAllyDelta: -30,
    killNeutralDelta: -5,
    killEnemyDelta: 15,
    attackHitDelta: -5,
    fightRememberTimeMs: 60_000,
    goodwillMin: -100,
    goodwillMax: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Serialization shape
// ---------------------------------------------------------------------------

/** A single personal goodwill entry for save/load. */
export interface IGoodwillEntry {
  readonly fromId: string;
  readonly toId: string;
  readonly goodwill: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Transient record of an active fight between two NPCs. */
interface IFightRecord {
  readonly attackerId: string;
  readonly defenderId: string;
  totalDamage: number;
  startTimeMs: number;
  lastHitTimeMs: number;
}

// ---------------------------------------------------------------------------
// Unicode arrow used as map key separator (same as game code)
// ---------------------------------------------------------------------------

const ARROW = '\u2192'; // →

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Tracks personal NPC-to-NPC goodwill and active fight records.
 *
 * Not a singleton -- create one instance per simulation and inject the config.
 *
 * @example
 * ```ts
 * const config = createDefaultRelationConfig();
 * const relations = new NPCRelationRegistry(config);
 * relations.adjustGoodwill('npc_a', 'npc_b', -10);
 * const attitude = relations.getAttitude('npc_a', 'npc_b', factionRel);
 * ```
 */
export class NPCRelationRegistry {
  private readonly config: INPCRelationConfig;

  /** Personal goodwill: Map<"fromId->toId", number>. */
  private readonly relations = new Map<string, number>();

  /** Active fights: Map<"attackerId->defenderId", IFightRecord>. */
  private readonly fights = new Map<string, IFightRecord>();

  /** Scratch array for collect-then-delete pattern in removeNPC/removeFightsFor. */
  private readonly _keysToRemove: string[] = [];

  /** Elapsed simulation time (ms) for fight decay. */
  private elapsedMs = 0;

  constructor(config: INPCRelationConfig) {
    this.config = config;
  }

  // =====================================================================
  // Personal Goodwill
  // =====================================================================

  /** Deterministic composite key for the from->to pair. */
  private key(fromId: string, toId: string): string {
    return `${fromId}${ARROW}${toId}`;
  }

  /** Clamp a value to the configured goodwill bounds. */
  private clamp(value: number): number {
    return Math.max(this.config.goodwillMin, Math.min(this.config.goodwillMax, value));
  }

  /**
   * Get the personal goodwill that `fromId` feels toward `toId`.
   * Returns 0 if no personal relation has been recorded.
   */
  getPersonalGoodwill(fromId: string, toId: string): number {
    return this.relations.get(this.key(fromId, toId)) ?? 0;
  }

  /**
   * Adjust personal goodwill by a signed delta, clamped to
   * `[goodwillMin, goodwillMax]`. Removes the entry if it reaches
   * exactly 0 to keep the map compact.
   */
  adjustGoodwill(fromId: string, toId: string, delta: number): void {
    const k = this.key(fromId, toId);
    const current = this.relations.get(k) ?? 0;
    const clamped = this.clamp(current + delta);

    if (clamped === 0) {
      this.relations.delete(k);
    } else {
      this.relations.set(k, clamped);
    }
  }

  /**
   * Combined attitude: faction relation + personal goodwill.
   *
   * The caller must pre-resolve the faction relation and pass it in,
   * so this registry stays decoupled from faction instances.
   *
   * @param fromId          Source NPC ID.
   * @param toId            Target NPC ID.
   * @param factionRelation Pre-resolved combined faction relation score.
   * @returns Combined attitude clamped to `[goodwillMin, goodwillMax]`.
   */
  getAttitude(fromId: string, toId: string, factionRelation: number): number {
    const personal = this.getPersonalGoodwill(fromId, toId);
    return this.clamp(factionRelation + personal);
  }

  // =====================================================================
  // Fight Registry
  // =====================================================================

  /**
   * Record (or update) a fight between attacker and defender.
   * Accumulates total damage and refreshes the last-hit timestamp.
   */
  registerFight(attackerId: string, defenderId: string, damage: number): void {
    const k = this.key(attackerId, defenderId);
    const existing = this.fights.get(k);

    if (existing) {
      existing.totalDamage += damage;
      existing.lastHitTimeMs = this.elapsedMs;
    } else {
      this.fights.set(k, {
        attackerId,
        defenderId,
        totalDamage: damage,
        startTimeMs: this.elapsedMs,
        lastHitTimeMs: this.elapsedMs,
      });
    }
  }

  /**
   * Advance simulation time and purge expired fight records.
   * Called every A-Life tick (or every frame for online AI).
   */
  updateFights(deltaMs: number): void {
    this.elapsedMs += deltaMs;

    this._keysToRemove.length = 0;
    for (const [k, fight] of this.fights) {
      if (this.elapsedMs - fight.lastHitTimeMs > this.config.fightRememberTimeMs) {
        this._keysToRemove.push(k);
      }
    }
    for (const k of this._keysToRemove) {
      this.fights.delete(k);
    }
  }

  /** Returns `true` if the NPC is currently involved in any tracked fight. */
  isInFight(npcId: string): boolean {
    for (const fight of this.fights.values()) {
      if (fight.attackerId === npcId || fight.defenderId === npcId) return true;
    }
    return false;
  }

  /**
   * Get the defender that `attackerId` is currently attacking, or `null`.
   * Returns the first match if multiple fights exist (most recent by insertion).
   */
  getDefender(attackerId: string): string | null {
    for (const fight of this.fights.values()) {
      if (fight.attackerId === attackerId) return fight.defenderId;
    }
    return null;
  }

  // =====================================================================
  // Action Handlers
  // =====================================================================

  /**
   * Called when an NPC kills another NPC.
   *
   * Adjusts personal goodwill for all witnesses based on their relationship
   * to the victim and the ongoing fight context.
   *
   * Decision matrix per witness (skipping killer and victim themselves):
   * - Same faction as victim:  `killAllyDelta` (negative -- killer harmed an ally)
   * - Victim was attacking this witness: `killEnemyDelta` (positive -- killer saved them)
   * - Otherwise: `killNeutralDelta` (mildly negative -- unprovoked violence)
   *
   * @param killerId        ID of the NPC that performed the kill.
   * @param victimId        ID of the killed NPC.
   * @param victimFaction   Faction ID of the victim.
   * @param witnessIds      IDs of NPCs who witnessed the kill.
   * @param witnessFactions Map from witnessId to their factionId.
   */
  onNPCKilled(
    killerId: string,
    victimId: string,
    victimFaction: string,
    witnessIds: readonly string[],
    witnessFactions: ReadonlyMap<string, string>,
  ): void {
    for (const witnessId of witnessIds) {
      if (witnessId === killerId || witnessId === victimId) continue;

      const witnessFaction = witnessFactions.get(witnessId);
      if (!witnessFaction) continue;

      let delta: number;

      if (witnessFaction === victimFaction) {
        // Witness is same faction as victim -- killer killed their ally.
        delta = this.config.killAllyDelta;
      } else {
        // Check if the victim was actively attacking this witness.
        const wasBeingAttacked = this.fights.has(this.key(victimId, witnessId));
        if (wasBeingAttacked) {
          // Killer helped the witness -- killed their attacker.
          delta = this.config.killEnemyDelta;
        } else {
          // Neutral kill.
          delta = this.config.killNeutralDelta;
        }
      }

      this.adjustGoodwill(witnessId, killerId, delta);
    }

    // Clean up all fight records involving the victim.
    this.removeFightsFor(victimId);
  }

  /**
   * Called when an NPC attacks (hits) another NPC.
   * Registers the fight and applies a per-hit goodwill penalty from the
   * target's perspective toward the attacker.
   */
  onNPCAttacked(attackerId: string, targetId: string, damage: number): void {
    this.registerFight(attackerId, targetId, damage);
    this.adjustGoodwill(targetId, attackerId, this.config.attackHitDelta);
  }

  // =====================================================================
  // Cleanup
  // =====================================================================

  /**
   * Remove all data (personal relations + fight records) involving a specific NPC.
   * Called when an NPC is permanently despawned or removed from the simulation.
   */
  removeNPC(npcId: string): void {
    const prefix = npcId + ARROW;
    const suffix = ARROW + npcId;
    this._keysToRemove.length = 0;
    for (const k of this.relations.keys()) {
      if (k.startsWith(prefix) || k.endsWith(suffix)) {
        this._keysToRemove.push(k);
      }
    }
    for (const k of this._keysToRemove) this.relations.delete(k);
    this.removeFightsFor(npcId);
  }

  /** Remove all fight records involving the given NPC (as attacker or defender). */
  private removeFightsFor(npcId: string): void {
    const prefix = npcId + ARROW;
    const suffix = ARROW + npcId;
    this._keysToRemove.length = 0;
    for (const k of this.fights.keys()) {
      if (k.startsWith(prefix) || k.endsWith(suffix)) {
        this._keysToRemove.push(k);
      }
    }
    for (const k of this._keysToRemove) this.fights.delete(k);
  }

  // =====================================================================
  // Persistence
  // =====================================================================

  /**
   * Serialize all non-zero personal goodwill entries for save data.
   * Fight records are NOT serialized -- they are transient combat memory.
   */
  serialize(): IGoodwillEntry[] {
    const result: IGoodwillEntry[] = [];

    for (const [k, goodwill] of this.relations) {
      if (goodwill === 0) continue;
      const sep = k.indexOf(ARROW);
      const fromId = k.slice(0, sep);
      const toId = k.slice(sep + ARROW.length);
      result.push({ fromId, toId, goodwill });
    }

    return result;
  }

  /**
   * Restore personal goodwill from save data.
   * Clears all existing state (relations, fights, elapsed time) first.
   */
  restore(data: readonly IGoodwillEntry[]): void {
    this.relations.clear();
    this.fights.clear();
    this.elapsedMs = 0;

    for (const { fromId, toId, goodwill } of data) {
      const clamped = this.clamp(goodwill);
      if (clamped !== 0) {
        this.relations.set(this.key(fromId, toId), clamped);
      }
    }
  }

  /** Reset all state -- used on new game or full teardown. */
  reset(): void {
    this.relations.clear();
    this.fights.clear();
    this.elapsedMs = 0;
  }
}
