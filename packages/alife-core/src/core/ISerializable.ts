/**
 * Contract for subsystems that support save/load.
 *
 * TState must be a plain JSON-serialisable object (no functions, Maps, Sets).
 */
export interface ISerializable<TState> {
  /** Capture the current state as a plain JSON-serialisable object. */
  serialize(): TState;
  /** Overwrite internal state from a previously serialised snapshot. */
  restore(state: TState): void;
}
