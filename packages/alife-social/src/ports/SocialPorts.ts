// ports/SocialPorts.ts
// Port tokens for the social plugin.

import { createPortToken } from '@alife-sdk/core';
import type { ISocialPresenter } from './ISocialPresenter';
import type { INPCSocialProvider } from './INPCSocialProvider';

/**
 * Social subsystem port tokens.
 *
 * - SocialPresenter: required — renders bubbles and plays sounds
 * - NPCSocialProvider: required — provides NPC data for social evaluation
 */
export const SocialPorts = {
  SocialPresenter: createPortToken<ISocialPresenter>(
    'socialPresenter',
    'Renders social bubbles and plays vocalizations',
  ),
  NPCSocialProvider: createPortToken<INPCSocialProvider>(
    'npcSocialProvider',
    'Provides online NPC data for social interaction evaluation',
  ),
} as const;
