import {
  applyAIFuzziness,
  createAIDecisionSource,
  FreecivAIDecisionSource,
} from '@game/ai/AIDecisionSource';
import { createAIProfile } from '@game/ai/AIProfile';
import { FreecivRandom } from '@game/random/FreecivRandom';

describe('Freeciv AI decision source', () => {
  it('consumes the shared Freeciv sequence in call order', () => {
    const first = new FreecivAIDecisionSource(new FreecivRandom(7), createAIProfile('easy'));
    const second = new FreecivAIDecisionSource(new FreecivRandom(7), createAIProfile('easy'));

    first.sample('unrelated');

    expect(first.sample('target:1')).not.toBe(second.sample('target:1'));
  });

  it('uses the game-owned stream across AI domains and players', () => {
    const random = new FreecivRandom(7);
    const game = {
      id: 'game-1',
      currentTurn: 7,
      players: new Map([['ai-1', { aiLevel: 'easy' }]]),
      random,
    } as any;
    const expected = new FreecivRandom(7);

    const first = createAIDecisionSource(game, 'ai-1', 'military');
    const otherDomain = createAIDecisionSource(game, 'ai-1', 'treasury');

    expect(first.sample('choice')).toBe(expected.next(0xffff_ffff) / 0xffff_ffff);
    expect(otherDomain.sample('choice')).toBe(expected.next(0xffff_ffff) / 0xffff_ffff);
  });

  it('matches Freeciv boolean-flip fuzziness by difficulty', () => {
    expect(applyAIFuzziness(createAIProfile('restricted'), 0.399, true)).toBe(false);
    expect(applyAIFuzziness(createAIProfile('restricted'), 0.4, true)).toBe(true);
    expect(applyAIFuzziness(createAIProfile('easy'), 0.299, false)).toBe(true);
    expect(applyAIFuzziness(createAIProfile('normal'), 0, true)).toBe(true);
    expect(applyAIFuzziness(createAIProfile('normal'), 0, false)).toBe(false);
  });
});
