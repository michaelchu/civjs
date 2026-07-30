import { FreecivAIPlayerController } from '@game/ai/AIPlayerController';
import { createAIState } from '@game/ai/AIStateStore';
import { ActionType } from '@app-types/shared/actions';

describe('Freeciv barbarian AI', () => {
  it('uses the primitive barbarian phase and pillages before strategic AI work', async () => {
    const executeUnitAction = jest.fn().mockResolvedValue({ success: true });
    const warrior = {
      id: 'barbarian-warrior',
      playerId: 'barbarian',
      unitTypeId: 'warriors',
      x: 2,
      y: 2,
      movementLeft: 3,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
    };
    const game = {
      id: 'game',
      currentTurn: 10,
      players: new Map([
        [
          'barbarian',
          {
            id: 'barbarian',
            nation: 'barbarian',
            civilization: 'barbarian-land',
            isAI: true,
          },
        ],
      ]),
      unitManager: {
        getPlayerUnits: () => [warrior],
        getAllUnits: () => new Map([[warrior.id, warrior]]),
        getUnit: () => warrior,
        getUnitType: () => ({ id: 'warriors', attack: 1, defense: 1, roles: [] }),
        canUnitPerformAction: (_id: string, action: ActionType) => action === ActionType.PILLAGE,
        executeUnitAction,
      },
      cityManager: {
        getAllCities: () => [],
      },
      mapManager: {
        getDistance: () => 1,
      },
    };
    const run = jest.fn(async (_label, decision) => decision());
    const actions = await new FreecivAIPlayerController({} as any).processPlayer(
      'game',
      game as any,
      'barbarian',
      createAIState(),
      run
    );

    expect(actions).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('barbarian units', expect.any(Function));
    expect(executeUnitAction).toHaveBeenCalledWith(
      warrior.id,
      ActionType.PILLAGE,
      undefined,
      undefined,
      'barbarian'
    );
  });
});
