import { FreecivAIPlayerController } from '@game/ai/AIPlayerController';
import { FreecivAIUnitController } from '@game/ai/AIUnitController';
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

  it('moves a barbarian leader toward its nearest guard and attacks adjacent enemies', async () => {
    const executeUnitAction = jest.fn().mockResolvedValue({ success: true });
    const attackUnit = jest.fn().mockResolvedValue(undefined);
    const leader = {
      id: 'barbarian-leader',
      playerId: 'barbarian',
      unitTypeId: 'leader',
      x: 0,
      y: 0,
      movementLeft: 3,
    };
    const guard = {
      id: 'barbarian-guard',
      playerId: 'barbarian',
      unitTypeId: 'warriors',
      x: 2,
      y: 0,
      movementLeft: 3,
    };
    const farGuard = {
      id: 'barbarian-far-guard',
      playerId: 'barbarian',
      unitTypeId: 'warriors',
      x: 10,
      y: 0,
      movementLeft: 3,
    };
    const enemy = {
      id: 'enemy-a',
      playerId: 'foreign',
      unitTypeId: 'warriors',
      x: 3,
      y: 0,
      movementLeft: 3,
    };
    const farEnemy = {
      id: 'enemy-b',
      playerId: 'foreign',
      unitTypeId: 'warriors',
      x: 11,
      y: 0,
      movementLeft: 3,
    };
    const units = new Map([
      [leader.id, leader],
      [guard.id, guard],
      [farGuard.id, farGuard],
      [enemy.id, enemy],
      [farEnemy.id, farEnemy],
    ]);
    const game = {
      currentTurn: 12,
      unitManager: {
        getPlayerUnits: () => [leader, guard, farGuard],
        getAllUnits: () => units,
        getUnit: (id: string) => units.get(id),
        getUnitType: (id: string) =>
          id === 'leader' ? { roles: ['BarbarianLeader'] } : { roles: [] },
        canUnitPerformAction: (_id: string, action: ActionType) => action === ActionType.GOTO,
        executeUnitAction,
        attackUnit,
      },
      cityManager: { getAllCities: () => [] },
      mapManager: {
        getDistance: (x1: number, y1: number, x2: number, y2: number) =>
          Math.abs(x1 - x2) + Math.abs(y1 - y2),
      },
    };

    const actions = await new FreecivAIUnitController({} as any).manageBarbarians(
      game as any,
      'barbarian',
      createAIState()
    );

    expect(actions).toBe(3);
    expect(executeUnitAction).toHaveBeenCalledWith(
      leader.id,
      ActionType.GOTO,
      guard.x,
      guard.y,
      'barbarian'
    );
    expect(attackUnit).toHaveBeenCalledWith(guard.id, enemy.id);
    expect(attackUnit).toHaveBeenCalledWith(farGuard.id, farEnemy.id);
  });

  it('sentries a co-located leader and sends a warrior toward the nearest city', async () => {
    const executeUnitAction = jest.fn().mockResolvedValue({ success: true });
    const leader = {
      id: 'barbarian-leader',
      playerId: 'barbarian',
      unitTypeId: 'leader',
      x: 1,
      y: 1,
      movementLeft: 3,
    };
    const warrior = {
      id: 'barbarian-warrior',
      playerId: 'barbarian',
      unitTypeId: 'warriors',
      x: 1,
      y: 1,
      movementLeft: 3,
    };
    const game = {
      currentTurn: 7,
      unitManager: {
        getPlayerUnits: () => [leader, warrior],
        getAllUnits: () =>
          new Map([
            [leader.id, leader],
            [warrior.id, warrior],
          ]),
        getUnit: () => warrior,
        getUnitType: (id: string) =>
          id === 'leader' ? { roles: ['BarbarianLeader'] } : { roles: [] },
        canUnitPerformAction: (_id: string, action: ActionType) =>
          action === ActionType.SENTRY || action === ActionType.GOTO,
        executeUnitAction,
      },
      cityManager: {
        getAllCities: () => [{ id: 'foreign-city', playerId: 'foreign', x: 8, y: 4 }],
      },
      mapManager: { getDistance: () => 4 },
    };
    const state = createAIState();

    const actions = await new FreecivAIUnitController({} as any).manageBarbarians(
      game as any,
      'barbarian',
      state
    );

    expect(actions).toBe(2);
    expect(executeUnitAction).toHaveBeenNthCalledWith(
      1,
      leader.id,
      ActionType.SENTRY,
      undefined,
      undefined,
      'barbarian'
    );
    expect(executeUnitAction).toHaveBeenNthCalledWith(
      2,
      warrior.id,
      ActionType.GOTO,
      8,
      4,
      'barbarian'
    );
    expect(state.unitTasks[warrior.id]).toMatchObject({
      role: 'attack',
      targetId: 'foreign-city',
      assignedTurn: 7,
    });
  });

  it('skips immobile units, failed leader actions, and warriors without a valid target', async () => {
    const executeUnitAction = jest.fn().mockResolvedValue({ success: false });
    const leader = {
      id: 'immobile-leader',
      playerId: 'barbarian',
      unitTypeId: 'leader',
      x: 0,
      y: 0,
      movementLeft: 0,
    };
    const warrior = {
      id: 'immobile-warrior',
      playerId: 'barbarian',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      movementLeft: 0,
    };
    const game = {
      currentTurn: 1,
      unitManager: {
        getPlayerUnits: () => [leader, warrior],
        getAllUnits: () => new Map(),
        getUnit: () => undefined,
        getUnitType: (id: string) =>
          id === 'leader' ? { roles: ['BarbarianLeader'] } : { roles: [] },
        canUnitPerformAction: jest.fn(),
        executeUnitAction,
      },
      cityManager: { getAllCities: () => [] },
      mapManager: { getDistance: () => 1 },
    };

    const actions = await new FreecivAIUnitController({} as any).manageBarbarians(
      game as any,
      'barbarian',
      createAIState()
    );

    expect(actions).toBe(0);
    expect(executeUnitAction).not.toHaveBeenCalled();
  });
});
