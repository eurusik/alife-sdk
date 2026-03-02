/**
 * Port tokens for the simulation plugin.
 *
 * Plugins declare required ports via `requiredPorts` — the kernel validates
 * them at init time. The host game engine provides concrete implementations
 * via `kernel.provide(token, impl)`.
 */

import { createPortToken } from '@alife-sdk/core';
import type { ISimulationBridge } from './ISimulationBridge';

export const SimulationPorts = {
  SimulationBridge: createPortToken<ISimulationBridge>(
    'simulationBridge',
    'Bridge for offline combat damage, morale, and liveness checks',
  ),
} as const;
