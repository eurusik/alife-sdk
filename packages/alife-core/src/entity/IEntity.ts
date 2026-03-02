/**
 * Minimal entity contract used by AI states, GOAP actions, and the state machine.
 *
 * This is the simulation's view of an entity — not the full game object.
 * Host engines provide a richer object; the kernel only consumes this slice.
 */
export interface IEntity {
  /** Globally unique identifier. */
  readonly id: string;
  /** Type discriminator (e.g. 'npc', 'monster', 'player'). */
  readonly entityType: string;
  /** True while the entity has not been killed or destroyed. */
  readonly isAlive: boolean;
  /** Arbitrary key-value store for cross-system data. */
  readonly metadata?: ReadonlyMap<string, unknown>;
  /** Current X world position (px). Mutable — updated by the simulation. */
  x: number;
  /** Current Y world position (px). Mutable — updated by the simulation. */
  y: number;
  /** Whether the entity participates in physics and AI updates. */
  active: boolean;
  /** Move the entity to a new world position. */
  setPosition(x: number, y: number): void;
  /** Enable/disable the entity. Returns `this` for chaining. */
  setActive(value: boolean): this;
  /** Show/hide the entity. Returns `this` for chaining. */
  setVisible(value: boolean): this;
  /** Check if a named component is attached. */
  hasComponent(name: string): boolean;
  /** Retrieve a component by name. Throws if not found. */
  getComponent<T>(name: string): T;
}
