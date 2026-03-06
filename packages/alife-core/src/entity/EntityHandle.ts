/**
 * EntityHandle — versioned entity references with use-after-free protection.
 *
 * Instead of holding raw entity references that can become dangling after an
 * entity is destroyed, systems hold an EntityHandle. The handle encodes both
 * the entity's slot index and a generation counter. When a slot is reused for
 * a new entity the generation is bumped, making all old handles stale.
 *
 * Bit layout (fits in a JavaScript safe integer):
 *   [47..20] generation  (28 bits, up to ~268 M versions per slot)
 *   [19.. 0] index       (20 bits, up to ~1 M concurrent slots)
 *
 * Usage:
 *   const manager = new EntityHandleManager();
 *   const handle  = manager.alloc('wolf-1');
 *   manager.resolve(handle);   // → 'wolf-1'
 *   manager.free(handle);
 *   manager.resolve(handle);   // → null  (stale)
 */

// ---------------------------------------------------------------------------
// Bit-layout constants
// ---------------------------------------------------------------------------

const INDEX_BITS = 20;
const GEN_BITS = 28;
const INDEX_MASK = (1 << INDEX_BITS) - 1; // 0x000FFFFF — 1 048 575 max slots
const GEN_MASK = (1 << GEN_BITS) - 1;     // 0x0FFFFFFF — 268 435 455 max gen
const MAX_SLOTS = 1 << INDEX_BITS;

// ---------------------------------------------------------------------------
// Handle type & primitives
// ---------------------------------------------------------------------------

/** Opaque numeric type that encodes (generation, index). */
export type EntityHandle = number & { readonly __brand: 'EntityHandle' };

/** Sentinel value for an absent or invalid handle. */
export const NULL_HANDLE = 0 as EntityHandle;

/** Pack (index, generation) into a single handle. */
export function makeHandle(index: number, generation: number): EntityHandle {
  // Use multiplication instead of bit-shift to avoid 32-bit truncation.
  return ((generation & GEN_MASK) * MAX_SLOTS + (index & INDEX_MASK)) as EntityHandle;
}

/** Extract the slot index from a handle. */
export function indexOf(handle: EntityHandle): number {
  return handle & INDEX_MASK;
}

/** Extract the generation counter from a handle. */
export function genOf(handle: EntityHandle): number {
  return Math.floor(handle / MAX_SLOTS) & GEN_MASK;
}

/** Return `true` if the handle is not the null sentinel. */
export function isValidHandle(handle: EntityHandle): boolean {
  return handle !== NULL_HANDLE;
}

/** Human-readable description for logging / debugging. */
export function handleToString(handle: EntityHandle): string {
  if (!isValidHandle(handle)) return 'Entity(NULL)';
  return `Entity(idx=${indexOf(handle)}, gen=${genOf(handle)})`;
}

// ---------------------------------------------------------------------------
// EntityHandleManager
// ---------------------------------------------------------------------------

/**
 * Central registry that owns the slot → entity-id mapping.
 *
 * Recycles freed slots so slot count stays bounded. Old handles pointing at
 * recycled slots resolve to `null` because their stored generation no longer
 * matches the slot's current generation.
 */
export class EntityHandleManager<TId = string> {
  /** Generation counter per slot (index = slot index). */
  private readonly generations: number[] = [];
  /** Entity ID stored in each live slot. `null` = free. */
  private readonly ids: (TId | null)[] = [];
  /** Slot indices available for reuse. */
  private readonly freeList: number[] = [];
  /** Next slot to allocate when freeList is empty. */
  private nextSlot = 0;

  /**
   * Allocate a new handle for the given entity id.
   * @throws if the slot limit is exhausted.
   */
  alloc(id: TId): EntityHandle {
    let index: number;

    if (this.freeList.length > 0) {
      index = this.freeList.pop()!;
    } else {
      if (this.nextSlot >= MAX_SLOTS) {
        throw new Error(`EntityHandleManager: slot limit (${MAX_SLOTS}) reached`);
      }
      index = this.nextSlot++;
      this.generations[index] = 1;
    }

    this.ids[index] = id;
    return makeHandle(index, this.generations[index]);
  }

  /**
   * Release a handle, incrementing the slot's generation.
   * All existing handles pointing at this slot become stale.
   *
   * Does nothing (and does not throw) if the handle is already stale.
   */
  free(handle: EntityHandle): void {
    if (!this.isAlive(handle)) return;
    const index = indexOf(handle);
    this.ids[index] = null;
    this.generations[index] = (this.generations[index] + 1) & GEN_MASK || 1; // skip 0
    this.freeList.push(index);
  }

  /**
   * Resolve a handle to its entity id.
   * Returns `null` if the handle is stale (entity was freed) or null.
   */
  resolve(handle: EntityHandle): TId | null {
    if (!isValidHandle(handle)) return null;
    const index = indexOf(handle);
    if (this.generations[index] !== genOf(handle)) return null;
    return this.ids[index] ?? null;
  }

  /**
   * Return `true` if the handle points to a currently-live slot.
   */
  isAlive(handle: EntityHandle): boolean {
    if (!isValidHandle(handle)) return false;
    const index = indexOf(handle);
    return this.generations[index] === genOf(handle) && this.ids[index] !== null;
  }

  /** Number of currently-live slots. */
  get size(): number {
    return this.nextSlot - this.freeList.length;
  }
}
