import { Registry } from './Registry';

/** Definition of a SmartTerrain task type (e.g. patrol, guard, camp). */
export interface ITaskTypeDefinition {
  /** Human-readable display name. */
  readonly name: string;
  /** BehaviorScheme ID to activate when this task is assigned. */
  readonly defaultBehavior: string;
  /** Scheduling priority. Higher = assigned first when multiple tasks compete. */
  readonly priority: number;
}

/** Registry of task types. Call registerDefaults() for the 4 built-in types (patrol, guard, camp, wander). */
export class TaskTypeRegistry extends Registry<string, ITaskTypeDefinition> {
  constructor() {
    super({ name: 'TaskTypeRegistry' });
  }

  /** Register the 4 built-in task types (patrol, guard, camp, wander). Returns `this` for chaining. */
  registerDefaults(): this {
    return this
      .register('patrol', { name: 'Patrol', defaultBehavior: 'patrol', priority: 10 })
      .register('guard', { name: 'Guard', defaultBehavior: 'guard', priority: 20 })
      .register('camp', { name: 'Camp', defaultBehavior: 'camp', priority: 5 })
      .register('wander', { name: 'Wander', defaultBehavior: 'wander', priority: 1 });
  }
}
