/**
 * Bi-directional mapping between story IDs and NPC entity IDs.
 *
 * Quest-critical NPCs are registered here so the simulation can protect
 * them from offline combat death, redundancy cleanup, and other culling.
 */

// ---------------------------------------------------------------------------
// Serialized shape
// ---------------------------------------------------------------------------

export interface IStoryRegistryEntry {
  readonly storyId: string;
  readonly npcId: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class StoryRegistry {
  private readonly storyToNpc = new Map<string, string>();
  private readonly npcToStory = new Map<string, string>();

  /** Register a story NPC. Overwrites any previous mapping for either key. */
  register(storyId: string, npcId: string): void {
    this.removeExisting(storyId, npcId);
    this.storyToNpc.set(storyId, npcId);
    this.npcToStory.set(npcId, storyId);
  }

  /** Remove by story ID. */
  unregister(storyId: string): void {
    const npcId = this.storyToNpc.get(storyId);
    if (npcId === undefined) return;
    this.storyToNpc.delete(storyId);
    this.npcToStory.delete(npcId);
  }

  /** Remove by NPC entity ID. */
  removeByNpcId(npcId: string): void {
    const storyId = this.npcToStory.get(npcId);
    if (storyId === undefined) return;
    this.npcToStory.delete(npcId);
    this.storyToNpc.delete(storyId);
  }

  /** True if the given NPC is registered as a story NPC. */
  isStoryNPC(npcId: string): boolean {
    return this.npcToStory.has(npcId);
  }

  /** Look up story ID by NPC entity ID. */
  getStoryId(npcId: string): string | undefined {
    return this.npcToStory.get(npcId);
  }

  /** Look up NPC entity ID by story ID. */
  getNpcId(storyId: string): string | undefined {
    return this.storyToNpc.get(storyId);
  }

  /** Number of registered story NPCs. */
  get size(): number {
    return this.storyToNpc.size;
  }

  /** Serialize all entries for save/load. */
  serialize(): IStoryRegistryEntry[] {
    const entries: IStoryRegistryEntry[] = [];
    for (const [storyId, npcId] of this.storyToNpc) {
      entries.push({ storyId, npcId });
    }
    return entries;
  }

  /** Restore from serialized entries. Clears existing state first. */
  restore(entries: readonly IStoryRegistryEntry[]): void {
    this.clear();
    for (const { storyId, npcId } of entries) {
      this.register(storyId, npcId);
    }
  }

  /** Remove all entries. */
  clear(): void {
    this.storyToNpc.clear();
    this.npcToStory.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private removeExisting(storyId: string, npcId: string): void {
    const existingNpc = this.storyToNpc.get(storyId);
    if (existingNpc !== undefined) {
      this.npcToStory.delete(existingNpc);
    }

    const existingStory = this.npcToStory.get(npcId);
    if (existingStory !== undefined) {
      this.storyToNpc.delete(existingStory);
    }
  }
}
