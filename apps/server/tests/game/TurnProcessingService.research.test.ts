import { TurnProcessingService } from '@game/services/TurnProcessingService';

describe('TurnProcessingService research processing', () => {
  it('adds the sum of the player city science outputs to research', async () => {
    const cityManager = {
      getPlayerCities: jest
        .fn()
        .mockReturnValue([
          { sciencePerTurn: 2 },
          { sciencePerTurn: 3 },
          { sciencePerTurn: undefined },
        ]),
    };
    const researchManager = {
      addResearchPoints: jest.fn().mockResolvedValue(null),
    };
    const service = new TurnProcessingService(
      'game-1',
      {} as never,
      cityManager as never,
      researchManager as never
    );

    // @reference reference/freeciv/server/techtools.c:650-719
    await expect(service.processResearch('player-1')).resolves.toBe(false);
    expect(researchManager.addResearchPoints).toHaveBeenCalledWith('player-1', 5);
  });
});
