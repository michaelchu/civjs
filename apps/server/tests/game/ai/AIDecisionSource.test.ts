import {
  applyAIFuzziness,
  createAIDecisionSource,
  FreecivAIDecisionSource,
} from '@game/ai/AIDecisionSource';
import { createAIProfile } from '@game/ai/AIProfile';

describe('Freeciv AI decision source', () => {
  it('replays the same keyed decision without depending on call order', () => {
    const first = new FreecivAIDecisionSource('seed:turn:player', createAIProfile('easy'));
    const second = new FreecivAIDecisionSource('seed:turn:player', createAIProfile('easy'));

    first.sample('unrelated');

    expect(first.sample('target:1')).toBe(second.sample('target:1'));
    expect(first.fuzzy('target:1', true)).toBe(second.fuzzy('target:1', true));
  });

  it('includes game seed, turn, player, and domain in factory decisions', () => {
    const game = {
      id: 'game-1',
      currentTurn: 7,
      players: new Map([['ai-1', { aiLevel: 'easy' }]]),
      mapManager: { getMapData: () => ({ seed: 'map-seed' }) },
    } as any;

    const first = createAIDecisionSource(game, 'ai-1', 'military');
    const same = createAIDecisionSource(game, 'ai-1', 'military');
    const otherDomain = createAIDecisionSource(game, 'ai-1', 'treasury');

    expect(first.sample('choice')).toBe(same.sample('choice'));
    expect(first.sample('choice')).not.toBe(otherDomain.sample('choice'));

    game.currentTurn = 8;
    expect(first.sample('choice')).not.toBe(
      createAIDecisionSource(game, 'ai-1', 'military').sample('choice')
    );
  });

  it('matches Freeciv boolean-flip fuzziness by difficulty', () => {
    expect(applyAIFuzziness(createAIProfile('restricted'), 0.399, true)).toBe(false);
    expect(applyAIFuzziness(createAIProfile('restricted'), 0.4, true)).toBe(true);
    expect(applyAIFuzziness(createAIProfile('easy'), 0.299, false)).toBe(true);
    expect(applyAIFuzziness(createAIProfile('normal'), 0, true)).toBe(true);
    expect(applyAIFuzziness(createAIProfile('normal'), 0, false)).toBe(false);
  });
});
