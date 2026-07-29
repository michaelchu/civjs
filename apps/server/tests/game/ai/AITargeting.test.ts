import { potentiallyHostilePlayerIds } from '@game/ai/AITargeting';

describe('FreecivAITargeting', () => {
  it('lets virtual attackers plan for wars, no-contact players, and war countdowns', () => {
    const targets = potentiallyHostilePlayerIds(
      ['ai', 'enemy', 'unknown', 'planned', 'peaceful', 'ally'],
      'ai',
      new Set(['enemy']),
      new Set(['ally']),
      new Set(['unknown']),
      {
        diplomacy: {
          planned: { love: -100, warDesire: 10, countdown: 2 },
          peaceful: { love: 100, warDesire: 0, countdown: 0 },
          ally: { love: -1000, warDesire: 1000, countdown: 10 },
        },
      }
    );

    expect(targets).toEqual(new Set(['enemy', 'unknown', 'planned']));
  });
});
