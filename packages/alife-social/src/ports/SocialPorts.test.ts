import { describe, it, expect } from 'vitest';
import { SocialPorts } from './SocialPorts';

describe('SocialPorts', () => {
  it('exports SocialPresenter token', () => {
    expect(SocialPorts.SocialPresenter).toBeDefined();
    expect(SocialPorts.SocialPresenter.id).toBe('socialPresenter');
    expect(typeof SocialPorts.SocialPresenter.description).toBe('string');
  });

  it('exports NPCSocialProvider token', () => {
    expect(SocialPorts.NPCSocialProvider).toBeDefined();
    expect(SocialPorts.NPCSocialProvider.id).toBe('npcSocialProvider');
    expect(typeof SocialPorts.NPCSocialProvider.description).toBe('string');
  });

  it('has exactly 2 port tokens', () => {
    expect(Object.keys(SocialPorts)).toHaveLength(2);
  });
});
