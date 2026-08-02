import { FreecivAIDomesticController } from '@game/ai/AIDomesticController';
import { createAIState } from '@game/ai/AIStateStore';

describe('Freeciv AI domestic controller', () => {
  /**
   * @evidence stack
   * @contract Scenario setup can lock an individual AI player's economic rates for deterministic CivJS runs.
   */
  it('does not alter economic rates when the scenario locks them for the AI player', async () => {
    const getEconomicManager = jest.fn();
    const game = {
      players: new Map([['ai', { playerNumber: 2 }]]),
      config: {
        scenarioSetup: {
          players: [
            { playerNumber: 1, lockEconomicRates: true },
            { playerNumber: 2, lockEconomicRates: true },
          ],
        },
      },
      turnManager: { getEconomicManager },
    };

    const actions = await new FreecivAIDomesticController({} as any).manageEconomy(
      game as any,
      'ai',
      createAIState()
    );

    expect(actions).toBe(0);
    expect(getEconomicManager).not.toHaveBeenCalled();
  });
});
