// ports/AIPorts.ts
// Port tokens for the AI plugin.

import { createPortToken } from '@alife-sdk/core';
import type { ICoverPointSource } from './ICoverPointSource';
import type { IPerceptionProvider } from './IPerceptionProvider';

/**
 * AI subsystem port tokens.
 *
 * All AI ports are optional — the plugin works without them but
 * gains additional capabilities when they're provided.
 */
export const AIPorts = {
  CoverPointSource: createPortToken<ICoverPointSource>(
    'coverPointSource',
    'Provides cover point positions from host level data',
  ),
  PerceptionProvider: createPortToken<IPerceptionProvider>(
    'perceptionProvider',
    'Provides spatial entity queries for perception system',
  ),
} as const;
