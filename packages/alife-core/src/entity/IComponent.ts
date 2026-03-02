/**
 * Lifecycle contract for an entity component.
 *
 * Components encapsulate a single concern (health, movement, combat, AI)
 * and are attached to entities by name.
 */
export interface IComponent {
  /** Unique component identifier used in hasComponent() / getComponent(). */
  readonly name: string;
  /** Called once when the component is first attached to an entity. */
  init(): void;
  /** Called every frame. `delta` is seconds since the last frame. */
  update(delta: number): void;
  /** Called when the component or its owner entity is destroyed. Release resources here. */
  destroy(): void;
}
