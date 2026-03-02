import { describe, it, expect } from 'vitest';
import { PhaserSocialPresenter } from './PhaserSocialPresenter';

describe('PhaserSocialPresenter', () => {
  it('delegates showBubble to handler', () => {
    const calls: unknown[] = [];
    const presenter = new PhaserSocialPresenter({
      showBubble: (npcId, text, durationMs) => calls.push({ npcId, text, durationMs }),
    });

    presenter.showBubble('npc_1', 'Hello', 3000);

    expect(calls).toEqual([{ npcId: 'npc_1', text: 'Hello', durationMs: 3000 }]);
  });

});
