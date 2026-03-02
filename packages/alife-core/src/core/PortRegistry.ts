// core/PortRegistry.ts
// Type-safe service registry with token-based port resolution.
//
// Ports are external adapters (entity adapter, player position, pathfinder)
// that the host game engine supplies to the A-Life kernel. PortRegistry
// replaces the hard-coded IALifeKernelPorts interface with an extensible
// token-based lookup, allowing third-party plugins to declare and consume
// custom ports without modifying the kernel's constructor signature.

// ---------------------------------------------------------------------------
// PortToken
// ---------------------------------------------------------------------------

/**
 * Opaque token identifying a port type.
 *
 * The phantom `_brand` field carries the port's TypeScript type without
 * contributing to the runtime shape, enabling type-safe `require<T>()`.
 *
 * @example
 * ```ts
 * const MyPort = createPortToken<IMyAdapter>('myAdapter', 'Bridge to XYZ');
 * kernel.provide(MyPort, new MyAdapterImpl());
 * const adapter = kernel.portRegistry.require(MyPort); // typed as IMyAdapter
 * ```
 */
export interface PortToken<T> {
  readonly id: string;
  readonly description: string;
  /** @internal Phantom field for type inference — never set at runtime. */
  readonly _brand?: T;
}

/**
 * Create a new port token with a unique id and human-readable description.
 *
 * @param id          - Unique identifier (e.g. `'entityAdapter'`).
 * @param description - Short explanation shown in diagnostics.
 */
export function createPortToken<T>(id: string, description: string): PortToken<T> {
  return { id, description };
}

// ---------------------------------------------------------------------------
// PortRegistry
// ---------------------------------------------------------------------------

/**
 * Runtime container for port implementations, keyed by {@link PortToken}.
 *
 * Designed for a single-phase lifecycle:
 *   1. `provide()` during setup (before `kernel.init()`).
 *   2. `require()` / `tryGet()` during init and at runtime.
 *
 * Duplicate registrations throw immediately to surface wiring bugs early.
 */
export class PortRegistry {
  private readonly ports = new Map<string, unknown>();

  /**
   * Register a port implementation.
   *
   * @throws {Error} If a port with the same token id is already registered.
   */
  provide<T>(token: PortToken<T>, impl: T): void {
    if (this.ports.has(token.id)) {
      throw new Error(
        `[PortRegistry] Port "${token.id}" already registered. ` +
        `Each port token must be provided exactly once.`,
      );
    }
    this.ports.set(token.id, impl);
  }

  /**
   * Retrieve a required port.
   *
   * @throws {Error} If the port has not been provided.
   */
  require<T>(token: PortToken<T>): T {
    const impl = this.ports.get(token.id);
    if (impl === undefined) {
      throw new Error(
        `[PortRegistry] Required port "${token.id}" (${token.description}) ` +
        `not provided. Call kernel.provide(token, impl) before init().`,
      );
    }
    return impl as T;
  }

  /** Retrieve an optional port, returning `undefined` when absent. */
  tryGet<T>(token: PortToken<T>): T | undefined {
    return this.ports.get(token.id) as T | undefined;
  }

  /** Check whether a port has been provided. */
  has(token: PortToken<unknown>): boolean {
    return this.ports.has(token.id);
  }

  /** Return all registered port ids (useful for diagnostics). */
  registeredIds(): string[] {
    return [...this.ports.keys()];
  }
}
