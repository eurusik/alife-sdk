// core/PortTokens.ts
// Built-in port tokens for the standard A-Life kernel adapters.
//
// Third-party plugins can create their own tokens via createPortToken<T>().

import { createPortToken } from './PortRegistry';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';
import type { IRandom } from '../ports/IRandom';
import type { IRuntimeClock } from '../ports/IRuntimeClock';

/**
 * Well-known port tokens shipped with the SDK.
 *
 * The first three (`EntityAdapter`, `PlayerPosition`, `EntityFactory`) are
 * required by the kernel — `init()` will report a diagnostic error if any
 * is missing. The rest are optional capability ports consumed by plugins.
 *
 * @example
 * ```ts
 * import { Ports } from '@alife-sdk/core';
 *
 * kernel.provide(Ports.EntityAdapter, myAdapter);
 * kernel.provide(Ports.PlayerPosition, myPositionProvider);
 * kernel.provide(Ports.EntityFactory, myFactory);
 * ```
 */
export const Ports = {
  EntityAdapter: createPortToken<IEntityAdapter>(
    'entityAdapter',
    'Bridge between kernel and host entity system',
  ),
  PlayerPosition: createPortToken<IPlayerPositionProvider>(
    'playerPosition',
    'Provides player world position for online/offline checks',
  ),
  EntityFactory: createPortToken<IEntityFactory>(
    'entityFactory',
    'Creates and destroys game entities on spawn/despawn',
  ),
  Random: createPortToken<IRandom>(
    'random',
    'PRNG for simulation randomness',
  ),
  RuntimeClock: createPortToken<IRuntimeClock>(
    'runtimeClock',
    'Monotonic real-time ms for cooldowns and memory aging',
  ),
} as const;

/**
 * Port tokens that the kernel unconditionally requires.
 *
 * `EntityAdapter`, `PlayerPosition`, and `EntityFactory` are no longer listed
 * here — the kernel auto-provides no-op defaults for them in `init()` when the
 * host does not supply real implementations (same pattern as `Random`).
 * Plugins that genuinely need real implementations declare them via
 * `plugin.requiredPorts`.
 */
export const REQUIRED_PORTS: readonly import('./PortRegistry').PortToken<unknown>[] = [];
