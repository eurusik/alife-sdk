export interface RegistryOptions<TConfig> {
  /** Human-readable name for error messages (e.g., 'MonsterRegistry'). */
  name: string;
  /** Optional validation function. Returns error messages array (empty = valid). */
  validate?: (config: TConfig) => string[];
}

/**
 * Generic, freezable, validated ID → config registry.
 *
 * Base class for all content registries. Supports unique ID enforcement,
 * optional validation on register(), and freezing to prevent mutation after init().
 *
 * @typeParam TId     - String-like identifier type. Default: `string`.
 * @typeParam TConfig - Shape of the stored configuration object.
 */
export class Registry<TId extends string = string, TConfig = unknown> {
  private readonly entries = new Map<TId, TConfig>();
  private readonly name: string;
  private readonly validate?: (config: TConfig) => string[];
  private frozen = false;

  constructor(options: RegistryOptions<TConfig>) {
    this.name = options.name;
    this.validate = options.validate;
  }

  /** Register a new entry. Throws if frozen, the ID is duplicate, or validation fails. Returns `this` for chaining. */
  register(id: TId, config: TConfig): this {
    this.ensureNotFrozen('register');
    this.ensureUnique(id);
    this.runValidation(id, config);
    this.entries.set(id, config);
    return this;
  }

  /** Retrieve an entry by ID. Throws if not found. */
  get(id: TId): TConfig {
    const config = this.entries.get(id);
    if (config === undefined && !this.entries.has(id)) {
      throw new Error(`[${this.name}] ID "${id}" not found`);
    }
    return config as TConfig;
  }

  /** Retrieve an entry by ID, or `undefined` if not found. */
  tryGet(id: TId): TConfig | undefined {
    return this.entries.get(id);
  }

  /** Check whether an ID is registered. */
  has(id: TId): boolean {
    return this.entries.has(id);
  }

  /** Return all registered IDs as an array. */
  ids(): TId[] {
    return [...this.entries.keys()];
  }

  /** Number of registered entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Iterate over [id, config] pairs. */
  [Symbol.iterator](): IterableIterator<[TId, TConfig]> {
    return this.entries.entries();
  }

  /** Lock the registry. All subsequent register() calls will throw. Called automatically by ALifeKernel.init(). */
  freeze(): void {
    this.frozen = true;
  }

  /** True if the registry has been frozen. */
  get isFrozen(): boolean {
    return this.frozen;
  }

  private ensureNotFrozen(operation: string): void {
    if (this.frozen) {
      throw new Error(`[${this.name}] Cannot ${operation}: registry is frozen`);
    }
  }

  private ensureUnique(id: TId): void {
    if (this.entries.has(id)) {
      throw new Error(`[${this.name}] ID "${id}" already registered`);
    }
  }

  private runValidation(id: TId, config: TConfig): void {
    if (!this.validate) return;
    const errors = this.validate(config);
    if (errors.length > 0) {
      throw new Error(
        `[${this.name}] Invalid config for "${id}": ${errors.join('; ')}`,
      );
    }
  }
}
