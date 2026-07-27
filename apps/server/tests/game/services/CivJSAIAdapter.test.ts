import { CivJSAIAdapter } from '@game/services/CivJSAIAdapter';

describe('CivJSAIAdapter', () => {
  it('uses authoritative managers for baseline research, production, and diplomacy', async () => {
    const diplomacyManager = {
      getSnapshot: jest.fn().mockResolvedValue({
        nations: [
          {
            id: 'human',
            relation: {
              proposal: {
                id: 'proposal',
                recipientId: 'ai',
                status: 'pending',
                clauses: [{ type: 'peace' }],
              },
            },
          },
        ],
      }),
      respondToTreaty: jest.fn().mockResolvedValue(undefined),
    };
    const setCurrentResearch = jest.fn().mockResolvedValue(undefined);
    const setCityProduction = jest.fn().mockResolvedValue(true);
    const game = {
      players: new Map([
        ['human', { id: 'human', isAI: false }],
        ['ai', { id: 'ai', isAI: true }],
      ]),
      researchManager: {
        getPlayerResearch: () => ({ currentTech: undefined }),
        getAvailableTechnologies: () => [
          { id: 'expensive', cost: 30 },
          { id: 'cheap', cost: 10 },
        ],
        setCurrentResearch,
      },
      cityManager: {
        getPlayerCities: () => [{ id: 'city', currentProduction: null }],
        setCityProduction,
      },
    };

    const actions = await new CivJSAIAdapter(diplomacyManager as any).processTurn(
      'game',
      game as any
    );

    expect(actions).toBe(3);
    expect(setCurrentResearch).toHaveBeenCalledWith('ai', 'cheap');
    expect(setCityProduction).toHaveBeenCalledWith('city', 'unit', 'warriors', 'ai');
    expect(diplomacyManager.respondToTreaty).toHaveBeenCalledWith(
      'game',
      'ai',
      'human',
      'proposal',
      true
    );
  });
});
